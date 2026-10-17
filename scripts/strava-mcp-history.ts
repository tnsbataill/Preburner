import { existsSync, readFileSync } from 'node:fs';
import type { RideRecord } from '../src/training/history/types';

// Build snapshots/history.json from the Strava data pulled through the Strava
// connector (snapshots/strava-mcp/: rides.tsv plus power streams). Personal data:
// everything lives in snapshots/, which is gitignored.
//
// FTP on each date comes from ramp tests and the targets of TrainerRoad
// workouts (over-unders pin FTP down exactly); in between it's held flat.

// Known FTP values (tests, TrainerRoad targets, settings) live with the other
// personal data: snapshots/ftp-points.json, [date, watts, source][].
export const FTP_POINTS: Array<[string, number, string]> = existsSync('snapshots/ftp-points.json') ? JSON.parse(readFileSync('snapshots/ftp-points.json', 'utf8')) : [];

export function ftpAt(date: string): number {
  let f = FTP_POINTS[0]?.[1] ?? 250;
  for (const [d, v] of FTP_POINTS) if (date >= d) f = v;
  return f;
}

type Load = { tss: number; domain: RideRecord['domain']; best20?: number };
type Kind = 'trainer' | 'virtual' | 'outdoor' | 'mtb';
const kindOf = (sport: string, trainer: string): Kind =>
  trainer === '1' ? 'trainer' : sport === 'VirtualRide' ? 'virtual' : sport === 'MountainBikeRide' ? 'mtb' : 'outdoor';

const tsv = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t')) : []);
const mean = (w: number[]) => w.reduce((a, b) => a + b, 0) / Math.max(1, w.length);
const rolling = (w: number[], k: number) => {
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < w.length; i += 1) {
    s += w[i] - (i >= k ? w[i - k] : 0);
    out.push(s / Math.min(k, i + 1));
  }
  return out;
};

// Load from a power stream sampled every dt seconds: NP and the domain split
// from 30 s rolling power, as TSS is normally computed. With a coarse stream
// (dt >= 30 s) the samples are used as they are: fine for steady ERG sessions,
// checked against 20 s streams (NP within 0.4%, domain split within 2 points).
// Each coarse sample stands for a minute or more, so it is capped at 150% FTP
// (about the best 1-min power): one sprint or spike would otherwise weigh a
// whole minute in the 4th-power average.
// Downsampled streams are point samples, so one sample at a sprint or a
// power-meter spike would stand in for 10-20 s: a 3-point median drops lone
// samples and keeps anything held for two samples or more.
const median3 = (w: number[]) => w.map((x, i) => (i === 0 || i === w.length - 1 ? x : [w[i - 1], x, w[i + 1]].sort((a, b) => a - b)[1]));

function fromStream(w: number[], dt: number, hours: number, ftp: number): Load {
  const p = dt < 30 ? rolling(dt >= 5 ? median3(w) : w, Math.round(30 / dt)) : w.map((x) => Math.min(x, 1.5 * ftp));
  const np = mean(p.map((x) => x ** 4)) ** 0.25;
  const tss = hours * (np / ftp) ** 2 * 100;
  const raw = { low: 0, mid: 0, high: 0 };
  for (const x of p) raw[x / ftp < 0.76 ? 'low' : x / ftp <= 1.05 ? 'mid' : 'high'] += x ** 4;
  const tot = raw.low + raw.mid + raw.high || 1;
  let best20: number | undefined;
  const win = Math.round(1200 / dt);
  for (let i = 0, s = 0; i < w.length; i += 1) {
    s += w[i] - (i >= win ? w[i - win] : 0);
    if (i >= win - 1) best20 = Math.max(best20 ?? 0, s / win);
  }
  return { tss, domain: { low: (tss * raw.low) / tot, mid: (tss * raw.mid) / tot, high: (tss * raw.high) / tot }, best20 };
}

// Rides without a usable stream are estimated from Strava's kcal (= kJ of
// work for power rides): average power x a variability index, and a domain
// split by intensity. Both are calibrated on this rider's streamed rides of the
// same kind, so the whole history sits on one footing. The fixed defaults
// below are the fallback (and all there is for MTB, whose kcal is an HR guess).
const DEFAULT_VI: Record<Kind, number> = { trainer: 1.05, virtual: 1.08, outdoor: 1.12, mtb: 1.25 };
const defaultSplit = (ifactor: number) => (ifactor < 0.7 ? [1, 0, 0] : ifactor < 0.8 ? [0.75, 0.25, 0] : ifactor < 0.88 ? [0.55, 0.4, 0.05] : [0.4, 0.5, 0.1]);
const IF_EDGES = [0.7, 0.8];
const bucket = (ifactor: number) => IF_EDGES.filter((e) => ifactor >= e).length;

export interface Calibration {
  vi: Record<Kind, number>;
  /** [kind][IF bucket] -> TSS-weighted low/mid/high shares, when >= 3 streamed rides */
  split: Partial<Record<Kind, Array<number[] | undefined>>>;
  n: Record<Kind, number>;
}

function calibrate(measured: Array<{ kind: Kind; avgKcalW: number; ftp: number; load: Load; np: number }>): Calibration {
  const vi = { ...DEFAULT_VI };
  const n = { trainer: 0, virtual: 0, outdoor: 0, mtb: 0 };
  const split: Calibration['split'] = {};
  for (const kind of ['trainer', 'virtual', 'outdoor'] as const) {
    const rs = measured.filter((m) => m.kind === kind && m.avgKcalW > 0);
    n[kind] = rs.length;
    if (rs.length < 5) continue;
    const ratios = rs.map((m) => m.np / m.avgKcalW).sort((a, b) => a - b);
    vi[kind] = ratios[Math.floor(ratios.length / 2)];
    split[kind] = [0, 1, 2].map((b) => {
      const inB = rs.filter((m) => bucket(Math.min(1.05, (m.avgKcalW * vi[kind]) / m.ftp)) === b);
      if (inB.length < 3) return undefined;
      const d = inB.reduce((a, m) => [a[0] + m.load.domain.low, a[1] + m.load.domain.mid, a[2] + m.load.domain.high], [0, 0, 0]);
      const t = d[0] + d[1] + d[2] || 1;
      return d.map((x) => x / t);
    });
  }
  return { vi, split, n };
}

function fromKcal(kind: Kind, kcal: number, secs: number, ftp: number, cal: Calibration): Load {
  const hours = secs / 3600;
  const avg = (kcal * 1000) / Math.max(1, secs);
  const ifactor = Math.max(0.45, Math.min(1.05, (avg * cal.vi[kind]) / ftp));
  const tss = hours * ifactor * ifactor * 100;
  const sp = cal.split[kind]?.[bucket(ifactor)] ?? defaultSplit(ifactor);
  return { tss, domain: { low: tss * sp[0], mid: tss * sp[1], high: tss * sp[2] } };
}

/** How each ride's load was found, for reporting. */
export type LoadSource = 'stream' | 'samples' | 'kcal';
export let lastBuild: { calibration: Calibration; sources: Record<LoadSource, number> } | undefined;

export function buildHistory(dir = 'snapshots/strava-mcp'): RideRecord[] {
  const lines = tsv(`${dir}/rides.tsv`);
  // Streams, best first: hires-watts.tsv (10-15 s, every ride with power in the
  // two peak builds),
  // streams.tsv (20-30 s), block-watts.tsv (60 evenly spaced samples).
  // 60 point samples are only trusted indoors: outdoors they overstate
  // the time above threshold (checked against 10 s streams).
  const hires = new Map(tsv(`${dir}/hires-watts.tsv`).map(([id, w]) => [id, w.split(',').map(Number)]));
  const streams = new Map(tsv(`${dir}/streams.tsv`).map(([id, dt, w]) => [id, { dt: Number(dt), w: w.split(',').map(Number) }]));
  const samples = new Map(tsv(`${dir}/block-watts.tsv`).filter((r) => r[1]).map(([id, w]) => [id, w.split(',').map(Number)]));
  const rows = lines.map(([id, start, sport, trainer, movingS, kcal, , name]) => ({ id, start, kind: kindOf(sport, trainer), secs: Number(movingS), kcal: Number(kcal), name, ftp: ftpAt(start.slice(0, 10)) }));
  const measured = new Map<string, { load: Load; np: number; source: LoadSource }>();
  for (const r of rows) {
    const hours = r.secs / 3600;
    const h = hires.get(r.id);
    const s = streams.get(r.id);
    const w60 = samples.get(r.id);
    let load: Load | undefined;
    let source: LoadSource = 'stream';
    if (h?.length) load = fromStream(h, r.secs / h.length, hours, r.ftp);
    else if (s) load = fromStream(s.w, s.dt, hours, r.ftp);
    else if (w60?.length && r.kind === 'trainer') {
      load = fromStream(w60, r.secs / w60.length, hours, r.ftp);
      load.best20 = undefined; // 60 samples can't place a 20 min best
      source = 'samples';
    }
    if (load) measured.set(r.id, { load, np: Math.sqrt(load.tss / 100 / hours) * r.ftp, source });
  }
  const cal = calibrate(rows.filter((r) => measured.has(r.id)).map((r) => ({ kind: r.kind, avgKcalW: (r.kcal * 1000) / Math.max(1, r.secs), ftp: r.ftp, ...measured.get(r.id)! })));
  const sources: Record<LoadSource, number> = { stream: 0, samples: 0, kcal: 0 };
  const out: RideRecord[] = [];
  for (const r of rows) {
    const m = measured.get(r.id);
    const load = m?.load ?? fromKcal(r.kind, r.kcal, r.secs, r.ftp, cal);
    sources[m?.source ?? 'kcal'] += 1;
    const date = r.start.slice(0, 10);
    out.push({
      id: `strava-${r.id}`,
      date,
      startMin: Number(r.start.slice(11, 13)) * 60 + Number(r.start.slice(14, 16)),
      durationMin: Math.round(r.secs / 60),
      tss: Math.round(load.tss),
      domain: { low: Math.round(load.domain.low), mid: Math.round(load.domain.mid), high: Math.round(load.domain.high) },
      ftpSet: r.ftp,
      best20: load.best20,
      isTest: /ramp test/i.test(r.name),
      ...(!m && { estimated: true }),
      source: 'strava',
    });
  }
  lastBuild = { calibration: cal, sources };
  // Known FTP values become test observations on their dates.
  for (const [d, v, why] of FTP_POINTS) {
    const r = out.find((x) => x.date === d && x.isTest);
    if (r) r.best20 = v / 0.95;
    else out.push({ id: `ftp-${d}`, date: d, durationMin: 0, tss: 0, domain: { low: 0, mid: 0, high: 0 }, ftpSet: v, best20: v / 0.95, isTest: true, source: 'strava', kind: why });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
