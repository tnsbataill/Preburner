import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { addDays } from '../../engine/time';
import { INITIAL_TRAINING, type TrainingState, recentNoDataRides, answerMissed, answerRideIssue, applyFeedback, debriefQueue, historyRides, runAdaptation } from '../../state/training';
import { isQuality, personalRpe } from '../adapt';
import { perfObservations } from '../fit';
import { activityToRide } from '../history/intervals';
import { targetDate } from '../optimize';
import { generatePlan } from '../generator';
import type { RideRecord, WellnessRecord } from '../history/types';
import type { PlannedSession, TrainingPlan } from '../types';

// "What happened?" answers driven through the same state functions the app
// uses: a plan, the rides that were (or weren't) done, the answer, and what
// the plan looks like afterwards.

const START = '2026-10-19';
const plan: TrainingPlan = generatePlan({ start: START, weeks: 10, objective: 'ftp', ftp: 260, ctl: 55, atl: 55, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6 });
// A quality session in the build, with an easy day in the next three to catch it up on.
const missed = plan.sessions.find(
  (s) => isQuality(s) && s.date > addDays(START, 21) && [1, 2, 3].some((o) => plan.sessions.some((x) => x.date === addDays(s.date, o) && !x.hard)),
)!;
const today = addDays(missed.date, 1);

function rideFor(s: PlannedSession, extra: Partial<RideRecord> = {}): RideRecord {
  return { id: `act-${s.date}`, date: s.date, durationMin: s.durationMin, tss: s.tss, domain: s.domain, ftpSet: 260, source: 'intervals', ...extra };
}

/** Every planned session up to `today` ridden as planned, except `skip`. */
function state(opts: { skip?: PlannedSession; rides?: RideRecord[]; applied?: boolean } = {}): TrainingState {
  const done = plan.sessions.filter((s) => s.date < today && s.id !== opts.skip?.id && !opts.rides?.some((r) => r.date === s.date)).map((s) => rideFor(s));
  return { ...INITIAL_TRAINING, plan, ftp: 260, intervalsRides: [...done, ...(opts.rides ?? [])], appliedAt: opts.applied ? '2026-10-18T00:00:00Z' : undefined };
}

const apply = (t: TrainingState, patch: Partial<TrainingState> | undefined): TrainingState => ({ ...t, ...patch });
const byId = (t: TrainingState, id: string) => t.plan!.sessions.find((s) => s.id === id)!;

describe('missed sessions', () => {
  it('asks about a skipped quality session, not about days that went to plan', () => {
    const q = debriefQueue(state({ skip: missed }), today);
    expect(q).toEqual([{ type: 'missed', session: missed }]);
    expect(debriefQueue(state(), today)).toEqual([]);
  });

  it('no time: the work is caught up once, whether the daily check or the answer comes first', () => {
    // Daily check first (assumes life got in the way), then the answer.
    let t = apply(state({ skip: missed }), runAdaptation(state({ skip: missed }), today, 260));
    const move = t.adjustments.find((a) => a.action === 'move' && a.movedFrom === missed.id)!;
    expect(move).toBeDefined();
    expect(byId(t, move.sessionId!).kind).toBe(missed.kind);
    const before = t.plan!.sessions;
    t = apply(t, answerMissed(t, missed.id, 'time', today));
    expect(t.plan!.sessions).toEqual(before);
    expect(debriefQueue(t, today)).toEqual([]);

    // Answer first, then the daily check: still exactly one catch-up.
    let u = state({ skip: missed });
    u = apply(u, answerMissed(u, missed.id, 'travel', today));
    u = apply(u, runAdaptation(u, today, 260));
    expect(u.adjustments.filter((a) => a.action === 'move' && a.movedFrom === missed.id)).toHaveLength(1);
  });

  it('too tired: the catch-up is undone exactly and the next hard day is eased; changes are marked for Intervals', () => {
    let t = apply(state({ skip: missed, applied: true }), runAdaptation(state({ skip: missed, applied: true }), today, 260));
    const move = t.adjustments.find((a) => a.action === 'move' && a.movedFrom === missed.id)!;
    const original = plan.sessions.find((s) => s.id === move.sessionId)!;
    const nextHard = t.plan!.sessions.filter((s) => isQuality(s) && s.date >= today && s.date < addDays(today, 4) && s.id !== move.sessionId && s.level > 1)[0];
    t = apply(t, answerMissed(t, missed.id, 'tired', today));
    expect(byId(t, original.id)).toEqual(original);
    expect(nextHard).toBeDefined();
    expect(byId(t, nextHard.id).level).toBe(nextHard.level - 1);
    expect(t.dirtyIds).toContain(nextHard.id);
    expect(t.dirtyIds).toContain(original.id);
    expect(t.adjustments[0].reason).toMatch(/run down|Not catching up/);
  });

  it('sick: no catch-up, easy spins for three days, then the first hard day back is eased', () => {
    let t = state({ skip: missed });
    t = apply(t, answerMissed(t, missed.id, 'sick', today));
    t = apply(t, runAdaptation(t, today, 260));
    expect(t.adjustments.some((a) => a.action === 'move' && a.movedFrom === missed.id)).toBe(false);
    const window = t.plan!.sessions.filter((s) => s.date >= today && s.date < addDays(today, 3));
    expect(window.some((s) => isQuality(s))).toBe(false);
    const swapped = plan.sessions.filter((s) => isQuality(s) && s.date >= today && s.date < addDays(today, 3));
    expect(swapped.length).toBeGreaterThan(0);
    for (const s of swapped) expect(byId(t, s.id).kind).toBe('recovery');
    const back = plan.sessions.filter((s) => isQuality(s) && s.date >= addDays(today, 3) && s.date < addDays(today, 10) && s.level > 1)[0];
    expect(byId(t, back.id).level).toBe(back.level - 1);
  });

  it('injured: no hard sessions for a week', () => {
    let t = state({ skip: missed });
    t = apply(t, answerMissed(t, missed.id, 'injured', today));
    expect(t.plan!.sessions.filter((s) => s.date >= today && s.date < addDays(today, 7) && isQuality(s))).toEqual([]);
  });

  it('a changed answer is recorded but not applied twice', () => {
    let t = state({ skip: missed });
    t = apply(t, answerMissed(t, missed.id, 'tired', today));
    const after = t.plan!.sessions;
    t = apply(t, answerMissed(t, missed.id, 'sick', today));
    expect(t.plan!.sessions).toBe(after);
    expect(t.missedReasons[missed.id]).toBe('sick');
  });
});

describe('FTP tests', () => {
  it('a test skipped for lack of time is moved, not dropped', () => {
    const test = plan.sessions.find((s) => s.kind === 'ftptest')!;
    const day = addDays(test.date, 1);
    const rides = plan.sessions.filter((s) => s.date < day && s.id !== test.id).map((s) => rideFor(s));
    let t: TrainingState = { ...INITIAL_TRAINING, plan, ftp: 260, intervalsRides: rides };
    expect(debriefQueue(t, day).map((i) => i.session.id)).toContain(test.id);
    t = apply(t, answerMissed(t, test.id, 'time', day));
    const move = t.adjustments.find((a) => a.movedFrom === test.id)!;
    expect(byId(t, move.sessionId!)).toMatchObject({ kind: 'ftptest', date: day });
    // The plan is now judged on the new test day.
    expect(targetDate(t.plan!)).toBe(day);
  });
});

describe('readiness after an answer', () => {
  it('"sick" swaps don\'t use up readiness\'s two swaps a week: a red day after still gets an easy spin', () => {
    let t = state({ skip: missed });
    t = apply(t, answerMissed(t, missed.id, 'sick', today));
    expect(t.adjustments.filter((a) => a.action === 'downgrade').length).toBeGreaterThanOrEqual(1);
    // The next hard day within the week, everything before it ridden.
    const red = t.plan!.sessions.find((s) => isQuality(s) && s.date > addDays(today, 2) && s.date < addDays(today, 7))!;
    expect(red).toBeDefined();
    const ridden = t.plan!.sessions.filter((s) => s.date >= today && s.date < red.date).map((s) => rideFor(s));
    const wellness: WellnessRecord[] = Array.from({ length: 60 }, (_, i) => ({ date: addDays(red.date, i - 59), lnRmssd: i >= 55 ? 3.6 : 4.1 + (i % 3) * 0.04, rhr: i >= 55 ? 57 : 50 + (i % 2) }));
    t = { ...t, intervalsRides: [...t.intervalsRides, ...ridden], wellness, lastAdapt: addDays(red.date, -1) };
    t = apply(t, runAdaptation(t, red.date, 260));
    expect(t.readiness!.level).toBe('red');
    expect(byId(t, red.id).kind).toBe('recovery');
  });
});

describe('rides that did not go to plan', () => {
  const hard = missed;
  const nextSame = plan.sessions.filter((s) => s.kind === hard.kind && s.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0];

  it('a ride at a third of the planned time is asked about, and "couldn\'t hold the targets" counts as a failed session', () => {
    const short = rideFor(hard, { durationMin: Math.round(hard.durationMin * 0.3), rpe: 9 });
    let t = state({ rides: [short] });
    // Too short to be matched to the session on duration alone.
    expect(historyRides(t).find((r) => r.id === short.id)!.kind).toBeUndefined();
    const q = debriefQueue(t, today);
    expect(q).toEqual([expect.objectContaining({ type: 'short', why: 'time', session: hard, ride: expect.objectContaining({ id: short.id }) })]);
    t = apply(t, answerRideIssue(t, short.id, 'too-hard', today, hard.id));
    const tagged = historyRides(t).find((r) => r.id === short.id)!;
    expect(tagged).toMatchObject({ kind: hard.kind, failed: true, issue: 'too-hard' });
    const after = byId(t, nextSame.id);
    expect(after.level < nextSame.level || (t.plan!.intensityScale?.[hard.kind as 'threshold'] ?? 1) < 1).toBe(true);
    expect(t.reviewedRides).toContain(short.id);
    expect(debriefQueue(t, today)).toEqual([]);
  });

  it('a full-length ride well under the planned load is asked about; the same ride at another FTP setting is not', () => {
    const backedOff = rideFor(hard, { tss: Math.round(hard.tss * 0.7) });
    expect(debriefQueue(state({ rides: [backedOff] }), today)).toEqual([expect.objectContaining({ type: 'short', why: 'load', tss: Math.round(hard.tss * 0.7) })]);
    // Same work against a 10% lower FTP setting: the TSS reads higher, the
    // ride was the planned one, so no question.
    const asPlanned = rideFor(hard, { ftpSet: 234, tss: Math.round(hard.tss * (260 / 234) ** 2) });
    expect(debriefQueue(state({ rides: [asPlanned] }), today)).toEqual([]);
  });

  it("RPE already stepped the plan back: answering \"couldn't hold the targets\" doesn't step back again", () => {
    const r = rideFor(hard, { rpe: 10 });
    let t = state({ rides: [r] });
    t = apply(t, applyFeedback(t, r.id, today));
    const level = byId(t, nextSame.id).level;
    expect(level).toBeLessThan(nextSame.level);
    t = apply(t, answerRideIssue(t, r.id, 'too-hard', today, hard.id));
    expect(byId(t, nextSame.id).level).toBe(level);
  });

  it('ran out of time or felt unwell: the RPE says nothing about the targets', () => {
    const r = rideFor(hard, { durationMin: Math.round(hard.durationMin * 0.6), rpe: 10 });
    let t = state({ rides: [r] });
    t = apply(t, answerRideIssue(t, r.id, 'time', today, hard.id));
    expect(t.plan!.sessions).toEqual(plan.sessions);
    // A later RPE answer for it doesn't move the plan either.
    expect(applyFeedback(t, r.id, today)).toBeUndefined();
    // And it's left out of what this kind of session normally feels like.
    const rides = historyRides(t);
    expect(personalRpe(rides, hard.kind, hard.level, addDays(today, 1))).toBe(personalRpe(rides.filter((x) => x.id !== r.id), hard.kind, hard.level, addDays(today, 1)));

    let u = state({ rides: [{ ...r, id: 'act-unwell' }] });
    u = apply(u, answerRideIssue(u, 'act-unwell', 'unwell', today, hard.id));
    expect(historyRides(u).find((x) => x.id === 'act-unwell')!.failed).toBeFalsy();
    // An RPE-10 ride ridden unwell isn't taken as a maximal effort by the model fit.
    const withPower = { ...r, id: 'act-unwell', best20: 200 };
    const obs = (issue?: 'unwell') => perfObservations([{ ...withPower, issue }]).find((o) => o.date === r.date)!.kind;
    expect(obs()).toBe('max');
    expect(obs('unwell')).toBe('bound');
  });
});

describe('rides that reached Intervals only through Strava', () => {
  // What the Intervals API returns for a Strava-sourced activity: a date, nothing else.
  const stub = (date: string, id = 's1') => activityToRide({ id, start_date_local: `${date}T07:00:00`, source: 'STRAVA' }, 260)!;

  it('on a planned day: assumed ridden as planned, not asked about, not caught up', () => {
    let t = state({ skip: missed });
    t = { ...t, intervalsRides: [...t.intervalsRides, stub(missed.date)] };
    const assumed = historyRides(t).find((r) => r.date === missed.date)!;
    expect(assumed).toMatchObject({ assumed: true, tss: missed.tss, kind: missed.kind, plannedId: missed.id });
    expect(debriefQueue(t, today)).toEqual([]);
    t = apply(t, runAdaptation(t, today, 260));
    expect(t.adjustments.some((a) => a.movedFrom === missed.id)).toBe(false);
    expect(recentNoDataRides(t, today)).toHaveLength(1);
  });

  it('on a rest day it could be anything, so it adds no load; next to a real ride it is ignored', () => {
    const restDay = [1, 2, 3, 4, 5, 6].map((o) => addDays(missed.date, -o)).find((d) => !plan.sessions.some((s) => s.date === d))!;
    const t = { ...state(), intervalsRides: [...state().intervalsRides, stub(restDay, 's2'), stub(addDays(missed.date, -7), 's3')] };
    const rides = historyRides(t);
    expect(rides.some((r) => r.date === restDay)).toBe(false);
    expect(rides.filter((r) => r.date === addDays(missed.date, -7)).every((r) => !r.assumed)).toBe(true);
  });
});

describe('upgrades', () => {
  it('state saved before the questionnaire existed still loads and works', () => {
    const legacy = { ...state({ skip: missed }) } as Partial<TrainingState>;
    delete legacy.missedReasons;
    delete legacy.rideIssues;
    const t = legacy as TrainingState;
    expect(() => historyRides(t)).not.toThrow();
    expect(debriefQueue(t, today)).toHaveLength(1);
    expect(answerMissed(t, missed.id, 'time', today).missedReasons).toEqual({ [missed.id]: 'time' });
    expect(runAdaptation(t, today, 260)).toBeDefined();
  });
});
