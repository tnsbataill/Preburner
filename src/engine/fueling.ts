import { isHard, sessionCarbGrams } from './energy';
import type { DayLoadClass, NutritionPrefs, Workout } from './types';

const round5 = (v: number) => Math.round(v / 5) * 5;

/**
 * In-session carbohydrate target (g/h). Duration sets the base (ACSM / IOC
 * consensus: <45 min none needed, 1–2.5 h 30–60 g/h, >2.5 h up to 90 g/h with
 * glucose+fructose), intensity scales it, the trained gut caps it.
 */
export function duringCarbPerHour(w: Workout, prefs: NutritionPrefs): number {
  if (w.carbsPerHourOverride && w.carbsPerHourOverride > 0) return w.carbsPerHourOverride;
  const h = w.durationMin / 60;
  const hard = isHard(w.intensity);
  let base: number;
  if (h < 0.75) base = hard ? 20 : 0;
  else if (h < 1.25) base = hard ? 40 : 25;
  else if (h < 2.5) base = 60;
  else base = 80;

  let scale = 1;
  if (w.ifactor < 0.6) scale = 0.6;
  else if (w.ifactor < 0.72) scale = 0.85;
  else if (w.ifactor >= 0.88) scale = 1.15;
  if (w.intensity === 'Race') scale = Math.max(scale, 1.25);

  return Math.min(prefs.maxCarbPerHour, round5(base * scale));
}

export function duringFluid(w: Workout, prefs: NutritionPrefs) {
  const indoorBump = w.indoor ? 1.25 : 1;
  const sweat = prefs.sweatRateLPerH * indoorBump;
  // Replace ~70% of sweat loss; more is rarely tolerated.
  const fluidMlPerHour = Math.round((Math.min(1.0, sweat * 0.7) * 1000) / 50) * 50;
  const sodiumMgPerHour = Math.round((sweat * prefs.sodiumMgPerL) / 50) * 50;
  return { fluidMlPerHour, sodiumMgPerHour };
}

export function splitSugars(carbG: number, carbPerHour: number, fructoseRatio: number) {
  // Below ~60 g/h a single transporter (glucose) is enough.
  if (carbPerHour <= 60) return { glucoseG: carbG, fructoseG: 0 };
  const glucoseG = carbG / (1 + fructoseRatio);
  return { glucoseG, fructoseG: carbG - glucoseG };
}

const CLASS_ORDER: DayLoadClass[] = ['rest', 'light', 'moderate', 'high', 'very-high'];

export function loadClassFor(workouts: Workout[]): DayLoadClass {
  const minutes = workouts.reduce((s, w) => s + w.durationMin, 0);
  const load = workouts.reduce((s, w) => s + w.load, 0);
  const hard = workouts.some((w) => isHard(w.intensity));
  if (minutes === 0) return 'rest';
  if (minutes >= 240 || load >= 250) return 'very-high';
  if (minutes >= 120 || load >= 130 || (hard && minutes >= 90)) return 'high';
  if (minutes >= 60 || hard || load >= 60) return 'moderate';
  return 'light';
}

export function maxClass(a: DayLoadClass, b: DayLoadClass): DayLoadClass {
  return CLASS_ORDER[Math.max(CLASS_ORDER.indexOf(a), CLASS_ORDER.indexOf(b))];
}

/** IOC/ACSM daily carbohydrate guideline bands, g/kg. */
export const CARB_BANDS: Record<DayLoadClass, [number, number]> = {
  rest: [3, 4],
  light: [3, 5],
  moderate: [5, 7],
  high: [6, 10],
  'very-high': [8, 12],
};

/**
 * Daily carbs: baseline + what the sessions actually burn + a top-up when
 * tomorrow is demanding ("fuel for the work required"). High-load days are
 * held to the guideline band floor; easy days can sit lower, which is where
 * a cut finds its room. Carb-loading days jump to 10 g/kg.
 */
export function dailyCarbGrams(opts: {
  workouts: Workout[];
  weightKg: number;
  efficiency: number;
  prefs: NutritionPrefs;
  loadClass: DayLoadClass;
  nextLoadClass: DayLoadClass;
  carbLoad?: boolean;
}): { grams: number; sessionCarbG: number; topUpG: number } {
  const { workouts, weightKg, prefs } = opts;
  const sessionCarbG = workouts.reduce((s, w) => s + sessionCarbGrams(w.kj, w.ifactor, opts.efficiency), 0);
  const nextIdx = CLASS_ORDER.indexOf(opts.nextLoadClass);
  const topUpPerKg = nextIdx >= 4 ? 1.5 : nextIdx >= 3 ? 1.0 : nextIdx >= 2 ? 0.5 : 0;
  const topUpG = topUpPerKg * weightKg;
  const raw = prefs.baseCarbGPerKg * weightKg + sessionCarbG + topUpG;
  const [lo, hi] = CARB_BANDS[opts.loadClass];
  const strictFloor = CLASS_ORDER.indexOf(opts.loadClass) >= 3;
  const floor = (strictFloor ? lo : Math.min(lo, prefs.baseCarbGPerKg)) * weightKg;
  const ceiling = (hi + topUpPerKg) * weightKg;
  let grams = Math.min(ceiling, Math.max(floor, raw));
  // 10 g/kg for a day fills muscle glycogen (Bussau et al. 2002).
  if (opts.carbLoad) grams = Math.max(grams, 10 * weightKg);
  // When carb-loading the extra is spread across every meal, not piled into dinner.
  return { grams, sessionCarbG, topUpG: opts.carbLoad ? 0 : topUpG };
}
