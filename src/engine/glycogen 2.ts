import { carbFraction, grossExerciseKcal } from './energy';
import type { DayPlan, GlycogenPoint } from './types';

// A deliberately simple two-pool model used for visualisation and as a
// readiness signal — prescriptions come from guideline bands, not from this.

const STEP = 15; // minutes
const BRAIN_G_PER_H = 5;
const NEAT_MUSCLE_G_PER_H = 1;
const MAX_EXOGENOUS_G_PER_MIN = 1.5; // glucose + fructose multi-transporter ceiling

export function simulateGlycogen(days: DayPlan[], opts: { weightKg: number; efficiency: number; startPct?: number }): GlycogenPoint[] {
  const capMuscle = 6 * opts.weightKg;
  const capLiver = 100;
  let muscle = capMuscle * (opts.startPct ?? 0.8);
  let liver = capLiver * (opts.startPct ?? 0.8);
  const points: GlycogenPoint[] = [];
  let minutesSinceExercise = Infinity;

  for (const day of days) {
    // Carb absorption timeline for the day (g per step index).
    const steps = 1440 / STEP;
    const absorb = new Array<number>(steps).fill(0);
    const burn = new Array<number>(steps).fill(0);

    for (const s of day.slots) {
      if (s.kind === 'during') continue;
      // Liquid / simple snacks absorb faster than mixed meals.
      const spread = s.kind === 'pre-snack' ? 45 : s.kind === 'recovery' ? 90 : 150;
      const n = Math.max(1, Math.round(spread / STEP));
      const start = Math.floor(s.startMin / STEP);
      for (let i = 0; i < n; i += 1) {
        const idx = start + i;
        if (idx < steps) absorb[idx] += s.macros.carbG / n;
      }
    }

    for (const w of day.workouts) {
      const n = Math.max(1, Math.round(w.durationMin / STEP));
      const start = Math.floor(w.resolvedStartMin / STEP);
      const totalCho = (grossExerciseKcal(w.kj, opts.efficiency) * carbFraction(w.ifactor)) / 4;
      const slot = day.slots.find((s) => s.kind === 'during' && s.workoutId === w.id);
      const intake = slot?.macros.carbG ?? 0;
      for (let i = 0; i < n; i += 1) {
        const idx = start + i;
        if (idx >= steps) break;
        burn[idx] += totalCho / n;
        absorb[idx] += Math.min(intake / n, MAX_EXOGENOUS_G_PER_MIN * STEP);
      }
    }

    for (let i = 0; i < steps; i += 1) {
      const min = i * STEP;
      const exercising = burn[i] > 0;
      let available = absorb[i];

      // Brain/obligate needs come from incoming carbs first, then the liver.
      const brain = (BRAIN_G_PER_H * STEP) / 60;
      const fromIntakeBrain = Math.min(available, brain);
      available -= fromIntakeBrain;
      liver -= brain - fromIntakeBrain;

      if (exercising) {
        minutesSinceExercise = 0;
        // Exogenous carbs spare endogenous stores during exercise.
        const exo = Math.min(available, burn[i]);
        available -= exo;
        const endo = burn[i] - exo;
        muscle -= endo * 0.8;
        liver -= endo * 0.2;
      } else {
        minutesSinceExercise += STEP;
        muscle -= (NEAT_MUSCLE_G_PER_H * STEP) / 60;
      }

      // Refill: liver first, then muscle at a rate that is faster soon after exercise.
      const toLiver = Math.min(available, capLiver - liver);
      liver += toLiver;
      available -= toLiver;
      const synthPerKgH = minutesSinceExercise < 240 ? 1.2 : 0.6;
      const maxMuscle = (synthPerKgH * opts.weightKg * STEP) / 60;
      const toMuscle = Math.min(available, maxMuscle, capMuscle - muscle);
      muscle += toMuscle;

      muscle = Math.max(0, muscle);
      liver = Math.max(0, liver);

      if (min % 30 === 0) {
        points.push({
          date: day.date,
          min,
          muscle: Math.round(muscle),
          liver: Math.round(liver),
          pct: (muscle + liver) / (capMuscle + capLiver),
        });
      }
    }
  }
  return points;
}

/** Lowest tank level during a given day, plus the level at each session start. */
export function readiness(points: GlycogenPoint[], day: DayPlan) {
  const today = points.filter((p) => p.date === day.date);
  const low = today.reduce((m, p) => Math.min(m, p.pct), 1);
  const atStart = day.workouts.map((w) => {
    const p = [...today].reverse().find((x) => x.min <= w.resolvedStartMin) ?? today[0];
    return { workoutId: w.id, pct: p?.pct ?? 0 };
  });
  return { low, atStart };
}
