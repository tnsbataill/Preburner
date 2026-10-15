import { existsSync, readFileSync } from 'node:fs';
import type { RideRecord } from '../src/training/history/types';

// Build snapshots/history.json from the Strava data pulled through the Strava
// connector (snapshots/strava-mcp/rides.tsv + streams.tsv). Personal data:
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

const VI: Record<string, number> = { trainer: 1.05, VirtualRide: 1.08, Ride: 1.12, GravelRide: 1.15, MountainBikeRide: 1.25 };

function load(ifactor: number, hours: number) {
  const tss = hours * ifactor * ifactor * 100;
  const split = ifactor < 0.7 ? [1, 0, 0] : ifactor < 0.8 ? [0.75, 0.25, 0] : ifactor < 0.88 ? [0.55, 0.4, 0.05] : [0.4, 0.5, 0.1];
  return { tss, domain: { low: tss * split[0], mid: tss * split[1], high: tss * split[2] } };
}

export function buildHistory(dir = 'snapshots/strava-mcp'): RideRecord[] {
  const lines = readFileSync(`${dir}/rides.tsv`, 'utf8').trim().split('\n').slice(1);
  const streams = new Map<string, { dt: number; w: number[] }>();
  for (const l of readFileSync(`${dir}/streams.tsv`, 'utf8').trim().split('\n').slice(1)) {
    const [id, dt, w] = l.split('\t');
    streams.set(id, { dt: Number(dt), w: w.split(',').map(Number) });
  }
  const out: RideRecord[] = [];
  for (const l of lines) {
    const [id, start, sport, trainer, movingS, kcal, , name] = l.split('\t');
    const date = start.slice(0, 10);
    const ftp = ftpAt(date);
    const secs = Number(movingS);
    const hours = secs / 3600;
    const s = streams.get(id);
    let tss: number;
    let domain: RideRecord['domain'];
    let best20: number | undefined;
    if (s) {
      // Evenly sampled stream: exact intensity distribution.
      const n = s.w.length;
      const np = (s.w.reduce((a, x) => a + x ** 4, 0) / n) ** 0.25;
      tss = hours * (np / ftp) ** 2 * 100;
      const raw = { low: 0, mid: 0, high: 0 };
      for (const x of s.w) raw[x / ftp < 0.76 ? 'low' : x / ftp <= 1.05 ? 'mid' : 'high'] += x ** 4;
      const tot = raw.low + raw.mid + raw.high || 1;
      domain = { low: (tss * raw.low) / tot, mid: (tss * raw.mid) / tot, high: (tss * raw.high) / tot };
      const win = Math.round(1200 / s.dt);
      for (let i = 0; i + win <= n; i += 1) {
        const m = s.w.slice(i, i + win).reduce((a, b) => a + b, 0) / win;
        best20 = Math.max(best20 ?? 0, m);
      }
    } else {
      // Strava reports work in kJ as kcal for power rides; MTB calories are HR estimates.
      const avg = (Number(kcal) * 1000) / Math.max(1, secs);
      const vi = trainer === '1' ? VI.trainer : (VI[sport] ?? 1.12);
      const ifactor = Math.max(0.45, Math.min(1.05, (avg * vi) / ftp));
      ({ tss, domain } = load(ifactor, hours));
    }
    out.push({
      id: `strava-${id}`,
      date,
      startMin: Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16)),
      durationMin: Math.round(secs / 60),
      tss: Math.round(tss),
      domain: { low: Math.round(domain.low), mid: Math.round(domain.mid), high: Math.round(domain.high) },
      ftpSet: ftp,
      best20,
      isTest: /ramp test/i.test(name),
      source: 'strava',
    });
  }
  // Known FTP values become test observations on their dates.
  for (const [d, v, why] of FTP_POINTS) {
    const r = out.find((x) => x.date === d && x.isTest);
    if (r) r.best20 = v / 0.95;
    else out.push({ id: `ftp-${d}`, date: d, durationMin: 0, tss: 0, domain: { low: 0, mid: 0, high: 0 }, ftpSet: v, best20: v / 0.95, isTest: true, source: 'strava', kind: why });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
