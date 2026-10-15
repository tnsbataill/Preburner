import { stepsKj } from '../engine/energy';
import { addDays, diffDays, weekdayOf } from '../engine/time';
import type { DateKey, Intensity, Weekday, Workout } from '../engine/types';
import { MAX_LEVEL, buildSession, coreMinutes, expandBlocks, levelThatFits, stepMetrics, toIntervalsText } from './library';
import type { Genome, HardKind, Phase, PlanRequest, PlanWeek, PlannedSession, SessionKind, TrainingPlan } from './types';

// Deterministic plan generator: request + genome -> sessions. The optimizer
// searches genomes; everything here enforces the evidence-based limits that
// hold no matter what the model thinks:
//   - at most 3 hard sessions a week, never on consecutive days
//   - CTL ramp capped at the athlete's limit
//   - a recovery week every 2-4 weeks, keeping one short quality session
//   - sessions never exceed the day's available time

export const DEFAULT_GENOME: Genome = {
  cadence: 3,
  recoveryDepth: 0.6,
  rampPerWeek: 4,
  hardPerWeek: 2,
  vo2Share: 0.5,
  baseFrac: 0.4,
  baseThresholdShare: 0.3,
};

const CTL_K = 1 - 1 / 42;
const MIN_EASY = 45;
const MIN_LONG = 90;
const STEP_MIN = 15;

/** Constant daily load that moves CTL from c0 to c1 in 7 days. */
export function weeklyTssFor(c0: number, c1: number): number {
  const decay = CTL_K ** 7;
  return 7 * ((c1 - c0 * decay) / (1 - decay));
}

export function startLevelFromCtl(ctl: number): number {
  return ctl < 35 ? 1 : ctl < 55 ? 2 : ctl < 75 ? 3 : 4;
}

interface WeekShape {
  phase: Phase;
  /** hard kinds in placement order */
  quality: HardKind[];
  targetTss: number;
  final?: 'ftptest' | 'event';
}

/** Phase per week index. The final week is a test/event week for those objectives. */
export function phaseLayout(req: PlanRequest, g: Genome): Phase[] {
  const n = req.weeks;
  const taperWeeks = req.objective === 'event' ? (n >= 8 ? 2 : 1) : req.objective === 'ftp' ? 1 : 0;
  const body = n - taperWeeks;
  const baseWeeks = Math.round(g.baseFrac * body);
  const out: Phase[] = [];
  let sinceRecovery = 0;
  for (let i = 0; i < body; i += 1) {
    // Never end the body on a recovery week right before a taper/test week.
    if (sinceRecovery >= g.cadence && i < body - 1) {
      out.push('recovery');
      sinceRecovery = 0;
      continue;
    }
    out.push(i < baseWeeks ? 'base' : 'build');
    sinceRecovery += 1;
  }
  for (let i = 0; i < taperWeeks; i += 1) out.push(req.objective === 'ftp' ? 'test' : 'taper');
  return out;
}

/** Spread kinds by share across the whole plan so the mix is hit over time. */
class KindPicker {
  private acc = 0;
  constructor(private share: number) {}
  next(a: HardKind, b: HardKind): HardKind {
    this.acc += this.share;
    if (this.acc >= 0.5) {
      this.acc -= 1;
      return a;
    }
    return b;
  }
}

function pickHardDays(avail: number[], longIdx: number, count: number, needMin: number[]): { days: number[]; score: number } {
  // avail indexed by day-in-week (0..6). Exhaustive search over combinations.
  let best: { days: number[]; score: number } | undefined;
  const cands = avail.map((_, i) => i).filter((i) => i !== longIdx);
  const choose = (start: number, picked: number[]) => {
    if (picked.length === count) {
      const sorted = [...picked];
      for (let i = 1; i < sorted.length; i += 1) if (sorted[i] - sorted[i - 1] < 2) return;
      // Session k goes on the k-th chosen day; each needs its core time.
      if (sorted.some((d, k) => avail[d] < needMin[k])) return;
      let score = sorted.reduce((s, d) => s + Math.min(avail[d], 120), 0);
      if (sorted.includes(longIdx + 1)) score -= 60; // hard the day after the long ride
      const gaps = sorted.slice(1).map((d, i) => d - sorted[i]);
      score += 15 * Math.min(...(gaps.length ? gaps : [3]));
      if (!best || score > best.score) best = { days: sorted, score };
      return;
    }
    for (let i = start; i < cands.length; i += 1) choose(i + 1, [...picked, cands[i]]);
  };
  choose(0, []);
  return best ?? { days: [], score: -Infinity };
}

interface Slot {
  kind: SessionKind;
  level: number;
  minutes: number;
  maxMinutes: number;
  /** growth priority: lower grows first */
  prio: number;
}

function slotTss(s: Slot): number {
  const built = buildSession(s.kind, s.minutes, s.level);
  return stepMetrics(expandBlocks(built.blocks)).tss;
}

function fitWeek(slots: Array<Slot | undefined>, target: number): { tss: number; limited: boolean } {
  const live = () => slots.filter((s): s is Slot => !!s);
  let tss = live().reduce((t, s) => t + slotTss(s), 0);
  // Grow easy volume first (long, then endurance, then padding on hard days).
  for (let guard = 0; guard < 200 && tss < target - 10; guard += 1) {
    const growable = live()
      .filter((s) => s.minutes + STEP_MIN <= s.maxMinutes)
      .sort((a, b) => a.prio - b.prio || a.minutes - b.minutes);
    if (!growable.length) return { tss, limited: true };
    const s = growable[0];
    const before = slotTss(s);
    s.minutes += STEP_MIN;
    tss += slotTss(s) - before;
  }
  // Shrink if the minimums overshoot (recovery and taper weeks).
  for (let guard = 0; guard < 200 && tss > target + 15; guard += 1) {
    const shrinkable = live()
      .filter((s) => (s.kind === 'endurance' || s.kind === 'long' || s.kind === 'recovery') && s.minutes - STEP_MIN >= 30)
      .sort((a, b) => b.minutes - a.minutes);
    if (!shrinkable.length) {
      // Drop an easy day entirely before cutting quality.
      const idx = slots.findIndex((s) => s && (s.kind === 'endurance' || s.kind === 'recovery'));
      if (idx < 0) break;
      tss -= slotTss(slots[idx]!);
      slots[idx] = undefined;
      continue;
    }
    const s = shrinkable[0];
    const before = slotTss(s);
    s.minutes -= STEP_MIN;
    tss += slotTss(s) - before;
  }
  return { tss, limited: false };
}

export function generatePlan(req: PlanRequest, genome: Genome = DEFAULT_GENOME): TrainingPlan {
  const g = { ...genome, rampPerWeek: Math.min(genome.rampPerWeek, req.maxRampPerWeek) };
  const phases = phaseLayout(req, g);
  const start0 = startLevelFromCtl(req.ctl);
  const levels: Record<HardKind, number> = { tempo: start0, sweetspot: start0, threshold: start0, overunder: start0, vo2: start0, anaerobic: start0 };
  for (const [k, v] of Object.entries(req.startLevels ?? {})) levels[k as HardKind] = v!;
  const basePick = new KindPicker(g.baseThresholdShare);
  const buildPick = new KindPicker(g.vo2Share);
  const thrPick = new KindPicker(0.6);
  const vo2Pick = new KindPicker(0.75);

  const sessions: PlannedSession[] = [];
  const weeks: PlanWeek[] = [];
  let ctl = req.ctl;
  let lastLoadTss = Math.max(weeklyTssFor(ctl, ctl), 150);

  for (let w = 0; w < phases.length; w += 1) {
    const phase = phases[w];
    const weekStart = addDays(req.start, w * 7);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const avail = dates.map((d) => Math.round((req.availabilityHours[weekdayOf(d)] ?? 0) * 60));

    // ---- weekly target ----
    let shape: WeekShape;
    if (phase === 'recovery') shape = { phase, quality: [], targetTss: g.recoveryDepth * lastLoadTss };
    else if (phase === 'test') shape = { phase, quality: [], targetTss: 0.55 * lastLoadTss, final: 'ftptest' };
    else if (phase === 'taper') {
      const lastTaper = w === phases.length - 1;
      shape = { phase, quality: [], targetTss: (lastTaper ? 0.45 : 0.7) * lastLoadTss, final: lastTaper ? 'event' : undefined };
    } else {
      shape = { phase, quality: [], targetTss: weeklyTssFor(ctl, ctl + g.rampPerWeek) };
      lastLoadTss = shape.targetTss;
    }

    // ---- quality mix ----
    const hardCount = phase === 'base' || phase === 'build' ? g.hardPerWeek : 1;
    for (let k = 0; k < hardCount; k += 1) {
      if (phase === 'base') {
        shape.quality.push(basePick.next('threshold', 'sweetspot'));
      } else if (phase === 'build') {
        const high = buildPick.next('vo2', 'threshold');
        shape.quality.push(high === 'vo2' ? vo2Pick.next('vo2', 'anaerobic') : thrPick.next('threshold', 'overunder'));
      } else {
        // recovery/taper/test weeks keep one short touch of intensity
        shape.quality.push(phase === 'recovery' ? 'sweetspot' : 'vo2');
      }
    }

    // ---- day placement ----
    const wanted = shape.quality.map((k) => {
      const lv = phase === 'base' || phase === 'build' ? levels[k] : Math.max(1, levels[k] - 2);
      return { kind: k, level: lv };
    });
    const needMin = wanted.map((q) => coreMinutes(q.kind, 1));
    // Long-ride day: the athlete's choice, else whichever weekend day gives
    // the best week (hard Saturday + long Sunday usually beats the reverse).
    let longIdx = -1;
    if (req.longRideDay !== undefined) longIdx = dates.findIndex((d) => weekdayOf(d) === req.longRideDay);
    else {
      const weekendIdx = dates.map((d, i) => ({ i, wd: weekdayOf(d) })).filter((x) => x.wd === 0 || x.wd === 6).map((x) => x.i);
      const pool = (weekendIdx.length ? weekendIdx : dates.map((_, i) => i)).filter((i) => avail[i] >= MIN_LONG);
      let bestScore = -Infinity;
      for (const i of pool) {
        const sc = pickHardDays(avail, i, wanted.length, needMin).score + Math.min(avail[i], 240) / 4;
        if (sc > bestScore) {
          bestScore = sc;
          longIdx = i;
        }
      }
    }
    if (longIdx >= 0 && avail[longIdx] < MIN_LONG) longIdx = -1;

    const slots: Array<Slot | undefined> = new Array(7).fill(undefined);
    let testIdx = -1;
    if (shape.final) {
      // Test/event on the last day with time; openers the day before.
      for (let i = 6; i >= 0; i -= 1) if (avail[i] >= 60) { testIdx = i; break; }
      if (testIdx >= 0) {
        if (shape.final === 'ftptest') slots[testIdx] = { kind: 'ftptest', level: 1, minutes: 60, maxMinutes: 60, prio: 9 };
        const opIdx = [testIdx - 1, testIdx - 2].find((i) => i >= 0 && avail[i] >= 45);
        if (opIdx !== undefined) slots[opIdx] = { kind: 'openers', level: 1, minutes: 45, maxMinutes: 45, prio: 9 };
      }
      longIdx = -1;
    }

    // Hard days: never consecutive, never on the final test/openers days.
    const blocked = slots.map((s) => !!s);
    let hardDays: number[] = [];
    for (let count = wanted.length; count >= 1 && !hardDays.length; count -= 1) {
      const availForHard = avail.map((a, i) => (blocked[i] || (testIdx >= 0 && i >= testIdx - 2) ? 0 : a));
      hardDays = pickHardDays(availForHard, longIdx, count, needMin.slice(0, count)).days;
    }
    hardDays.forEach((d, k) => {
      if (w === 0 && k === 0 && req.baselineTest && avail[d] >= 60) {
        slots[d] = { kind: 'ftptest', level: 1, minutes: 60, maxMinutes: 60, prio: 9 };
        return;
      }
      const q = wanted[k];
      const lv = levelThatFits(q.kind, q.level, avail[d]);
      if (!lv) return;
      const core = coreMinutes(q.kind, lv);
      slots[d] = { kind: q.kind, level: lv, minutes: core, maxMinutes: Math.min(avail[d], core + 30), prio: 3 };
      if (phase === 'base' || phase === 'build') levels[q.kind] = Math.min(MAX_LEVEL[q.kind], levels[q.kind] + 1);
    });
    if (longIdx >= 0 && !slots[longIdx]) {
      const loadWeek = phase === 'base' || phase === 'build';
      slots[longIdx] = { kind: 'long', level: 1, minutes: Math.min(avail[longIdx], loadWeek ? 120 : MIN_LONG), maxMinutes: loadWeek ? avail[longIdx] : Math.min(avail[longIdx], 120), prio: 1 };
    }
    for (let i = 0; i < 7; i += 1) {
      if (slots[i] || avail[i] < 30) continue;
      // The day before a hard day or the test stays easy and short.
      const beforeHard = slots[i + 1] && slots[i + 1]!.kind !== 'endurance' && slots[i + 1]!.kind !== 'long';
      const afterHard = i > 0 && slots[i - 1] && slots[i - 1]!.prio === 3;
      slots[i] = {
        kind: afterHard && phase !== 'base' ? 'recovery' : 'endurance',
        level: 1,
        minutes: Math.min(avail[i], MIN_EASY),
        maxMinutes: afterHard ? Math.min(avail[i], 60) : beforeHard ? Math.min(avail[i], 75) : avail[i],
        prio: 2,
      };
    }

    const { tss, limited } = fitWeek(slots, shape.targetTss);

    // ---- emit ----
    let weekHours = 0;
    let hard = 0;
    slots.forEach((s, i) => {
      if (!s) return;
      const built = buildSession(s.kind, s.minutes, s.level);
      const steps = expandBlocks(built.blocks);
      const mtx = stepMetrics(steps);
      const isHardSession = s.prio === 3 && s.kind !== 'tempo';
      if (isHardSession) hard += 1;
      weekHours += mtx.seconds / 3600;
      sessions.push({
        id: `pb-${req.start}-${dates[i]}-${s.kind}`,
        date: dates[i],
        kind: s.kind,
        level: s.level,
        title: built.title,
        durationMin: Math.round(mtx.seconds / 60),
        blocks: built.blocks,
        steps,
        ifactor: Math.round(mtx.ifactor * 1000) / 1000,
        tss: Math.round(mtx.tss),
        domain: { low: Math.round(mtx.domain.low), mid: Math.round(mtx.domain.mid), high: Math.round(mtx.domain.high) },
        hard: isHardSession || s.kind === 'ftptest',
        structure: toIntervalsText(built.blocks),
        purpose: built.purpose,
      });
    });

    // Advance CTL through the week as planned.
    const byDate = new Map(sessions.filter((s) => s.date >= weekStart).map((s) => [s.date, s.tss]));
    for (const d of dates) ctl += ((byDate.get(d) ?? 0) - ctl) / 42;
    weeks.push({
      index: w,
      start: weekStart,
      phase,
      targetTss: Math.round(shape.targetTss),
      plannedTss: Math.round(tss),
      hours: Math.round(weekHours * 10) / 10,
      hardSessions: hard,
      availabilityLimited: limited,
    });
  }

  return { id: `plan-${req.start}-${req.weeks}w-${req.objective}`, createdAt: new Date().toISOString(), request: req, genome: g, weeks, sessions };
}

/** Last date the plan covers. */
export function planEnd(plan: TrainingPlan): DateKey {
  return addDays(plan.request.start, plan.request.weeks * 7 - 1);
}

/** Plan length in weeks so the final week ends on `eventDate`. */
export function weeksUntil(start: DateKey, eventDate: DateKey): number {
  return Math.max(1, Math.ceil((diffDays(start, eventDate) + 1) / 7));
}

const KIND_INTENSITY: Record<SessionKind, Intensity> = {
  recovery: 'Recovery',
  endurance: 'Endurance',
  long: 'Endurance',
  tempo: 'Tempo',
  sweetspot: 'Threshold',
  threshold: 'Threshold',
  overunder: 'Threshold',
  vo2: 'VO2',
  anaerobic: 'VO2',
  openers: 'Tempo',
  ftptest: 'Race',
};

/** A planned session as an engine Workout, so fuelling and fitness see it. */
export function sessionToWorkout(s: PlannedSession, ftp: number, startMin: number | null = null): Workout {
  return {
    id: s.id,
    source: 'preburner',
    date: s.date,
    startMin,
    durationMin: s.durationMin,
    title: s.title,
    sport: 'Ride',
    intensity: KIND_INTENSITY[s.kind],
    ifactor: s.ifactor,
    load: s.tss,
    kj: Math.round(stepsKj(s.steps, ftp)),
    kjSource: 'steps',
    steps: s.steps,
    indoor: s.kind !== 'long',
    category: 'WORKOUT',
    description: s.structure,
  };
}

export type { Weekday };
