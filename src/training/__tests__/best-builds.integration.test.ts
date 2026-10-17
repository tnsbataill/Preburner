import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { addDays } from '../../engine/time';
import { perfObservations } from '../fit';
import { findBuildBlocks } from '../history/best-builds';
import type { RideRecord } from '../history/types';
import { analyzeHistory, planFromHistory } from '../planner';

// History where FTP rose during a sweet-spot-led block (little VO2) should hold
// the optimiser to that shape; with the option off it may choose otherwise.

const START = '2025-01-06';
function history(opts: { vo2From?: number; estimated?: boolean } = {}): RideRecord[] {
  const rides: RideRecord[] = [];
  for (let d = 0; d < 300; d += 1) {
    const date = addDays(START, d);
    const wd = d % 7;
    if (wd === 4 || wd === 0) continue;
    const hard = wd === 1 || wd === 3 || wd === 5;
    const lateVo2 = opts.vo2From !== undefined ? d >= opts.vo2From && d < 100 && wd !== 3 : d >= 80 && d < 100 && wd === 5;
    rides.push({
      id: `r${d}`,
      date,
      durationMin: hard ? 60 : 90,
      tss: hard ? 85 : 55,
      domain: hard ? { low: 25, mid: lateVo2 ? 30 : 58, high: lateVo2 ? 30 : 2 } : { low: 55, mid: 0, high: 0 },
      ftpSet: 280,
      best20: hard ? 275 : undefined,
      ...(opts.estimated && { estimated: true }),
      source: 'strava',
    });
  }
  const test = (d: number, ftp: number) => rides.push({ id: `t${d}`, date: addDays(START, d), durationMin: 45, tss: 60, domain: { low: 20, mid: 30, high: 10 }, ftpSet: ftp, best20: ftp / 0.95, isTest: true, source: 'strava' });
  test(10, 270);
  test(55, 285);
  test(100, 300);
  test(250, 280);
  return rides.sort((a, b) => (a.date < b.date ? -1 : 1));
}

describe('best builds', () => {
  it('finds the FTP-raising block and its intensity mix', () => {
    const rides = history();
    const blocks = findBuildBlocks(rides, perfObservations(rides));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ fromFtp: 270, toFtp: 300, weeks: 13 });
    expect(blocks[0].vo2DayShare).toBeLessThan(0.15);
    expect(blocks[0].baseFrac).toBeGreaterThan(0.6);
  });

  it('holds the optimised plan to that shape when asked', () => {
    const rides = history();
    const today = addDays(START, 299);
    const snap = { rides, wellness: [], ftpSet: 280, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6, today };
    const analysis = analyzeHistory(snap, 'core', 6);
    expect(analysis.bestBuilds?.bounds.vo2Share?.max).toBeLessThanOrEqual(0.25);
    const { plan } = planFromHistory(snap, { objective: 'ftp', weeks: 12, optimize: true, useBestBuilds: true }, analysis);
    expect(plan.genome.vo2Share).toBeLessThanOrEqual(0.25);
    expect(plan.genome.baseFrac).toBeGreaterThanOrEqual(analysis.bestBuilds!.bounds.baseFrac!.min!);
    // Projection range includes model error, not just ensemble spread.
    const p = plan.projection!.finalFtp;
    expect(p.p90 - p.p10).toBeGreaterThan(0.08 * p.p50);
  }, 60_000);

  it('pins the plan to the mix that worked, from below as well as above', () => {
    const rides = history({ vo2From: 40 });
    const analysis = analyzeHistory({ rides, wellness: [], ftpSet: 280, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6, today: addDays(START, 299) }, 'core', 4);
    // Two of three hard days were VO2 from week 5 of 13: about half of all hard days.
    const share = analysis.bestBuilds!.blocks[0].vo2DayShare!;
    expect(share).toBeGreaterThan(0.4);
    const { min, max } = analysis.bestBuilds!.bounds.vo2Share!;
    expect(min).toBe(max);
    expect(Math.abs(min! - share)).toBeLessThanOrEqual(0.125);
    expect(analysis.bestBuilds?.bounds.baseFrac?.max).toBeLessThanOrEqual(0.4);
  });

  it('a best build outside the conventional limits gives way to their nearest edge, not to no limits', () => {
    // VO2 two days in three from the first week: the best-build bounds (VO2 0.75,
    // base 0) clash with the conventional ones (VO2 <= 0.5, base >= 0.4).
    const rides = history({ vo2From: 0 });
    const today = addDays(START, 299);
    const snap = { rides, wellness: [], ftpSet: 280, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6, today };
    const analysis = analyzeHistory(snap, 'core', 4);
    expect(analysis.bestBuilds?.bounds.baseFrac?.max).toBeLessThan(0.4);
    const { plan } = planFromHistory(snap, { objective: 'ftp', weeks: 12, optimize: true, useBestBuilds: true }, analysis);
    expect(plan.genome.vo2Share).toBe(0.5);
    expect(plan.genome.baseFrac).toBe(0.4);
  }, 60_000);

  it('rides with estimated loads say nothing about the intensity mix', () => {
    const rides = history({ estimated: true });
    const analysis = analyzeHistory({ rides, wellness: [], ftpSet: 280, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6, today: addDays(START, 299) }, 'core', 4);
    expect(analysis.bestBuilds).toBeUndefined();
  });
});
