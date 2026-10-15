import { addDays, diffDays } from '../engine/time';
import type { DateKey } from '../engine/types';
import type { PerfObs, RideRecord } from './history/types';
import { type DayLoad, type ModelParams, PRIOR, type ModelState, loadsByDate, priorParams, simulate } from './model';

// Fitting the planning model to one athlete. Most rides are sub-maximal, so
// their best 20-min power is only a *lower bound* on FTP; only tests and
// near-maximal efforts pin performance down. The loss is therefore one-sided
// for bounds, and every parameter is pulled toward the population prior (MAP),
// because individual fitness-fatigue fits on sparse data are unstable.

export type FitMode = 'prior' | 'scale' | 'core' | 'full';

const FIT_KEYS: Record<FitMode, Array<Exclude<keyof ModelParams, 'p0'>>> = {
  prior: [],
  scale: ['k1'],
  core: ['k1', 'k2', 'tau1'],
  full: ['k1', 'k2', 'tau1', 'tau2', 'wLow', 'wMid', 'wHigh', 'sat'],
};

/** Performance observations from rides: tests, likely-maximal efforts, and bounds. */
export function perfObservations(rides: RideRecord[]): PerfObs[] {
  const sorted = [...rides].filter((r) => r.best20 && r.best20 > 50).sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: PerfObs[] = [];
  const recent: Array<{ date: DateKey; w: number }> = [];
  const first = sorted[0]?.date;
  for (const r of sorted) {
    const w = 0.95 * r.best20!;
    while (recent.length && diffDays(recent[0].date, r.date) > 365) recent.shift();
    const best365 = recent.reduce((m, x) => Math.max(m, x.w), 0);
    let kind: PerfObs['kind'] = 'bound';
    if (r.isTest) kind = 'test';
    // Probably maximal: the athlete said so (RPE 9+), or it matches the best
    // 20-min power of the past year (once there's enough history to know).
    else if ((r.rpe ?? 0) >= 9 && r.best20! > 0) kind = 'max';
    else if (first && diffDays(first, r.date) >= 90 && w >= best365 * 0.985) kind = 'max';
    out.push({ date: r.date, watts: w, kind });
    recent.push({ date: r.date, w });
  }
  return out;
}

export function dayLoads(rides: RideRecord[]): DayLoad[] {
  return rides.map((r) => ({ date: r.date, low: r.domain.low, mid: r.domain.mid, high: r.domain.high }));
}

interface Prepared {
  start: DateKey;
  days: number;
  loads: ReturnType<typeof loadsByDate>;
  obs: Array<{ idx: number; watts: number; kind: PerfObs['kind'] }>;
}

function prepare(loads: DayLoad[], obs: PerfObs[], end: DateKey): Prepared {
  const start = loads.reduce((a, d) => (d.date < a ? d.date : a), loads[0]?.date ?? end);
  const days = diffDays(start, end) + 1;
  return {
    start,
    days,
    loads: loadsByDate(loads),
    // Performance on day d reflects the state after day d-1's load.
    obs: obs.filter((o) => o.date >= start && o.date <= end).map((o) => ({ idx: diffDays(start, o.date) - 1, watts: o.watts, kind: o.kind })),
  };
}

const SIGMA = { test: 0.02, max: 0.02, bound: 0.02 };
/** "Max" efforts are probably near-maximal but never above max: predictions above them are penalised lightly. */
const MAX_ABOVE_SIGMA = 0.05;
/** Ignore observations in the first weeks: the model state hasn't warmed up. */
const WARMUP_DAYS = 42;

function dataLoss(prep: Prepared, p: ModelParams): number {
  const { perf } = simulate(prep.start, prep.loads, prep.days, p);
  let loss = 0;
  for (const o of prep.obs) {
    if (o.idx < WARMUP_DAYS) continue;
    const pred = perf[o.idx];
    const r = (pred - o.watts) / (SIGMA[o.kind] * o.watts);
    if (o.kind === 'bound') {
      if (pred < o.watts) loss += r * r;
    } else if (o.kind === 'max' && pred > o.watts) {
      const ra = (pred - o.watts) / (MAX_ABOVE_SIGMA * o.watts);
      loss += ra * ra;
    } else loss += r * r;
  }
  return loss;
}

function priorLoss(p: ModelParams, keys: Array<Exclude<keyof ModelParams, 'p0'>>): number {
  let loss = 0;
  for (const k of keys) {
    const z = (Math.log(p[k]) - Math.log(PRIOR[k].mean)) / PRIOR[k].sd;
    loss += z * z;
  }
  return loss;
}

/**
 * Fitness typically accounts for 10-30% of a trained cyclist's FTP. Without
 * this, sparse data lets a tiny p0 and a huge k1 trade off against each other.
 */
function p0Prior(p0: number, ref: number): number {
  const z = (p0 / ref - 0.8) / 0.08;
  return z * z;
}

function toParams(x: number[], keys: Array<Exclude<keyof ModelParams, 'p0'>>, base: ModelParams): ModelParams {
  const p = { ...base, p0: x[0] };
  keys.forEach((k, i) => {
    p[k] = Math.exp(x[i + 1]);
  });
  return p;
}

/** Nelder-Mead minimiser. */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 400): { x: number[]; fx: number } {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))].map((x) => ({ x, fx: f(x) }));
  for (let it = 0; it < iters; it += 1) {
    simplex.sort((a, b) => a.fx - b.fx);
    const best = simplex[0];
    const worst = simplex[n];
    if (Math.abs(worst.fx - best.fx) < 1e-6 * (1 + Math.abs(best.fx))) break;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, v) => s + v.x[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (worst.x[j] - c));
    const r = along(-1);
    const fr = f(r);
    if (fr < best.fx) {
      const e = along(-2);
      const fe = f(e);
      simplex[n] = fe < fr ? { x: e, fx: fe } : { x: r, fx: fr };
    } else if (fr < simplex[n - 1].fx) simplex[n] = { x: r, fx: fr };
    else {
      const c = along(fr < worst.fx ? -0.5 : 0.5);
      const fc = f(c);
      if (fc < Math.min(fr, worst.fx)) simplex[n] = { x: c, fx: fc };
      else simplex = simplex.map((v, i) => (i === 0 ? v : { x: v.x.map((xj, j) => best.x[j] + 0.5 * (xj - best.x[j])), fx: NaN })).map((v) => (Number.isNaN(v.fx) ? { x: v.x, fx: f(v.x) } : v));
    }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return simplex[0];
}

export interface FitResult {
  params: ModelParams;
  /** posterior-ish samples for robust planning */
  ensemble: ModelParams[];
  mode: FitMode;
  nObs: { test: number; max: number; bound: number };
  loss: number;
}

export function fitModel(loads: DayLoad[], obs: PerfObs[], end: DateKey, mode: FitMode = 'scale', opts: { ensemble?: number; seed?: number } = {}): FitResult {
  const keys = FIT_KEYS[mode];
  const anchor = obs.filter((o) => o.kind !== 'bound');
  const p0Guess = (anchor.length ? anchor : obs).reduce((s, o) => s + o.watts, 0) / Math.max(1, (anchor.length ? anchor : obs).length) || 250;
  const base = priorParams(p0Guess);
  const prep = prepare(loads, obs, end);
  // Reference level: the best recent anchors, else the best bounds.
  const ref = Math.max(...(anchor.length ? anchor : obs).slice(-6).map((o) => o.watts), 100);
  const objective = (x: number[]) => {
    const p = toParams(x, keys, base);
    return dataLoss(prep, p) + priorLoss(p, keys) + p0Prior(p.p0, ref);
  };
  // Start p0 so the model sits on the anchors under the prior, then refine.
  const x0 = [p0Guess, ...keys.map((k) => Math.log(base[k]))];
  const { perf } = simulate(prep.start, prep.loads, prep.days, toParams(x0, keys, base));
  const anchorsIdx = prep.obs.filter((o) => o.kind !== 'bound' && o.idx >= WARMUP_DAYS);
  if (anchorsIdx.length) x0[0] += anchorsIdx.reduce((s, o) => s + (o.watts - perf[o.idx]), 0) / anchorsIdx.length;
  let best = nelderMead(objective, x0, [10, ...keys.map(() => 0.3)], 120 + 80 * keys.length);
  best = nelderMead(objective, best.x, [3, ...keys.map(() => 0.1)], 60 + 60 * keys.length);
  const params = toParams(best.x, keys, base);

  // Ensemble: importance-sample around the MAP with prior-scale perturbations,
  // re-centring p0 for each draw so the samples stay on the data.
  const ensemble: ModelParams[] = [params];
  const want = opts.ensemble ?? 0;
  if (want > 0) {
    let seed = opts.seed ?? 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
    const allKeys = Object.keys(PRIOR) as Array<Exclude<keyof ModelParams, 'p0'>>;
    const mapPerf = simulate(prep.start, prep.loads, prep.days, params).perf;
    const mapNow = mapPerf[mapPerf.length - 1];
    const draws: Array<{ p: ModelParams; w: number }> = [];
    for (let i = 0; i < want * 6; i += 1) {
      const p = { ...params };
      // Fitted dims wobble around the MAP; unfitted dims keep prior uncertainty.
      for (const k of allKeys) p[k] = params[k] * Math.exp(gauss() * PRIOR[k].sd * (keys.includes(k) ? 0.4 : 0.6));
      // Re-centre so every member agrees on today's performance: level
      // uncertainty doesn't help rank plans, response uncertainty does.
      const sim = simulate(prep.start, prep.loads, prep.days, p).perf;
      p.p0 += mapNow - sim[sim.length - 1];
      const l = dataLoss(prep, p);
      draws.push({ p, w: l });
    }
    const minL = Math.min(...draws.map((d) => d.w));
    const weighted = draws.map((d) => ({ p: d.p, w: Math.exp(-(d.w - minL) / 2) }));
    const total = weighted.reduce((s, d) => s + d.w, 0);
    // Systematic resampling.
    let u = rand() / want;
    let acc = 0;
    let j = 0;
    for (const d of weighted) {
      acc += d.w / total;
      while (u < acc && j < want - 1) {
        ensemble.push(d.p);
        u += 1 / want;
        j += 1;
      }
    }
  }
  return {
    params,
    ensemble,
    mode,
    nObs: { test: obs.filter((o) => o.kind === 'test').length, max: obs.filter((o) => o.kind === 'max').length, bound: obs.filter((o) => o.kind === 'bound').length },
    loss: best.fx,
  };
}

/** Model state at the end of the history under `p`. */
export function stateAtEnd(loads: DayLoad[], end: DateKey, p: ModelParams): ModelState {
  const prep = prepare(loads, [], end);
  const { states } = simulate(prep.start, prep.loads, prep.days, p);
  return states[states.length - 1];
}

/** Predicted performance at each of `dates` given all loads (backtesting). */
export function predictAt(loads: DayLoad[], p: ModelParams, dates: DateKey[]): number[] {
  if (!loads.length) return dates.map(() => p.p0);
  const start = loads.reduce((a, d) => (d.date < a ? d.date : a), loads[0].date);
  const last = dates.reduce((a, d) => (d > a ? d : a), dates[0]);
  const { perf } = simulate(start, loadsByDate(loads), diffDays(start, last) + 1, p);
  return dates.map((d) => perf[Math.max(0, diffDays(start, d) - 1)]);
}

export { addDays };
