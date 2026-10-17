import { describe, expect, it } from 'vitest';
import { addDays } from '../../engine/time';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { buildPlan } from '../../engine/plan';
import { IntervalsClient } from '../client';
import { syncIntervals } from '../sync';
import * as rec from './fixtures/recorded';

// Integration test at the HTTP boundary: a fake fetch serves recorded
// Intervals.icu responses, everything above it (client, mapping, sync, engine)
// runs for real.

const today = '2026-10-14';
const d = (o: number) => addDays(today, o);

function recordedFetch(log: Array<{ url: URL; init?: RequestInit }>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    log.push({ url, init });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const p = url.pathname;
    if (p.endsWith('/athlete/0') || p.endsWith('/athlete/i123456')) return json(rec.athlete);
    if (p.endsWith('/events.json')) return json(rec.events(d));
    if (p.endsWith('/activities')) return json(rec.activities(d));
    if (p.endsWith('/wellness.json')) return json(rec.wellness(d));
    return new Response('not found', { status: 404 });
  };
}

describe('Intervals sync (recorded responses)', () => {
  it('authenticates, maps and merges a realistic calendar', async () => {
    const log: Array<{ url: URL; init?: RequestInit }> = [];
    const client = new IntervalsClient('secret-key', '0', recordedFetch(log) as typeof fetch);
    const res = await syncIntervals(client, today, 250);

    // auth + routing
    const auth = (log[0].init?.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${btoa('API_KEY:secret-key')}`);
    expect(res.athleteId).toBe('i123456');
    expect(log.slice(1).every((l) => l.url.pathname.includes('/athlete/i123456/'))).toBe(true);
    const ev = log.find((l) => l.url.pathname.endsWith('/events.json'))!;
    expect(ev.url.searchParams.get('oldest')).toBe(d(-21));
    expect(ev.url.searchParams.get('category')).toContain('RACE_A');

    // profile
    expect(res.profile).toMatchObject({ ftp: 305, heightCm: 180, sex: 'M', ageYears: 35, timezone: 'America/New_York', units: 'imperial', weightKg: 78.2 });

    // workouts
    const byTitle = Object.fromEntries(res.workouts.map((w) => [w.title, w]));
    expect(byTitle['Threshold 3x12']).toMatchObject({ startMin: null, kj: 811, kjSource: 'description', intensity: 'Threshold', load: 99 });
    expect(byTitle['Sweet Spot 3x12']).toMatchObject({ startMin: 375, kjSource: 'steps', carbsPerHourOverride: 75, intensity: 'Threshold' });
    expect(byTitle['Sweet Spot 3x12'].steps).toHaveLength(8);
    expect(byTitle['Local Crit'].intensity).toBe('Race');
    expect(res.workouts.filter((w) => w.title === 'Endurance 1h')).toHaveLength(1);
    expect(byTitle['Endurance 1h']).toMatchObject({ completed: true, kj: 612, kjSource: 'actual', startMin: 17 * 60 + 42 });
    expect(res.workouts.some((w) => w.title === 'Travel day')).toBe(false);

    // wellness
    expect(res.wellness.at(-1)).toMatchObject({ ctl: 61.9, atl: 65.9, sleepHours: 8 });
    expect(res.weights.map((w) => w.kg)).toEqual([78.6, 78.2]);
  });

  it('feeds the planner: untimed TR session lands in the default slot, explicit carbs/h is honoured', async () => {
    const client = new IntervalsClient('k', '0', recordedFetch([]) as typeof fetch);
    const res = await syncIntervals(client, today, 250);
    const settings = { ...DEFAULT_SETTINGS, profile: { ...DEFAULT_SETTINGS.profile, ...res.profile } };
    const plan = buildPlan({ settings, workouts: res.workouts, start: today, days: 4, today });
    const tomorrow = plan.days[1];
    expect(tomorrow.workouts[0]).toMatchObject({ title: 'Threshold 3x12', timeAssumed: true, resolvedStartMin: settings.schedule.defaultTrainingMin[tomorrow.weekday] });
    const during = plan.days[2].slots.find((s) => s.kind === 'during')!;
    expect(during.fueling?.carbPerHour).toBe(75);
    expect(plan.days[2].slots[0].startMin).toBeLessThanOrEqual(375 - 15);
  });

  it('surfaces a helpful error on 403', async () => {
    const client = new IntervalsClient('k', '0', (async () => new Response('forbidden', { status: 403 })) as typeof fetch);
    await expect(syncIntervals(client, today, 250)).rejects.toThrow(/Access denied/);
  });
});
