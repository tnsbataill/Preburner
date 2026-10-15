import type { DomainLoad } from '../types';
import type { FitSample } from './fit-file';

// FTP-independent ride summary. Raw streams are reduced to a histogram of
// 30-second rolling power (10 W bins) plus best efforts, so TSS and the
// per-domain split can be recomputed for whatever FTP applied at the time.

export const BIN_W = 10;
export const BEST_WINDOWS = [60, 180, 300, 480, 1200, 3600] as const;

export interface RideSummary {
  movingS: number;
  /** seconds per 10 W bin of 30 s rolling power, keyed by bin index */
  hist: Record<number, number>;
  best: Partial<Record<(typeof BEST_WINDOWS)[number], number>>;
  avgPower?: number;
  avgHr?: number;
  hasPower: boolean;
}

/** 1 Hz power series from samples: short gaps carry forward, long gaps are dropped (paused). */
export function toSeries(samples: FitSample[], maxGapS = 10): { power: number[]; hr: number[] } {
  const power: number[] = [];
  const hr: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const next = samples[i + 1];
    const span = next ? Math.max(1, Math.min(next.t - s.t, maxGapS)) : 1;
    for (let k = 0; k < span; k += 1) {
      power.push(s.power ?? 0);
      hr.push(s.hr ?? 0);
    }
  }
  return { power, hr };
}

export function summarize(samples: FitSample[]): RideSummary {
  const { power, hr } = toSeries(samples);
  const hasPower = samples.some((s) => (s.power ?? 0) > 0);
  const hist: Record<number, number> = {};
  const best: RideSummary['best'] = {};
  if (hasPower && power.length) {
    // 30 s rolling mean (shorter at the start)
    let sum = 0;
    for (let i = 0; i < power.length; i += 1) {
      sum += power[i];
      if (i >= 30) sum -= power[i - 30];
      const roll = sum / Math.min(i + 1, 30);
      const b = Math.round(roll / BIN_W);
      hist[b] = (hist[b] ?? 0) + 1;
    }
    for (const w of BEST_WINDOWS) {
      if (power.length < w) continue;
      let s = 0;
      for (let i = 0; i < w; i += 1) s += power[i];
      let m = s;
      for (let i = w; i < power.length; i += 1) {
        s += power[i] - power[i - w];
        if (s > m) m = s;
      }
      best[w] = Math.round(m / w);
    }
  }
  const hrs = hr.filter((x) => x > 0);
  return {
    movingS: power.length,
    hist,
    best,
    avgPower: hasPower ? Math.round(power.reduce((a, b) => a + b, 0) / power.length) : undefined,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined,
    hasPower,
  };
}

/** NP, IF, TSS and per-domain TSS for a given FTP, from the histogram. */
export function loadFor(sum: RideSummary, ftp: number): { np: number; ifactor: number; tss: number; domain: DomainLoad } {
  const entries = Object.entries(sum.hist).map(([b, s]) => [Number(b) * BIN_W, s] as const);
  const T = entries.reduce((a, [, s]) => a + s, 0);
  if (!T || !ftp) return { np: 0, ifactor: 0, tss: 0, domain: { low: 0, mid: 0, high: 0 } };
  const p4 = entries.reduce((a, [p, s]) => a + p ** 4 * s, 0);
  const np = (p4 / T) ** 0.25;
  const ifactor = np / ftp;
  const tss = (T / 3600) * ifactor * ifactor * 100;
  const raw: DomainLoad = { low: 0, mid: 0, high: 0 };
  for (const [p, s] of entries) {
    const rel = p / ftp;
    raw[rel < 0.76 ? 'low' : rel <= 1.05 ? 'mid' : 'high'] += p ** 4 * s;
  }
  const tot = raw.low + raw.mid + raw.high || 1;
  return { np, ifactor, tss, domain: { low: (tss * raw.low) / tot, mid: (tss * raw.mid) / tot, high: (tss * raw.high) / tot } };
}

/**
 * Ride without power: estimate load from heart rate when we have it (a
 * simple %HRmax-to-IF mapping), else assume endurance pace (IF 0.65).
 */
export function loadWithoutPower(movingS: number, avgHr?: number, maxHr?: number): { tss: number; domain: DomainLoad; ifactor: number } {
  let ifactor = 0.65;
  if (avgHr && maxHr && maxHr > 120) {
    const frac = avgHr / maxHr;
    ifactor = Math.max(0.45, Math.min(1.0, 0.65 + (frac - 0.72) * 1.6));
  }
  const tss = (movingS / 3600) * ifactor * ifactor * 100;
  const domain: DomainLoad = ifactor < 0.76 ? { low: tss, mid: 0, high: 0 } : { low: tss * 0.5, mid: tss * 0.5, high: 0 };
  return { tss, domain, ifactor };
}
