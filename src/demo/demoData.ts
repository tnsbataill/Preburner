import { addDays, weekStartOf } from '../engine/time';
import type { DateKey, Intensity, WeightEntry, WellnessDay, Workout } from '../engine/types';
import { makeWorkout } from '../engine/workout';
import { buildSession, expandBlocks } from '../training/library';
import type { SessionKind } from '../training/types';

// A realistic TrainerRoad-style block: date-only sessions (time unknown),
// a two-a-day, long weekend rides, and a B-race at the end of week 3.

type Spec = [dayOffset: number, title: string, minutes: number, intensity: Intensity, ifactor: number, startMin?: number, kind?: SessionKind];

// Indoor sessions carry structured steps (from the planner's own library) like
// TrainerRoad workouts synced through Intervals; outdoor rides have none.
const WEEK: Spec[] = [
  [0, 'Recovery spin', 45, 'Recovery', 0.5, undefined, 'recovery'],
  [1, 'Threshold intervals', 75, 'Threshold', 0.89, undefined, 'threshold'],
  [2, 'Endurance ride', 60, 'Endurance', 0.66, undefined, 'endurance'],
  [3, 'VO2max intervals', 75, 'VO2', 0.88, undefined, 'vo2'],
  [5, 'Sweet spot intervals', 90, 'Threshold', 0.86, 8 * 60, 'sweetspot'],
  [5, 'Easy spin — commute home', 40, 'Endurance', 0.6, 17 * 60 + 30],
  [6, 'Long endurance group ride', 210, 'Endurance', 0.7, 8 * 60],
];

const stepsFor = (kind: SessionKind, minutes: number) => expandBlocks(buildSession(kind, minutes, 3).blocks);

export function demoWorkouts(today: DateKey, ftp: number): Workout[] {
  const monday = weekStartOf(today);
  const out: Workout[] = [];
  for (let week = -1; week < 3; week += 1) {
    for (const [d, title, minutes, intensity, ifactor, startMin, kind] of WEEK) {
      const date = addDays(monday, week * 7 + d);
      // Week 3 Sunday: race instead of the long ride; Saturday becomes openers.
      if (week === 2 && d === 6) {
        out.push(makeWorkout({ id: `demo-${date}-race`, date, title: 'Gran Fondo (B race)', durationMin: 240, intensity: 'Race', ifactor: 0.78, startMin: 7 * 60 + 30, ftp, source: 'demo', category: 'RACE_B' }));
        continue;
      }
      if (week === 2 && d === 5) {
        if (startMin === 8 * 60) out.push({ ...makeWorkout({ id: `demo-${date}-openers`, date, title: 'Openers', durationMin: 50, intensity: 'Tempo', ifactor: 0.72, ftp, source: 'demo' }), steps: stepsFor('openers', 50) });
        continue;
      }
      const scale = week === 1 ? 1.1 : 1; // build week
      const w = makeWorkout({
        id: `demo-${date}-${d}-${minutes}`,
        date,
        title,
        durationMin: Math.round(minutes * scale),
        intensity,
        ifactor,
        startMin: startMin ?? null,
        ftp,
        source: 'demo',
        indoor: startMin === undefined,
      });
      out.push(kind ? { ...w, steps: stepsFor(kind, w.durationMin) } : w);
    }
  }
  return out.map((w) => (w.date < today ? { ...w, completed: true } : w));
}

export function demoWeights(today: DateKey, startKg: number): WeightEntry[] {
  const out: WeightEntry[] = [];
  for (let i = 42; i >= 0; i -= 1) {
    const noise = Math.sin(i * 1.7) * 0.35 + Math.cos(i * 0.9) * 0.2;
    out.push({ date: addDays(today, -i), kg: Math.round((startKg + i * 0.045 + noise) * 10) / 10, source: 'manual' });
  }
  return out;
}

export function demoWellness(today: DateKey): WellnessDay[] {
  const out: WellnessDay[] = [];
  let ctl = 58;
  let atl = 55;
  for (let i = 60; i >= 1; i -= 1) {
    const load = [40, 85, 55, 90, 0, 95, 160][(i + 3) % 7];
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    out.push({ date: addDays(today, -i), ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, restingHR: 48 + (i % 4), hrv: 62 + ((i * 7) % 11) });
  }
  return out;
}
