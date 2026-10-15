import { describe, expect, it } from 'vitest';
import { demoWellness, demoWeights, demoWorkouts } from '../../demo/demoData';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { addDays } from '../../engine/time';
import { COACH_TOOLS, applyChanges, runTool } from '../tools';

const today = '2026-10-14';
const settings = { ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals, eventName: 'Fondo', eventDate: addDays(today, 30), targetCtl: 75, targetTsb: 10 } };
const world = { settings, workouts: demoWorkouts(today, 260), wellness: demoWellness(today), weights: demoWeights(today, 75), today };

describe('coach tools', () => {
  it('every tool schema is a closed object schema', () => {
    for (const t of COACH_TOOLS) {
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });

  it('context reflects goals and fitness', () => {
    const ctx = runTool(world, 'get_athlete_context', {}) as any;
    expect(ctx.goals.event).toMatchObject({ name: 'Fondo', targetCtl: 75 });
    expect(ctx.fitnessToday.ctl).toBeGreaterThan(0);
  });

  it('simulate shows added load raising projected event CTL', () => {
    const changes = [1, 2, 3].map((w) => ({
      action: 'add' as const,
      date: addDays(today, w * 7 - 1),
      reason: 'extra long ride',
      session: { title: 'Long Z2', durationMin: 240, intensity: 'Endurance' as const, ifactor: 0.68 },
    }));
    const sim = runTool(world, 'simulate_changes', { changes }) as any;
    expect(sim.errors).toEqual([]);
    expect(sim.withChanges.event.ctl).toBeGreaterThan(sim.baseline.event.ctl);
  });

  it('refuses to touch completed sessions or unknown ids', () => {
    const done = world.workouts.find((w) => w.completed)!;
    const { errors } = applyChanges(
      world.workouts,
      [
        { action: 'remove', date: done.date, targetWorkoutId: done.id, reason: 'x' },
        { action: 'move', date: today, targetWorkoutId: 'nope', newDate: today, reason: 'x' },
      ],
      260,
    );
    expect(errors).toHaveLength(2);
  });
});

describe('coach training-plan tool', () => {
  it('reports the plan, readiness and next sessions, or says there is none', async () => {
    const { generatePlan } = await import('../../training/generator');
    const { INITIAL_TRAINING } = await import('../../state/training');
    expect((runTool(world, 'get_training_plan', {}) as any).plan).toBeNull();
    const plan = generatePlan({ start: today, weeks: 6, objective: 'ftp', ftp: 260, ctl: 55, atl: 55, availabilityHours: settings.goals.availabilityHours, maxRampPerWeek: 6 });
    const out = runTool({ ...world, training: { ...INITIAL_TRAINING, plan } }, 'get_training_plan', {}) as any;
    expect(out.goal).toBe('ftp');
    expect(out.weeks).toHaveLength(6);
    expect(out.next7Days.length).toBeGreaterThan(3);
  });
});
