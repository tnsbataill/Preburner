import { describe, expect, it } from 'vitest';
import { demoWorkouts } from '../../demo/demoData';
import { DEFAULT_SETTINGS } from '../defaults';
import { buildPlan } from '../plan';
import { addDays } from '../time';

// Properties every generated plan must satisfy, checked over a realistic
// 4-week block in maintenance, cut and gain modes.
const today = '2026-03-02';
const settings = structuredClone(DEFAULT_SETTINGS);
const workouts = demoWorkouts(today, settings.profile.ftp);

for (const rate of [0, -0.6, 0.25]) {
  describe(`plan invariants @ ${rate} kg/wk`, () => {
    const s = { ...settings, goals: { ...settings.goals, weeklyRateKg: rate } };
    const plan = buildPlan({ settings: s, workouts, start: addDays(today, -7), days: 28, today });

    it('never schedules a main meal in the 90 min before or during a session', () => {
      for (const d of plan.days) {
        for (const w of d.workouts) {
          const S = w.resolvedStartMin;
          const E = S + w.durationMin;
          const clash = d.slots.filter(
            (sl) => ['breakfast', 'lunch', 'dinner', 'recovery'].includes(sl.kind) && sl.startMin > S - 90 && sl.startMin < E,
          );
          expect(clash, `${d.date} ${w.title}`).toEqual([]);
        }
      }
    });

    it('gives every session over 75 min a fuelling slot with carbs', () => {
      for (const d of plan.days) {
        for (const w of d.workouts.filter((x) => x.durationMin > 75)) {
          const during = d.slots.find((sl) => sl.kind === 'during' && sl.workoutId === w.id);
          expect(during?.macros.carbG ?? 0, `${d.date} ${w.title}`).toBeGreaterThan(0);
          expect(during!.fueling!.carbPerHour).toBeLessThanOrEqual(s.nutrition.maxCarbPerHour);
        }
      }
    });

    it('puts no deficit on protected days and respects the daily cap', () => {
      for (const d of plan.days) {
        if (d.protectedDay) expect(d.energy.deficit, d.date).toBeLessThanOrEqual(15);
        expect(d.energy.deficit, d.date).toBeLessThanOrEqual(s.goals.maxDailyDeficit + 15);
      }
    });

    it('slot macros add up to the day', () => {
      for (const d of plan.days) {
        const sum = d.slots.reduce((a, sl) => a + sl.kcal, 0);
        expect(Math.abs(sum - d.energy.target), d.date).toBeLessThan(40);
      }
    });

    it('keeps protein and fat floors', () => {
      for (const d of plan.days) {
        expect(d.macros.proteinG).toBeGreaterThanOrEqual(s.nutrition.proteinGPerKg * s.profile.weightKg - 3);
        expect(d.macros.fatG).toBeGreaterThanOrEqual(s.nutrition.fatMinGPerKg * s.profile.weightKg - 3);
      }
    });

    it('slots are chronological and within the waking day (race mornings excepted)', () => {
      for (const d of plan.days) {
        const times = d.slots.map((sl) => sl.startMin);
        expect(times).toEqual([...times].sort((a, b) => a - b));
        const race = d.workouts.some((w) => w.intensity === 'Race');
        if (!race) expect(Math.min(...times), d.date).toBeGreaterThanOrEqual(s.schedule.wakeMin);
        expect(Math.max(...times), d.date).toBeLessThan(s.schedule.sleepMin);
      }
    });

    it('glycogen stays within physical bounds', () => {
      for (const p of plan.glycogen) {
        expect(p.pct).toBeGreaterThanOrEqual(0);
        expect(p.pct).toBeLessThanOrEqual(1.0001);
      }
    });
  });
}

describe('weekly deficit', () => {
  it('places most of a moderate cut across a normal week', () => {
    const s = { ...settings, goals: { ...settings.goals, weeklyRateKg: -0.4 } };
    const plan = buildPlan({ settings: s, workouts, start: '2026-03-02', days: 7, today });
    const wk = plan.weeks[0];
    expect(wk.placedDeficit).toBeGreaterThan(wk.targetDeficit * 0.5);
  });
});
