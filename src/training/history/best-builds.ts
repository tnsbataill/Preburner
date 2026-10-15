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
  /** share of above-endurance load that was above threshold (VO2+) */
  highShare: number;
  /** fraction of the block before VO2+ work became regular */
  baseFrac: number;
}

export interface BestBuildProfile {
  blocks: BuildBlock[];
  /** genome bounds derived from the blocks */
  bounds: GenomeBounds;
  summary: string;
}

export type GenomeBounds = Partial<{ [K in keyof Genome]: { min?: number; max?: number } }>;

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
      const mid = inBlock.reduce((s, r) => s + r.domain.mid, 0);
      const high = inBlock.reduce((s, r) => s + r.domain.high, 0);
      // When did VO2+ become regular? First week from which >=1 ride/week has high load.
      const total = diffDays(a.date, b.date);
      let firstRegular = total;
      for (let d = 0; d < total; d += 7) {
        const wk = inBlock.filter((r) => r.date > addDays(a.date, d) && r.date <= addDays(a.date, d + 7));
        const rest = inBlock.filter((r) => r.date > addDays(a.date, d));
        const weeksLeft = Math.max(1, (total - d) / 7);
        if (wk.some((r) => r.domain.high >= 8) && rest.filter((r) => r.domain.high >= 8).length >= weeksLeft * 0.75) {
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
        highShare: mid + high > 0 ? high / (mid + high) : 0,
        baseFrac: firstRegular / Math.max(1, total),
      });
    }
    i = Math.max(j, i + 1);
  }
  return blocks;
}

const VO2_STEPS = [0, 0.25, 0.5, 0.75, 1];

export function bestBuildProfile(rides: RideRecord[], obs: PerfObs[]): BestBuildProfile | undefined {
  const blocks = findBuildBlocks(rides, obs);
  if (!blocks.length) return undefined;
  // Weight blocks by how much FTP rose.
  const w = blocks.map((b) => b.toFtp - b.fromFtp);
  const wSum = w.reduce((a, b) => a + b, 0);
  const highShare = blocks.reduce((s, b, k) => s + b.highShare * w[k], 0) / wSum;
  const baseFrac = blocks.reduce((s, b, k) => s + b.baseFrac * w[k], 0) / wSum;
  // High-intensity TSS share maps onto the share of build-phase hard days that
  // are VO2: a VO2 day is roughly 40% of its load above threshold. Round to
  // the nearest gene step at or above what worked.
  const impliedVo2Days = Math.min(1, highShare / 0.4);
  const vo2Max = VO2_STEPS.find((v) => v >= impliedVo2Days - 0.03) ?? 1;
  const baseMin = Math.max(0, Math.min(0.8, Math.floor(baseFrac * 5) / 5));
  const gain = blocks.map((b) => `${b.fromFtp}→${b.toFtp} W in ${b.weeks} wk`).join(', ');
  return {
    blocks,
    bounds: { vo2Share: { max: vo2Max }, baseFrac: { min: baseMin } },
    summary: `Your FTP rose ${gain}. Those builds were ${highShare < 0.15 ? 'sweet-spot/threshold led' : highShare < 0.3 ? 'mixed' : 'VO2 heavy'} (${Math.round(highShare * 100)}% of hard load above threshold), with VO2 work arriving after ${Math.round(baseFrac * 100)}% of the block.`,
  };
}
