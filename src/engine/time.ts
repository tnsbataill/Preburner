import type { DateKey, Weekday } from './types';

// Date keys are calendar dates with no zone attached. Arithmetic is done on a
// UTC-noon anchor so DST transitions in the host zone can never shift a day.

const DAY_MS = 86_400_000;

function anchor(date: DateKey): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

function fromAnchor(ms: number): DateKey {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: DateKey, days: number): DateKey {
  return fromAnchor(anchor(date) + days * DAY_MS);
}

export function diffDays(from: DateKey, to: DateKey): number {
  return Math.round((anchor(to) - anchor(from)) / DAY_MS);
}

export function weekdayOf(date: DateKey): Weekday {
  return new Date(anchor(date)).getUTCDay() as Weekday;
}

/** Monday of the week containing `date`. */
export function weekStartOf(date: DateKey): DateKey {
  const wd = weekdayOf(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function dateRange(start: DateKey, days: number): DateKey[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

/** Today's date key in a given IANA zone (defaults to the host zone). */
export function todayKey(timeZone?: string, now: Date = new Date()): DateKey {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes after local midnight right now in a given zone. */
export function nowMinutes(timeZone?: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** Parse 'YYYY-MM-DDTHH:mm[:ss]' local wall-clock strings without zone conversion. */
export function parseLocal(value: string): { date: DateKey; min: number } | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return undefined;
  return { date: m[1], min: m[2] ? Number(m[2]) * 60 + Number(m[3]) : 0 };
}

export function formatClock(min: number, h12 = true): string {
  const total = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h12) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const suffix = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh}${suffix}` : `${hh}:${String(m).padStart(2, '0')}${suffix}`;
}

export function parseClock(value: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayShort(date: DateKey): string {
  return WEEKDAY_SHORT[weekdayOf(date)];
}

export function formatDate(date: DateKey, opts: { weekday?: boolean } = {}): string {
  const [, m, d] = date.split('-').map(Number);
  const base = `${MONTH_SHORT[m - 1]} ${d}`;
  return opts.weekday ? `${weekdayShort(date)}, ${base}` : base;
}
