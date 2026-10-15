import { addDays, diffDays } from '../engine/time';
import type { DateKey } from '../engine/types';
import { DEFAULT_GENOME, generatePlan, planEnd } from './generator';
import { type ModelParams, type ModelState, performance, step } from './model';
import type { GenomeBounds } from './history/best-builds';
import type { Genome, PlanProjection, PlanRequest, TrainingPlan } from './types';

// One-shot plan optimizer. Searches the genome space, scores each candidate
// plan by running it through every member of the athlete's model ensemble, and
// returns the plan with the best risk-adjusted objective. The generator still
// enforces the hard limits (hard-day count and spacing, ramp cap, recovery
// weeks), so the optimizer can't exploit model error into an unsafe plan.

export interface Member {
  p: ModelParams;
  /** model state the day before the plan starts */
  s0: ModelState;
}

export interface OptimizeOptions {
  /** penalise spread across the ensemble (risk aversion) */
  riskAversion?: number;
  /** restrict genes, e.g. to the shape of the athlete's own best builds */
  bounds?: GenomeBounds;
  /** candidate budget for the random phase */
  samples?: number;
  seed?: number;
}

/** SD of FTP prediction error on real data (see docs/training-plan-results.md). */
export const MODEL_ERROR_SD = 0.04;

const GENE_VALUES: { [K in keyof Genome]: Array<Genome[K]> } = {
  cadence: [2, 3, 4],
  recoveryDepth: [0.5, 0.6, 0.7],
  rampPerWeek: [1, 2, 3, 4, 5, 6, 7, 8],
  hardPerWeek: [2, 3],
  vo2Share: [0, 0.25, 0.5, 0.75, 1],
  baseFrac: [0, 0.2, 0.4, 0.6, 0.8],
  baseThresholdShare: [0, 0.33, 0.67, 1],
};

/** Day on which the objective is measured. */
export function targetDate(plan: TrainingPlan): DateKey {
  const req = plan.request;
  if (req.objective === 'event' && req.eventDate) return req.eventDate;
  const test = plan.sessions.filter((s) => s.kind === 'ftptest').at(-1);
  return test?.date ?? addDays(planEnd(plan), 1);
}

interface Scored {
  value: number;
  perfAtTarget: number[];
  minTsb: number;
  daily: Array<{ date: DateKey; ctl: number; atl: number; perf: number }>;
}

/** Run the plan through each ensemble member. */
export function scorePlan(plan: TrainingPlan, members: Member[], ctl0: number, atl0: number, opts: OptimizeOptions = {}): Scored {
  const start = plan.request.start;
  const target = targetDate(plan);
  const days = diffDays(start, target) + 1;
  const byDate = new Map<DateKey, { low: number; mid: number; high: number }>();
  for (const s of plan.sessions) {
    const cur = byDate.get(s.date) ?? { low: 0, mid: 0, high: 0 };
    byDate.set(s.date, { low: cur.low + s.domain.low, mid: cur.mid + s.domain.mid, high: cur.high + s.domain.high });
  }
  const zero = { low: 0, mid: 0, high: 0 };
  const perfAtTarget: number[] = [];
  const perfSum: number[] = new Array(days).fill(0);
  for (const m of members) {
    let s = m.s0;
    for (let i = 0; i < days; i += 1) {
      // Performance on day i is measured before day i's load.
      const perf = performance(s, m.p);
      perfSum[i] += perf;
      if (i === days - 1) perfAtTarget.push(perf);
      s = step(s, byDate.get(addDays(start, i)) ?? zero, m.p);
    }
  }
  // Classic PMC for constraint checks and the chart.
  let ctl = ctl0;
  let atl = atl0;
  let minTsb = Infinity;
  const daily: Scored['daily'] = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const l = byDate.get(date);
    const load = l ? l.low + l.mid + l.high : 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    minTsb = Math.min(minTsb, ctl - atl);
    daily.push({ date, ctl, atl, perf: perfSum[i] / members.length });
  }

  const req = plan.request;
  let value: number;
  if (req.objective === 'ctl') value = ctl;
  else {
    const mean = perfAtTarget.reduce((a, b) => a + b, 0) / perfAtTarget.length;
    const sd = Math.sqrt(perfAtTarget.reduce((a, b) => a + (b - mean) ** 2, 0) / perfAtTarget.length);
    value = mean - (opts.riskAversion ?? 0.5) * sd;
  }
  // Soft guard on deep fatigue beyond what's productive (TSB < -30).
  value -= Math.max(0, -30 - minTsb) * 0.5;
  return { value, perfAtTarget, minTsb, daily };
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

export interface OptimizeResult {
  plan: TrainingPlan;
  evaluated: number;
  /** top candidates for transparency */
  leaderboard: Array<{ genome: Genome; value: number }>;
}

export function optimizePlan(req: PlanRequest, members: Member[], opts: OptimizeOptions = {}): OptimizeResult {
  let seed = opts.seed ?? 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const cache = new Map<string, { plan: TrainingPlan; scored: Scored }>();
  const evalGenome = (g: Genome) => {
    const key = JSON.stringify(g);
    let hit = cache.get(key);
    if (!hit) {
      const plan = generatePlan(req, g);
      hit = { plan, scored: scorePlan(plan, members, req.ctl, req.atl, opts) };
      cache.set(key, hit);
    }
    return hit;
  };
  const keys = Object.keys(GENE_VALUES) as Array<keyof Genome>;
  const allowedRamp = GENE_VALUES.rampPerWeek.filter((r) => r <= req.maxRampPerWeek);
  const values = { ...GENE_VALUES, rampPerWeek: allowedRamp.length ? allowedRamp : [req.maxRampPerWeek] } as typeof GENE_VALUES;
  for (const [k, b] of Object.entries(opts.bounds ?? {}) as Array<[keyof Genome, { min?: number; max?: number }]>) {
    const kept = (values[k] as number[]).filter((v) => (b.min === undefined || v >= b.min - 1e-9) && (b.max === undefined || v <= b.max + 1e-9));
    if (kept.length) (values as Record<string, number[]>)[k] = kept;
  }
  const clampGenome = (g: Genome): Genome => {
    const out = { ...g };
    for (const k of keys) {
      const vs = values[k] as number[];
      if (!vs.includes(out[k] as number)) (out as Record<string, number>)[k] = vs.reduce((best, v) => (Math.abs(v - (out[k] as number)) < Math.abs(best - (out[k] as number)) ? v : best), vs[0]);
    }
    return out;
  };

  // Phase 1: default plus random samples.
  let best: { g: Genome; v: number } = { g: clampGenome({ ...DEFAULT_GENOME, rampPerWeek: Math.min(DEFAULT_GENOME.rampPerWeek, req.maxRampPerWeek) }), v: -Infinity };
  best.v = evalGenome(best.g).scored.value;
  for (let i = 0; i < (opts.samples ?? 40); i += 1) {
    const g = Object.fromEntries(keys.map((k) => [k, values[k][Math.floor(rand() * values[k].length)]])) as unknown as Genome;
    const v = evalGenome(g).scored.value;
    if (v > best.v) best = { g, v };
  }
  // Phase 2: coordinate descent over each gene until no improvement.
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (const k of keys) {
      for (const val of values[k] as unknown[]) {
        const g = { ...best.g, [k]: val } as Genome;
        const v = evalGenome(g).scored.value;
        if (v > best.v + 1e-9) {
          best = { g, v };
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const winner = evalGenome(best.g);
  const startPerf = members.reduce((s, m) => s + performance(m.s0, m.p), 0) / members.length;
  // The ensemble only captures uncertainty in the response parameters. Add
  // model error measured on real data (fit-to-date vs later FTP tests: 3.1%
  // mean absolute error, ~4% SD) in quadrature. Whether the plan actually
  // gets ridden isn't in here at all, so this is still optimistic.
  const p50 = quantile(winner.scored.perfAtTarget, 0.5);
  const ensSd = (quantile(winner.scored.perfAtTarget, 0.9) - quantile(winner.scored.perfAtTarget, 0.1)) / 2.56;
  const sd = Math.sqrt(ensSd ** 2 + (MODEL_ERROR_SD * p50) ** 2);
  const projection: PlanProjection = {
    finalFtp: { p10: p50 - 1.28 * sd, p50, p90: p50 + 1.28 * sd },
    startFtp: startPerf,
    daily: winner.scored.daily,
    overloadRisk: winner.scored.minTsb < -30 ? Math.min(1, (-30 - winner.scored.minTsb) / 20) : 0,
    objectiveValue: winner.scored.value,
  };
  const leaderboard = [...cache.values()]
    .sort((a, b) => b.scored.value - a.scored.value)
    .slice(0, 5)
    .map((c) => ({ genome: c.plan.genome, value: c.scored.value }));
  return { plan: { ...winner.plan, projection }, evaluated: cache.size, leaderboard };
}
