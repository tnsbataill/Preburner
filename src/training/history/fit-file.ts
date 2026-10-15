// Minimal FIT decoder: enough to read cycling activities (per-second power,
// heart rate, cadence) and the session summary. Follows the FIT protocol:
// file header, then definition/data records, compressed-timestamp headers and
// developer fields (skipped). No dependency, works in Node and the browser.

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in unix seconds

export interface FitSample {
  /** unix seconds (UTC) */
  t: number;
  power?: number;
  hr?: number;
  cadence?: number;
}

export interface FitActivity {
  samples: FitSample[];
  /** unix seconds of the first sample / session start */
  start?: number;
  /** seconds to add to UTC to get local time, when the file says */
  utcOffsetS?: number;
  sport?: number;
  subSport?: number;
  /** session summaries */
  avgPower?: number;
  normalizedPower?: number;
  totalTimerS?: number;
  totalElapsedS?: number;
  /** Garmin device-reported FTP, if present in the session */
  thresholdPower?: number;
}

interface FieldDef {
  num: number;
  size: number;
  type: number;
}
interface Def {
  global: number;
  little: boolean;
  fields: FieldDef[];
  devBytes: number;
}

const INVALID: Record<number, number> = { 0x84: 0xffff, 0x02: 0xff, 0x86: 0xffffffff, 0x00: 0xff, 0x0a: 0x00, 0x83: 0x7fff, 0x85: 0x7fffffff, 0x01: 0x7f };

function readValue(view: DataView, off: number, f: FieldDef, little: boolean): number | undefined {
  const base = f.type & 0x1f;
  let v: number;
  switch (f.type) {
    case 0x00:
    case 0x02:
    case 0x0a:
    case 0x0d:
      if (f.size !== 1) return undefined;
      v = view.getUint8(off);
      break;
    case 0x01:
      v = view.getInt8(off);
      break;
    case 0x84:
    case 0x8b:
      if (f.size < 2) return undefined;
      v = view.getUint16(off, little);
      if (v === 0xffff) return undefined;
      return v;
    case 0x83:
      v = view.getInt16(off, little);
      break;
    case 0x86:
    case 0x8c:
      if (f.size < 4) return undefined;
      v = view.getUint32(off, little);
      if (v === 0xffffffff) return undefined;
      return v;
    case 0x85:
      v = view.getInt32(off, little);
      break;
    default:
      void base;
      return undefined;
  }
  if (INVALID[f.type] !== undefined && v === INVALID[f.type]) return undefined;
  return v;
}

export function decodeFit(buf: Uint8Array): FitActivity {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerSize = view.getUint8(0);
  if (buf.byteLength < 12 || String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== '.FIT') throw new Error('Not a FIT file');
  const dataSize = view.getUint32(4, true);
  const end = Math.min(buf.byteLength, headerSize + dataSize);
  const defs = new Map<number, Def>();
  const out: FitActivity = { samples: [] };
  let off = headerSize;
  let lastTs = 0;
  while (off < end) {
    const h = view.getUint8(off);
    off += 1;
    if (h & 0x80) {
      // Compressed timestamp header: data message with a 5-bit time offset.
      const local = (h >> 5) & 0x3;
      const tOff = h & 0x1f;
      const def = defs.get(local);
      if (!def) break;
      let ts = (lastTs & ~0x1f) + tOff;
      if (tOff < (lastTs & 0x1f)) ts += 0x20;
      lastTs = ts;
      off = readData(view, off, def, out, ts);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      const dev = (h & 0x20) !== 0;
      const little = view.getUint8(off + 1) === 0;
      const global = view.getUint16(off + 2, little);
      const n = view.getUint8(off + 4);
      off += 5;
      const fields: FieldDef[] = [];
      for (let i = 0; i < n; i += 1) {
        fields.push({ num: view.getUint8(off), size: view.getUint8(off + 1), type: view.getUint8(off + 2) });
        off += 3;
      }
      let devBytes = 0;
      if (dev) {
        const nd = view.getUint8(off);
        off += 1;
        for (let i = 0; i < nd; i += 1) {
          devBytes += view.getUint8(off + 1);
          off += 3;
        }
      }
      defs.set(local, { global, little, fields, devBytes });
    } else {
      const def = defs.get(local);
      if (!def) break;
      off = readData(view, off, def, out, undefined, (ts) => {
        lastTs = ts;
      });
    }
  }
  out.samples.sort((a, b) => a.t - b.t);
  if (out.start === undefined && out.samples.length) out.start = out.samples[0].t;
  return out;
}

function readData(view: DataView, off: number, def: Def, out: FitActivity, compressedTs?: number, onTs?: (ts: number) => void): number {
  const vals = new Map<number, number | undefined>();
  for (const f of def.fields) {
    vals.set(f.num, readValue(view, off, f, def.little));
    off += f.size;
  }
  off += def.devBytes;
  const ts = vals.get(253) ?? compressedTs;
  if (vals.get(253) !== undefined) onTs?.(vals.get(253)!);
  switch (def.global) {
    case 20: // record
      if (ts !== undefined) out.samples.push({ t: ts + FIT_EPOCH, power: vals.get(7), hr: vals.get(3), cadence: vals.get(4) });
      break;
    case 18: {
      // session
      const st = vals.get(2);
      if (st !== undefined) out.start = st + FIT_EPOCH;
      out.sport = vals.get(5) ?? out.sport;
      out.subSport = vals.get(6) ?? out.subSport;
      const el = vals.get(7);
      const tm = vals.get(8);
      if (el !== undefined) out.totalElapsedS = el / 1000;
      if (tm !== undefined) out.totalTimerS = tm / 1000;
      out.avgPower = vals.get(20) ?? out.avgPower;
      out.normalizedPower = vals.get(34) ?? out.normalizedPower;
      out.thresholdPower = vals.get(45) ?? out.thresholdPower;
      break;
    }
    case 34: {
      // activity: local_timestamp - timestamp = UTC offset
      const local = vals.get(5);
      if (local !== undefined && ts !== undefined) out.utcOffsetS = local - ts;
      break;
    }
    case 12: // sport
      out.sport = vals.get(0) ?? out.sport;
      break;
  }
  return off;
}

// ---- Encoder (tests and fixtures only) ----

/** Write a FIT activity with record messages (1 Hz) and an activity message. */
export function encodeFit(samples: FitSample[], opts: { utcOffsetS?: number; sport?: number } = {}): Uint8Array {
  const bytes: number[] = [];
  const u8 = (v: number) => bytes.push(v & 0xff);
  const u16 = (v: number) => {
    u8(v);
    u8(v >> 8);
  };
  const u32 = (v: number) => {
    u16(v & 0xffff);
    u16((v >>> 16) & 0xffff);
  };
  // definition: local 0 = record (timestamp, power, hr, cadence)
  u8(0x40);
  u8(0);
  u8(0);
  u16(20);
  u8(4);
  for (const [num, size, type] of [
    [253, 4, 0x86],
    [7, 2, 0x84],
    [3, 1, 0x02],
    [4, 1, 0x02],
  ])
    (u8(num), u8(size), u8(type));
  for (const s of samples) {
    u8(0x00);
    u32(s.t - FIT_EPOCH);
    u16(s.power ?? 0xffff);
    u8(s.hr ?? 0xff);
    u8(s.cadence ?? 0xff);
  }
  // definition: local 1 = session (start_time, sport)
  u8(0x41);
  u8(0);
  u8(0);
  u16(18);
  u8(2);
  for (const [num, size, type] of [
    [2, 4, 0x86],
    [5, 1, 0x00],
  ])
    (u8(num), u8(size), u8(type));
  u8(0x01);
  u32((samples[0]?.t ?? FIT_EPOCH) - FIT_EPOCH);
  u8(opts.sport ?? 2);
  if (opts.utcOffsetS !== undefined) {
    // definition: local 2 = activity (timestamp, local_timestamp)
    u8(0x42);
    u8(0);
    u8(0);
    u16(34);
    u8(2);
    for (const [num, size, type] of [
      [253, 4, 0x86],
      [5, 4, 0x86],
    ])
      (u8(num), u8(size), u8(type));
    const last = samples.at(-1)?.t ?? FIT_EPOCH;
    u8(0x02);
    u32(last - FIT_EPOCH);
    u32(last - FIT_EPOCH + opts.utcOffsetS);
  }
  const header = [14, 0x20, 0x08, 0x08, ...[0, 0, 0, 0], 0x2e, 0x46, 0x49, 0x54, 0, 0];
  const size = bytes.length;
  header[4] = size & 0xff;
  header[5] = (size >> 8) & 0xff;
  header[6] = (size >> 16) & 0xff;
  header[7] = (size >>> 24) & 0xff;
  // CRC is not verified by our decoder; write zero.
  return new Uint8Array([...header, ...bytes, 0, 0]);
}
