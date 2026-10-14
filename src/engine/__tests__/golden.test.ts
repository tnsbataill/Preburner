import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../defaults';
import { buildPlan } from '../plan';
import type { Settings, Workout } from '../types';
import { makeWorkout } from '../workout';
import { renderDay } from './render';

const settings: Settings = structuredClone(DEFAULT_SETTINGS);
const FTP = settings.profile.ftp;

function plan(workouts: Workout[], start = '2026-03-02', days = 2, s: Settings = settings) {
  return buildPlan({ settings: s, workouts, start, days, today: start });
}

const cut: Settings = { ...settings, goals: { ...settings.goals, weeklyRateKg: -0.5 } };

const scenarios: Record<string, () => string> = {
  'early fasted ride': () =>
    renderDay(
      plan([makeWorkout({ id: 'a', date: '2026-03-02', title: 'Early endurance', durationMin: 75, intensity: 'Endurance', startMin: 6 * 60 + 45, ftp: FTP })]).days[0],
    ),
  'two-a-day': () =>
    renderDay(
      plan([
        makeWorkout({ id: 'am', date: '2026-03-02', title: 'AM threshold', durationMin: 75, intensity: 'Threshold', ifactor: 0.89, startMin: 7 * 60 + 30, ftp: FTP }),
        makeWorkout({ id: 'pm', date: '2026-03-02', title: 'PM endurance', durationMin: 60, intensity: 'Endurance', startMin: 17 * 60 + 30, ftp: FTP }),
      ]).days[0],
    ),
  'rest day before hard day (cutting)': () => {
    const p = plan([makeWorkout({ id: 'h', date: '2026-03-03', title: 'VO2', durationMin: 75, intensity: 'VO2', startMin: 17 * 60 + 30, ftp: FTP })], '2026-03-02', 2, cut);
    return p.days.map(renderDay).join('\n\n');
  },
  'race day with carb-load eve': () => {
    const p = plan(
      [makeWorkout({ id: 'r', date: '2026-03-08', title: 'Gran Fondo', durationMin: 270, intensity: 'Race', ifactor: 0.78, startMin: 7 * 60, ftp: FTP, category: 'RACE_A' })],
      '2026-03-07',
      2,
      cut,
    );
    return p.days.map(renderDay).join('\n\n');
  },
  'no start time (TrainerRoad date-only)': () =>
    renderDay(plan([makeWorkout({ id: 'u', date: '2026-03-03', title: 'Sweet spot', durationMin: 90, intensity: 'Threshold', ifactor: 0.86, ftp: FTP })], '2026-03-03', 1).days[0]),
  'day crossing DST (US spring forward)': () =>
    renderDay(plan([makeWorkout({ id: 'd', date: '2026-03-08', title: 'Long ride', durationMin: 180, intensity: 'Endurance', startMin: 8 * 60, ftp: FTP })], '2026-03-08', 1).days[0]),
  'lunch ride': () =>
    renderDay(plan([makeWorkout({ id: 'l', date: '2026-03-04', title: 'Lunch tempo', durationMin: 60, intensity: 'Tempo', startMin: 12 * 60, ftp: FTP })], '2026-03-04', 1).days[0]),
};

describe('golden day plans', () => {
  for (const [name, run] of Object.entries(scenarios)) {
    it(name, async () => {
      await expect(run()).toMatchFileSnapshot(`./golden/${name.replace(/[^a-z0-9]+/gi, '-')}.txt`);
    });
  }
});
