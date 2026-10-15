import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { addDays, weekdayOf } from '../../engine/time';
import type { Weekday } from '../../engine/types';
import { DEFAULT_GENOME, MAX_HIGH_PER_WEEK, MIN_LOW_TIME_SHARE, generatePlan } from '../generator';
import type { Genome, PlanRequest } from '../types';
import { renderPlan } from './render';

const AVAIL = DEFAULT_SETTINGS.goals.availabilityHours;
const base: PlanRequest = { start: '2026-10-19', weeks: 12, objective: 'ftp', ftp: 260, ctl: 55, atl: 60, availabilityHours: AVAIL, maxRampPerWeek: 6 };

const scenarios: Record<string, () => string> = {
  '12-week FTP plan, default availability': () => renderPlan(generatePlan(base)),
  '12-week FTP plan opening with a test': () => renderPlan(generatePlan({ ...base, baselineTest: true })),
  '8-week event plan with taper': () => renderPlan(generatePlan({ ...base, weeks: 8, objective: 'event', eventDate: addDays(base.start, 55) })),
  '6-week fitness block, 45 min weekdays': () =>
    renderPlan(generatePlan({ ...base, weeks: 6, objective: 'ctl', ctl: 35, atl: 35, availabilityHours: { 0: 2.5, 1: 0.75, 2: 0.75, 3: 0.75, 4: 0.75, 5: 0, 6: 3 } })),
};

describe('golden training plans', () => {
  for (const [name, run] of Object.entries(scenarios)) {
    it(name, async () => {
      await expect(run()).toMatchFileSnapshot(`./golden/${name.replace(/[^a-z0-9]+/gi, '-')}.txt`);
    });
  }
});

// The hard limits must hold for any genome the optimiser can pick, on any
// availability, so model error can never produce an unsafe plan.
describe('plan invariants across the genome space', () => {
  const genomes: Genome[] = [];
  for (const cadence of [2, 3, 4] as const)
    for (const hardPerWeek of [2, 3] as const)
      for (const vo2Share of [0, 1])
        for (const rampPerWeek of [2, 8]) genomes.push({ ...DEFAULT_GENOME, cadence, hardPerWeek, vo2Share, rampPerWeek, baseFrac: vo2Share ? 0 : 0.6 });
  const avails: Array<Record<Weekday, number>> = [
    AVAIL,
    { 0: 4, 1: 1.5, 2: 1.5, 3: 1.5, 4: 1.5, 5: 1.5, 6: 5 },
    { 0: 2, 1: 0, 2: 1, 3: 0, 4: 1, 5: 0, 6: 2 },
  ];
  it('respects hard-day spacing, intensity limits, availability and the ramp cap', () => {
    let checked = 0;
    for (const g of genomes)
      for (const availabilityHours of avails) {
        const plan = generatePlan({ ...base, availabilityHours, maxRampPerWeek: 5 }, g);
        expect(plan.genome.rampPerWeek).toBeLessThanOrEqual(5);
        const hardDates = plan.sessions.filter((s) => s.hard && s.kind !== 'ftptest').map((s) => s.date);
        for (const d of hardDates) expect(hardDates).not.toContain(addDays(d, 1));
        for (const s of plan.sessions) expect(s.durationMin).toBeLessThanOrEqual(availabilityHours[weekdayOf(s.date)] * 60 + 1);
        for (const w of plan.weeks) {
          const ss = plan.sessions.filter((s) => s.date >= w.start && s.date < addDays(w.start, 7));
          expect(ss.filter((s) => s.kind === 'vo2' || s.kind === 'anaerobic').length).toBeLessThanOrEqual(MAX_HIGH_PER_WEEK);
          expect(w.hardSessions).toBeLessThanOrEqual(3);
          let low = 0;
          let total = 0;
          for (const s of ss)
            for (const st of s.steps) {
              total += st.durationS;
              if ((st.lo + st.hi) / 2 < 0.76) low += st.durationS;
            }
          // The time-in-zone floor holds unless the week has no room for easy riding at all.
          if (total && !w.availabilityLimited) expect(low / total).toBeGreaterThanOrEqual(MIN_LOW_TIME_SHARE - 0.02);
          checked += 1;
        }
        // FTP objective always ends with a test after openers.
        expect(plan.sessions.at(-1)!.kind).toBe('ftptest');
      }
    expect(checked).toBeGreaterThan(400);
  });
});
