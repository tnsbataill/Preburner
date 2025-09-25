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

  it('fetches athlete profile and planned workouts using basic auth', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const path = `${url.pathname}${url.search}`;

      if (path.startsWith('/api/v1/athlete/123/events')) {
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

      if (path.startsWith('/api/v1/athlete/123')) {
        return buildJsonResponse({ id: 123, ftp: 255 });
      }

      throw new Error(`Unexpected fetch to ${path}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const debugSpy = vi.fn();
    const provider = createIntervalsProvider('abc123', debugSpy, { athleteId: 123 });

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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [profileUrl, profileInit] = fetchMock.mock.calls[0];
    expect(profileUrl.toString()).toBe('https://intervals.icu/api/v1/athlete/123');
    expect(profileInit?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('abc123:').toString('base64')}`,
      Accept: 'application/json',
    });

    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: expect.stringContaining('Loaded athlete profile'),
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
      'Intervals.icu rejected the automatic athlete lookup (405). Enter your athlete ID in Settings.',
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

      if (path.startsWith('/api/v1/athlete/123/events')) {
        return new Response('Access denied', {
          status: 403,
          statusText: 'Forbidden',
        });
      }

      if (path === '/api/v1/athlete/123') {
        return buildJsonResponse({ id: 123, ftp: 250 });
      }

      throw new Error(`Unexpected fetch to ${path}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const provider = createIntervalsProvider('abc123', undefined, { athleteId: 123 });

    await expect(
      provider.getPlannedWorkouts('2024-06-10T00:00:00.000Z', '2024-06-20T00:00:00.000Z'),
    ).rejects.toThrow(
      /Intervals\.icu denied access to planned workouts \(403\)\. Ensure your API key allows planned workout access on Intervals\.icu → Settings → API and that the athlete has shared planned workouts with you\./,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://intervals.icu/api/v1/athlete/123/events?start=2024-06-10T00%3A00%3A00.000Z&end=2024-06-20T00%3A00%3A00.000Z&category=WORKOUT',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });
});
