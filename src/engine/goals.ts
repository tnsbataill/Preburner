import { KCAL_PER_KG_TISSUE } from './energy';
import { diffDays } from './time';
import type { DateKey, Goals, PlanFlag, WeightEntry } from './types';

/** Exponentially-smoothed weight trend (Hacker's Diet style, ~10-day half-life). */
export function weightTrend(entries: WeightEntry[], alpha = 0.1): Array<{ date: DateKey; kg: number; trend: number }> {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: Array<{ date: DateKey; kg: number; trend: number }> = [];
  let trend: number | undefined;
  let prevDate: DateKey | undefined;
  for (const e of sorted) {
    if (trend === undefined) trend = e.kg;
    else {
      // Missing days decay the trend toward the new value faster.
      const gap = prevDate ? Math.max(1, diffDays(prevDate, e.date)) : 1;
      const a = 1 - (1 - alpha) ** gap;
      trend += a * (e.kg - trend);
    }
    prevDate = e.date;
    out.push({ date: e.date, kg: e.kg, trend });
  }
  return out;
}

/** Observed rate of change of the trend over the last `days`, kg/week. */
export function observedRate(entries: WeightEntry[], days = 21): number | undefined {
  const t = weightTrend(entries);
  if (t.length < 4) return undefined;
  const last = t[t.length - 1];
  const first = [...t].reverse().find((p) => diffDays(p.date, last.date) >= days) ?? t[0];
  const span = diffDays(first.date, last.date);
  if (span < 7) return undefined;
  return ((last.trend - first.trend) / span) * 7;
}

export interface RateResult {
  weeklyRateKg: number;
  requestedKg: number;
  flags: PlanFlag[];
}

/**
 * Resolve the weekly weight-change rate. Losses are capped at 1% of body mass
 * per week (0.5–0.7% is the sweet spot for keeping power) and gains at 0.5%.
 */
export function resolveWeeklyRate(goals: Goals, currentKg: number, today: DateKey): RateResult {
  const flags: PlanFlag[] = [];
  let requested = goals.weeklyRateKg ?? 0;
  if (goals.weeklyRateKg === undefined && goals.targetWeightKg && goals.targetWeightDate) {
    const weeks = diffDays(today, goals.targetWeightDate) / 7;
    if (weeks > 0.5) requested = (goals.targetWeightKg - currentKg) / weeks;
    else if (Math.abs(goals.targetWeightKg - currentKg) > 0.3)
      flags.push({ level: 'warn', code: 'goal-date-passed', message: 'Your target weight date has passed — set a new one.' });
  }
  const maxLoss = -0.01 * currentKg;
  const maxGain = 0.005 * currentKg;
  let rate = Math.max(maxLoss, Math.min(maxGain, requested));
  if (rate !== requested) {
    flags.push({
      level: 'warn',
      code: 'rate-clamped',
      message: `Target needs ${requested.toFixed(2)} kg/wk; capped at ${rate.toFixed(2)} kg/wk to protect training quality.`,
    });
  }
  if (rate < -0.007 * currentKg) {
    flags.push({
      level: 'info',
      code: 'rate-aggressive',
      message: 'Losing >0.7% body mass per week usually costs power. Consider a later target date.',
    });
  }
  rate = Math.round(rate * 100) / 100;
  return { weeklyRateKg: rate, requestedKg: requested, flags };
}

export function weeklyEnergyDelta(rateKg: number): number {
  return rateKg * KCAL_PER_KG_TISSUE;
}

export interface DeficitCandidate {
  date: DateKey;
  /** 0 = protected */
  weight: number;
  cap: number;
}

/** Water-fill a weekly deficit into days by weight, respecting per-day caps. */
export function allocateDeficit(total: number, days: DeficitCandidate[]): Map<DateKey, number> {
  const out = new Map<DateKey, number>(days.map((d) => [d.date, 0]));
  let remaining = Math.max(0, total);
  let active = days.filter((d) => d.weight > 0 && d.cap > 0);
  for (let guard = 0; guard < 20 && remaining > 1 && active.length; guard += 1) {
    const wSum = active.reduce((s, d) => s + d.weight, 0);
    let used = 0;
    for (const d of active) {
      const room = d.cap - out.get(d.date)!;
      const give = Math.min(room, (remaining * d.weight) / wSum);
      out.set(d.date, out.get(d.date)! + give);
      used += give;
    }
    remaining -= used;
    active = active.filter((d) => d.cap - out.get(d.date)! > 1);
  }
  return out;
}
