import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIntervalsProvider } from '../intervals.js';

function buildJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });
}

describe('IntervalsProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches planned workouts for personal API keys using basic auth and athlete 0', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const path = `${url.pathname}${url.search}`;

      if (path === '/api/v1/athlete/0') {
        return buildJsonResponse({
          id: 0,
          ftp: 260,
          weight: 70.2,
          sex: 'M',
          birth_date: '1990-06-15',
        });
      }

      if (path.startsWith('/api/v1/athlete/0/metrics/weight')) {
        return buildJsonResponse([
          { date: '2024-06-01', value: 70.4 },
          { date: '2024-06-05', value: 70.1 },
        ]);
      }

      if (path.startsWith('/api/v1/athlete/0/events.json')) {
        return buildJsonResponse([
          {
            id: 42,
            title: 'Tempo Ride',
            start_date: '2024-06-11T08:00:00Z',
            planned_duration_total: 3600,
            planned_work_kj: 650,
            ftp: 255,
            tags: ['Tempo'],
            steps: [
              { duration: 600, target_type: 'Watts', target_lo: 220, target_hi: 240 },
              { duration: 600, target_type: 'Watts', target_lo: 200, target_hi: 200 },
            ],
          },
        ]);
      }

      throw new Error(`Unexpected fetch to ${path}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const debugSpy = vi.fn();
    const provider = createIntervalsProvider('abc123', debugSpy, { athleteId: 0 });

    const workouts = await provider.getPlannedWorkouts(
      '2024-06-10T00:00:00.000Z',
      '2024-06-20T00:00:00.000Z',
    );

    expect(workouts).toHaveLength(1);
    const [workout] = workouts;
    expect(workout.id).toBe('42');
    expect(workout.type).toBe('Tempo');
    expect(workout.duration_hr).toBeCloseTo(1);
    expect(workout.planned_kJ).toBe(650);
    expect(workout.kj_source).toBe('ICU Structured');
    expect(workout.steps).toHaveLength(2);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const eventsCall = fetchMock.mock.calls.find(([request]) =>
      request.toString().includes('/athlete/0/events.json'),
    );
    expect(eventsCall).toBeDefined();
    const [eventsUrl, eventsInit] = eventsCall!;
    expect(eventsUrl.toString()).toBe(
      'https://intervals.icu/api/v1/athlete/0/events.json?oldest=2024-06-10&newest=2024-06-20&category=WORKOUT',
    );
    expect(eventsInit?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('API_KEY:abc123').toString('base64')}`,
      Accept: 'application/json',
    });

    const context = provider.getLatestAthleteContext();
    expect(context?.weights).toHaveLength(2);
    expect(context?.profile?.weight_kg).toBeCloseTo(70.1);
    expect(context?.profile?.ftp_watts).toBe(255);

    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: expect.stringContaining('Prepared 1 workouts for planner'),
      }),
    );
  });

  it('suggests entering athlete id when automatic lookup is rejected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const path = `${url.pathname}${url.search}`;

      if (path === '/api/v1/athlete') {
        return new Response('Method Not Allowed', {
          status: 405,
          statusText: 'Method Not Allowed',
        });
      }

      throw new Error(`Unexpected fetch to ${path}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const provider = createIntervalsProvider('abc123');

    await expect(
      provider.getPlannedWorkouts('2024-06-10T00:00:00.000Z', '2024-06-20T00:00:00.000Z'),
    ).rejects.toThrow(
      /Intervals\.icu rejected the automatic athlete lookup \(405\)\. Set your athlete ID in settings, or pass athleteId=0 to target your own account\./,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://intervals.icu/api/v1/athlete',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });

  it('advises enabling planned workout access when events request is forbidden', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const path = `${url.pathname}${url.search}`;

      if (path.startsWith('/api/v1/athlete/0/metrics/weight')) {
        return buildJsonResponse([]);
      }

      if (path.startsWith('/api/v1/athlete/0/events.json')) {
        return new Response('Access denied', {
          status: 403,
          statusText: 'Forbidden',
        });
      }

      throw new Error(`Unexpected fetch to ${path}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const provider = createIntervalsProvider('abc123', undefined, { athleteId: 0 });

    await expect(
      provider.getPlannedWorkouts('2024-06-10T00:00:00.000Z', '2024-06-20T00:00:00.000Z'),
    ).rejects.toThrow(
      /Access denied \(403\)\. Using a personal API key\? Use Basic auth with username "API_KEY" and your key as the password\./,
    );

    const eventsCall = fetchMock.mock.calls.find(([request]) =>
      request.toString().startsWith('https://intervals.icu/api/v1/athlete/0/events.json'),
    );
    expect(eventsCall).toBeDefined();
    const [eventsUrl, eventsInit] = eventsCall!;
    expect(eventsUrl.toString()).toBe(
      'https://intervals.icu/api/v1/athlete/0/events.json?oldest=2024-06-10&newest=2024-06-20&category=WORKOUT',
    );
    expect(eventsInit).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });
});
