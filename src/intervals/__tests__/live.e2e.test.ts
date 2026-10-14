import { describe, expect, it } from 'vitest';
import { todayKey } from '../../engine/time';
import { IntervalsClient } from '../client';
import { syncIntervals } from '../sync';

// Opt-in, read-only end-to-end test against the real Intervals.icu API.
//   INTERVALS_API_KEY=... npm run test:live
const key = process.env.INTERVALS_API_KEY;

describe.skipIf(!key)('Intervals.icu live (read-only)', () => {
  it('syncs the real calendar without errors', async () => {
    const res = await syncIntervals(new IntervalsClient(key!), todayKey(), 250);
    expect(res.athleteId).toMatch(/^i?\d+$/);
    for (const w of res.workouts) {
      expect(w.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(w.durationMin).toBeGreaterThan(0);
      expect(w.kj).toBeGreaterThan(0);
    }
    console.log(res.log.join('\n'));
  }, 30_000);
});
