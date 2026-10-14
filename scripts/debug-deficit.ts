import { buildWindows } from '../src/calc/prescribe.js';
import { allocateWeeklyDeficits } from '../src/calc/weekly.js';
import { plannedWorkouts } from '../src/samples/workouts.js';
import { sampleProfile } from '../src/samples/profile.js';

interface SummaryRequest {
  targetKgPerWeek: number;
}

function summarize({ targetKgPerWeek }: SummaryRequest) {
  const profile = { ...sampleProfile, targetKgPerWeek };
  const weeklyEnergy = profile.targetKgPerWeek * profile.kcalPerKg;
  const dailyEnergy = weeklyEnergy / 7;

  const windows = buildWindows(profile, plannedWorkouts);
  const { windows: allocated, weekly } = allocateWeeklyDeficits(profile, windows, plannedWorkouts);
  const weeklyPlan = weekly[0];

  return {
    targetKgPerWeek,
    weeklyEnergy,
    dailyEnergy,
    weeklyAllocated: weeklyPlan?.weeklyAllocated_kcal ?? 0,
    carryOver: weeklyPlan?.carryOver_kcal ?? 0,
    windows: allocated.map((window) => ({
      id: window.nextWorkoutId,
      type: window.nextWorkoutType,
      need_kcal: window.need_kcal,
      target_kcal: window.target_kcal,
      deficit_kcal: window.need_kcal - window.target_kcal,
      workoutCarb_kcal: window.workoutCarb_kcal,
      macros: window.macros,
      notes: window.notes,
    })),
  };
}

function formatSummary(summary: ReturnType<typeof summarize>) {
  console.log('---');
  console.log(`Target: ${summary.targetKgPerWeek.toFixed(3)} kg/week`);
  console.log(`  Weekly energy: ${summary.weeklyEnergy.toFixed(0)} kcal`);
  console.log(`  Daily energy:  ${(summary.dailyEnergy).toFixed(0)} kcal`);
  console.log(`  Weekly allocated: ${summary.weeklyAllocated.toFixed(0)} kcal`);
  if (summary.carryOver) {
    console.log(`  Carry-over (unallocated): ${summary.carryOver.toFixed(0)} kcal`);
  }
  summary.windows.forEach((window) => {
    console.log(`    Window ${window.id} (${window.type})`);
    console.log(`      Need: ${window.need_kcal.toFixed(0)} kcal`);
    console.log(`      Target: ${window.target_kcal.toFixed(0)} kcal`);
    console.log(`      Deficit: ${window.deficit_kcal.toFixed(0)} kcal`);
    console.log(`      Workout carbs: ${window.workoutCarb_kcal.toFixed(0)} kcal`);
    console.log(
      `      Base macros: protein ${window.macros.protein_g.toFixed(1)} g, fat ${window.macros.fat_g.toFixed(1)} g, carbs ${window.macros.carb_g.toFixed(1)} g`,
    );
    if (window.notes.length > 0) {
      console.log(`      Notes: ${window.notes.join(', ')}`);
    }
  });
}

function main() {
  const targets = process.argv.slice(2).map(Number).filter((value) => Number.isFinite(value));
  const list = targets.length > 0 ? targets : [-0.1, -0.2, -0.3, -0.35, -0.5, -0.7];

  list.forEach((value) => {
    const summary = summarize({ targetKgPerWeek: value });
    formatSummary(summary);
  });
}

main();
