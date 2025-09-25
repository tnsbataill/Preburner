import { describe, expect, it } from 'vitest';
import { buildWindows, estimateWorkoutKilojoules, harrisBenedictRmr } from '../prescribe';
import {
  WINDOW_EMPTY_FLAG,
  WINDOW_UNDER_RECOVERY_FLAG,
  allocateWeeklyDeficits,
} from '../weekly';
import { computeCarbPlan } from '../carb';
import { plannedWorkouts } from '../../samples/workouts';
import { sampleProfile } from '../../samples/profile';

function cloneProfile(overrides: Partial<typeof sampleProfile> = {}) {
  return { ...sampleProfile, ...overrides };
}

describe('prescription engine', () => {
  it('computes resting metabolic rate using Harris-Benedict', () => {
    const rmr = harrisBenedictRmr(sampleProfile);
    expect(Math.round(rmr)).toBeGreaterThan(1400);
    expect(Math.round(rmr)).toBeLessThan(1700);
  });

  it('estimates kilojoules using structured steps when missing planned_kJ', () => {
    const workout = { ...plannedWorkouts[1], planned_kJ: undefined };
    const estimate = estimateWorkoutKilojoules(workout);
    expect(estimate).toBeGreaterThan(500);
    expect(estimate).toBeLessThan(1500);
  });

  it('protects hard days from deficits', () => {
    const windows = buildWindows(sampleProfile, plannedWorkouts);
    const { windows: allocated } = allocateWeeklyDeficits(sampleProfile, windows, plannedWorkouts);
    const hardWindow = allocated.find((window) => window.nextWorkoutType === 'VO2');
    expect(hardWindow).toBeDefined();
    expect(hardWindow?.target_kcal).toBe(hardWindow?.need_kcal);
  });

  it('enforces deficit caps and weekly totals', () => {
    const aggressiveProfile = cloneProfile({ targetKgPerWeek: -0.8 });
    const windows = buildWindows(aggressiveProfile, plannedWorkouts);
    const { windows: allocated, weekly } = allocateWeeklyDeficits(
      aggressiveProfile,
      windows,
      plannedWorkouts,
    );

    const easyWindow = allocated.find((window) => window.nextWorkoutType === 'Endurance');
    expect(easyWindow).toBeDefined();
    const deficit = easyWindow!.need_kcal - easyWindow!.target_kcal;
    const pctCap = aggressiveProfile.windowPctCap ?? 0.3;
    expect(deficit).toBeLessThanOrEqual(aggressiveProfile.deficitCapPerWindow + 1);
    expect(deficit).toBeLessThanOrEqual(easyWindow!.need_kcal * pctCap + 1);

    const allocatedTotal = weekly.reduce((sum, week) => sum + week.weeklyAllocated_kcal, 0);
    expect(allocatedTotal).toBeLessThanOrEqual(
      Math.abs(aggressiveProfile.targetKgPerWeek) * aggressiveProfile.kcalPerKg + 1,
    );
  });

  it('applies weight flags to adjust deficits', () => {
    const windows = buildWindows(sampleProfile, plannedWorkouts);
    windows[0].notes.push(WINDOW_EMPTY_FLAG);
    windows[1].notes.push(WINDOW_UNDER_RECOVERY_FLAG);
    const { windows: allocated } = allocateWeeklyDeficits(sampleProfile, windows, plannedWorkouts);

    const flaggedHalf = allocated[0].need_kcal - allocated[0].target_kcal;
    const expectedMax = Math.min(
      sampleProfile.deficitCapPerWindow,
      allocated[0].need_kcal * (sampleProfile.windowPctCap ?? 0.3),
    );
    expect(flaggedHalf).toBeLessThanOrEqual(expectedMax * 0.51);

    const flaggedZero = allocated[1].need_kcal - allocated[1].target_kcal;
    expect(flaggedZero).toBe(0);
  });

  it('creates carb splits using profile defaults', () => {
    const windowNeed = 2000;
    const plan = computeCarbPlan(sampleProfile, plannedWorkouts[2], windowNeed);
    expect(plan.g_per_hr).toBeCloseTo(sampleProfile.carbBands.VO2[1], 1);
    expect(plan.gluFruRatio).toBeCloseTo(sampleProfile.gluFruRatio, 5);
    const totalCarbs = plan.pre_g + plan.during_g + plan.post_g;
    expect(totalCarbs).toBeGreaterThan(0);
  });

  it('derives macro targets per window and aggregates them weekly', () => {
    const baseWindows = buildWindows(sampleProfile, plannedWorkouts);
    const easyWindow = baseWindows.find((window) => window.nextWorkoutType === 'Endurance');
    expect(easyWindow).toBeDefined();
    const expectedProtein = sampleProfile.protein_g_per_kg * sampleProfile.weight_kg;
    const expectedFat = sampleProfile.fat_g_per_kg_min * sampleProfile.weight_kg;
    expect(easyWindow?.macros.protein_g).toBeCloseTo(expectedProtein, 1);
    expect(easyWindow?.macros.fat_g).toBeCloseTo(expectedFat, 1);

    const { windows: allocated, weekly } = allocateWeeklyDeficits(sampleProfile, baseWindows, plannedWorkouts);
    const allocatedEasy = allocated.find((window) => window.nextWorkoutType === 'Endurance');
    expect(allocatedEasy).toBeDefined();
    expect(allocatedEasy?.macros.protein_g).toBeCloseTo(expectedProtein, 1);
    expect(allocatedEasy?.macros.fat_g).toBeCloseTo(expectedFat, 1);
    expect(allocatedEasy?.macros.carb_g ?? Infinity).toBeLessThan(easyWindow?.macros.carb_g ?? 0);

    const weeklyTotals = weekly[0];
    expect(weeklyTotals).toBeDefined();
    const summedCarbs = allocated.reduce((sum, window) => sum + window.macros.carb_g, 0);
    const summedProtein = allocated.reduce((sum, window) => sum + window.macros.protein_g, 0);
    const summedFat = allocated.reduce((sum, window) => sum + window.macros.fat_g, 0);
    expect(weeklyTotals?.macros.carb_g).toBeCloseTo(summedCarbs, 0);
    expect(weeklyTotals?.macros.protein_g).toBeCloseTo(summedProtein, 0);
    expect(weeklyTotals?.macros.fat_g).toBeCloseTo(summedFat, 0);
  });
});
