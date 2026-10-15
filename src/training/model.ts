import { addDays, diffDays } from '../engine/time';
import type { DateKey } from '../engine/types';
import type { DomainLoad } from './types';

// Planning model: a Banister-style fitness-fatigue model with three changes
// that the literature and our simulations argue for:
//   1. Fitness is tracked per intensity domain with per-domain gains, so the
//      optimizer can trade sweet spot against VO2 work for *this* athlete.
//   2. Each domain's contribution saturates, giving diminishing returns on
//      volume (Cove et al.: beyond a necessary volume, more doesn't help).
//   3. Fatigue gets a variable-dose gain (Busso 2003): heavy recent load makes
//      each extra unit of load more costly.
// Performance is in watts of FTP.

export interface DayLoad extends DomainLoad {
  date: DateKey;
}

export interface ModelParams {
  /** baseline FTP with zero fitness */
  p0: number;
  /** overall fitness gain, watts per (saturated) unit of fitness */
  k1: number;
  /** relative domain weights; mean of the three is 1 */
  wLow: number;
  wMid: number;
  wHigh: number;
  /** fatigue gain, watts per unit of ATL */
  k2: number;
  /** fitness and fatigue time constants (days) */
  tau1: number;
  tau2: number;
  /** saturation constant (TSS/day per domain-weighted fitness) */
  sat: number;
  /** variable-dose: fatigue gain grows by this per unit of 14-day load above 'busso0' */
  busso: number;
}

/** Population prior: means and log-scale SDs (except p0, which is fit freely). */
export const PRIOR: Record<Exclude<keyof ModelParams, 'p0'>, { mean: number; sd: number }> = {
  k1: { mean: 1.6, sd: 0.5 },
  wLow: { mean: 0.8, sd: 0.3 },
  wMid: { mean: 1.1, sd: 0.3 },
  wHigh: { mean: 1.2, sd: 0.35 },
  k2: { mean: 0.5, sd: 0.45 },
  tau1: { mean: 42, sd: 0.25 },
  tau2: { mean: 7, sd: 0.3 },
  sat: { mean: 150, sd: 0.4 },
  busso: { mean: 0.004, sd: 0.6 },
};

export function priorParams(p0: number): ModelParams {
  return {
    p0,
    k1: PRIOR.k1.mean,
    wLow: PRIOR.wLow.mean,
    wMid: PRIOR.wMid.mean,
    wHigh: PRIOR.wHigh.mean,
    k2: PRIOR.k2.mean,
    tau1: PRIOR.tau1.mean,
    tau2: PRIOR.tau2.mean,
    sat: PRIOR.sat.mean,
    busso: PRIOR.busso.mean,
  };
}

export interface ModelState {
  fLow: number;
  fMid: number;
  fHigh: number;
  atl: number;
  /** 14-day load EWMA for the variable-dose fatigue term */
  l14: number;
}

export const ZERO_STATE: ModelState = { fLow: 0, fMid: 0, fHigh: 0, atl: 0, l14: 0 };

export function step(s: ModelState, load: DomainLoad, p: ModelParams): ModelState {
  const total = load.low + load.mid + load.high;
  return {
    fLow: s.fLow + (load.low - s.fLow) / p.tau1,
    fMid: s.fMid + (load.mid - s.fMid) / p.tau1,
    fHigh: s.fHigh + (load.high - s.fHigh) / p.tau1,
    atl: s.atl + (total - s.atl) / p.tau2,
    l14: s.l14 + (total - s.l14) / 14,
  };
}

const BUSSO_REF = 60;

export function performance(s: ModelState, p: ModelParams): number {
  // Domain-weighted fitness, then a saturating transform.
  const wSum = (p.wLow + p.wMid + p.wHigh) / 3;
  const f = (p.wLow * s.fLow + p.wMid * s.fMid + p.wHigh * s.fHigh) / wSum;
  const fit = (p.sat * f) / (p.sat + f);
  const k2 = p.k2 * (1 + p.busso * Math.max(0, s.l14 - BUSSO_REF));
  return p.p0 + p.k1 * fit - k2 * s.atl;
}

/** Run the model over consecutive days; returns perf after each day's load. */
export function simulate(
  start: DateKey,
  loads: Map<DateKey, DomainLoad>,
  days: number,
  p: ModelParams,
  init: ModelState = ZERO_STATE,
): { states: ModelState[]; perf: number[] } {
  const states: ModelState[] = [];
  const perf: number[] = [];
  let s = init;
  for (let i = 0; i < days; i += 1) {
    const l = loads.get(addDays(start, i)) ?? { low: 0, mid: 0, high: 0 };
    s = step(s, l, p);
    states.push(s);
    perf.push(performance(s, p));
  }
  return { states, perf };
}

export function loadsByDate(days: DayLoad[]): Map<DateKey, DomainLoad> {
  const m = new Map<DateKey, DomainLoad>();
  for (const d of days) {
    const cur = m.get(d.date) ?? { low: 0, mid: 0, high: 0 };
    m.set(d.date, { low: cur.low + d.low, mid: cur.mid + d.mid, high: cur.high + d.high });
  }
  return m;
}

/** Model state at the end of `history` (warm start for planning). */
export function stateAt(history: DayLoad[], end: DateKey, p: ModelParams): ModelState {
  if (!history.length) return ZERO_STATE;
  const first = history.reduce((a, d) => (d.date < a ? d.date : a), history[0].date);
  const n = diffDays(first, end) + 1;
  if (n <= 0) return ZERO_STATE;
  const { states } = simulate(first, loadsByDate(history), n, p);
  return states[states.length - 1];
}

/** Classic CTL/ATL (42/7) from domain loads, for reporting and constraints. */
export function pmc(start: DateKey, loads: Map<DateKey, DomainLoad>, days: number, ctl0 = 0, atl0 = 0) {
  const out: Array<{ date: DateKey; load: number; ctl: number; atl: number }> = [];
  let ctl = ctl0;
  let atl = atl0;
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const l = loads.get(date);
    const load = l ? l.low + l.mid + l.high : 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    out.push({ date, load, ctl, atl });
  }
  return out;
}
