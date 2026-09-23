import { en } from '@fitadapt/i18n';
import {
  ExerciseSchema,
  type ContraindicationTag,
  type EquipmentId,
  type Exercise,
  type ExerciseTag,
  type ImpactLevel,
  type JointLoadLevel,
  type LoadType,
  type MovementPattern,
  type MuscleId,
  type SkillLevel,
} from '@fitadapt/shared';

/** Content source of every seed exercise (wording in packages/i18n, structure here). */
export const SEED_CONTENT_SOURCE =
  'Original content written for the company for the M06 MVP seed (AI-assisted drafting, docs/status/M06.md); no text, data or media copied from books, websites or datasets. Not expert-validated.';

/** Sources for %-bodyweight coefficients. Never invented: an estimate says it is one. */
export const BW_SOURCE = {
  ebben:
    'Ebben WP et al. (2011), J Strength Cond Res 25(10):2891–2894, value as quoted in docs/specs/M02-adaptive-training-engine.md; citation compiled by the drafting assistant and not checked against the paper',
  estimate: 'Author estimate for the M06 seed; no external source',
  hang: 'Physical reasoning: the grip supports the whole body in a hang; no external source',
} as const;

export type BwSource = keyof typeof BW_SOURCE;

export interface ExerciseSpec {
  /** Movement pattern. */
  p: MovementPattern;
  /** Primary muscles. */
  m: MuscleId[];
  /** Secondary muscles. */
  s?: MuscleId[];
  /** Equipment requirement groups: an id, or a list of alternatives (any one of them). All groups are required. */
  eq?: (EquipmentId | EquipmentId[])[];
  /**
   * Joint-load profile as seven letters l/m/h in the order shoulder, elbow,
   * wrist, lumbar, hip, knee, ankle (e.g. 'mmhllll').
   */
  j: string;
  imp?: ImpactLevel;
  sk: SkillLevel;
  uni?: boolean;
  lt: LoadType;
  /** %-bodyweight coefficient (fraction of body mass) and its source key; bodyweight moves only. */
  bw?: [number, BwSource];
  ci?: ContraindicationTag[];
  t?: ExerciseTag[];
}

const LEVEL: Record<string, JointLoadLevel> = { l: 'low', m: 'medium', h: 'high' };

function jointProfile(id: string, code: string) {
  if (!/^[lmh]{7}$/.test(code)) throw new Error(`${id}: joint code "${code}" must be 7 letters l/m/h`);
  const [shoulder, elbow, wrist, lumbar, hip, knee, ankle] = [...code].map((c) => LEVEL[c] as JointLoadLevel);
  return { shoulder, elbow, wrist, lumbar, hip, knee, ankle } as Exercise['jointLoad'];
}

function numberedKeys(id: string, kind: 'cue' | 'mistake'): string[] {
  const keys: string[] = [];
  for (let n = 1; Object.prototype.hasOwnProperty.call(en, `exercise.${id}.${kind}.${n}`); n++) keys.push(`exercise.${id}.${kind}.${n}`);
  return keys;
}

/** Builds and validates one seed exercise. Every seed exercise is unvalidated and pending review. */
export function defineExercise(id: string, spec: ExerciseSpec): Exercise {
  return ExerciseSchema.parse({
    id,
    contentVersion: 1,
    nameKey: `exercise.${id}.name`,
    cueKeys: numberedKeys(id, 'cue'),
    mistakeKeys: numberedKeys(id, 'mistake'),
    pattern: spec.p,
    primaryMuscles: spec.m,
    secondaryMuscles: spec.s ?? [],
    equipment: (spec.eq ?? []).map((g) => ({ anyOf: Array.isArray(g) ? g : [g] })),
    jointLoad: jointProfile(id, spec.j),
    impact: spec.imp ?? 'none',
    skill: spec.sk,
    unilateral: spec.uni ?? false,
    loadType: spec.lt,
    bodyweightLoad: spec.bw ? { value: spec.bw[0], unit: 'fraction_of_body_mass', source: BW_SOURCE[spec.bw[1]], validated: false } : null,
    contraindications: spec.ci ?? [],
    tags: spec.t ?? [],
    mediaAssetIds: [],
    source: SEED_CONTENT_SOURCE,
    validated: false,
    reviewStatus: 'pending',
    review: { physio: null, coach: null },
  });
}
