import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayKey } from '../../engine/time';
import { useApp } from '../../state/store';
import type { IcuEvent } from '../client';
import * as rec from './fixtures/recorded';

// The training-plan write paths against a stateful fake Intervals.icu: the real
// store actions, client, mapping and planner run; only HTTP is faked. Events
// upsert by external_id like the real bulk endpoint.

const TZ = 'America/New_York';
const today = todayKey(TZ);
const d = (o: number) => addDays(today, o);

class FakeIntervals {
  events: IcuEvent[] = [
    { id: 1, start_date_local: `${d(9)}T00:00:00`, category: 'WORKOUT', type: 'VirtualRide', name: 'TR Threshold 3x12', moving_time: 4500, icu_training_load: 99, tags: ['trainerroad'] },
    { id: 2, start_date_local: `${d(20)}T08:00:00`, category: 'RACE_B', type: 'Ride', name: 'Gran Fondo', moving_time: 14400, icu_training_load: 260 },
  ];
  nextId = 100;
  /** what the athlete changes in Intervals between syncs */
  rideFtp = 305;
  weightToday?: number;
  activityPuts: Array<{ id: string; body: unknown }> = [];
  log: string[] = [];
  activities = Array.from({ length: 120 }, (_, i) => {
    const day = d(-120 + i);
    const hard = i % 7 === 1 || i % 7 === 3;
    return {
      id: `a${i}`,
      start_date_local: `${day}T17:30:00`,
      type: 'VirtualRide',
      name: hard ? 'Sweet Spot 3x15' : 'Endurance',
      moving_time: hard ? 4800 : 5400,
      icu_training_load: hard ? 85 : 55,
      icu_intensity: hard ? 82 : 66,
      icu_ftp: 305,
      icu_pm_ftp: hard ? 300 + (i % 5) : undefined,
      icu_zone_times: hard ? [{ id: 'Z2', secs: 2400 }, { id: 'Z4', secs: 2700 }] : [{ id: 'Z2', secs: 5400 }],
      icu_rpe: hard ? 6 : 3,
      feel: 2,
      source: 'GARMIN_CONNECT',
    };
  });
  // A ride that reached Intervals via Strava: the API returns only a stub.
  stravaStub = { id: 'strava1', start_date_local: `${d(-2)}T07:00:00`, source: 'STRAVA', _note: 'STRAVA activities are not available via the API' };
  fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const method = init?.method ?? 'GET';
    this.log.push(`${method} ${p}`);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (p.endsWith('/athlete/0') || p.endsWith('/athlete/i123456'))
      return json({ ...rec.athlete, timezone: TZ, ...(this.weightToday && { icu_weight: this.weightToday }), sportSettings: rec.athlete.sportSettings.map((x) => (x.types.includes('Ride') ? { ...x, ftp: this.rideFtp } : x)) });
    if (p.endsWith('/events.json')) return json(this.events);
    if (p.endsWith('/events/bulk') && method === 'POST') {
      for (const e of JSON.parse(String(init!.body)) as IcuEvent[]) {
        const i = this.events.findIndex((x) => x.external_id && x.external_id === e.external_id);
        if (i >= 0) this.events[i] = { ...this.events[i], ...e };
        else this.events.push({ ...e, id: (this.nextId += 1) });
      }
      return json([]);
    }
    const del = /\/events\/(\d+)$/.exec(p);
    if (del && method === 'DELETE') {
      this.events = this.events.filter((e) => e.id !== Number(del[1]));
      return new Response(null, { status: 204 });
    }
    if (p.endsWith('/activities')) return json([...this.activities, this.stravaStub]);
    const act = /\/activity\/([^/]+)$/.exec(p);
    if (act && method === 'PUT') {
      this.activityPuts.push({ id: act[1], body: JSON.parse(String(init!.body)) });
      return json({});
    }
    if (p.endsWith('/wellness.json'))
      return json([
        ...Array.from({ length: 90 }, (_, i) => ({ id: d(-90 + i), ctl: 60, atl: 62, hrv: 60 + (i % 5), restingHR: 48 + (i % 3) })),
        ...(this.weightToday ? [{ id: today, weight: this.weightToday }] : []),
      ]);
    return new Response('not found', { status: 404 });
  };
  planEvents() {
    return this.events.filter((e) => e.external_id?.startsWith('preburner-plan-'));
  }
}

// Node has no localStorage; give the persisted store an in-memory one.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

const fake = new FakeIntervals();
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = fake.fetch as typeof fetch;
  useApp.getState().resetAll();
  useApp.setState((s) => ({ onboarded: true, connection: { ...s.connection, mode: 'intervals', intervalsKey: 'k', athleteId: '0' }, settings: { ...s.settings, profile: { ...s.settings.profile, timezone: TZ } } }));
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('training plan <-> Intervals.icu', () => {
  it('sync maps RPE, feel, zones, modelled FTP and HRV into the training history', async () => {
    await useApp.getState().sync();
    const t = useApp.getState().training;
    expect(useApp.getState().connection.syncError).toBeUndefined();
    const hard = t.intervalsRides.find((r) => r.durationMin === 80)!;
    expect(hard).toMatchObject({ rpe: 6, feel: 2, ftpSet: 305, startMin: 17 * 60 + 30 });
    expect(hard.domain.mid).toBeGreaterThan(hard.domain.low);
    expect(0.95 * hard.best20!).toBeCloseTo(300, -1);
    expect(t.wellness.at(-1)!.lnRmssd).toBeCloseTo(Math.log(64), 1);
    // The Strava stub is kept as "something was recorded", with no data.
    expect(t.intervalsRides.find((r) => r.id === 'act-strava1')).toMatchObject({ date: d(-2), noData: true, tss: 0 });
  });

  it('plans with the Intervals FTP, keeps the race, and sends the plan once', async () => {
    useApp.getState().generateTrainingPlan({ objective: 'ftp', weeks: 6, start: d(1), optimize: false });
    const plan = useApp.getState().training.plan!;
    expect(plan.request.ftp).toBe(305);
    expect(plan.sessions.find((s) => s.date === d(20))).toBeUndefined();
    await useApp.getState().applyTrainingPlan();
    const sent = fake.planEvents();
    expect(sent).toHaveLength(plan.sessions.length);
    const e = sent.find((x) => x.name?.startsWith('Sweet spot') || x.name?.startsWith('Threshold'))!;
    expect(e).toMatchObject({ category: 'WORKOUT', tags: ['preburner', 'preburner-plan'] });
    expect(e.description).toMatch(/\n- Warmup 10m 50-65%/);
    expect(e.start_date_local).toMatch(/T\d\d:\d\d:00$/);
    // Calendar after sync: plan events from Intervals, no duplicates, TR hidden, race kept.
    const { mergePlanIntoCalendar } = await import('../../state/training');
    const s = useApp.getState();
    const cal = mergePlanIntoCalendar(s.workouts, s.training, today, 'intervals', 305);
    expect(cal.filter((w) => w.source === 'preburner' && w.date >= today)).toHaveLength(plan.sessions.length);
    expect(cal.find((w) => w.title === 'TR Threshold 3x12')).toBeUndefined();
    expect(cal.find((w) => w.title === 'Gran Fondo')).toBeDefined();
    // Re-applying is idempotent.
    await useApp.getState().applyTrainingPlan();
    expect(fake.planEvents()).toHaveLength(plan.sessions.length);
  });

  it('a new plan over an applied one leaves no orphaned events', async () => {
    useApp.getState().generateTrainingPlan({ objective: 'ftp', weeks: 4, start: d(3), optimize: false });
    const plan = useApp.getState().training.plan!;
    await useApp.getState().applyTrainingPlan();
    const ids = new Set(plan.sessions.map((x) => `preburner-plan-${x.id}`));
    const future = fake.planEvents().filter((e) => e.start_date_local.slice(0, 10) >= today);
    expect(future.every((e) => ids.has(e.external_id!))).toBe(true);
    expect(future).toHaveLength(plan.sessions.length);
  });

  it('RPE and feel answered in the app are written back to the activity', async () => {
    const ride = useApp.getState().training.intervalsRides.at(-1)!;
    await useApp.getState().setFeedback(ride.id, { rpe: 7, feel: 2 });
    expect(fake.activityPuts.at(-1)).toEqual({ id: ride.id.slice(4), body: { icu_rpe: 7, feel: 2 } });
  });

  it('"what happened?" answers reach the Intervals calendar on the next update', async () => {
    const { isQuality } = await import('../../training/adapt');
    useApp.getState().generateTrainingPlan({ objective: 'ftp', weeks: 6, start: d(-10), optimize: false });
    await useApp.getState().applyTrainingPlan();
    const plan = useApp.getState().training.plan!;
    const missed = plan.sessions.filter((s) => s.date < today)[0];
    const upcoming = plan.sessions.filter((s) => isQuality(s) && s.date >= today && s.date < d(7));
    expect(upcoming.length).toBeGreaterThan(0);
    useApp.getState().answerMissed(missed.id, 'injured');
    const t = useApp.getState().training;
    expect(t.dirtyIds).toEqual(expect.arrayContaining(upcoming.map((s) => s.id)));
    await useApp.getState().applyTrainingPlan();
    for (const s of upcoming) {
      const e = fake.planEvents().find((x) => x.external_id === `preburner-plan-${s.id}`)!;
      expect(e.name).toMatch(/recovery/i);
    }
    expect(useApp.getState().training.dirtyIds).toEqual([]);
  });

  it('discarding removes the future plan events and keeps everything else', async () => {
    await useApp.getState().discardTrainingPlan();
    expect(fake.planEvents().filter((e) => e.start_date_local.slice(0, 10) >= today)).toHaveLength(0);
    expect(fake.events.map((e) => e.name)).toEqual(expect.arrayContaining(['TR Threshold 3x12', 'Gran Fondo']));
    expect(useApp.getState().training.plan).toBeUndefined();
  });

  it('FTP and weight changed in Intervals reach the app, and the plan, on the next sync', async () => {
    useApp.getState().generateTrainingPlan({ objective: 'ftp', weeks: 6, start: d(1), optimize: false });
    expect(useApp.getState().training.ftp).toBe(305);
    fake.rideFtp = 292;
    fake.weightToday = 76.4;
    // Connecting from demo mode, with an old-style demo weigh-in labelled "manual".
    useApp.setState((st) => ({ connection: { ...st.connection, mode: 'demo' }, weights: [{ date: d(-3), kg: 99, source: 'manual' }] }));
    await useApp.getState().sync();
    const s = useApp.getState();
    expect(s.settings.profile.ftp).toBe(292);
    // Same day: the plan's working FTP follows without waiting for tomorrow's adaptation.
    expect(s.training.ftp).toBe(292);
    expect(s.settings.profile.weightKg).toBe(76.4);
    expect(s.weights.find((w) => w.date === today)).toMatchObject({ kg: 76.4, source: 'intervals' });
    // The demo's made-up weigh-ins never survive into a connected app.
    expect(s.weights.some((w) => w.source === 'demo' || w.kg === 99)).toBe(false);
  });
});
