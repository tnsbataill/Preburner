import { describe, expect, it } from 'vitest';
import type { PlannedWorkout, WindowPlan } from '../../types.js';
import { enumerateWindowSlices, prepareWindowSlices } from '../../utils/windowSlices.js';
import { computeDailyTargets } from '../TimelinePage.js';

const BASE_WINDOW: WindowPlan = {
  windowStartISO: '2024-10-05T12:00:00Z',
  windowEndISO: '2024-10-08T12:00:00Z',
  prevWorkoutId: 'start',
  nextWorkoutId: 'wkt-tempo',
  nextWorkoutType: 'Tempo',
  need_kcal: 4200,
  target_kcal: 3900,
  activityFactorApplied: 1.2,
  resting_kcal: 2600,
  workout_kcal: 1600,
  workoutCarb_kcal: 700,
  carbs: {
    g_per_hr: 65,
    pre_g: 80,
    during_g: 210,
    post_g: 70,
    gluFruRatio: 0.8,
  },
  macros: {
    protein_g: 120,
    fat_g: 45,
    carb_g: 350,
  },
  notes: [],
};

const PREV_WORKOUT: PlannedWorkout = {
  id: 'prev',
  source: 'intervals',
  type: 'Endurance',
  startISO: '2024-10-04T08:00:00Z',
  endISO: '2024-10-04T10:30:00Z',
  duration_hr: 2.5,
  planned_kJ: 1500,
  kj_source: 'ICU Structured',
};

describe('Timeline window slicing helpers', () => {
  it('generates slices covering every day spanned by the window', () => {
    const slices = enumerateWindowSlices(BASE_WINDOW);
    const dayStarts = slices.map((slice) => slice.dayStartISO.slice(0, 10));
    expect(dayStarts).toEqual(['2024-10-05', '2024-10-06', '2024-10-07', '2024-10-08']);
  });

  it('returns slices in chronological order even when previous workout overlaps the start', () => {
    const slices = prepareWindowSlices(BASE_WINDOW, PREV_WORKOUT);
    const dayStarts = slices.map((slice) => slice.dayStartISO.slice(0, 10));
    expect(dayStarts[0]).toBe('2024-10-05');
    expect(dayStarts).toEqual(['2024-10-05', '2024-10-06', '2024-10-07', '2024-10-08']);
  });

  it('distributes window targets across consecutive days without gaps', () => {
    const targets = computeDailyTargets(BASE_WINDOW, undefined, PREV_WORKOUT);
    expect(targets.map((entry) => entry.label)).toEqual([
      'Saturday, October 5',
      'Sunday, October 6',
      'Monday, October 7',
      'Tuesday, October 8',
    ]);
    const total = targets.reduce((sum, entry) => sum + entry.value, 0);
    expect(total).toBeCloseTo(BASE_WINDOW.target_kcal, 1);
  });
});
