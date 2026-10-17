import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import type { DateKey } from '../engine/types';

// Apple Health import. A web app can't read HealthKit, so this reads the
// export the Health app makes (Profile → Export All Health Data): a zip with
// apple_health_export/export.xml, often over 1 GB. The XML is streamed and only
// per-day values the app uses are kept: weight, body fat, resting HR, HRV
// (SDNN — Apple's measure, not rMSSD) and sleep. Heart-rate samples, steps and
// everything else are skipped as they stream past.

export interface HealthDay {
  date: DateKey;
  /** earliest weigh-in of the day (the morning weight) */
  weightKg?: number;
  bodyFatPct?: number;
  restingHR?: number;
  /** daily mean SDNN, ms */
  hrvSdnn?: number;
  /** asleep time for the night ending this morning */
  sleepHours?: number;
}

export interface HealthReport {
  days: number;
  first?: DateKey;
  last?: DateKey;
  /** days with a value, per category */
  counts: { weight: number; bodyFat: number; restingHR: number; hrv: number; sleep: number };
  /** where each category came from (Health app source names) */
  sources: { weight: string[]; bodyFat: string[]; restingHR: string[]; hrv: string[]; sleep: string[] };
  /** body fat copied to the profile on import (it sets fat-free mass) */
  appliedBodyFat?: { pct: number; date: DateKey };
}

export interface AppleHealthData {
  days: HealthDay[];
  report: HealthReport;
  importedAt: string;
}

const TYPES = {
  HKQuantityTypeIdentifierBodyMass: 'weight',
  HKQuantityTypeIdentifierBodyFatPercentage: 'bodyFat',
  HKQuantityTypeIdentifierRestingHeartRate: 'restingHR',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv',
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
} as const;
type Category = (typeof TYPES)[keyof typeof TYPES];

// Asleep stages (iOS 16+) and the older single "Asleep" value. In bed and
// awake don't count.
const ASLEEP = /^HKCategoryValueSleepAnalysis(Asleep|AsleepUnspecified|AsleepCore|AsleepDeep|AsleepREM)$/;

const decodeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ATTR = new Map<string, RegExp>();
const attr = (tag: string, name: string) => {
  const re = ATTR.get(name) ?? ATTR.set(name, new RegExp(`\\s${name}="([^"]*)"`)).get(name)!;
  const m = re.exec(tag);
  return m ? decodeXml(m[1]) : undefined;
};
/** "2024-03-01 07:15:22 -0500" -> epoch ms */
const toMs = (d: string) => Date.parse(d.replace(/^(\S+) (\S+) ([+-]\d\d)(\d\d)$/, '$1T$2$3:$4'));

const KG: Record<string, number> = { kg: 1, lb: 0.45359237, g: 0.001, st: 6.35029318 };

/** Fed the XML text in chunks of any size; tags may split across chunks. */
export class HealthAccumulator {
  private tail = '';
  private weight = new Map<DateKey, { at: number; kg: number }>();
  private bodyFat = new Map<DateKey, { at: number; pct: number }>();
  private rhr = new Map<DateKey, number[]>();
  private hrv = new Map<DateKey, number[]>();
  private sleep = new Map<DateKey, Map<string, number>>();
  private sources: Record<Category, Set<string>> = { weight: new Set(), bodyFat: new Set(), restingHR: new Set(), hrv: new Set(), sleep: new Set() };
  /** whether the text looked like a Health export at all */
  sawHealthData = false;

  constructor(private since: DateKey = '0000-00-00') {}

  push(text: string) {
    const s = this.tail + text;
    let i = 0;
    for (;;) {
      const start = s.indexOf('<Record ', i);
      if (start < 0) {
        // Keep a possible partial "<Record " at the end.
        this.tail = s.slice(Math.max(i, s.length - 8));
        return;
      }
      const end = s.indexOf('>', start);
      if (end < 0) {
        this.tail = s.slice(start);
        return;
      }
      this.sawHealthData = true;
      this.record(s.slice(start, end));
      i = end + 1;
    }
  }

  private record(tag: string) {
    const type = attr(tag, 'type');
    const cat = type ? (TYPES as Record<string, Category>)[type] : undefined;
    if (!cat) return;
    const startDate = attr(tag, 'startDate');
    const endDate = attr(tag, 'endDate');
    const value = attr(tag, 'value');
    if (!startDate || !endDate || value === undefined) return;
    // Days are the athlete's local days, as recorded.
    const day = (cat === 'sleep' ? endDate : startDate).slice(0, 10);
    if (day < this.since) return;
    const source = attr(tag, 'sourceName') ?? 'Unknown';
    const at = toMs(startDate);
    if (cat === 'sleep') {
      if (!ASLEEP.test(value)) return;
      const mins = (toMs(endDate) - at) / 60000;
      if (!(mins > 0 && mins < 24 * 60)) return;
      const bySource = this.sleep.get(day) ?? new Map<string, number>();
      bySource.set(source, (bySource.get(source) ?? 0) + mins);
      this.sleep.set(day, bySource);
    } else {
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      if (cat === 'weight') {
        const kg = v * (KG[attr(tag, 'unit') ?? 'kg'] ?? NaN);
        if (!(kg > 20 && kg < 400)) return;
        const prev = this.weight.get(day);
        if (!prev || at < prev.at) this.weight.set(day, { at, kg });
      } else if (cat === 'bodyFat') {
        // Stored as a fraction with unit "%" (0.18 = 18%).
        const pct = v <= 1 ? v * 100 : v;
        if (!(pct > 2 && pct < 70)) return;
        const prev = this.bodyFat.get(day);
        if (!prev || at > prev.at) this.bodyFat.set(day, { at, pct });
      } else {
        const map = cat === 'restingHR' ? this.rhr : this.hrv;
        if (!(v > 0 && v < 400)) return;
        map.set(day, [...(map.get(day) ?? []), v]);
      }
    }
    this.sources[cat].add(source);
  }

  finish(): Omit<AppleHealthData, 'importedAt'> {
    const days = new Map<DateKey, HealthDay>();
    const get = (d: DateKey) => days.get(d) ?? days.set(d, { date: d }).get(d)!;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    for (const [d, w] of this.weight) get(d).weightKg = r1(w.kg);
    for (const [d, b] of this.bodyFat) get(d).bodyFatPct = r1(b.pct);
    for (const [d, xs] of this.rhr) get(d).restingHR = Math.round(mean(xs));
    for (const [d, xs] of this.hrv) get(d).hrvSdnn = r1(mean(xs));
    // Watch, phone and sleep apps often all log the same night: take the
    // source with the most sleep instead of adding them up.
    for (const [d, bySource] of this.sleep) get(d).sleepHours = r1(Math.max(...bySource.values()) / 60);
    const list = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    const count = (k: keyof HealthDay) => list.filter((x) => x[k] !== undefined).length;
    return {
      days: list,
      report: {
        days: list.length,
        first: list[0]?.date,
        last: list.at(-1)?.date,
        counts: { weight: count('weightKg'), bodyFat: count('bodyFatPct'), restingHR: count('restingHR'), hrv: count('hrvSdnn'), sleep: count('sleepHours') },
        sources: Object.fromEntries(Object.entries(this.sources).map(([k, v]) => [k, [...v].sort()])) as HealthReport['sources'],
      },
    };
  }
}

const EXPORT_XML = /(^|\/)export\.xml$/i;

/**
 * Read an Apple Health export: the zip from the Health app, or export.xml on
 * its own. Streams the file, so a multi-GB export never sits in memory.
 */
export async function readHealthExport(file: Blob & { name?: string }, opts: { since?: DateKey; onProgress?: (fraction: number) => void } = {}): Promise<Omit<AppleHealthData, 'importedAt'>> {
  const acc = new HealthAccumulator(opts.since);
  const total = file.size || 1;
  let read = 0;
  const reader = file.stream().getReader();
  const isXml = /\.xml$/i.test(file.name ?? '');
  if (isXml) {
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.length;
      acc.push(dec.decode(value, { stream: true }));
      opts.onProgress?.(read / total);
    }
    acc.push(dec.decode());
  } else {
    let found = false;
    let pending: Promise<void> | undefined;
    const unzip = new Unzip((entry) => {
      if (!EXPORT_XML.test(entry.name) || found) return;
      found = true;
      const dec = new TextDecoder();
      pending = new Promise<void>((resolve, reject) => {
        entry.ondata = (err, chunk, final) => {
          if (err) return reject(err);
          acc.push(dec.decode(chunk, { stream: !final }));
          if (final) resolve();
        };
      });
      entry.start();
    });
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.length;
      unzip.push(value);
      opts.onProgress?.(read / total);
    }
    unzip.push(new Uint8Array(0), true);
    if (!found) throw new Error("No export.xml in this zip. Use the file from Health → your profile → Export All Health Data.");
    await pending;
  }
  if (!acc.sawHealthData) throw new Error("This doesn't look like an Apple Health export (no health records found).");
  return acc.finish();
}
