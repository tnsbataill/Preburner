import { addDays, diffDays } from './time';
import type { DateKey, FitnessPoint, WellnessDay, Workout } from './types';

const CTL_DAYS = 42;
const ATL_DAYS = 7;

/**
 * Banister impulse-response (CTL/ATL/TSB) seeded from the latest Intervals
 * wellness values, then projected forward through planned load.
 */
export function projectFitness(opts: {
  wellness: WellnessDay[];
  workouts: Workout[];
  from: DateKey;
  to: DateKey;
  today: DateKey;
}): FitnessPoint[] {
  const loadByDate = new Map<DateKey, number>();
  for (const w of opts.workouts) loadByDate.set(w.date, (loadByDate.get(w.date) ?? 0) + w.load);

  const seeds = opts.wellness.filter((d) => d.ctl !== undefined && d.atl !== undefined && d.date < opts.from);
  const seed = seeds.sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1);
  let ctl = seed?.ctl ?? 0;
  let atl = seed?.atl ?? 0;
  const cursor = seed ? addDays(seed.date, 1) : opts.from;

  const wellByDate = new Map(opts.wellness.map((d) => [d.date, d]));
  const points: FitnessPoint[] = [];
  const total = diffDays(cursor, opts.to);
  for (let i = 0; i <= total; i += 1) {
    const date = addDays(cursor, i);
    const load = loadByDate.get(date) ?? 0;
    const actual = wellByDate.get(date);
    // Past days with real Intervals values win over our recomputation.
    if (date <= opts.today && actual?.ctl !== undefined && actual.atl !== undefined) {
      ctl = actual.ctl;
      atl = actual.atl;
    } else {
      ctl += (load - ctl) / CTL_DAYS;
      atl += (load - atl) / ATL_DAYS;
    }
    if (date >= opts.from) {
      points.push({ date, load, ctl, atl, tsb: ctl - atl, projected: date > opts.today });
    }
  }
  return points;
}

/** CTL ramp over the trailing 7 days, per week. */
export function rampRate(points: FitnessPoint[], date: DateKey): number | undefined {
  const idx = points.findIndex((p) => p.date === date);
  if (idx < 7) return undefined;
  return points[idx].ctl - points[idx - 7].ctl;
}

/**
 * Daily load needed to move CTL from `ctl0` to `ctlTarget` over `days` with a
 * constant daily load — closed form of the EWMA.
 */
export function constantLoadFor(ctl0: number, ctlTarget: number, days: number): number {
  const k = 1 - 1 / CTL_DAYS;
  const decay = k ** days;
  return (ctlTarget - ctl0 * decay) / (1 - decay);
}
