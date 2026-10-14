import type { AthleteProfile, Intensity, KjSource, WorkoutStep } from './types';

export const KCAL_PER_KJ = 1 / 4.184;
export const KCAL_PER_KG_TISSUE = 7700;

/** Mifflin-St Jeor resting metabolic rate (kcal/day). */
export function mifflinBmr(p: Pick<AthleteProfile, 'sex' | 'weightKg' | 'heightCm' | 'ageYears'>): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears;
  return base + (p.sex === 'M' ? 5 : -161);
}

/** Katch-McArdle when body fat is known — more accurate for lean athletes. */
export function restingKcal(p: AthleteProfile): number {
  if (p.bodyFatPct && p.bodyFatPct > 3 && p.bodyFatPct < 50) {
    const ffm = p.weightKg * (1 - p.bodyFatPct / 100);
    return 370 + 21.6 * ffm;
  }
  return mifflinBmr(p);
}

export function fatFreeMassKg(p: AthleteProfile): number {
  const bf = p.bodyFatPct ?? (p.sex === 'M' ? 15 : 23);
  return p.weightKg * (1 - bf / 100);
}

/**
 * Gross metabolic cost of a ride. Mechanical work / gross efficiency, minus the
 * resting energy the athlete would have burned anyway over that time (that is
 * already counted in BMR x NEAT), so days don't double-count.
 */
export function netExerciseKcal(kj: number, durationMin: number, p: AthleteProfile): number {
  const gross = (kj * KCAL_PER_KJ) / p.efficiency;
  const resting = (restingKcal(p) * p.neatFactor * durationMin) / 1440;
  return Math.max(0, gross - resting);
}

export function grossExerciseKcal(kj: number, efficiency: number): number {
  return (kj * KCAL_PER_KJ) / efficiency;
}

/**
 * Fraction of energy from carbohydrate as a function of intensity factor.
 * Piecewise fit to the crossover concept (Brooks & Mercier) and lab data
 * for trained cyclists. An estimate — individual variation is large.
 */
export function carbFraction(ifactor: number): number {
  const pts: Array<[number, number]> = [
    [0.0, 0.35],
    [0.5, 0.45],
    [0.65, 0.6],
    [0.75, 0.7],
    [0.85, 0.8],
    [0.95, 0.9],
    [1.05, 0.95],
    [1.3, 0.97],
  ];
  if (ifactor <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x0, y0] = pts[i - 1];
    if (ifactor <= x1) return y0 + ((ifactor - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[pts.length - 1][1];
}

/** Grams of carbohydrate oxidised during a session. */
export function sessionCarbGrams(kj: number, ifactor: number, efficiency: number): number {
  return (grossExerciseKcal(kj, efficiency) * carbFraction(ifactor)) / 4;
}

export function intensityFromIf(ifactor: number): Intensity {
  if (ifactor >= 1.0) return 'VO2';
  if (ifactor >= 0.88) return 'Threshold';
  if (ifactor >= 0.76) return 'Tempo';
  if (ifactor >= 0.55) return 'Endurance';
  return 'Recovery';
}

export const TYPICAL_IF: Record<Intensity, number> = {
  Recovery: 0.5,
  Endurance: 0.68,
  Tempo: 0.8,
  Threshold: 0.88,
  VO2: 0.9,
  Race: 0.92,
};

export function isHard(i: Intensity): boolean {
  return i === 'Threshold' || i === 'VO2' || i === 'Race';
}

export function stepsKj(steps: WorkoutStep[], ftp: number): number {
  return steps.reduce((sum, s) => sum + ((s.lo + s.hi) / 2) * ftp * s.durationS, 0) / 1000;
}

export function stepsIf(steps: WorkoutStep[]): number {
  // Normalized-power style 4th-power mean over steps.
  const total = steps.reduce((t, s) => t + s.durationS, 0);
  if (total <= 0) return 0;
  const p4 = steps.reduce((acc, s) => acc + ((s.lo + s.hi) / 2) ** 4 * s.durationS, 0) / total;
  return p4 ** 0.25;
}

/**
 * Best estimate of mechanical work in kJ, in priority order. Average power is
 * a bit below NP for interval sessions, hence the 0.95 factor on IF paths.
 */
export function estimateKj(input: {
  plannedKj?: number;
  descriptionKj?: number;
  steps?: WorkoutStep[];
  ifactor?: number;
  load?: number;
  durationMin: number;
  ftp: number;
  intensity?: Intensity;
}): { kj: number; source: KjSource; ifactor: number } {
  const hours = input.durationMin / 60;
  const ifFromLoad =
    input.load && hours > 0 ? Math.sqrt(input.load / (hours * 100)) : undefined;
  const ifactor =
    input.ifactor ??
    (input.steps?.length ? stepsIf(input.steps) : undefined) ??
    ifFromLoad ??
    TYPICAL_IF[input.intensity ?? 'Endurance'];

  if (input.plannedKj && input.plannedKj > 0) return { kj: input.plannedKj, source: 'planned', ifactor };
  if (input.descriptionKj && input.descriptionKj > 0)
    return { kj: input.descriptionKj, source: 'description', ifactor };
  if (input.steps?.length && input.ftp > 0) return { kj: stepsKj(input.steps, input.ftp), source: 'steps', ifactor };
  const avgW = input.ftp * ifactor * 0.95;
  const kj = (avgW * input.durationMin * 60) / 1000;
  if (input.ifactor) return { kj, source: 'intensity', ifactor };
  if (ifFromLoad) return { kj, source: 'load', ifactor };
  return { kj, source: 'duration', ifactor };
}

export function loadFromIf(ifactor: number, durationMin: number): number {
  return (durationMin / 60) * ifactor * ifactor * 100;
}
