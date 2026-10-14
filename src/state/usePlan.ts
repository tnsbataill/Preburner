import { useMemo } from 'react';
import { weightTrend } from '../engine/goals';
import { projectFitness } from '../engine/fitness';
import { buildPlan } from '../engine/plan';
import { addDays, todayKey } from '../engine/time';
import type { Workout } from '../engine/types';
import { useApp } from './store';

export const PLAN_PAST_DAYS = 7;
export const PLAN_FUTURE_DAYS = 28;

/** Workouts after local edits: time overrides, hidden, and locally added. */
export function useEffectiveWorkouts(): Workout[] {
  const workouts = useApp((s) => s.workouts);
  const local = useApp((s) => s.localWorkouts);
  const hidden = useApp((s) => s.hiddenWorkoutIds);
  const overrides = useApp((s) => s.timeOverrides);
  return useMemo(() => {
    const hiddenSet = new Set(hidden);
    return [...workouts, ...local]
      .filter((w) => !hiddenSet.has(w.id))
      .map((w) => (overrides[w.id] !== undefined ? { ...w, startMin: overrides[w.id] } : w));
  }, [workouts, local, hidden, overrides]);
}

export function useToday() {
  const tz = useApp((s) => s.settings.profile.timezone);
  return todayKey(tz);
}

export function usePlan() {
  const settings = useApp((s) => s.settings);
  const weights = useApp((s) => s.weights);
  const wellness = useApp((s) => s.wellness);
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
