import { EXERCISE_TEXT_IDS, en, fr } from '@fitadapt/i18n';
import { EQUIPMENT_IDS, ExerciseEdgeSchema, ExerciseSchema, type Exercise, type ExerciseEdge } from '@fitadapt/shared';

/**
 * Graph integrity rules (M06): schema, references, acyclic progressions,
 * PROGRESSES_TO ↔ REGRESSES_TO symmetry, REQUIRES edges matching the
 * exercise's equipment, and FR/EN wording for every text key.
 * validateGraph returns every problem found (empty = valid).
 */

export function findProgressionCycle(edges: readonly ExerciseEdge[], type: 'PROGRESSES_TO' | 'REGRESSES_TO' = 'PROGRESSES_TO'): string[] | null {
  const next = new Map<string, string[]>();
  for (const e of edges) if (e.type === type) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    const s = state.get(node);
    if (s === 'done') return null;
    if (s === 'visiting') return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, 'visiting');
    stack.push(node);
    for (const to of next.get(node) ?? []) {
      const cycle = visit(to);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  };
  for (const node of [...next.keys()].sort()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

export function missingInverseEdges(edges: readonly ExerciseEdge[]): string[] {
  const key = (type: string, from: string, to: string) => `${type}|${from}|${to}`;
  const present = new Set(edges.map((e) => key(e.type, e.from, e.to)));
  const problems: string[] = [];
  for (const e of edges) {
    if (e.type === 'PROGRESSES_TO' && !present.has(key('REGRESSES_TO', e.to, e.from))) problems.push(`PROGRESSES_TO ${e.from} → ${e.to} has no REGRESSES_TO ${e.to} → ${e.from}`);
    if (e.type === 'REGRESSES_TO' && !present.has(key('PROGRESSES_TO', e.to, e.from))) problems.push(`REGRESSES_TO ${e.from} → ${e.to} has no PROGRESSES_TO ${e.to} → ${e.from}`);
  }
  return problems;
}

/** Whether `to` is reachable from `from` over edges of one type. */
export function reachable(edges: readonly ExerciseEdge[], type: ExerciseEdge['type'], from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) if (e.type === type) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    if (node === to) return true;
    for (const n of next.get(node) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return false;
}

type Catalogue = Readonly<Record<string, string>>;

export function validateGraph(exercises: readonly Exercise[], edges: readonly ExerciseEdge[], catalogues: { en: Catalogue; fr: Catalogue } = { en, fr }): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const e of exercises) {
    const parsed = ExerciseSchema.safeParse(e);
    if (!parsed.success) problems.push(`${e.id}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    if (ids.has(e.id)) problems.push(`${e.id}: duplicate id`);
    ids.add(e.id);
    for (const key of [e.nameKey, ...e.cueKeys, ...e.mistakeKeys]) {
      for (const locale of ['en', 'fr'] as const) {
        const text = catalogues[locale][key];
        if (typeof text !== 'string' || text.trim() === '') problems.push(`${e.id}: missing ${locale} text for ${key}`);
      }
    }
  }
  const textIds = new Set<string>(EXERCISE_TEXT_IDS);
  if (catalogues.en === en) {
    for (const id of textIds) if (!ids.has(id)) problems.push(`${id}: wording in packages/i18n without an exercise`);
  }
  const equipmentIds = new Set<string>(EQUIPMENT_IDS);
  for (const edge of edges) {
    const parsed = ExerciseEdgeSchema.safeParse(edge);
    if (!parsed.success) problems.push(`edge ${edge.type} ${edge.from} → ${edge.to}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    if (!ids.has(edge.from)) problems.push(`edge ${edge.type} ${edge.from} → ${edge.to}: unknown exercise ${edge.from}`);
    if (edge.type === 'REQUIRES' ? !equipmentIds.has(edge.to) : !ids.has(edge.to)) problems.push(`edge ${edge.type} ${edge.from} → ${edge.to}: unknown target ${edge.to}`);
  }
  const byId = new Map(exercises.map((e) => [e.id, e] as const));
  const requires = new Set(edges.filter((e) => e.type === 'REQUIRES').map((e) => `${e.from}|${e.group}|${e.to}`));
  for (const e of exercises) {
    e.equipment.forEach((g, i) => {
      for (const id of g.anyOf) if (!requires.has(`${e.id}|${i}|${id}`)) problems.push(`${e.id}: no REQUIRES edge for ${id} (group ${i})`);
    });
  }
  for (const edge of edges) {
    if (edge.type !== 'REQUIRES') continue;
    const ex = byId.get(edge.from);
    if (ex && !ex.equipment[edge.group]?.anyOf.includes(edge.to)) problems.push(`REQUIRES ${edge.from} → ${edge.to} does not match the exercise equipment`);
  }
  for (const type of ['PROGRESSES_TO', 'REGRESSES_TO'] as const) {
    const cycle = findProgressionCycle(edges, type);
    if (cycle) problems.push(`${type} cycle: ${cycle.join(' → ')}`);
  }
  problems.push(...missingInverseEdges(edges));
  return problems;
}
