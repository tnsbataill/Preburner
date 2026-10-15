import { parseLocal } from '../../engine/time';
import type { IcuActivity, IcuWellness } from '../../intervals/client';
import type { DomainLoad } from '../types';
import type { RideRecord, WellnessRecord } from './types';

// Intervals.icu activities and wellness -> the compact training history.
// Intervals gives us what Strava can't: RPE and feel, HRV and resting HR,
// zone times, and a per-ride modelled FTP from the power curve.

const RIDE = /ride|cycl|bike/i;

/** Coggan power zones (Intervals defaults): representative % of FTP and domain. */
const ZONES: Record<string, { pct: number; domain: keyof DomainLoad }> = {
  Z1: { pct: 0.45, domain: 'low' },
  Z2: { pct: 0.65, domain: 'low' },
  Z3: { pct: 0.83, domain: 'mid' },
  Z4: { pct: 0.98, domain: 'mid' },
  Z5: { pct: 1.13, domain: 'high' },
  Z6: { pct: 1.35, domain: 'high' },
  Z7: { pct: 1.7, domain: 'high' },
};

export function zoneDomains(zoneTimes: IcuActivity['icu_zone_times'], tss: number): DomainLoad | undefined {
  if (!zoneTimes?.length) return undefined;
  const raw: DomainLoad = { low: 0, mid: 0, high: 0 };
  for (const z of zoneTimes) {
    const zone = ZONES[z.id];
    if (zone) raw[zone.domain] += z.secs * zone.pct ** 4;
  }
  const tot = raw.low + raw.mid + raw.high;
  if (!tot) return undefined;
  return { low: (tss * raw.low) / tot, mid: (tss * raw.mid) / tot, high: (tss * raw.high) / tot };
}

export function activityToRide(a: IcuActivity, ftpFallback: number): RideRecord | undefined {
  if (a.type && !RIDE.test(a.type)) return undefined;
  if (/e-?bike/i.test(a.type ?? '')) return undefined;
  const at = parseLocal(a.start_date_local);
  if (!at) return undefined;
  // Strava-sourced activities come back as stubs: a date and nothing else (not
  // even the sport). Keep the fact that something was recorded; the history
  // decides what it means against the plan.
  if (a.source === 'STRAVA' && a.icu_training_load === undefined) {
    return { id: `act-${a.id}`, date: at.date, startMin: at.min, durationMin: 0, tss: 0, domain: { low: 0, mid: 0, high: 0 }, ftpSet: ftpFallback, noData: true, source: 'intervals' };
  }
  const secs = a.moving_time || a.elapsed_time || 0;
  if (secs < 300) return undefined;
  const ftp = a.icu_ftp || ftpFallback;
  const ifactor = a.icu_intensity ? a.icu_intensity / 100 : a.icu_weighted_avg_watts ? a.icu_weighted_avg_watts / ftp : 0.65;
  const tss = a.icu_training_load ?? (secs / 3600) * ifactor * ifactor * 100;
  const domain =
    zoneDomains(a.icu_zone_times, tss) ??
    (ifactor < 0.76 ? { low: tss, mid: 0, high: 0 } : ifactor < 0.95 ? { low: tss * 0.4, mid: tss * 0.6, high: 0 } : { low: tss * 0.3, mid: tss * 0.5, high: tss * 0.2 });
  return {
    id: `act-${a.id}`,
    date: at.date,
    startMin: at.min,
    durationMin: Math.round(secs / 60),
    tss: Math.round(tss),
    domain: { low: Math.round(domain.low), mid: Math.round(domain.mid), high: Math.round(domain.high) },
    ftpSet: ftp,
    // icu_pm_ftp is Intervals' FTP estimate from this ride's power curve;
    // store it as the equivalent 20-min best so observations line up.
    best20: a.icu_pm_ftp ? a.icu_pm_ftp / 0.95 : undefined,
    isTest: /\b(ftp|ramp)\s*test\b|\b20\s*min(ute)?\s*test\b/i.test(a.name ?? ''),
    rpe: a.icu_rpe && a.icu_rpe >= 1 && a.icu_rpe <= 10 ? a.icu_rpe : undefined,
    feel: a.feel && a.feel >= 1 && a.feel <= 5 ? a.feel : undefined,
    plannedId: a.paired_event_id ? `icu-${a.paired_event_id}` : undefined,
    source: 'intervals',
  };
}

export function wellnessToRecords(rows: IcuWellness[]): WellnessRecord[] {
  return rows
    .filter((r) => r.hrv || r.restingHR || r.sleepSecs)
    .map((r) => ({
      date: r.id,
      lnRmssd: r.hrv && r.hrv > 0 ? Math.log(r.hrv) : undefined,
      rhr: r.restingHR || undefined,
      sleepHours: r.sleepSecs ? Math.round((r.sleepSecs / 3600) * 10) / 10 : undefined,
    }));
}

/**
 * Merge history sources. The same ride often exists in both Strava and
 * Intervals: match on date, start within 20 min (when both know it) and
 * duration within 15%. Intervals wins when it has RPE/feel; otherwise the
 * record with power bests wins.
 */
export function mergeRides(...sources: RideRecord[][]): RideRecord[] {
  const out: RideRecord[] = [];
  for (const r of sources.flat()) {
    const dup = out.findIndex(
      (o) =>
        o.date === r.date &&
        Math.abs(o.durationMin - r.durationMin) <= 0.15 * Math.max(o.durationMin, r.durationMin) &&
        (o.startMin === undefined || r.startMin === undefined || Math.abs(o.startMin - r.startMin) <= 20),
    );
    if (dup < 0) {
      out.push(r);
      continue;
    }
    const o = out[dup];
    const score = (x: RideRecord) => (x.rpe !== undefined ? 2 : 0) + (x.feel !== undefined ? 1 : 0) + (x.best5 !== undefined ? 1 : 0);
    const [keep, other] = score(r) > score(o) ? [r, o] : [o, r];
    out[dup] = {
      ...keep,
      best5: keep.best5 ?? other.best5,
      best20: Math.max(keep.best20 ?? 0, other.best20 ?? 0) || undefined,
      best60: keep.best60 ?? other.best60,
      rpe: keep.rpe ?? other.rpe,
      feel: keep.feel ?? other.feel,
      isTest: keep.isTest || other.isTest,
    };
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.startMin ?? 0) - (b.startMin ?? 0)));
}
