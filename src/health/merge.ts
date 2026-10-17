import type { DateKey, WeightEntry, WellnessDay } from '../engine/types';
import type { WellnessRecord } from '../training/history/types';
import type { AppleHealthData } from './appleHealth';

// Apple Health data is kept on its own and merged in wherever wellness and
// weights are read, so an Intervals sync (which replaces its own data) never
// wipes it. Precedence, per field:
// - weight: one per day, manual > Apple Health > Intervals
// - resting HR, sleep: Intervals when it has a value, else Apple Health
// - HRV: Intervals' rMSSD and Apple's SDNN are kept apart (different measures);
//   readiness uses SDNN only when there's no rMSSD at all (see adapt.ts)

export function withHealthDays(wellness: WellnessDay[], health?: AppleHealthData): WellnessDay[] {
  if (!health?.days.length) return wellness;
  const byDate = new Map<DateKey, WellnessDay>(wellness.map((w) => [w.date, w]));
  for (const h of health.days) {
    const w = byDate.get(h.date) ?? { date: h.date };
    byDate.set(h.date, {
      ...w,
      weight: w.weight ?? h.weightKg,
      restingHR: w.restingHR ?? h.restingHR,
      sleepHours: w.sleepHours ?? h.sleepHours,
      hrvSdnn: h.hrvSdnn,
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function withHealthRecords(records: WellnessRecord[], health?: AppleHealthData): WellnessRecord[] {
  if (!health?.days.length) return records;
  const byDate = new Map<DateKey, WellnessRecord>(records.map((w) => [w.date, w]));
  for (const h of health.days) {
    if (h.restingHR === undefined && h.sleepHours === undefined && h.hrvSdnn === undefined) continue;
    const w = byDate.get(h.date) ?? { date: h.date };
    byDate.set(h.date, {
      ...w,
      rhr: w.rhr ?? h.restingHR,
      sleepHours: w.sleepHours ?? h.sleepHours,
      lnSdnn: h.hrvSdnn ? Math.log(h.hrvSdnn) : undefined,
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const RANK: Record<WeightEntry['source'], number> = { manual: 0, 'apple-health': 1, intervals: 2, demo: 3 };

/** One weight per day for the trend: manual > Apple Health > Intervals. */
export function withHealthWeights(weights: WeightEntry[], health?: AppleHealthData): WeightEntry[] {
  const all = [...weights, ...(health?.days ?? []).filter((d) => d.weightKg !== undefined).map((d) => ({ date: d.date, kg: d.weightKg!, source: 'apple-health' as const }))];
  const best = new Map<DateKey, WeightEntry>();
  for (const w of all) {
    const cur = best.get(w.date);
    if (!cur || RANK[w.source] < RANK[cur.source]) best.set(w.date, w);
  }
  return [...best.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Latest body fat within the last 60 days, if any. */
export function recentBodyFat(health: AppleHealthData | undefined, today: DateKey): { pct: number; date: DateKey } | undefined {
  const d = [...(health?.days ?? [])].reverse().find((x) => x.bodyFatPct !== undefined);
  if (!d) return undefined;
  const ageDays = (Date.parse(today) - Date.parse(d.date)) / 864e5;
  return ageDays <= 60 ? { pct: d.bodyFatPct!, date: d.date } : undefined;
}
