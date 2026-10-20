import { TYPICAL_IF, estimateKj, intensityFromIf, loadFromIf } from '../engine/energy';
import { parseLocal } from '../engine/time';
import type { AthleteProfile, Intensity, WeightEntry, WellnessDay, Workout, WorkoutStep } from '../engine/types';
import type { IcuActivity, IcuAthlete, IcuEvent, IcuWellness } from './client';

const RIDE_TYPES = /ride|cycl|bike/i;

export function parseKjFromDescription(desc?: string): number | undefined {
  if (!desc) return undefined;
  const text = desc.replace(/<[^>]+>/g, ' ');
  const m = /\b(\d{2,5})\s*kJ\b|\bkJ(?:\s*\(Cal\))?\s*(\d{2,5})\b/i.exec(text);
  const v = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Intervals workout_doc steps → flat %FTP steps (repeats expanded). */
export function parseWorkoutDoc(doc: unknown, ftp?: number): WorkoutStep[] | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const steps = (doc as { steps?: unknown[] }).steps;
  if (!Array.isArray(steps)) return undefined;
  const out: WorkoutStep[] = [];
  const toFrac = (v: unknown, units?: string): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    if (units === 'w' || units === 'W' || units === 'watts' || n > 3) {
      if (units === '%ftp' || units === 'percent_ftp') return n / 100;
      return ftp ? n / ftp : undefined;
    }
    return n;
  };
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const s = raw as Record<string, any>;
      if (Array.isArray(s.steps)) {
        const reps = Math.max(1, Number(s.reps) || 1);
        for (let r = 0; r < reps; r += 1) walk(s.steps);
        continue;
      }
      const dur = Number(s.duration);
      if (!Number.isFinite(dur) || dur <= 0) continue;
      const p = s.power ?? s._power;
      let lo: number | undefined;
      let hi: number | undefined;
      if (p && typeof p === 'object') {
        const units = p.units as string | undefined;
        lo = toFrac(p.start ?? p.value, units);
        hi = toFrac(p.end ?? p.value, units) ?? lo;
      }
      if (lo === undefined) {
        // Unknown target (HR/pace/free): assume easy endurance.
        lo = 0.6;
        hi = 0.65;
      }
      out.push({ durationS: dur, lo, hi: hi ?? lo });
    }
  };
  walk(steps);
  return out.length ? out : undefined;
}

export function parseZwo(xml: string): WorkoutStep[] | undefined {
  const re = /<(Warmup|Cooldown|SteadyState|IntervalsT|FreeRide|Ramp)\b([^>]*)\/?>/gi;
  const out: WorkoutStep[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs: Record<string, number> = {};
    for (const a of m[2].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1].toLowerCase()] = Number(a[2]);
    const tag = m[1].toLowerCase();
    if (tag === 'intervalst') {
      for (let r = 0; r < (attrs.repeat || 1); r += 1) {
        out.push({ durationS: attrs.onduration, lo: attrs.onpower, hi: attrs.onpower });
        if (attrs.offduration) out.push({ durationS: attrs.offduration, lo: attrs.offpower, hi: attrs.offpower });
      }
    } else if (tag === 'steadystate') {
      out.push({ durationS: attrs.duration, lo: attrs.power, hi: attrs.power });
    } else if (tag === 'freeride') {
      out.push({ durationS: attrs.duration, lo: 0.55, hi: 0.65 });
    } else {
      out.push({ durationS: attrs.duration, lo: attrs.powerlow, hi: attrs.powerhigh });
    }
  }
  const valid = out.filter((s) => s.durationS > 0 && Number.isFinite(s.lo));
  return valid.length ? valid : undefined;
}

export function classifyIntensity(name: string, ifactor: number | undefined, category?: string): Intensity {
  if (/^RACE_/.test(category ?? '')) return 'Race';
  const n = name.toLowerCase();
  if (/\brace\b|crit\b|time trial|\btt\b|fondo/.test(n)) return 'Race';
  if (/vo2|v02|anaerobic|max aerobic/.test(n)) return 'VO2';
  if (/threshold|sweet ?spot|over[- ]?under|ftp/.test(n)) return 'Threshold';
  if (/tempo|steady state/.test(n)) return 'Tempo';
  if (/recovery|easy spin|rest/.test(n) && (ifactor ?? 0) < 0.65) return 'Recovery';
  if (/endurance|aerobic|z2|base/.test(n) && (ifactor ?? 0) < 0.8) return 'Endurance';
  return ifactor ? intensityFromIf(ifactor) : 'Endurance';
}

/**
 * Map a planned Intervals event. A local start of exactly 00:00 means the
 * event was synced date-only (TrainerRoad does this), so the time is unknown.
 */
export function eventToWorkout(e: IcuEvent, ftpFallback: number): Workout | undefined {
  if (e.category === 'NOTE') return undefined;
  const at = parseLocal(e.start_date_local);
  if (!at) return undefined;
  const ftp = e.icu_ftp || ftpFallback;
  const steps = parseWorkoutDoc(e.workout_doc, ftp);
  const stepSecs = steps?.reduce((s, x) => s + x.durationS, 0);
  const durationMin = Math.round((e.moving_time || e.time_target || stepSecs || 3600) / 60);
  const ifactor = e.icu_intensity ? e.icu_intensity / 100 : undefined;
  const name = e.name ?? 'Workout';
  const intensity = classifyIntensity(name, ifactor, e.category);
  const est = estimateKj({
    plannedKj: e.joules ? e.joules / 1000 : undefined,
    descriptionKj: parseKjFromDescription(e.description),
    steps,
    ifactor,
    load: e.icu_training_load ?? e.load_target,
    durationMin,
    ftp,
    intensity,
  });
  const isRide = !e.type || RIDE_TYPES.test(e.type);
  return {
    id: `icu-${e.id}`,
    source: e.external_id?.startsWith('preburner') ? 'preburner' : 'intervals',
    date: at.date,
    startMin: at.min === 0 ? null : at.min,
    durationMin,
    title: name,
    sport: e.type ?? 'Ride',
    intensity,
    ifactor: est.ifactor,
    load: Math.round(e.icu_training_load ?? e.load_target ?? loadFromIf(est.ifactor, durationMin)),
    // Non-ride sports: mechanical kJ isn't meaningful; approximate from the same model.
    kj: Math.round(isRide ? est.kj : est.kj * 0.9),
    kjSource: est.source,
    steps,
    indoor: e.indoor,
    carbsPerHourOverride: e.carbs_per_hour || undefined,
    category: e.category,
    description: e.description,
    externalId: e.external_id,
    tags: e.tags,
  };
}

export function activityToWorkout(a: IcuActivity, ftpFallback: number): Workout | undefined {
  const at = parseLocal(a.start_date_local);
  if (!at) return undefined;
  const durationMin = Math.round((a.moving_time || a.elapsed_time || 0) / 60);
  if (durationMin < 5) return undefined;
  const ifactor = a.icu_intensity ? a.icu_intensity / 100 : TYPICAL_IF.Endurance;
  const ftp = a.icu_ftp || ftpFallback;
  const kj = a.icu_joules ? a.icu_joules / 1000 : (ftp * ifactor * 0.95 * durationMin * 60) / 1000;
  return {
    id: `act-${a.id}`,
    source: 'intervals',
    date: at.date,
    startMin: at.min,
    durationMin,
    title: a.name ?? a.type ?? 'Activity',
    sport: a.type ?? 'Ride',
    intensity: classifyIntensity(a.name ?? '', ifactor),
    ifactor,
    load: Math.round(a.icu_training_load ?? loadFromIf(ifactor, durationMin)),
    kj: Math.round(kj),
    kjSource: a.icu_joules ? 'actual' : 'intensity',
    indoor: a.trainer,
    completed: true,
    category: 'WORKOUT',
  };
}

/** Completed activities replace the planned event they were paired with. */
export function mergePlannedAndDone(events: IcuEvent[], activities: IcuActivity[], ftp: number): Workout[] {
  const pairedEventIds = new Set(activities.map((a) => a.paired_event_id).filter(Boolean).map((id) => `icu-${id}`));
  const planned = events.map((e) => eventToWorkout(e, ftp)).filter((w): w is Workout => !!w && !pairedEventIds.has(w.id));
  const done = activities.map((a) => activityToWorkout(a, ftp)).filter((w): w is Workout => !!w);
  return [...planned, ...done].sort((a, b) => (a.date === b.date ? (a.startMin ?? 0) - (b.startMin ?? 0) : a.date < b.date ? -1 : 1));
}

export function wellnessToDays(rows: IcuWellness[]): { wellness: WellnessDay[]; weights: WeightEntry[] } {
  const wellness: WellnessDay[] = [];
  const weights: WeightEntry[] = [];
  for (const r of rows) {
    wellness.push({
      date: r.id,
      ctl: r.ctl,
      atl: r.atl,
      weight: r.weight,
      restingHR: r.restingHR,
      hrv: r.hrv,
      sleepHours: r.sleepSecs ? Math.round((r.sleepSecs / 3600) * 10) / 10 : undefined,
      kcalConsumed: r.kcalConsumed,
    });
    if (r.weight && r.weight > 20) weights.push({ date: r.id, kg: r.weight, source: 'intervals' });
  }
  return { wellness, weights };
}

export function athleteToProfile(a: IcuAthlete, today: string): Partial<AthleteProfile> {
  const out: Partial<AthleteProfile> = {};
  const ride = a.sportSettings?.find((s) => s.types?.some((t) => RIDE_TYPES.test(t)));
  if (ride?.ftp) out.ftp = ride.ftp;
  const weight = a.icu_weight ?? a.weight;
  if (weight && weight > 20) out.weightKg = weight;
  if (a.height && a.height > 0) out.heightCm = a.height < 3 ? Math.round(a.height * 100) : a.height;
  if (a.sex === 'M' || a.sex === 'F') out.sex = a.sex;
  if (a.icu_date_of_birth) {
    const [y, m, d] = a.icu_date_of_birth.split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    out.ageYears = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  }
  if (a.timezone) out.timezone = a.timezone;
  if (a.measurement_preference) out.units = a.measurement_preference === 'meters' ? 'metric' : 'imperial';
  out.name = a.firstname ?? a.name;
  return out;
}
