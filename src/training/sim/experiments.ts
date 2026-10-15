import { addDays } from '../../engine/time';
import { type FitMode, dayLoads, fitModel, perfObservations, predictAt } from '../fit';
import { Rng } from './rng';
import { samplePopulation } from './truth';
import { SimAthlete, liveHistory, sampleHabits } from './world';

export const HISTORY_START = '2025-01-01';

export function makeAthlete(seed: number, historyDays = 365, warmup = 180) {
  const rng = new Rng(seed * 7919 + 13);
  const p = samplePopulation(rng);
  const h = sampleHabits(rng);
  const a = new SimAthlete(p, rng, addDays(HISTORY_START, -warmup));
  liveHistory(a, h, historyDays, warmup);
  return { a, h };
}

export interface BacktestRow {
  seed: number;
  mode: FitMode | 'persistence';
  mape: number;
  bias: number;
}

/** Fit on the first `trainDays` of history; predict true FTP on the rest. */
export function backtest(seeds: number[], modes: FitMode[], trainDays = 270): BacktestRow[] {
  const rows: BacktestRow[] = [];
  for (const seed of seeds) {
    const { a } = makeAthlete(seed);
    const cutoff = addDays(HISTORY_START, trainDays);
    const train = a.rides.filter((r) => r.date <= cutoff);
    const obs = perfObservations(train);
    const evalDays = a.truth.filter((t) => t.date > cutoff && t.date.slice(8) === '15' || (t.date > cutoff && t.date.slice(8) === '01'));
    const dates = evalDays.map((t) => t.date);
    const truth = evalDays.map((t) => t.ftp);
    const score = (pred: number[]) => {
      const errs = pred.map((p, i) => (p - truth[i]) / truth[i]);
      return { mape: errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length, bias: errs.reduce((s, e) => s + e, 0) / errs.length };
    };
    // Persistence: best test/max-quality estimate in the last 60 days, else set FTP.
    const recent = obs.filter((o) => o.kind !== 'bound' && o.date > addDays(cutoff, -60));
    const persist = recent.length ? Math.max(...recent.map((o) => o.watts)) : (train.at(-1)?.ftpSet ?? 250);
    rows.push({ seed, mode: 'persistence', ...score(dates.map(() => persist)) });
    const allLoads = dayLoads(a.rides);
    for (const mode of modes) {
      const fit = fitModel(dayLoads(train), obs, cutoff, mode);
      rows.push({ seed, mode, ...score(predictAt(allLoads, fit.params, dates)) });
    }
  }
  return rows;
}

export function summarize<T extends { mode: string }>(rows: T[], key: keyof T): Record<string, { mean: number; median: number; p90: number }> {
  const out: Record<string, { mean: number; median: number; p90: number }> = {};
  for (const mode of [...new Set(rows.map((r) => r.mode))]) {
    const v = rows.filter((r) => r.mode === mode).map((r) => r[key] as unknown as number).sort((a, b) => a - b);
    out[mode] = { mean: v.reduce((s, x) => s + x, 0) / v.length, median: v[Math.floor(v.length / 2)], p90: v[Math.floor(v.length * 0.9)] };
  }
  return out;
}
