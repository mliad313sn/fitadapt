import type { ExerciseEdge } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import {
  buildEdges,
  EQUIPMENT_PRESETS,
  findProgressionCycle,
  ladderEdges,
  ladderRank,
  M02_LADDERS,
  missingInverseEdges,
  reachable,
  seedLibrary,
  stimulusSimilarity,
  substituteCoverage,
  validateGraph,
  LADDERS,
  SEED_EXERCISES,
  UNRESTRICTED_SAFETY_PROFILE,
  substitute,
  doableWith,
} from './index.js';

/** Goal condition (3): graph integrity, coverage per equipment set, M02 ladders complete. */
describe('knowledge graph integrity', () => {
  const lib = seedLibrary();
  const progress = lib.edges.filter((e) => e.type === 'PROGRESSES_TO');

  it('has typed edges of all four kinds', () => {
    const counts = Object.fromEntries(['PROGRESSES_TO', 'REGRESSES_TO', 'SUBSTITUTES', 'REQUIRES'].map((t) => [t, lib.edges.filter((e) => e.type === t).length]));
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(0);
    expect(counts.PROGRESSES_TO).toBe(counts.REGRESSES_TO);
  });

  it('progression chains are acyclic (PROGRESSES_TO and REGRESSES_TO)', () => {
    expect(findProgressionCycle(lib.edges, 'PROGRESSES_TO')).toBeNull();
    expect(findProgressionCycle(lib.edges, 'REGRESSES_TO')).toBeNull();
  });

  it('the cycle check catches a cycle (mutation)', () => {
    const cyclic: ExerciseEdge[] = [...lib.edges, { type: 'PROGRESSES_TO', from: 'pull_up', to: 'dead_hang', ladderId: 'bad', source: 'test', validated: false }];
    expect(findProgressionCycle(cyclic)).toEqual(expect.arrayContaining(['pull_up', 'dead_hang']));
    expect(validateGraph(lib.exercises, cyclic).some((p) => p.startsWith('PROGRESSES_TO cycle'))).toBe(true);
    // A cycle introduced by a ladder definition is caught the same way.
    const edges = buildEdges(SEED_EXERCISES, [...LADDERS, { id: 'loop', steps: [['push_up'], ['wall_push_up']] }]);
    expect(findProgressionCycle(edges)).not.toBeNull();
  });

  it('every PROGRESSES_TO has a matching REGRESSES_TO, and the reverse', () => {
    expect(missingInverseEdges(lib.edges)).toEqual([]);
    for (const e of progress) {
      expect(lib.edges.some((r) => r.type === 'REGRESSES_TO' && r.from === e.to && r.to === e.from), `${e.from} → ${e.to}`).toBe(true);
    }
  });

  it('the symmetry check catches a missing REGRESSES_TO (mutation)', () => {
    const first = progress[0] as ExerciseEdge;
    const broken = lib.edges.filter((e) => !(e.type === 'REGRESSES_TO' && e.from === first.to && e.to === first.from));
    expect(missingInverseEdges(broken)).toEqual([`PROGRESSES_TO ${first.from} → ${first.to} has no REGRESSES_TO ${first.to} → ${first.from}`]);
    const orphan: ExerciseEdge = { type: 'REGRESSES_TO', from: 'push_up', to: 'pull_up', ladderId: 'x', source: 'test', validated: false };
    expect(missingInverseEdges([orphan])).toHaveLength(1);
  });

  it('flags unknown references, mismatched REQUIRES edges and missing wording', () => {
    const edges: ExerciseEdge[] = [
      ...lib.edges,
      { type: 'SUBSTITUTES', from: 'push_up', to: 'ghost', similarity: 0.9, source: 't', validated: false },
      { type: 'REQUIRES', from: 'push_up', to: 'barbell', group: 0, source: 't', validated: false },
    ];
    const problems = validateGraph(lib.exercises, edges);
    expect(problems).toContain('edge SUBSTITUTES push_up → ghost: unknown target ghost');
    expect(problems).toContain('REQUIRES push_up → barbell does not match the exercise equipment');
    const withoutRequires = lib.edges.filter((e) => !(e.type === 'REQUIRES' && e.from === 'goblet_squat'));
    expect(validateGraph(lib.exercises, withoutRequires)).toContain('goblet_squat: no REQUIRES edge for dumbbell (group 0)');
    const dup = [...lib.exercises, lib.exercises[0]!];
    expect(validateGraph(dup, lib.edges)).toContain(`${lib.exercises[0]!.id}: duplicate id`);
    const noText = validateGraph(lib.exercises, lib.edges, { en: {}, fr: {} });
    expect(noText.some((p) => p.includes('missing en text'))).toBe(true);
    const badSchema = validateGraph([{ ...lib.exercises[0]!, primaryMuscles: [] }], []);
    expect(badSchema.length).toBeGreaterThan(0);
  });

  it('≥ 90% of exercises have a valid substitute with bodyweight-only, home-basic and full-gym equipment', () => {
    const report = Object.fromEntries(
      (['bodyweight_only', 'home_basic', 'full_gym'] as const).map((set) => {
        const c = substituteCoverage(lib, EQUIPMENT_PRESETS[set]);
        return [set, { share: Math.round(c.share * 1000) / 10, missing: c.missing }];
      }),
    );
    for (const r of Object.values(report)) expect(r.share).toBeGreaterThanOrEqual(90);
    // Documented gaps (docs/status/M06.md): carries have no load-free equivalent.
    expect(report.bodyweight_only?.missing).toEqual(expect.arrayContaining(['farmer_carry', 'suitcase_carry']));
  });

  it('ladders for pull, push and squat from the M02 spec are complete', () => {
    for (const [name, steps] of Object.entries(M02_LADDERS)) {
      for (const step of steps) for (const id of step) expect(lib.byId.has(id), `${name}: ${id}`).toBe(true);
      for (let i = 0; i + 1 < steps.length; i++) {
        for (const from of steps[i]!) {
          for (const to of steps[i + 1]!) {
            expect(reachable(lib.edges, 'PROGRESSES_TO', from, to), `${name}: ${from} → ${to}`).toBe(true);
            expect(reachable(lib.edges, 'REGRESSES_TO', to, from), `${name}: ${to} ← ${from}`).toBe(true);
          }
        }
      }
      // The canonical ladder links each consecutive step directly.
      const ladder = LADDERS.find((l) => l.id === name)!;
      for (let i = 0; i + 1 < ladder.steps.length; i++) {
        for (const from of ladder.steps[i]!) for (const to of ladder.steps[i + 1]!) expect(progress.some((e) => e.from === from && e.to === to && e.ladderId === name)).toBe(true);
      }
    }
    expect(reachable(lib.edges, 'PROGRESSES_TO', 'pull_up', 'dead_hang')).toBe(false);
  });

  it('P2: every step of the path to a first strict pull-up can be trained at home (itself or a substitute)', () => {
    const home = EQUIPMENT_PRESETS.home_basic;
    const path = LADDERS.find((l) => l.id === 'pull')!.steps.slice(0, 7).flat();
    for (const id of path) {
      const ok = doableWith(lib.byId.get(id)!, home) || substitute(id, home, {}, UNRESTRICTED_SAFETY_PROFILE) !== null;
      expect(ok, id).toBe(true);
    }
    expect(doableWith(lib.byId.get('band_assisted_pull_up')!, home)).toBe(true);
    expect(doableWith(lib.byId.get('negative_pull_up')!, home)).toBe(true);
  });

  it('P4: low-impact and supported balance options exist without equipment', () => {
    const balance = lib.exercises.filter((e) => e.pattern === 'balance' && e.tags.includes('supported') && doableWith(e, []));
    expect(balance.length).toBeGreaterThanOrEqual(4);
    const lowImpact = lib.exercises.filter((e) => e.impact !== 'high' && e.impact !== 'moderate' && e.tags.includes('low_impact') && doableWith(e, []));
    for (const pattern of ['squat', 'lunge', 'hinge', 'horizontal_push', 'core', 'balance', 'mobility', 'locomotion']) {
      expect(lowImpact.some((e) => e.pattern === pattern), pattern).toBe(true);
    }
  });

  it('P6: rings and muscle-up progressions exist for the park profile', () => {
    const park = EQUIPMENT_PRESETS.park;
    for (const id of ['ring_row', 'ring_dip', 'ring_muscle_up', 'bar_muscle_up', 'l_sit', 'pistol_squat']) expect(doableWith(lib.byId.get(id)!, park), id).toBe(true);
    expect(reachable(lib.edges, 'PROGRESSES_TO', 'pull_up', 'ring_muscle_up')).toBe(true);
    expect(reachable(lib.edges, 'PROGRESSES_TO', 'split_squat', 'pistol_squat')).toBe(true);
  });

  it('ladder ranks support Fair Pair relative-effort scaling (M09)', () => {
    expect(ladderRank(lib, 'push', 'wall_push_up')).toBe(0);
    expect(ladderRank(lib, 'push', 'push_up')).toBe(4);
    expect(ladderRank(lib, 'push', 'pull_up')).toBeNull();
    expect(ladderRank(lib, 'nope', 'pull_up')).toBeNull();
  });

  it('similarity is symmetric, in [0, 1], and 1 only for identical profiles', () => {
    const [a, b] = [lib.byId.get('push_up')!, lib.byId.get('knee_push_up')!];
    expect(stimulusSimilarity(a, b)).toBe(stimulusSimilarity(b, a));
    expect(stimulusSimilarity(a, a)).toBe(1);
    for (const e of lib.edges) if (e.type === 'SUBSTITUTES') expect(e.similarity).toBeGreaterThanOrEqual(0.5);
    // Balance and mobility never substitute strength work.
    const bal = lib.byId.get('single_leg_stand')!;
    expect(lib.edges.some((e) => e.type === 'SUBSTITUTES' && e.from === bal.id && lib.byId.get(e.to)!.pattern !== 'balance')).toBe(false);
  });

  it('ladderEdges deduplicates an edge shared by two ladders', () => {
    const edges = ladderEdges([
      { id: 'a', steps: [['x1'], ['x2']] },
      { id: 'b', steps: [['x1'], ['x2']] },
    ]);
    expect(edges).toHaveLength(2);
  });
});
