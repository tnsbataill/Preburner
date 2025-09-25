import { CarbPlan, PlannedWorkout, Profile, SessionType, WindowPlan } from '../types';
import { CarbComputationResult, computeCarbPlan } from './carb';

const MS_PER_HOUR = 1000 * 60 * 60;

const HARD_SESSION_TYPES: SessionType[] = ['Threshold', 'VO2', 'Race'];

function toDate(iso: string): Date {
  return new Date(iso);
}

function hoursBetween(startISO: string, endISO: string): number {
  const start = toDate(startISO).getTime();
  const end = toDate(endISO).getTime();
  return Math.max(0, (end - start) / MS_PER_HOUR);
}

function shiftHours(iso: string, hours: number): string {
  const ms = toDate(iso).getTime() + hours * MS_PER_HOUR;
  return new Date(ms).toISOString();
}

function formatDateKey(iso: string): string {
  return iso.slice(0, 10);
}

export function harrisBenedictRmr(profile: Profile): number {
  const { sex, weight_kg, height_cm, age_years } = profile;
  if (sex === 'M') {
    return 88.362 + 13.397 * weight_kg + 4.799 * height_cm - 5.677 * age_years;
  }
  return 447.593 + 9.247 * weight_kg + 3.098 * height_cm - 4.33 * age_years;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function isHardSession(type: SessionType): boolean {
  return HARD_SESSION_TYPES.includes(type);
}

export function estimateWorkoutKilojoules(workout: PlannedWorkout): number {
  if (typeof workout.planned_kJ === 'number') {
    return workout.planned_kJ;
  }

  if (workout.steps && workout.steps.length > 0 && workout.ftp_watts_at_plan) {
    let total = 0;
    for (const step of workout.steps) {
      const durationHours = step.duration_s / 3600;
      if (step.target_type === '%FTP' && workout.ftp_watts_at_plan) {
        const lo = step.target_lo ?? step.target_hi ?? 0;
        const hi = step.target_hi ?? step.target_lo ?? lo;
        const avgPct = (lo + hi) / 2 / 100;
        total += avgPct * workout.ftp_watts_at_plan * durationHours;
      } else if (step.target_type === 'Watts') {
        const lo = step.target_lo ?? step.target_hi ?? 0;
        const hi = step.target_hi ?? step.target_lo ?? lo;
        const avgWatts = (lo + hi) / 2;
        total += avgWatts * durationHours;
      }
    }
    return total * 3600 / 1000;
  }

  if (workout.ftp_watts_at_plan && workout.duration_hr) {
    const intensityFactor: Record<SessionType, number> = {
      Endurance: 0.65,
      Tempo: 0.8,
      Threshold: 0.92,
      VO2: 1.05,
      Race: 0.95,
      Rest: 0,
    };
    const watts = workout.ftp_watts_at_plan * (intensityFactor[workout.type] ?? 0.7);
    return (watts * workout.duration_hr * MS_PER_HOUR) / 1000;
  }

  return workout.duration_hr * 500;
}

function mapCarbPlan(plan: CarbComputationResult): CarbPlan {
  return {
    g_per_hr: round(plan.g_per_hr, 1),
    pre_g: round(plan.pre_g, 1),
    during_g: round(plan.during_g, 1),
    post_g: round(plan.post_g, 1),
    gluFruRatio: round(plan.gluFruRatio, 2),
  };
}

export function buildWindows(profile: Profile, workouts: PlannedWorkout[]): WindowPlan[] {
  if (workouts.length === 0) {
    return [];
  }

  const sorted = [...workouts].sort(
    (a, b) => toDate(a.startISO).getTime() - toDate(b.startISO).getTime(),
  );
  const rmr = harrisBenedictRmr(profile);
  const windows: WindowPlan[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const next = sorted[i];
    const prev = sorted[i - 1];
    const windowStart = prev ? prev.endISO : shiftHours(next.startISO, -24);
    const windowEnd = next.endISO;
    const windowHours = hoursBetween(windowStart, windowEnd);
    const dateKey = formatDateKey(prev ? prev.endISO : next.startISO);
    const activityFactor = profile.activityFactorOverrides?.[dateKey] ?? profile.activityFactorDefault;
    const restingKcal = rmr * (windowHours / 24) * activityFactor;
    const exerciseKcal = estimateWorkoutKilojoules(next) / profile.efficiency;
    const needKcal = restingKcal + exerciseKcal;
    const carbPlan = computeCarbPlan(profile, next, needKcal);
    const notes: string[] = [];

    if (carbPlan.overFuelGuardApplied) {
      notes.push('Over-fuel guard applied');
    }

    windows.push({
      windowStartISO: windowStart,
      windowEndISO: windowEnd,
      prevWorkoutId: prev ? prev.id : 'START',
      nextWorkoutId: next.id,
      nextWorkoutType: next.type,
      need_kcal: round(needKcal),
      target_kcal: round(needKcal),
      activityFactorApplied: round(activityFactor, 2),
      carbs: mapCarbPlan(carbPlan),
      notes,
    });
  }

  return windows;
}
