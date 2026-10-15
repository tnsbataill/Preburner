import { gunzipSync } from 'fflate';
import { addDays, diffDays } from '../../engine/time';
import type { DateKey } from '../../engine/types';
import { decodeFit, type FitSample } from './fit-file';
import { type RideSummary, loadFor, loadWithoutPower, summarize } from './metrics';
import type { RideRecord } from './types';

// Strava bulk export ("Download your archive") -> RideRecord[].
// The archive holds activities.csv plus activities/<id>.fit(.gz) | .tcx(.gz) |
// .gpx(.gz). Strava activities can't come through the Intervals API, so this
// is the only way to get that history into Preburner.
//
// Strava doesn't know the FTP you had on each date, so we estimate it after
// the fact: a rolling 90-day best of 0.95 x 20-min power (or 0.8 x 5-min),
// preferring the FTP a Garmin head unit wrote into the file when present.

export interface ArchiveActivity {
  id: string;
  /** local date of the start */
  date: DateKey;
  /** local start, minutes after midnight */
  startMin?: number;
  type: string;
  name?: string;
  movingS: number;
  rpe?: number;
  avgHr?: number;
  maxHr?: number;
  summary?: RideSummary;
  /** FTP from the device file */
  deviceFtp?: number;
  /** Strava's own average/weighted power from the CSV, used when there's no file */
  csvAvgPower?: number;
  csvWeightedPower?: number;
}

const RIDE = /ride|cycl|bike/i;
const EBIKE = /e-?bike|ebike/i;

/** RFC 4180-ish CSV parser (quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0]);
}

/** Parse Strava's "Oct 3, 2024, 2:15:31 PM" (UTC) into a Date. */
export function parseStravaDate(s: string): Date | undefined {
  const d = new Date(`${s.replace(/,(\s*\d{1,2}:)/, '$1')} UTC`);
  if (!Number.isNaN(d.getTime())) return d;
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? undefined : iso;
}

/** Local date/minutes of a UTC instant in an IANA zone. */
export function localParts(utcMs: number, timeZone?: string): { date: DateKey; min: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

export interface CsvColumns {
  id: number;
  date: number;
  type: number;
  name: number;
  moving: number;
  elapsed: number;
  filename: number;
  rpe: number;
  avgHr: number;
  maxHr: number;
  avgW: number;
  weightedW: number;
}

/** Find columns by header name. Strava repeats some headers; the first match wins. */
export function csvColumns(header: string[]): CsvColumns {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  return {
    id: find(/^Activity ID$/i),
    date: find(/^Activity Date$/i),
    type: find(/^Activity Type$/i),
    name: find(/^Activity Name$/i),
    moving: find(/^Moving Time$/i),
    elapsed: find(/^Elapsed Time$/i),
    filename: find(/^Filename$/i),
    rpe: find(/^Perceived Exertion$/i),
    avgHr: find(/^Average Heart Rate$/i),
    maxHr: find(/^Max Heart Rate$/i),
    avgW: find(/^Average Watts$/i),
    weightedW: find(/^Weighted Average Power$/i),
  };
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : undefined;
};

/** TCX trackpoints -> samples (power from the TPX extension). */
export function parseTcx(xml: string): FitSample[] {
  const out: FitSample[] = [];
  const re = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tp = m[1];
    const time = /<Time>([^<]+)<\/Time>/.exec(tp)?.[1];
    if (!time) continue;
    const t = Math.round(Date.parse(time) / 1000);
    const w = /<(?:\w+:)?Watts>(\d+)<\/(?:\w+:)?Watts>/.exec(tp)?.[1];
    const hr = /<HeartRateBpm>\s*<Value>(\d+)<\/Value>/.exec(tp)?.[1];
    const cad = /<Cadence>(\d+)<\/Cadence>/.exec(tp)?.[1];
    out.push({ t, power: w ? Number(w) : undefined, hr: hr ? Number(hr) : undefined, cadence: cad ? Number(cad) : undefined });
  }
  return out;
}

/** GPX trackpoints -> samples (power/HR from common extensions). */
export function parseGpx(xml: string): FitSample[] {
  const out: FitSample[] = [];
  const re = /<trkpt\b[\s\S]*?<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tp = m[0];
    const time = /<time>([^<]+)<\/time>/.exec(tp)?.[1];
    if (!time) continue;
    const w = /<(?:\w+:)?power>(\d+)<\/(?:\w+:)?power>/i.exec(tp)?.[1];
    const hr = /<(?:\w+:)?hr>(\d+)<\/(?:\w+:)?hr>/i.exec(tp)?.[1];
    out.push({ t: Math.round(Date.parse(time) / 1000), power: w ? Number(w) : undefined, hr: hr ? Number(hr) : undefined });
  }
  return out;
}

/** Decode one activity file (possibly gzipped) into samples + device metadata. */
export function readActivityFile(name: string, data: Uint8Array): { samples: FitSample[]; utcOffsetS?: number; deviceFtp?: number } {
  let bytes = data;
  let n = name.toLowerCase();
  if (n.endsWith('.gz')) {
    bytes = gunzipSync(data);
    n = n.slice(0, -3);
  }
  if (n.endsWith('.fit')) {
    const fit = decodeFit(bytes);
    return { samples: fit.samples, utcOffsetS: fit.utcOffsetS, deviceFtp: fit.thresholdPower };
  }
  const text = new TextDecoder().decode(bytes);
  if (n.endsWith('.tcx')) return { samples: parseTcx(text.trimStart()) };
  if (n.endsWith('.gpx')) return { samples: parseGpx(text) };
  return { samples: [] };
}

export interface ArchiveReader {
  /** activities.csv text */
  csv: string;
  /** fetch an activity file by the path in the CSV's Filename column */
  file(path: string): Uint8Array | undefined;
}

export interface ImportReport {
  activities: number;
  rides: number;
  withPower: number;
  withFile: number;
  withRpe: number;
  skipped: Record<string, number>;
  first?: DateKey;
  last?: DateKey;
}

/** Read the archive's cycling activities into FTP-independent summaries. */
export function readArchive(reader: ArchiveReader, timeZone?: string, onProgress?: (done: number, total: number) => void): { activities: ArchiveActivity[]; report: ImportReport } {
  const rows = parseCsv(reader.csv);
  const header = rows[0] ?? [];
  const col = csvColumns(header);
  if (col.id < 0 || col.date < 0) throw new Error('activities.csv is missing Activity ID / Activity Date columns');
  const report: ImportReport = { activities: rows.length - 1, rides: 0, withPower: 0, withFile: 0, withRpe: 0, skipped: {} };
  const skip = (why: string) => (report.skipped[why] = (report.skipped[why] ?? 0) + 1);
  const out: ArchiveActivity[] = [];
  rows.slice(1).forEach((r, i) => {
    onProgress?.(i, rows.length - 1);
    const type = r[col.type] ?? '';
    if (!RIDE.test(type) || EBIKE.test(type)) return skip(type || 'unknown type');
    const when = parseStravaDate(r[col.date] ?? '');
    if (!when) return skip('bad date');
    const movingS = num(r[col.moving]) ?? num(r[col.elapsed]) ?? 0;
    if (movingS < 300) return skip('under 5 min');
    let summary: RideSummary | undefined;
    let utcOffsetS: number | undefined;
    let deviceFtp: number | undefined;
    const fname = col.filename >= 0 ? r[col.filename] : '';
    if (fname) {
      const data = reader.file(fname);
      if (data) {
        try {
          const f = readActivityFile(fname, data);
          if (f.samples.length > 60) {
            summary = summarize(f.samples);
            report.withFile += 1;
          }
          utcOffsetS = f.utcOffsetS;
          deviceFtp = f.deviceFtp;
        } catch {
          skip('unreadable file');
        }
      }
    }
    const local = utcOffsetS !== undefined ? localParts(when.getTime() + utcOffsetS * 1000, 'UTC') : localParts(when.getTime(), timeZone);
    const rpe = col.rpe >= 0 ? num(r[col.rpe]) : undefined;
    out.push({
      id: `strava-${r[col.id]}`,
      date: local.date,
      startMin: local.min,
      type,
      name: col.name >= 0 ? r[col.name] : undefined,
      movingS: summary?.movingS && summary.movingS > 0 ? Math.min(summary.movingS, movingS * 1.5) : movingS,
      rpe: rpe && rpe >= 1 && rpe <= 10 ? rpe : undefined,
      avgHr: summary?.avgHr ?? (col.avgHr >= 0 ? num(r[col.avgHr]) : undefined),
      maxHr: col.maxHr >= 0 ? num(r[col.maxHr]) : undefined,
      summary,
      deviceFtp: deviceFtp && deviceFtp > 50 && deviceFtp < 600 ? deviceFtp : undefined,
      csvAvgPower: col.avgW >= 0 ? num(r[col.avgW]) : undefined,
      csvWeightedPower: col.weightedW >= 0 ? num(r[col.weightedW]) : undefined,
    });
    report.rides += 1;
    if (summary?.hasPower || out.at(-1)!.csvWeightedPower) report.withPower += 1;
    if (out.at(-1)!.rpe) report.withRpe += 1;
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.startMin ?? 0) - (b.startMin ?? 0)));
  report.first = out[0]?.date;
  report.last = out.at(-1)?.date;
  return { activities: out, report };
}

/** Effort-based FTP estimate from one ride's best powers. */
export function rideFtpEstimate(a: ArchiveActivity): number | undefined {
  const b = a.summary?.best;
  if (!b) return undefined;
  const est = Math.max(b[1200] ? 0.95 * b[1200] : 0, b[300] ? 0.8 * b[300] : 0, b[3600] ? b[3600] : 0);
  return est > 50 ? est : undefined;
}

/**
 * Turn summaries into RideRecords: FTP per date from the device when known,
 * else the 90-day rolling best effort estimate (looking forward for the first
 * 90 days, where there's no past to look at).
 */
export function toRideRecords(acts: ArchiveActivity[], fallbackFtp: number): RideRecord[] {
  const ests = acts.map((a) => ({ date: a.date, est: rideFtpEstimate(a) })).filter((x): x is { date: DateKey; est: number } => x.est !== undefined);
  const maxHr = Math.max(0, ...acts.map((a) => a.maxHr ?? 0)) || undefined;
  const first = acts[0]?.date;
  const ftpAt = (date: DateKey): number => {
    const from = first && diffDays(first, date) < 90 ? first : addDays(date, -90);
    const to = first && diffDays(first, date) < 90 ? addDays(first, 90) : addDays(date, -1);
    const inWin = ests.filter((e) => e.date >= from && e.date <= to).map((e) => e.est);
    return inWin.length ? Math.round(Math.max(...inWin)) : fallbackFtp;
  };
  return acts.map((a) => {
    const ftpSet = a.deviceFtp ?? ftpAt(a.date);
    let tss: number;
    let domain: RideRecord['domain'];
    if (a.summary?.hasPower) ({ tss, domain } = loadFor(a.summary, ftpSet));
    else if (a.csvWeightedPower && a.csvWeightedPower > 0) {
      const ifactor = a.csvWeightedPower / ftpSet;
      tss = (a.movingS / 3600) * ifactor * ifactor * 100;
      domain = ifactor < 0.76 ? { low: tss, mid: 0, high: 0 } : ifactor < 0.95 ? { low: tss * 0.4, mid: tss * 0.6, high: 0 } : { low: tss * 0.3, mid: tss * 0.5, high: tss * 0.2 };
    } else ({ tss, domain } = loadWithoutPower(a.movingS, a.avgHr, maxHr));
    const b = a.summary?.best ?? {};
    return {
      id: a.id,
      date: a.date,
      startMin: a.startMin,
      durationMin: Math.round(a.movingS / 60),
      tss: Math.round(tss),
      domain: { low: Math.round(domain.low), mid: Math.round(domain.mid), high: Math.round(domain.high) },
      ftpSet,
      best5: b[300],
      best20: b[1200],
      best60: b[3600],
      isTest: /\b(ftp|ramp)\s*test\b|\b20\s*min(ute)?\s*test\b/i.test(a.name ?? ''),
      rpe: a.rpe,
      source: 'strava' as const,
    };
  });
}
