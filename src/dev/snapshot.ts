import { usePlannerStore } from '../state/plannerStore.js';
import type { PlannerOverrides } from '../state/types.js';
import type { Profile, PlannedWorkout, WindowPlan, WeeklyPlan, WeightEntry } from '../types.js';

export interface PlannerSnapshot {
  capturedAt: string;
  version: string;
  profile: Profile;
  overrides: PlannerOverrides;
  workouts: PlannedWorkout[];
  windows: WindowPlan[];
  weekly: WeeklyPlan[];
  weights: WeightEntry[];
  weightSummary: ReturnType<typeof usePlannerStore.getState>['weightSummary'];
  dataSource: ReturnType<typeof usePlannerStore.getState>['dataSource'];
  lastSyncISO?: string;
}

export function capturePlannerSnapshot(): PlannerSnapshot {
  const state = usePlannerStore.getState();
  const { profile, overrides, workouts, windows, weekly, weights, weightSummary, dataSource, lastSyncISO } = state;

  const payload = {
    capturedAt: new Date().toISOString(),
    version: '1.0',
    profile,
    overrides,
    workouts,
    windows,
    weekly,
    weights,
    weightSummary,
    dataSource,
    lastSyncISO,
  } satisfies PlannerSnapshot;

  return JSON.parse(JSON.stringify(payload)) as PlannerSnapshot;
}
