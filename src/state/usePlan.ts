import { useMemo } from 'react';
import { weightTrend } from '../engine/goals';
import { projectFitness } from '../engine/fitness';
import { buildPlan } from '../engine/plan';
import { addDays, todayKey } from '../engine/time';
import type { Workout } from '../engine/types';
import { useApp } from './store';
import { useWeights, useWellness } from './useHealth';
import { mergePlanIntoCalendar } from './training';
import { detailsToWorkout } from '../training/review';

export const PLAN_PAST_DAYS = 7;
export const PLAN_FUTURE_DAYS = 28;

/** Workouts after local edits: time overrides, hidden, and locally added. */
export function useEffectiveWorkouts(): Workout[] {
  const workouts = useApp((s) => s.workouts);
  const local = useApp((s) => s.localWorkouts);
  const hidden = useApp((s) => s.hiddenWorkoutIds);
  const overrides = useApp((s) => s.timeOverrides);
  const training = useApp((s) => s.training);
  const mode = useApp((s) => s.connection.mode);
  const ftp = useApp((s) => s.settings.profile.ftp);
  const today = useToday();
  return useMemo(() => {
    const hiddenSet = new Set(hidden);
    // Strava-only rides the athlete filled in show as completed rides.
    const ids = new Set(workouts.map((w) => w.id));
    const filled = training.intervalsRides.flatMap((r) => {
      const d = r.noData && !ids.has(r.id) ? training.rideDetails?.[r.id] : undefined;
      const w = d && detailsToWorkout(r, d, training.feedback[r.id]?.rpe, training.ftp ?? ftp);
      return w ? [w] : [];
    });
    const base = [...workouts, ...local, ...filled].filter((w) => !hiddenSet.has(w.id));
    // A Preburner training plan replaces other planned sessions in its window.
    return mergePlanIntoCalendar(base, training, today, mode, ftp).map((w) => (overrides[w.id] !== undefined ? { ...w, startMin: overrides[w.id] } : w));
  }, [workouts, local, hidden, overrides, training, mode, ftp, today]);
}

export function useToday() {
  const tz = useApp((s) => s.settings.profile.timezone);
  return todayKey(tz);
}

export function usePlan() {
  const settings = useApp((s) => s.settings);
  const weights = useWeights();
  const wellness = useWellness();
  const workouts = useEffectiveWorkouts();
  const today = useToday();

  return useMemo(() => {
    const trend = weightTrend(weights);
    const currentWeightKg = trend.at(-1)?.trend ?? settings.profile.weightKg;
    const start = addDays(today, -PLAN_PAST_DAYS);
    const plan = buildPlan({ settings, workouts, start, days: PLAN_PAST_DAYS + PLAN_FUTURE_DAYS, today, currentWeightKg });
    const fitnessEnd = settings.goals.eventDate && settings.goals.eventDate > addDays(today, PLAN_FUTURE_DAYS) ? settings.goals.eventDate : addDays(today, PLAN_FUTURE_DAYS);
    const fitness = projectFitness({ wellness, workouts, from: addDays(today, -60), to: fitnessEnd, today });
    return { plan, fitness, trend, currentWeightKg, today };
  }, [settings, weights, wellness, workouts, today]);
}
