import type { GoalId, MesocycleIntent, MovementPattern, SessionFocus, SlotRole, SplitId, Weekday } from '@fitadapt/shared';

/**
 * Program templates (M08 spec: "committee-authored program templates plus
 * auto-generated programs"). These are DRAFT templates written by the
 * engineer from the spec's split rules; no committee member has authored or
 * reviewed them yet (seat A3). They are data: the generator
 * (generate.ts) turns one into a dated program.
 *
 * Split rules (spec): 2–3 days full body, 4 days upper/lower, 5–6 days
 * push/pull/legs or hybrid, calisthenics skill days; fat loss keeps the
 * strength work and adds aerobic volume.
 */

export type SlotKind = 'main' | 'skill' | 'balance' | 'mobility';

export interface SlotTemplate {
  readonly pattern: MovementPattern;
  readonly role: SlotRole;
  readonly kind: SlotKind;
}

export interface SessionTemplate {
  readonly key: string;
  readonly focus: SessionFocus;
  readonly slots: readonly SlotTemplate[];
  /** A whole-session conditioning block (M03 builds it). */
  readonly conditioning: boolean;
}

const main = (pattern: MovementPattern, role: SlotRole): SlotTemplate => ({ pattern, role, kind: 'main' });
const skill = (pattern: MovementPattern, role: SlotRole): SlotTemplate => ({ pattern, role, kind: 'skill' });

export const SESSION_TEMPLATES = {
  full_body_a: { key: 'full_body_a', focus: 'full_body', conditioning: false, slots: [main('squat', 'primary'), main('horizontal_push', 'primary'), main('horizontal_pull', 'primary'), main('hinge', 'secondary'), main('vertical_push', 'accessory'), main('core', 'accessory')] },
  full_body_b: { key: 'full_body_b', focus: 'full_body', conditioning: false, slots: [main('hinge', 'primary'), main('vertical_pull', 'primary'), main('vertical_push', 'primary'), main('lunge', 'secondary'), main('horizontal_push', 'accessory'), main('core', 'accessory')] },
  full_body_c: { key: 'full_body_c', focus: 'full_body', conditioning: false, slots: [main('lunge', 'primary'), main('horizontal_push', 'primary'), main('vertical_pull', 'primary'), main('hinge', 'secondary'), main('horizontal_pull', 'accessory'), main('core', 'accessory')] },
  upper: { key: 'upper', focus: 'upper', conditioning: false, slots: [main('horizontal_push', 'primary'), main('horizontal_pull', 'primary'), main('vertical_push', 'secondary'), main('vertical_pull', 'secondary'), main('isolation', 'accessory'), main('core', 'accessory')] },
  lower: { key: 'lower', focus: 'lower', conditioning: false, slots: [main('squat', 'primary'), main('hinge', 'primary'), main('lunge', 'secondary'), main('core', 'accessory')] },
  push: { key: 'push', focus: 'push', conditioning: false, slots: [main('horizontal_push', 'primary'), main('vertical_push', 'primary'), main('isolation', 'accessory'), main('core', 'accessory')] },
  pull: { key: 'pull', focus: 'pull', conditioning: false, slots: [main('vertical_pull', 'primary'), main('horizontal_pull', 'primary'), main('isolation', 'accessory'), main('core', 'accessory')] },
  legs: { key: 'legs', focus: 'legs', conditioning: false, slots: [main('squat', 'primary'), main('hinge', 'primary'), main('lunge', 'secondary'), main('core', 'accessory')] },
  skill: { key: 'skill', focus: 'skill', conditioning: false, slots: [skill('vertical_pull', 'primary'), skill('vertical_push', 'primary'), skill('horizontal_push', 'secondary'), skill('core', 'secondary')] },
  conditioning: { key: 'conditioning', focus: 'conditioning', conditioning: true, slots: [] },
  mobility_balance: {
    key: 'mobility_balance',
    focus: 'mobility_balance',
    conditioning: false,
    slots: [
      { pattern: 'balance', role: 'primary', kind: 'balance' },
      { pattern: 'mobility', role: 'primary', kind: 'mobility' },
      main('core', 'accessory'),
    ],
  },
} as const satisfies Record<string, SessionTemplate>;

export type SessionTemplateKey = keyof typeof SESSION_TEMPLATES;

export interface WeekTemplate {
  readonly split: SplitId;
  readonly sessions: readonly SessionTemplateKey[];
  /** Strength sessions end with a conditioning finisher (when time allows). */
  readonly finishers: boolean;
  /** Full-body sessions also train balance (general health). */
  readonly balance: boolean;
}

type DayCount = 1 | 2 | 3 | 4 | 5 | 6;
const w = (split: SplitId, sessions: SessionTemplateKey[], opts: { finishers?: boolean; balance?: boolean } = {}): WeekTemplate => ({ split, sessions, finishers: opts.finishers ?? false, balance: opts.balance ?? false });

const STRENGTH: Record<DayCount, WeekTemplate> = {
  1: w('full_body', ['full_body_a']),
  2: w('full_body', ['full_body_a', 'full_body_b']),
  3: w('full_body', ['full_body_a', 'full_body_b', 'full_body_c']),
  4: w('upper_lower', ['upper', 'lower', 'upper', 'lower']),
  5: w('hybrid', ['push', 'pull', 'legs', 'upper', 'lower']),
  6: w('push_pull_legs', ['push', 'pull', 'legs', 'push', 'pull', 'legs']),
};

/** Week templates by goal and training days per week. */
export const WEEK_TEMPLATES: Record<GoalId, Record<DayCount, WeekTemplate>> = {
  strength: STRENGTH,
  muscle_gain: STRENGTH,
  fat_loss: {
    1: w('full_body', ['full_body_a'], { finishers: true }),
    2: w('full_body', ['full_body_a', 'full_body_b'], { finishers: true }),
    3: w('full_body', ['full_body_a', 'full_body_b', 'full_body_c'], { finishers: true }),
    4: w('upper_lower', ['upper', 'lower', 'upper', 'lower'], { finishers: true }),
    5: w('upper_lower', ['upper', 'lower', 'conditioning', 'upper', 'lower']),
    6: w('upper_lower', ['upper', 'lower', 'conditioning', 'upper', 'lower', 'conditioning']),
  },
  endurance: {
    1: w('full_body', ['full_body_a'], { finishers: true }),
    2: w('full_body_conditioning', ['full_body_a', 'conditioning']),
    3: w('full_body_conditioning', ['full_body_a', 'conditioning', 'full_body_b']),
    4: w('full_body_conditioning', ['full_body_a', 'conditioning', 'full_body_b', 'conditioning']),
    5: w('full_body_conditioning', ['full_body_a', 'conditioning', 'full_body_b', 'conditioning', 'conditioning']),
    6: w('full_body_conditioning', ['full_body_a', 'conditioning', 'full_body_b', 'conditioning', 'full_body_c', 'conditioning']),
  },
  general_health: {
    1: w('full_body', ['full_body_a'], { balance: true }),
    2: w('full_body', ['full_body_a', 'full_body_b'], { balance: true }),
    3: w('full_body', ['full_body_a', 'full_body_b', 'full_body_c'], { balance: true }),
    4: w('full_body_conditioning', ['full_body_a', 'conditioning', 'full_body_b', 'mobility_balance'], { balance: true }),
    5: w('full_body_conditioning', ['full_body_a', 'conditioning', 'full_body_b', 'mobility_balance', 'full_body_c'], { balance: true }),
    6: w('full_body_conditioning', ['full_body_a', 'conditioning', 'full_body_b', 'mobility_balance', 'full_body_c', 'conditioning'], { balance: true }),
  },
  calisthenics_skills: {
    1: w('full_body', ['full_body_a']),
    2: w('calisthenics_skill', ['full_body_a', 'skill']),
    3: w('calisthenics_skill', ['full_body_a', 'skill', 'full_body_b']),
    4: w('calisthenics_skill', ['skill', 'lower', 'upper', 'lower']),
    5: w('calisthenics_skill', ['skill', 'lower', 'upper', 'lower', 'skill']),
    6: w('calisthenics_skill', ['skill', 'lower', 'upper', 'lower', 'skill', 'lower']),
  },
};

/** Goals whose weekly aerobic work includes one intervals element (when S1 and M03 allow it). */
export const INTERVAL_GOALS: readonly GoalId[] = ['fat_loss', 'endurance'];

/** Mesocycle intents by goal (goal-specific phases). */
export const MESOCYCLE_INTENTS_BY_GOAL: Record<GoalId, readonly MesocycleIntent[]> = {
  strength: ['hypertrophy', 'strength', 'strength'],
  muscle_gain: ['hypertrophy', 'hypertrophy', 'strength'],
  fat_loss: ['general', 'hypertrophy', 'general'],
  endurance: ['general', 'general', 'general'],
  general_health: ['general', 'general', 'general'],
  calisthenics_skills: ['skill', 'skill', 'strength'],
};

/** Evenly spread default training days per count (every template is schedulable on them; tested). */
export const DEFAULT_TRAINING_DAYS: Record<DayCount, readonly Weekday[]> = {
  1: ['wed'],
  2: ['mon', 'thu'],
  3: ['mon', 'wed', 'fri'],
  4: ['mon', 'tue', 'thu', 'fri'],
  5: ['mon', 'tue', 'wed', 'fri', 'sat'],
  6: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
};

/** Patterns whose hard sessions must not fall on consecutive days (reflow and scheduling rule). */
export const HARD_PATTERNS: readonly MovementPattern[] = ['squat', 'hinge', 'lunge', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'locomotion'];

/** Session focuses that make a heavy lower-body day (concurrent-training rule). */
export const HEAVY_LOWER_FOCUSES: readonly SessionFocus[] = ['full_body', 'lower', 'legs'];

export function weekTemplate(goal: GoalId, days: number): WeekTemplate {
  const count = Math.min(6, Math.max(1, Math.round(days))) as DayCount;
  return WEEK_TEMPLATES[goal][count];
}
