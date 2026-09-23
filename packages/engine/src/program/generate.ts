import { screeningGateCheck } from '@fitadapt/safety';
import {
  PROGRAM_MUSCLE_GROUPS,
  ProgramInputSchema,
  ProgramSchema,
  WEEKDAYS,
  type Conditioning,
  type EquipmentId,
  type ExperienceLevel,
  type Mesocycle,
  type MesocycleIntent,
  type Microcycle,
  type MicrocycleKind,
  type MovementPattern,
  type Program,
  type ProgramInput,
  type ProgramLocation,
  type ProgramMuscleGroup,
  type ProgramSlot,
  type SafetyProfile,
  type ScheduledSession,
  type SlotIntent,
  type TrainingAge,
  type Weekday,
} from '@fitadapt/shared';
import { stamp, type EngineContext } from '../context.js';
import { uuidFrom } from '../random.js';
import { blockingReasons, type GraphExercise } from '../substitution.js';
import { ENGINE_VERSION } from '../version.js';
import { MESOCYCLE_MAX_WEEKS, MESOCYCLE_MIN_WEEKS, PROGRAM_RULES_VERSION, programValue } from './config.js';
import { addDays, mondayOnOrAfter } from './dates.js';
import { layoutWeek, type WeekLayout } from './schedule.js';
import {
  DEFAULT_TRAINING_DAYS,
  HARD_PATTERNS,
  HEAVY_LOWER_FOCUSES,
  INTERVAL_GOALS,
  MESOCYCLE_INTENTS_BY_GOAL,
  SESSION_TEMPLATES,
  weekTemplate,
  type SlotTemplate,
  type WeekTemplate,
} from './templates.js';
import { allocateSets, volumeRange, weeklyTarget, type AllocationSlot } from './volume.js';

/** The part of the M06 graph the program needs: which movement patterns a place and a SafetyProfile allow. */
export interface ProgramLibrary {
  readonly exercises: ReadonlyMap<string, GraphExercise>;
}

export interface ProgramSafetyEvent {
  readonly invariant: 'S1';
  readonly reasonCode: 'safety.s1.rpe_above_cap' | 'safety.s1.hiit_not_allowed';
  readonly action: 'capped';
  readonly engineVersion: string;
}

export type GenerateProgramResult =
  | { readonly status: 'ok'; readonly program: Program; readonly safetyEvents: readonly ProgramSafetyEvent[] }
  | { readonly status: 'unavailable'; readonly reasonCodes: readonly string[] };

const LOWER: readonly MovementPattern[] = ['squat', 'hinge', 'lunge'];

export function trainingAgeOf(experience: ExperienceLevel): TrainingAge {
  return experience === 'intermediate' || experience === 'advanced' ? experience : 'beginner';
}

/** The highest effort ≤ `desired` that S1 (screeningGateCheck, M01) allows, in half-RPE steps; null below the minimum. */
export function cappedRpe(desired: number, profile: SafetyProfile): number | null {
  for (let rpe = desired; rpe >= programValue('rpe.minimum'); rpe -= 0.5) {
    if (screeningGateCheck({ profile, request: { rpe, hiit: false, maximalTest: false } }) === null) return rpe;
  }
  return null;
}

/** S1: may this user be given intervals (HIIT) at this effort? */
export function intervalsAllowed(profile: SafetyProfile, rpe: number): boolean {
  return screeningGateCheck({ profile, request: { rpe, hiit: true, maximalTest: false } }) === null;
}

/** Whether a place (its equipment) and the SafetyProfile allow at least one exercise of the pattern. */
function patternAvailable(library: ProgramLibrary, pattern: MovementPattern, equipment: readonly EquipmentId[], profile: SafetyProfile): boolean {
  for (const exercise of library.exercises.values()) {
    if (exercise.pattern === pattern && blockingReasons(exercise, equipment, {}, profile).length === 0) return true;
  }
  return false;
}

function slotIntent(slot: SlotTemplate, meso: MesocycleIntent): SlotIntent {
  if (slot.kind !== 'main') return slot.kind;
  return meso === 'skill' ? 'general' : meso;
}

interface WeekPlan {
  readonly kind: MicrocycleKind;
  readonly mesocycle: number;
  readonly weekInMesocycle: number;
  readonly accumulationWeeks: number;
}

function weekRpe(plan: WeekPlan): number {
  if (plan.kind === 'deload') return programValue('rpe.deload');
  if (plan.kind === 'transition') return programValue('rpe.transition');
  const start = programValue('rpe.accumulationStart');
  const end = programValue('rpe.accumulationEnd');
  const t = plan.accumulationWeeks <= 1 ? 0 : (plan.weekInMesocycle - 1) / (plan.accumulationWeeks - 1);
  return Math.round((start + (end - start) * t) * 2) / 2;
}

function volumeFactor(kind: MicrocycleKind): number {
  if (kind === 'deload') return programValue('deload.volumeFactor');
  if (kind === 'transition') return programValue('transition.volumeFactor');
  return 1;
}

function resolveLocation(input: ProgramInput, weekday: Weekday): ProgramLocation | null {
  const id = input.locationByWeekday[weekday] ?? input.defaultEquipmentProfileId;
  return input.locations.find((l) => l.equipmentProfileId === id) ?? input.locations[0] ?? null;
}

interface Choice {
  readonly template: WeekTemplate;
  readonly days: readonly Weekday[];
  readonly layout: WeekLayout;
  readonly reasonCodes: readonly string[];
}

function chooseLayout(input: ProgramInput, days: number, template: WeekTemplate, intervalCandidate: Parameters<typeof layoutWeek>[2]): Choice {
  const reasons: string[] = [];
  const wanted = input.trainingDays ? [...new Set(input.trainingDays)].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)) : null;
  if (wanted && wanted.length === days) {
    const layout = layoutWeek(template.sessions, wanted, intervalCandidate);
    if (layout) return { template, days: wanted, layout, reasonCodes: ['program.schedule.days_as_chosen'] };
    reasons.push('program.schedule.days_adjusted');
  } else if (wanted) {
    reasons.push('program.schedule.days_adjusted');
  }
  const defaults = DEFAULT_TRAINING_DAYS[days as keyof typeof DEFAULT_TRAINING_DAYS];
  const layout = layoutWeek(template.sessions, defaults, intervalCandidate);
  /* v8 ignore next -- every template has a valid layout on its default days (tested for all goals × days) */
  if (!layout) throw new Error(`no valid layout for ${template.split} on ${defaults.join(',')}`);
  return { template, days: defaults, layout, reasonCodes: [...reasons, 'program.schedule.days_spread'] };
}

/**
 * M08 program generator: split, mesocycles (accumulation → deload), weekly
 * hard-set targets per muscle group and a dated calendar. Pure and
 * deterministic (injected clock and seed); every session carries reason
 * codes.
 *
 * Safety: S7 (no automatic programming, low-intensity library, blocked,
 * not screened) → no program; S1 via screeningGateCheck: the effort ceiling
 * of every week is capped, and intervals are replaced by steady aerobic work
 * when HIIT is not allowed (safety events returned for the defensibility
 * log). Slots are kept only if the place's equipment (M01 equipment profile)
 * and the SafetyProfile allow at least one exercise of the pattern (M06
 * rules, never re-implemented).
 */
export function generateProgram(rawInput: ProgramInput, library: ProgramLibrary, ctx: EngineContext): GenerateProgramResult {
  const input = ProgramInputSchema.parse(rawInput);
  const profile = input.safetyProfile;
  if (profile.screeningOutcome === 'blocked') return { status: 'unavailable', reasonCodes: ['program.unavailable.blocked'] };
  if (profile.screeningOutcome === 'not_screened') return { status: 'unavailable', reasonCodes: ['program.unavailable.not_screened'] };
  if (!profile.automaticProgrammingAllowed || profile.lowIntensityLibraryOnly) return { status: 'unavailable', reasonCodes: ['program.unavailable.professional_guidance'] };
  if (cappedRpe(programValue('rpe.accumulationStart'), profile) === null) return { status: 'unavailable', reasonCodes: ['program.unavailable.effort_cap'] };

  const goal = input.goals.primary;
  const age = trainingAgeOf(input.experience);
  const programReasons: string[] = [`program.goal.${goal}`, `program.training_age.${age}`];
  const safetyEvents: ProgramSafetyEvent[] = [];

  const maxDays = programValue('schedule.maxTrainingDays');
  const days = Math.min(input.daysPerWeek, maxDays);
  if (input.daysPerWeek > maxDays) programReasons.push('program.schedule.rest_day_kept');
  const template = weekTemplate(goal, days);
  programReasons.push(`program.split.${template.split}`);

  const warmUp = programValue('session.warmUpMinutes');
  const finisherMinutes = programValue('conditioning.finisherMinutes');
  const finisherFits = template.finishers && input.minutesPerSession - warmUp - finisherMinutes >= programValue('conditioning.minStrengthMinutes');
  const wantsIntervals = INTERVAL_GOALS.includes(goal);
  const hiitOk = wantsIntervals && intervalsAllowed(profile, cappedRpe(programValue('rpe.accumulationEnd'), profile)!);
  if (wantsIntervals && !hiitOk) {
    programReasons.push('program.conditioning.intervals_not_allowed');
    safetyEvents.push({ invariant: 'S1', reasonCode: 'safety.s1.hiit_not_allowed', action: 'capped', engineVersion: ENGINE_VERSION });
  }
  const intervalCandidate = hiitOk ? (key: keyof typeof SESSION_TEMPLATES) => SESSION_TEMPLATES[key].conditioning || (finisherFits && SESSION_TEMPLATES[key].slots.length > 0) : null;
  const choice = chooseLayout(input, days, template, intervalCandidate);
  programReasons.push(...choice.reasonCodes);
  if (input.previousGoal !== null && input.previousGoal !== goal) programReasons.push('program.transition.goal_change');

  // ---- Mesocycles and weeks
  const mesoCount = programValue('program.mesocycles');
  const mesoWeeks = Math.min(MESOCYCLE_MAX_WEEKS, Math.max(MESOCYCLE_MIN_WEEKS, programValue(`mesocycle.weeks.${age}`)));
  const intents = MESOCYCLE_INTENTS_BY_GOAL[goal];
  const start = mondayOnOrAfter(input.startDate);
  const transition = input.previousGoal !== null && input.previousGoal !== goal;
  const weeks: WeekPlan[] = [];
  const mesocycles: Mesocycle[] = [];
  for (let m = 1; m <= mesoCount; m++) {
    const first = weeks.length + 1;
    for (let k = 1; k <= mesoWeeks; k++) {
      const kind: MicrocycleKind = k === mesoWeeks ? 'deload' : m === 1 && k === 1 && transition ? 'transition' : 'accumulation';
      weeks.push({ kind, mesocycle: m, weekInMesocycle: k, accumulationWeeks: mesoWeeks - 1 });
    }
    mesocycles.push({
      index: m,
      intent: intents[Math.min(m, intents.length) - 1]!,
      startDate: addDays(start, (first - 1) * 7),
      endDate: addDays(start, (first - 1 + mesoWeeks) * 7 - 1),
      weeks: mesoWeeks,
      deloadWeek: first + mesoWeeks - 1,
    });
  }

  let rpeCapped = false;
  const range = volumeRange(age);
  const available = new Map<string, boolean>();
  const canDo = (loc: ProgramLocation | null, pattern: MovementPattern) => {
    const key = `${loc?.equipmentProfileId ?? 'none'}:${pattern}`;
    if (!available.has(key)) available.set(key, patternAvailable(library, pattern, loc?.equipment ?? [], profile));
    return available.get(key)!;
  };

  const microcycles: Microcycle[] = weeks.map((plan, w) => {
    const week = w + 1;
    const weekStart = addDays(start, w * 7);
    const meso = mesocycles[plan.mesocycle - 1]!;
    const desiredRpe = weekRpe(plan);
    const rpe = cappedRpe(desiredRpe, profile)!;
    if (rpe < desiredRpe) rpeCapped = true;
    const factor = volumeFactor(plan.kind);
    const intervalsThisWeek = hiitOk && plan.kind === 'accumulation' && week >= programValue('conditioning.intervalsFromWeek');
    const weekReasons: string[] = [`program.week.${plan.kind}`];

    const drafts = choice.layout.sessions.map((ls, n) => {
      const tpl = SESSION_TEMPLATES[ls.key];
      const date = addDays(weekStart, ls.dayIndex);
      const weekday = WEEKDAYS[ls.dayIndex]!;
      const loc = resolveLocation(input, weekday);
      const reasons: string[] = [`program.session.${tpl.focus}`];
      const slotTemplates: SlotTemplate[] = [...tpl.slots];
      if (choice.template.balance && tpl.focus === 'full_body') slotTemplates.push({ pattern: 'balance', role: 'secondary', kind: 'balance' });
      const kept = slotTemplates.filter((s) => canDo(loc, s.pattern));
      if (kept.length < slotTemplates.length) reasons.push('program.slot.not_possible_here');
      // Concurrent training: intervals never the day before a heavy lower-body day; when no layout avoids it, the week's aerobic work stays steady.
      const wouldCarryIntervals = intervalsThisWeek && choice.layout.intervalsAt === n;
      const intervals = wouldCarryIntervals && !choice.layout.intervalsBeforeHeavyLower;
      if (wouldCarryIntervals && !intervals) reasons.push('program.concurrent.intervals_replaced');
      let conditioning: Conditioning | null = null;
      if (tpl.conditioning) conditioning = { kind: intervals ? 'intervals' : 'steady', placement: 'session', minutes: input.minutesPerSession - warmUp };
      else if (finisherFits) conditioning = { kind: intervals ? 'intervals' : 'steady', placement: 'finisher', minutes: finisherMinutes };
      if (conditioning) reasons.push(conditioning.placement === 'finisher' ? 'program.conditioning.finisher' : `program.conditioning.${conditioning.kind}`);
      if (intervals) reasons.push('program.conditioning.intervals');
      if (intervals) reasons.push('program.concurrent.no_intervals_before_heavy_lower');
      const strengthMinutes = input.minutesPerSession - warmUp - (conditioning?.placement === 'finisher' ? finisherMinutes : 0);
      const capacity = tpl.conditioning ? 0 : Math.max(0, Math.floor(strengthMinutes / programValue('session.minutesPerHardSet')));
      const slots: AllocationSlot[] = kept.map((s) => ({ pattern: s.pattern, role: s.role, counted: s.kind === 'main' || s.kind === 'skill', fixedSets: s.kind === 'balance' || s.kind === 'mobility' ? programValue('session.balanceSets') : 0 }));
      return { ls, tpl, date, weekday, loc, reasons, kept, conditioning, intervals, capacity, slots };
    });

    const targets = {} as Record<ProgramMuscleGroup, number>;
    const caps = {} as Record<ProgramMuscleGroup, number>;
    for (const g of PROGRAM_MUSCLE_GROUPS) {
      targets[g] = weeklyTarget(age, goal, plan.kind === 'accumulation' ? plan.weekInMesocycle : 1, factor);
      caps[g] = Math.ceil(range.max * factor);
    }
    const allocation = allocateSets(drafts.map((d) => ({ slots: d.slots, capacity: d.capacity })), targets, caps);

    const sessions: ScheduledSession[] = [];
    drafts.forEach((d, n) => {
      const slots: ProgramSlot[] = d.kept
        .map((s, j) => ({ pattern: s.pattern, role: s.role, intent: slotIntent(s, meso.intent), hardSets: allocation.sets[n]![j]! }))
        .filter((s) => s.hardSets > 0);
      if (slots.length === 0 && !d.conditioning) {
        weekReasons.push('program.session.none_possible_here');
        return;
      }
      const hardPatterns = [...new Set(slots.filter((s) => s.intent !== 'balance' && s.intent !== 'mobility').map((s) => s.pattern))].filter((p) => HARD_PATTERNS.includes(p));
      if (d.intervals) hardPatterns.push('locomotion');
      const setMinutes = slots.reduce((sum, s) => sum + s.hardSets, 0) * programValue('session.minutesPerHardSet');
      const estimatedMinutes = d.tpl.conditioning ? input.minutesPerSession : warmUp + setMinutes + (d.conditioning?.placement === 'finisher' ? d.conditioning.minutes : 0);
      const reasons = [...d.reasons, rpe < desiredRpe ? 'program.rpe.s1_capped' : `program.rpe.${plan.kind}`];
      sessions.push({
        id: `w${String(week).padStart(2, '0')}.s${sessions.length + 1}`,
        date: d.date,
        weekday: d.weekday,
        focus: d.tpl.focus,
        equipmentProfileId: d.loc?.equipmentProfileId ?? null,
        location: d.loc?.location ?? null,
        slots,
        conditioning: d.conditioning,
        targetRpe: rpe,
        hardPatterns,
        heavyLower: HEAVY_LOWER_FOCUSES.includes(d.tpl.focus) && slots.some((s) => LOWER.includes(s.pattern)),
        priority: d.tpl.focus === 'conditioning' || d.tpl.focus === 'mobility_balance' ? 1 : 2,
        estimatedMinutes,
        reasonCodes: reasons,
      });
    });

    const volume = allocation.volume.map((v) => ({ ...v, min: range.min, max: range.max }));
    if (volume.some((v) => v.planned < v.target - 0.5)) weekReasons.push('program.volume.time_limited');
    const aerobicMinutes = sessions.reduce((sum, s) => sum + (s.conditioning?.minutes ?? 0), 0);
    return {
      week,
      mesocycle: plan.mesocycle,
      weekInMesocycle: plan.weekInMesocycle,
      kind: plan.kind,
      startDate: weekStart,
      endDate: addDays(weekStart, 6),
      volumeFactor: factor,
      sessions,
      volume,
      aerobicMinutes,
      reasonCodes: weekReasons,
    };
  });

  if (rpeCapped) {
    programReasons.push('program.rpe.s1_capped');
    safetyEvents.push({ invariant: 'S1', reasonCode: 'safety.s1.rpe_above_cap', action: 'capped', engineVersion: ENGINE_VERSION });
  }
  const s = stamp(ctx);
  const program = ProgramSchema.parse({
    schemaVersion: 1,
    programId: uuidFrom(ctx.rng),
    engineVersion: s.engineVersion,
    rulesVersion: PROGRAM_RULES_VERSION,
    generatedAt: s.evaluatedAt,
    seed: s.seed,
    templateId: `${goal}.${days}d`,
    goal,
    secondaryGoal: input.goals.secondary,
    trainingAge: age,
    split: template.split,
    daysPerWeek: days,
    trainingDays: choice.days,
    minutesPerSession: input.minutesPerSession,
    startDate: start,
    endDate: addDays(start, weeks.length * 7 - 1),
    mesocycles,
    microcycles,
    reasonCodes: programReasons,
  });
  return { status: 'ok', program, safetyEvents };
}
