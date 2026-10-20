import { KCAL_PER_KJ, TYPICAL_IF, estimateKj, intensityFromIf, loadFromIf } from './energy';
import type { DateKey, Intensity, Workout } from './types';

let seq = 0;

/** Build a workout from the essentials, deriving kJ and load. */
export function makeWorkout(opts: {
  id?: string;
  date: DateKey;
  title: string;
  durationMin: number;
  intensity: Intensity;
  ftp: number;
  ifactor?: number;
  startMin?: number | null;
  source?: Workout['source'];
  category?: string;
  indoor?: boolean;
  description?: string;
}): Workout {
  const ifactor = opts.ifactor ?? TYPICAL_IF[opts.intensity];
  const { kj, source } = estimateKj({ ifactor, durationMin: opts.durationMin, ftp: opts.ftp, intensity: opts.intensity });
  seq += 1;
  return {
    id: opts.id ?? `${opts.source ?? 'manual'}-${opts.date}-${seq}`,
    source: opts.source ?? 'manual',
    date: opts.date,
    startMin: opts.startMin ?? null,
    durationMin: opts.durationMin,
    title: opts.title,
    sport: 'Ride',
    intensity: opts.intensity,
    ifactor,
    load: Math.round(loadFromIf(ifactor, opts.durationMin)),
    kj: Math.round(kj),
    kjSource: source,
    category: opts.category ?? 'WORKOUT',
    indoor: opts.indoor,
    description: opts.description,
  };
}

/**
 * A session planned by its calorie burn: the kcal a head unit reports for the
 * ride (mechanical work / gross efficiency). The work and duration give the
 * average power, which sets the intensity and load.
 */
export function workoutForKcal(opts: {
  id: string;
  date: DateKey;
  title?: string;
  kcal: number;
  durationMin: number;
  ftp: number;
  efficiency: number;
  startMin?: number | null;
  indoor?: boolean;
}): Workout {
  const kj = (opts.kcal * opts.efficiency) / KCAL_PER_KJ;
  // Average power runs a little under NP (the 0.95 in estimateKj).
  const avgW = (kj * 1000) / (opts.durationMin * 60);
  const ifactor = Math.round(Math.min(1.2, Math.max(0.35, avgW / (0.95 * opts.ftp))) * 100) / 100;
  const intensity = intensityFromIf(ifactor);
  return {
    ...makeWorkout({ id: opts.id, date: opts.date, title: opts.title?.trim() || `${intensity} ride`, durationMin: opts.durationMin, intensity, ifactor, ftp: opts.ftp, startMin: opts.startMin, indoor: opts.indoor }),
    kj: Math.round(kj),
    kjSource: 'planned',
  };
}
