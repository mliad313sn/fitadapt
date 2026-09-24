import type { CardioCue, SegmentTime } from '@fitadapt/engine';

/**
 * The on-device interval timer (M03; timers run on the device only, never on
 * the server). It is driven by the wall clock, not by counting ticks: the
 * position in the block is always `now − start` (minus pauses, plus skips),
 * and each cue is scheduled with one timeout aimed at its own time. A late or
 * throttled timer therefore never accumulates drift — the next cue is aimed
 * from the clock again — and a JS thread that was suspended in the background
 * catches up on return: announcements missed by more than `staleMs` are not
 * replayed (a stale "3-2-1" is worse than none), except the step now running
 * and the end, which are always announced.
 *
 * It also records which parts of the timeline were actually lived (a skip
 * jumps forward, a pause stops the clock), so the block's moderate and
 * vigorous minutes are what the user did (engine `cardioDone`).
 */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FiredCue {
  readonly cue: CardioCue;
  /** Position in the block (ms) when it played. */
  readonly atMs: number;
  /** How late it played (ms). */
  readonly lateMs: number;
}

export interface IntervalRunnerOptions {
  readonly cues: readonly CardioCue[];
  readonly totalSeconds: number;
  readonly segments: readonly { readonly index: number; readonly startSeconds: number; readonly durationSeconds: number }[];
  readonly now: () => number;
  readonly timers?: Timers;
  readonly onCue: (cue: CardioCue, lateMs: number) => void;
  readonly onFinish?: () => void;
  /** Announcements later than this are not replayed (except the running step and the end). */
  readonly staleMs?: number;
}

const defaultTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class IntervalRunner {
  private startedAt = 0;
  private offsetMs = 0;
  private pausedAt: number | null = null;
  private handle: unknown = null;
  private next = 0;
  private running = false;
  private finished = false;
  private rangeStart = 0;
  private readonly lived: [number, number][] = [];
  readonly fired: FiredCue[] = [];
  private readonly timers: Timers;
  private readonly staleMs: number;

  constructor(private readonly o: IntervalRunnerOptions) {
    this.timers = o.timers ?? defaultTimers;
    this.staleMs = o.staleMs ?? 1500;
  }

  /** Position in the block, in ms (frozen while paused, capped at the end). */
  elapsedMs(): number {
    const raw = (this.pausedAt ?? this.o.now()) - this.startedAt + this.offsetMs;
    return Math.max(0, Math.min(raw, this.o.totalSeconds * 1000));
  }

  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  start(atMs: number = this.o.now()): void {
    this.startedAt = atMs;
    this.offsetMs = 0;
    this.pausedAt = null;
    this.running = true;
    this.finished = false;
    this.rangeStart = 0;
    this.tick();
  }

  pause(): void {
    if (!this.running || this.pausedAt !== null) return;
    this.closeRange();
    this.pausedAt = this.o.now();
    this.clear();
  }

  resume(): void {
    if (!this.running || this.pausedAt === null) return;
    this.offsetMs -= this.o.now() - this.pausedAt;
    this.pausedAt = null;
    this.rangeStart = this.elapsedMs();
    this.tick();
  }

  /** Jumps to `seconds` (skip a step): the cues in between are not played. */
  skipTo(seconds: number): void {
    if (!this.running) return;
    this.closeRange();
    const target = Math.min(seconds * 1000, this.o.totalSeconds * 1000);
    this.offsetMs += target - this.elapsedMs();
    this.rangeStart = this.elapsedMs();
    while (this.next < this.o.cues.length && this.o.cues[this.next]!.atSeconds * 1000 < target) this.next += 1;
    if (this.pausedAt === null) this.tick();
  }

  /** Stops the timer (the block ends here). */
  stop(): void {
    if (!this.running) return;
    this.closeRange();
    this.running = false;
    this.clear();
  }

  /** Re-aims the timer from the clock (e.g. when the app returns to the foreground). */
  resync(): void {
    if (this.running && this.pausedAt === null) this.tick();
  }

  /** Seconds actually lived in each step (for the weekly ledger). */
  spent(): SegmentTime[] {
    const ranges: [number, number][] = [...this.lived];
    if (this.running && this.pausedAt === null) ranges.push([this.rangeStart, this.elapsedMs()]);
    return this.o.segments.map((s) => {
      const a = s.startSeconds * 1000;
      const b = (s.startSeconds + s.durationSeconds) * 1000;
      let ms = 0;
      for (const [x, y] of ranges) ms += Math.max(0, Math.min(b, y) - Math.max(a, x));
      return { index: s.index, seconds: ms / 1000 };
    });
  }

  private closeRange(): void {
    if (this.pausedAt !== null) return;
    const end = this.elapsedMs();
    if (end > this.rangeStart) this.lived.push([this.rangeStart, end]);
    this.rangeStart = end;
  }

  private clear(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  private tick(): void {
    this.clear();
    if (!this.running || this.pausedAt !== null) return;
    const elapsed = this.elapsedMs();
    const due: CardioCue[] = [];
    while (this.next < this.o.cues.length && this.o.cues[this.next]!.atSeconds * 1000 <= elapsed) due.push(this.o.cues[this.next++]!);
    // Catching up after a suspension: only the latest step announcement (the one running) and the end are replayed.
    const lastStep = [...due].reverse().find((c) => c.kind === 'step');
    for (const cue of due) {
      const late = elapsed - cue.atSeconds * 1000;
      const stale = late > this.staleMs;
      if (stale && cue.kind !== 'finish' && cue !== lastStep) continue;
      this.fired.push({ cue, atMs: elapsed, lateMs: late });
      this.o.onCue(cue, late);
    }
    if (this.next >= this.o.cues.length && elapsed >= this.o.totalSeconds * 1000) {
      this.closeRange();
      this.running = false;
      this.finished = true;
      this.o.onFinish?.();
      return;
    }
    const target = this.next < this.o.cues.length ? this.o.cues[this.next]!.atSeconds * 1000 : this.o.totalSeconds * 1000;
    this.handle = this.timers.setTimeout(() => this.tick(), Math.max(0, target - elapsed));
  }
}
