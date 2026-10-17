import { addDays, diffDays } from '../../engine/time';
import type { DateKey } from '../../engine/types';
import type { Genome } from '../types';
import type { PerfObs, RideRecord } from './types';

// "What worked for you": find the blocks in the history where FTP rose, and
// describe their training so the optimiser can be held to that shape.
//
// Why this exists: the fitted model can't tell from typical data which
// intensity an athlete responds to (per-domain gains aren't identifiable), so
// on its own the optimiser follows the *population* prior. When the athlete's
// own history shows how their FTP actually went up, that's better evidence.

export interface BuildBlock {
  start: DateKey;
  end: DateKey;
  fromFtp: number;
  toFtp: number;
  weeks: number;
  sessionsPerWeek: number;
  hoursPerWeek: number;
  /** hard sessions a week (measured rides only) */
  hardPerWeek: number;
  /** share of hard sessions that were VO2 sessions (measured rides only) */
  vo2DayShare?: number;
  /** fraction of the block before VO2 sessions became regular */
  baseFrac?: number;
  /** hard sessions the shares rest on */
  measuredHard: number;
}

export interface BestBuildProfile {
  blocks: BuildBlock[];
  /** genome bounds derived from the blocks */
  bounds: GenomeBounds;
  summary: string;
}

export type GenomeBounds = Partial<{ [K in keyof Genome]: { min?: number; max?: number } }>;

// Sessions are classified the way the genome counts them: a hard session has
// at least 30 TSS above endurance; it's a VO2 session when most of that is
// above threshold. Planned VO2 sessions put ~96% of it there and sweet-spot,
// threshold and over-under sessions ~0%, so the cut-off isn't delicate.
// Only rides with a measured power stream count: an estimate from kcal gives
// every ride of a kind the same average split, which says nothing about what
// that ride was. Tests are their own kind in the genome, so they don't count.
const HARD_TSS = 30;
const isHard = (r: RideRecord) => !r.isTest && !r.estimated && r.domain.mid + r.domain.high >= HARD_TSS;
const isVo2 = (r: RideRecord) => isHard(r) && r.domain.high >= r.domain.mid;
/** Below this many measured hard sessions a week, a block's mix isn't trusted. */
const MIN_MEASURED_PER_WEEK = 1;

/** Blocks between consecutive tests where FTP rose at least `minGain` over 4-24 weeks. */
export function findBuildBlocks(rides: RideRecord[], obs: PerfObs[], minGain = 0.04): BuildBlock[] {
  const tests = obs.filter((o) => o.kind === 'test').sort((a, b) => (a.date < b.date ? -1 : 1));
  const blocks: BuildBlock[] = [];
  // Chain consecutive rising tests into one block (e.g. 250 -> 262 -> 271 -> 280).
  let i = 0;
  while (i < tests.length - 1) {
    let j = i;
    while (j + 1 < tests.length && tests[j + 1].watts > tests[j].watts && diffDays(tests[j].date, tests[j + 1].date) <= 120) j += 1;
    const a = tests[i];
    const b = tests[j];
    const weeks = diffDays(a.date, b.date) / 7;
    if (j > i && b.watts >= a.watts * (1 + minGain) && weeks >= 4 && weeks <= 24) {
      const inBlock = rides.filter((r) => r.date > a.date && r.date <= b.date && r.durationMin > 0);
      const hard = inBlock.filter(isHard);
      const vo2 = hard.filter(isVo2);
      const trusted = hard.length >= weeks * MIN_MEASURED_PER_WEEK;
      // When did VO2 sessions become regular? The first week with one, from
      // which they keep coming at least 3 weeks in 4.
      const total = diffDays(a.date, b.date);
      let firstRegular = total;
      for (let d = 0; d < total; d += 7) {
        const inWeek = vo2.some((r) => r.date > addDays(a.date, d) && r.date <= addDays(a.date, d + 7));
        const rest = vo2.filter((r) => r.date > addDays(a.date, d)).length;
        if (inWeek && rest >= Math.max(1, (total - d) / 7) * 0.75) {
          firstRegular = d;
          break;
        }
      }
      blocks.push({
        start: a.date,
        end: b.date,
        fromFtp: Math.round(a.watts),
        toFtp: Math.round(b.watts),
        weeks: Math.round(weeks),
        sessionsPerWeek: Math.round((inBlock.length / weeks) * 10) / 10,
        hoursPerWeek: Math.round((inBlock.reduce((s, r) => s + r.durationMin, 0) / 60 / weeks) * 10) / 10,
        hardPerWeek: Math.round((hard.length / weeks) * 10) / 10,
        vo2DayShare: trusted ? vo2.length / hard.length : undefined,
        baseFrac: trusted ? firstRegular / Math.max(1, total) : undefined,
        measuredHard: hard.length,
      });
    }
    i = Math.max(j, i + 1);
  }
  return blocks;
}

const VO2_STEPS = [0, 0.25, 0.5, 0.75, 1];
const BASE_STEPS = [0, 0.2, 0.4, 0.6, 0.8];
/** The gene step nearest what worked. */
const pin = (v: number) => ({ min: v, max: v });
const nearest = (steps: number[], x: number) => steps.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), steps[0]);

export function bestBuildProfile(rides: RideRecord[], obs: PerfObs[]): BestBuildProfile | undefined {
  const blocks = findBuildBlocks(rides, obs).filter((b) => b.vo2DayShare !== undefined);
  if (!blocks.length) return undefined;
  // Weight blocks by how much FTP rose.
  const w = blocks.map((b) => b.toFtp - b.fromFtp);
  const wSum = w.reduce((a, b) => a + b, 0);
  const vo2Share = blocks.reduce((s, b, k) => s + b.vo2DayShare! * w[k], 0) / wSum;
  const baseFrac = blocks.reduce((s, b, k) => s + b.baseFrac! * w[k], 0) / wSum;
  // Pin the plan to the gene step nearest what worked, from both sides: the
  // fitted model can't tell which intensity this athlete responds to (left a
  // range, it goes to whichever end the population prior favours), so the
  // evidence is the mix that raised their FTP, not more or less of it.
  const gain = blocks.map((b) => `${b.fromFtp}→${b.toFtp} W in ${b.weeks} wk`).join(', ');
  const vo2Text = vo2Share < 0.1 ? 'almost no VO2 sessions' : `${Math.round(vo2Share * 100)}% of hard sessions VO2`;
  return {
    blocks,
    bounds: { vo2Share: pin(nearest(VO2_STEPS, vo2Share)), baseFrac: pin(nearest(BASE_STEPS, baseFrac)) },
    summary: `Your FTP rose ${gain}. Those builds had ${vo2Text} (the rest sweet spot and threshold), with VO2 regular after ${Math.round(baseFrac * 100)}% of the block.`,
  };
}
