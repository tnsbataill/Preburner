import { TYPICAL_IF, estimateKj, loadFromIf } from './energy';
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
