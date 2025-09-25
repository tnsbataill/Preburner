import type { PlannedWorkout } from '../types.js';

export interface PlannedWorkoutProvider {
  getPlannedWorkouts(startISO: string, endISO: string): Promise<PlannedWorkout[]>;
}
