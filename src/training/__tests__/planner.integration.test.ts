import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { CONVENTIONAL_BOUNDS, analyzeHistory, planFromHistory } from '../planner';

// The planner with no personal evidence: a new athlete, or one whose rides
// only reached Intervals via Strava (no data). The optimiser must not chase
// the population prior to an extreme, and must not present a guessed FTP.

const snap = { rides: [], wellness: [], ftpSet: 310, availabilityHours: DEFAULT_SETTINGS.goals.availabilityHours, maxRampPerWeek: 6, today: '2026-10-15' };

describe('planning without evidence', () => {
  const analysis = analyzeHistory(snap);
  const { plan } = planFromHistory(snap, { objective: 'ftp', weeks: 16, start: '2026-10-19', optimize: true, ftp: 310 }, analysis);

  it('keeps a conventional base-then-build shape', () => {
    expect(plan.genome.vo2Share).toBeLessThanOrEqual(CONVENTIONAL_BOUNDS.vo2Share!.max!);
    expect(plan.genome.baseFrac).toBeGreaterThanOrEqual(CONVENTIONAL_BOUNDS.baseFrac!.min!);
    expect(plan.genome.baseThresholdShare).toBeLessThanOrEqual(CONVENTIONAL_BOUNDS.baseThresholdShare!.max!);
    const firstHalf = plan.sessions.filter((s) => s.date < plan.weeks[8].start);
    expect(firstHalf.filter((s) => s.kind === 'vo2' || s.kind === 'anaerobic')).toHaveLength(0);
  });

  it("says it doesn't know FTP rather than presenting a guess", () => {
    expect(analysis.ftpEvidence).toBe(0);
    expect(plan.projection!.noFtpEvidence).toBe(true);
    expect(plan.request.baselineTest).toBe(true);
  });
});
