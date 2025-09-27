import type { PlannedWorkout, Step } from '../types.js';
import { plannedWorkouts } from '../samples/workouts.js';
import type { PlannedWorkoutProvider } from './provider.js';

export interface FakeProviderOptions {
  /**
   * When true, planned_kJ values will be omitted to simulate missing data from the source.
   */
  omitPlannedKj?: boolean;
}

function toTimestamp(iso: string): number {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return time;
}

function withinRange(workout: PlannedWorkout, startISO: string, endISO: string): boolean {
  const start = toTimestamp(startISO);
  const end = toTimestamp(endISO);
  const workoutStart = toTimestamp(workout.startISO);
  const workoutEnd = toTimestamp(workout.endISO);
  return workoutEnd >= start && workoutStart <= end;
}

function cloneSteps(steps: Step[] | undefined): Step[] | undefined {
  return steps ? steps.map((step) => ({ ...step })) : undefined;
}

function cloneWorkout(workout: PlannedWorkout): PlannedWorkout {
  return {
    ...workout,
    steps: cloneSteps(workout.steps),
  };
}

export class FakeProvider implements PlannedWorkoutProvider {
  private readonly omitPlannedKj: boolean;

  constructor(options: FakeProviderOptions = {}) {
    this.omitPlannedKj = Boolean(options.omitPlannedKj);
  }

  async getPlannedWorkouts(startISO: string, endISO: string): Promise<PlannedWorkout[]> {
    const filtered = plannedWorkouts.filter((workout) => withinRange(workout, startISO, endISO));

    return filtered.map((workout): PlannedWorkout => {
      const copy = cloneWorkout(workout);
      if (this.omitPlannedKj) {
        copy.planned_kJ = undefined;
        copy.kj_source = 'Estimated (steps)';
      }
      return copy;
    });
  }
}

export function createFakeProvider(options?: FakeProviderOptions): FakeProvider {
  return new FakeProvider(options);
}
