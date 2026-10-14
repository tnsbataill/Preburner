import { describe, expect, it } from 'vitest';
import { describePlannerNote } from '../noteFormatting.js';
import { buildWindows, isHardSession } from '../prescribe.js';
import { WINDOW_EMPTY_FLAG, WINDOW_UNDER_RECOVERY_FLAG, allocateWeeklyDeficits } from '../weekly.js';
import { plannedWorkouts } from '../../samples/workouts.js';
import { sampleProfile } from '../../samples/profile.js';

const LOG_RESULTS = process.env.DEBUG_DEFICIT === '1';

function sumDeficit(windows: ReturnType<typeof buildWindows>) {
  return windows.reduce((total, window) => total + Math.max(0, window.need_kcal - window.target_kcal), 0);
}

function windowCapacity(profile: typeof sampleProfile, windows: ReturnType<typeof buildWindows>) {
  const workoutMap = new Map(plannedWorkouts.map((workout) => [workout.id, workout]));
  return windows.reduce((sum, window) => {
    const nextWorkout = workoutMap.get(window.nextWorkoutId);
    const nextType = nextWorkout?.type ?? window.nextWorkoutType;
    const pctCap = profile.windowPctCap ?? 0.3;
    let maxDeficit = Math.min(profile.deficitCapPerWindow, window.need_kcal * pctCap);
    if (window.notes.includes(WINDOW_EMPTY_FLAG)) {
      maxDeficit *= 0.5;
    }
    return sum + Math.max(0, maxDeficit);
  }, 0);
}

describe('weekly target influence', () => {
  it('responds to more aggressive weight-loss targets', () => {
    const baseProfile = { ...sampleProfile, targetKgPerWeek: 0 };
    const baseWindows = buildWindows(baseProfile, plannedWorkouts);
    const { windows: baseAllocated } = allocateWeeklyDeficits(
      baseProfile,
      baseWindows,
      plannedWorkouts,
    );

    const aggressiveProfile = { ...sampleProfile, targetKgPerWeek: -0.9 };
    const aggressiveWindows = buildWindows(aggressiveProfile, plannedWorkouts);
    const { windows: aggressiveAllocated } = allocateWeeklyDeficits(
      aggressiveProfile,
      aggressiveWindows,
      plannedWorkouts,
    );

    expect(sumDeficit(baseAllocated)).toBeLessThan(sumDeficit(aggressiveAllocated));
  });

  it('reduces per-window targets when the weekly loss goal increases', () => {
    const moderateProfile = { ...sampleProfile, targetKgPerWeek: -0.1 };
    const moderateWindows = buildWindows(moderateProfile, plannedWorkouts);
    const { windows: moderateAllocated } = allocateWeeklyDeficits(
      moderateProfile,
      moderateWindows,
      plannedWorkouts,
    );

    const aggressiveProfile = { ...sampleProfile, targetKgPerWeek: -0.8 };
    const aggressiveWindows = buildWindows(aggressiveProfile, plannedWorkouts);
    const { windows: aggressiveAllocated } = allocateWeeklyDeficits(
      aggressiveProfile,
      aggressiveWindows,
      plannedWorkouts,
    );

    const findWindow = (windows: typeof moderateAllocated) =>
      windows.find((window) => window.nextWorkoutType === 'Endurance');

    const moderateWindow = findWindow(moderateAllocated);
    const aggressiveWindow = findWindow(aggressiveAllocated);

    expect(moderateWindow).toBeDefined();
    expect(aggressiveWindow).toBeDefined();
    expect(aggressiveWindow!.target_kcal).toBeLessThan(moderateWindow!.target_kcal);
  });

  it('matches the requested weekly deficit until hitting capacity', () => {
    const mildProfile = { ...sampleProfile, targetKgPerWeek: -0.05 };
    const mildWindows = buildWindows(mildProfile, plannedWorkouts);
    const { windows: mildAllocated } = allocateWeeklyDeficits(
      mildProfile,
      mildWindows,
      plannedWorkouts,
    );

    const aggressiveProfile = { ...sampleProfile, targetKgPerWeek: -1.2 };
    const aggressiveWindows = buildWindows(aggressiveProfile, plannedWorkouts);
    const { windows: aggressiveAllocated } = allocateWeeklyDeficits(
      aggressiveProfile,
      aggressiveWindows,
      plannedWorkouts,
    );

    const mildTarget = Math.abs(mildProfile.targetKgPerWeek) * mildProfile.kcalPerKg;
    expect(sumDeficit(mildAllocated)).toBeCloseTo(mildTarget, 0);

    const aggressiveTarget = Math.abs(aggressiveProfile.targetKgPerWeek) * aggressiveProfile.kcalPerKg;
    const aggressiveTotal = sumDeficit(aggressiveAllocated);
    expect(aggressiveTotal).toBeLessThan(aggressiveTarget);
    expect(aggressiveTotal).toBeCloseTo(windowCapacity(aggressiveProfile, aggressiveAllocated), 0);
  });

  it('does not apply a deficit when targeting weight gain', () => {
    const gainProfile = { ...sampleProfile, targetKgPerWeek: 0.4 };
    const gainWindows = buildWindows(gainProfile, plannedWorkouts);
    const { windows: gainAllocated } = allocateWeeklyDeficits(
      gainProfile,
      gainWindows,
      plannedWorkouts,
    );

    expect(sumDeficit(gainAllocated)).toBe(0);
    expect(
      gainAllocated.every((window) => Math.abs(window.target_kcal - window.need_kcal) < 1e-6),
    ).toBe(true);
  });

  it('emits descriptive safety notes across slider-accessible weight-loss targets', () => {
    const sliderTargets = [-0.1, -0.2, -0.35, -0.6, -1.0];

    const results = sliderTargets.map((targetKgPerWeek) => {
      const profile = { ...sampleProfile, targetKgPerWeek };
      const windows = buildWindows(profile, plannedWorkouts);
      const { windows: allocated, weekly } = allocateWeeklyDeficits(profile, windows, plannedWorkouts);

      const uniqueTokens = Array.from(new Set(allocated.flatMap((window) => window.notes))).sort();
      const formattedNotes = uniqueTokens
        .map((note) => describePlannerNote(note, (value, digits = 0) => value.toFixed(digits)))
        .sort();
      const weeklySummary = weekly[0];

      return {
        targetKgPerWeek,
        weeklyAllocated_kcal: weeklySummary?.weeklyAllocated_kcal ?? 0,
        carryOver_kcal: weeklySummary?.carryOver_kcal ?? 0,
        noteTokens: uniqueTokens,
        formattedNotes,
      };
    });

    if (LOG_RESULTS) {
      // eslint-disable-next-line no-console
      console.log('Slider deficit summaries:', JSON.stringify(results, null, 2));
    }

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "carryOver_kcal": 0,
          "formattedNotes": [
            "Planned deficit in this window: 193 kcal.",
          ],
          "noteTokens": [
            "DEFICIT_APPLIED:193",
          ],
          "targetKgPerWeek": -0.1,
          "weeklyAllocated_kcal": 770,
        },
        {
          "carryOver_kcal": 0,
          "formattedNotes": [
            "Planned deficit in this window: 385 kcal.",
          ],
          "noteTokens": [
            "DEFICIT_APPLIED:385",
          ],
          "targetKgPerWeek": -0.2,
          "weeklyAllocated_kcal": 1540,
        },
        {
          "carryOver_kcal": 295,
          "formattedNotes": [
            "Max safe deficit reached here: 600 kcal. Weekly target still short by 295 kcal.",
            "Planned deficit in this window: 600 kcal.",
          ],
          "noteTokens": [
            "DEFICIT_APPLIED:600",
            "DEFICIT_MAXED:600:295",
          ],
          "targetKgPerWeek": -0.35,
          "weeklyAllocated_kcal": 2400,
        },
        {
          "carryOver_kcal": 2220,
          "formattedNotes": [
            "Max safe deficit reached here: 600 kcal. Weekly target still short by 2220 kcal.",
            "Planned deficit in this window: 600 kcal.",
          ],
          "noteTokens": [
            "DEFICIT_APPLIED:600",
            "DEFICIT_MAXED:600:2220",
          ],
          "targetKgPerWeek": -0.6,
          "weeklyAllocated_kcal": 2400,
        },
        {
          "carryOver_kcal": 5300,
          "formattedNotes": [
            "Max safe deficit reached here: 600 kcal. Weekly target still short by 5300 kcal.",
            "Planned deficit in this window: 600 kcal.",
          ],
          "noteTokens": [
            "DEFICIT_APPLIED:600",
            "DEFICIT_MAXED:600:5300",
          ],
          "targetKgPerWeek": -1,
          "weeklyAllocated_kcal": 2400,
        },
      ]
    `);
  });
});
