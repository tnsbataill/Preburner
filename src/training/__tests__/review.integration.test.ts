import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { addDays } from '../../engine/time';
import { isQuality } from '../adapt';
import { applyMissedReason } from '../debrief';
import { generatePlan } from '../generator';
import { estimateLoad, planChanges, queueReviews, snapshotPlan } from '../review';
import type { RideRecord } from '../history/types';

// "What changed" is the plan now against the plan when the ride arrived. These
// run the planner's own edits ("what happened?" answers) and check the
// summary describes them.

const plan = generatePlan({ start: '2026-10-19', weeks: 8, objective: 'ftp', ftp: 260, ctl: 55, atl: 55, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6 });
const missed = plan.sessions.find((s) => s.date > '2026-10-26' && isQuality(s))!;
const today = addDays(missed.date, 1);
const baseline = snapshotPlan(plan.sessions, today);

describe('ride review: what changed', () => {
  it('nothing changed: nothing to report', () => {
    expect(planChanges(baseline, plan.sessions, today)).toEqual([]);
  });

  it('"I was tired" eases the next hard day', () => {
    const res = applyMissedReason(plan.sessions, missed, 'tired', today, []);
    const changes = planChanges(baseline, res.sessions, today);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.type === 'easier')).toBe(true);
  });

  it('"I was sick" swaps the next days\' hard sessions for easy ones, or eases the first hard day back', () => {
    const res = applyMissedReason(plan.sessions, missed, 'sick', today, []);
    const changes = planChanges(baseline, res.sessions, today);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.type === 'replaced' || c.type === 'easier')).toBe(true);
  });

  it('"no time" catches the session up later in the week', () => {
    const res = applyMissedReason(plan.sessions, missed, 'time', today, []);
    // The missed session was before today, so its catch-up shows as moved into the window or added.
    const changes = planChanges(snapshotPlan(plan.sessions, missed.date), res.sessions, missed.date);
    expect(changes.some((c) => c.type === 'moved' || c.type === 'added' || c.type === 'replaced')).toBe(true);
  });
});

describe('ride review: queue and estimates', () => {
  const ride = (id: string, date: string): RideRecord => ({ id, date, durationMin: 60, tss: 50, domain: { low: 50, mid: 0, high: 0 }, ftpSet: 260, source: 'intervals' });

  it('rides arriving together share a baseline and are marked as one batch; known rides are skipped', () => {
    const r = queueReviews({}, [ride('a', today), ride('b', today), ride('old', today)], new Set(['old']), baseline);
    expect(Object.keys(r).sort()).toEqual(['a', 'b']);
    expect(r.a.batch).toEqual(['a', 'b']);
    expect(r.a.baseline).toBe(baseline);
    // Already queued: not replaced.
    expect(queueReviews(r, [ride('a', today)], new Set(), snapshotPlan([], today))).toBe(r);
  });

  it('a ride with no data gets its load from length and effort', () => {
    expect(Math.round(estimateLoad(60, 6).tss)).toBe(64);
    expect(estimateLoad(60, 3).domain.high).toBe(0);
    expect(estimateLoad(90, 9).domain.high).toBeGreaterThan(0);
  });
});
