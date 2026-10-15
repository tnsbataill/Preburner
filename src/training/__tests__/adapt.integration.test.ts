import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { addDays } from '../../engine/time';
import { INITIAL_TRAINING, type TrainingState, applyFeedback, mergePlanIntoCalendar, runAdaptation } from '../../state/training';
import { makeWorkout } from '../../engine/workout';
import { adaptDay, readiness } from '../adapt';
import { generatePlan } from '../generator';
import type { RideRecord, WellnessRecord } from '../history/types';
import type { PlannedSession, TrainingPlan } from '../types';

// The adaptation layer driven through the same state functions the app uses:
// plan + rides + wellness in, adjusted plan out.

const START = '2026-10-19';
const plan: TrainingPlan = generatePlan({ start: START, weeks: 8, objective: 'ftp', ftp: 260, ctl: 55, atl: 55, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6 });
const firstHard = plan.sessions.find((s) => s.hard && s.date > addDays(START, 7))!;

/** 60 days of steady wellness, then `tail` days with an offset. */
function wellness(today: string, tailDays: number, hrvDrop: number, rhrRise: number): WellnessRecord[] {
  return Array.from({ length: 60 }, (_, i) => {
    const date = addDays(today, i - 59);
    const tail = i >= 60 - tailDays;
    return { date, lnRmssd: 4.1 + (i % 3) * 0.04 - (tail ? hrvDrop : 0), rhr: 50 + (i % 2) - 0 + (tail ? rhrRise : 0) };
  });
}

function ride(date: string, s: PlannedSession, extra: Partial<RideRecord> = {}): RideRecord {
  return { id: `r-${date}`, date, durationMin: s.durationMin, tss: s.tss, domain: s.domain, ftpSet: 260, kind: s.kind, level: s.level, source: 'intervals', ...extra };
}

describe('readiness', () => {
  it('is green inside the normal range and red when HRV drops with RHR up', () => {
    const today = firstHard.date;
    expect(readiness(wellness(today, 0, 0, 0), today, -5).level).toBe('green');
    const r = readiness(wellness(today, 5, 0.5, 6), today, -5);
    expect(r.level).toBe('red');
    expect(r.reasons.join(' ')).toMatch(/HRV/);
  });

  it('feeling poor two rides running only eases the day (amber), never red', () => {
    const today = firstHard.date;
    const rides = [ride(addDays(today, -2), firstHard, { feel: 5 }), ride(addDays(today, -1), firstHard, { feel: 4, id: 'b' })];
    expect(readiness(wellness(today, 0, 0, 0), today, -5, undefined, rides).level).toBe('amber');
  });
});

describe('daily adaptation', () => {
  it('swaps a hard session for an easy spin on a red day and fits the work back in', () => {
    const today = firstHard.date;
    const out = adaptDay({ plan, today, rides: [], wellness: wellness(today, 5, 0.5, 6), ftpSet: 260, tsb: -10 });
    const swapped = out.plan.sessions.find((s) => s.id === firstHard.id)!;
    expect(swapped.kind).toBe('recovery');
    expect(out.adjustments.map((a) => a.action)).toContain('downgrade');
    // Moved work never lands next to another hard day.
    const hardDates = out.plan.sessions.filter((s) => s.hard).map((s) => s.date);
    for (const d of hardDates) expect(hardDates).not.toContain(addDays(d, 1));
  });

  it('raises FTP after a test that beats the set FTP', () => {
    const today = firstHard.date;
    const test = { id: 't', date: addDays(today, -1), durationMin: 60, tss: 70, domain: { low: 20, mid: 40, high: 10 }, ftpSet: 260, best20: 290, isTest: true, source: 'intervals' as const };
    const out = adaptDay({ plan, today, rides: [test], wellness: [], ftpSet: 260, tsb: 0 });
    expect(out.ftpSet).toBe(Math.round(0.95 * 290));
  });
});

describe('how did it feel -> progression', () => {
  const sameKind = plan.sessions.filter((s) => s.kind === firstHard.kind && s.date > firstHard.date);
  const today = addDays(firstHard.date, 1);
  const state = (fb: Record<string, { rpe?: number; feel?: number }>, extra: Partial<RideRecord> = {}): TrainingState => ({
    ...INITIAL_TRAINING,
    plan,
    intervalsRides: [ride(firstHard.date, firstHard, { id: 'act-1', rpe: undefined, ...extra })],
    feedback: fb,
  });

  it('a session that felt easy moves the progression up a level', () => {
    const patch = applyFeedback(state({ 'act-1': { rpe: 3 } }), 'act-1', today)!;
    const next = patch.plan!.sessions.find((s) => s.id === sameKind[0].id)!;
    expect(next.level).toBe(Math.min(sameKind[0].level + 1, sameKind[0].level + 2));
    expect(patch.adjustments![0].action).toBe('progress');
  });

  it('much harder than usual steps back; as expected changes nothing', () => {
    const hard = applyFeedback(state({ 'act-1': { rpe: 10 } }), 'act-1', today)!;
    expect(hard.plan!.sessions.find((s) => s.id === sameKind[0].id)!.level).toBeLessThan(sameKind[0].level);
    const fine = applyFeedback(state({ 'act-1': { rpe: Math.round(6.2) } }), 'act-1', today);
    expect(fine?.adjustments?.length ?? 0).toBe(0);
  });

  it('applies each ride once, and stays within ±2 levels of the plan', () => {
    let t = state({ 'act-1': { rpe: 2 } });
    const p1 = applyFeedback(t, 'act-1', today)!;
    t = { ...t, ...p1 };
    expect(applyFeedback(t, 'act-1', today)).toBeUndefined();
    // Even repeated "easy" reports on new rides can't push past +2.
    for (let i = 2; i < 7; i += 1) {
      t = { ...t, intervalsRides: [...t.intervalsRides, ride(addDays(firstHard.date, 0), firstHard, { id: `act-${i}`, rpe: 2, startMin: i * 60 })], feedback: { ...t.feedback, [`act-${i}`]: { rpe: 2 } } };
      t = { ...t, ...(applyFeedback(t, `act-${i}`, today) ?? {}) };
    }
    for (const s of t.plan!.sessions.filter((x) => x.kind === firstHard.kind && x.date >= today)) expect(s.level).toBeLessThanOrEqual((s.plannedLevel ?? s.level) + 2);
  });

  it('daily adaptation runs once per day and logs readiness', () => {
    const t = state({});
    const p = runAdaptation(t, firstHard.date, 260)!;
    expect(p.lastAdapt).toBe(firstHard.date);
    expect(p.readiness).toBeDefined();
    expect(runAdaptation({ ...t, ...p }, firstHard.date, 260)).toBeUndefined();
  });
});

describe('calendar merge', () => {
  it('plan sessions replace other planned sessions in the window; completed rides stay', () => {
    const today = START;
    const tr = makeWorkout({ id: 'icu-1', date: addDays(START, 2), title: 'TR Lamarck', durationMin: 75, intensity: 'Threshold', ftp: 260, source: 'intervals' });
    const done = { ...makeWorkout({ id: 'act-9', date: addDays(START, -1), title: 'Ride', durationMin: 60, intensity: 'Endurance', ftp: 260 }), completed: true };
    const merged = mergePlanIntoCalendar([tr, done], { ...INITIAL_TRAINING, plan }, today, 'demo', 260);
    expect(merged.find((w) => w.id === 'icu-1')).toBeUndefined();
    expect(merged.find((w) => w.id === 'act-9')).toBeDefined();
    expect(merged.filter((w) => w.source === 'preburner')).toHaveLength(plan.sessions.length);
    // With the TrainerRoad toggle off, both stay.
    expect(mergePlanIntoCalendar([tr], { ...INITIAL_TRAINING, plan, replaceExternal: false }, today, 'demo', 260).find((w) => w.id === 'icu-1')).toBeDefined();
  });
});

describe('intensity personalisation', () => {
  it('repeated failures at a kind lower its targets (bounded), easy reports give some back', async () => {
    const { applyRpe } = await import('../adapt');
    const vo2 = plan.sessions.filter((s) => s.kind === 'vo2');
    expect(vo2.length).toBeGreaterThan(2);
    const first = vo2[0];
    const failed = (id: string, date: string): RideRecord => ride(date, first, { id, failed: true, rpe: 9, level: 1 });
    const r1 = failed('a', first.date);
    let res = applyRpe(plan.sessions, [r1], r1, addDays(first.date, 1));
    expect(res.scales.vo2).toBe(0.97);
    const next = res.sessions.find((s) => s.id === vo2[1].id)!;
    const peak = (s: PlannedSession) => Math.max(...s.steps.map((x) => x.hi));
    expect(peak(next)).toBeLessThan(peak(vo2[1]));
    // Keep failing: never below 88%.
    let rides = [r1];
    for (let i = 0; i < 8; i += 1) {
      const r = failed(`f${i}`, addDays(first.date, i + 2));
      rides = [...rides, r];
      res = applyRpe(res.sessions, rides, r, addDays(first.date, i + 3), undefined, false, res.scales);
    }
    expect(res.scales.vo2).toBe(0.88);
    const easy = ride(addDays(first.date, 12), first, { id: 'e', rpe: 2, level: 1 });
    res = applyRpe(res.sessions, [...rides, easy], easy, addDays(first.date, 13), undefined, false, res.scales);
    expect(res.scales.vo2).toBe(0.9);
  });
});

describe('races', () => {
  it('stay on the calendar inside the plan window, and the plan works around them', () => {
    const raceDate = addDays(START, 20);
    const race = { ...makeWorkout({ id: 'icu-77', date: raceDate, title: 'Gran Fondo', durationMin: 240, intensity: 'Race', ftp: 260, source: 'intervals' }), category: 'RACE_B' };
    const p2 = generatePlan({ start: START, weeks: 8, objective: 'ftp', ftp: 260, ctl: 55, atl: 55, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6, blockedDates: [raceDate] });
    expect(p2.sessions.find((s) => s.date === raceDate)).toBeUndefined();
    const dayBefore = p2.sessions.find((s) => s.date === addDays(raceDate, -1));
    expect(dayBefore?.hard ?? false).toBe(false);
    const merged = mergePlanIntoCalendar([race], { ...INITIAL_TRAINING, plan: p2 }, START, 'demo', 260);
    expect(merged.find((w) => w.id === 'icu-77')).toBeDefined();
  });
});
