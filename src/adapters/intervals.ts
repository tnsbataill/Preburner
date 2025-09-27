// intervals.ts — corrected Intervals.icu provider

import type { PlannedWorkout, SessionType, Step, WeightEntry } from '../types.js';
import type { PlannedWorkoutProvider } from './provider.js';

const ICU_BASE_URL = 'https://intervals.icu/api/v1/';
const ICU_API_PREFIX = 'api/v1/';
const KG_PER_LB = 0.45359237;

export type IntervalsDebugLevel = 'info' | 'warn' | 'error';

export interface IntervalsDebugEntry {
  level?: IntervalsDebugLevel;
  message: string;
  detail?: string;
}

type IntervalsDebugLogger = (entry: IntervalsDebugEntry) => void;

interface IntervalsAthleteResponse {
  id: number | string;
  ftp?: number | string;
  weight?: number | string;
  weight_kg?: number | string;
  weightKg?: number | string;
  weight_lb?: number | string;
  weightLb?: number | string;
  height?: number | string;
  height_cm?: number | string;
  heightCm?: number | string;
  height_ft?: number | string;
  heightFt?: number | string;
  height_in?: number | string;
  heightIn?: number | string;
  sex?: string;
  gender?: string;
  birth_date?: string;
  birthDate?: string;
  dob?: string;
  units?: string;
  unit?: string;
  unit_system?: string;
  preferred_units?: string;
  use_imperial?: boolean;
  useImperial?: boolean;
  profile?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

interface IntervalsAthleteProfile {
  sex?: 'M' | 'F';
  age_years?: number;
  height_cm?: number;
  weight_kg?: number;
  ftp_watts?: number;
  useImperial?: boolean;
}

interface IntervalsAthleteContext {
  profile?: IntervalsAthleteProfile;
  weights?: WeightEntry[];
}

type IntervalsTagCollection = string[] | Record<string, unknown> | undefined;

interface IntervalsEventSummary {
  id: number | string;
  name?: string;
  title?: string;
  type?: string;
  workout_type?: string;
  sport?: string;
  description?: string;
  category?: string;
  start?: string;
  start_date?: string;
  start_date_local?: string;
  start_time?: string;
  end?: string;
  end_date?: string;
  end_date_local?: string;
  duration?: number | string;
  planned_duration?: number | string;
  planned_duration_total?: number | string;
  time_target?: number | string;
  timeTarget?: number | string;
  moving_time?: number | string;
  movingTime?: number | string;
  planned_work_kj?: number | string;
  planned_work?: number | string;
  plannedWork?: number | string;
  joules?: number | string;
  target?: unknown;
  plannedTrainingLoad?: number;
  planned_tss?: number;
  planned_intensity_factor?: number;
  ftp?: number;
  ftp_override?: number;
  tags?: IntervalsTagCollection;
  labels?: string[];
  structured_workout_id?: number;
  structuredWorkoutId?: number;
  workout_file_id?: number;
  workoutFileId?: number;
  workout_doc?: unknown;
  steps?: unknown;
}

interface IntervalsEventDetail extends IntervalsEventSummary {
  structuredWorkout?: unknown;
  workout_doc?: unknown;
  workout_file?: { id: number; ext?: string };
  files?: { id: number; ext?: string; type?: string }[];
}

interface PlannedKilojoulesResult {
  planned_kJ?: number;
  source: PlannedWorkout['kj_source'];
}

/** Personal API key must be sent as Basic with username 'API_KEY' and password = key */
function encodeBasicAuth(key: string): string {
  const pair = `API_KEY:${key}`;
  if (typeof btoa === 'function') return `Basic ${btoa(pair)}`;
  // Node.js / server-side
  // eslint-disable-next-line no-undef
  return `Basic ${Buffer.from(pair).toString('base64')}`;
}

function normaliseIso(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function secondsFromEvent(event: IntervalsEventSummary): number | undefined {
  const candidates = [
    event.planned_duration_total,
    event.planned_duration,
    event.time_target,
    (event as any).timeTarget,
    event.moving_time,
    (event as any).movingTime,
    event.duration,
  ];
  for (const candidate of candidates) {
    const seconds = toFiniteNumber(candidate);
    if (typeof seconds === 'number' && seconds > 0) {
      return seconds;
    }
  }
  return undefined;
}

function extractTags(collection: IntervalsTagCollection): string[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.map((tag) => String(tag));
  return Object.keys(collection).map((key) => key);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseSex(value: unknown): 'M' | 'F' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized.startsWith('M')) return 'M';
  if (normalized.startsWith('F')) return 'F';
  return undefined;
}

function parseBirthDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return trimmed;
}

function computeAgeYears(birthDateISO: string): number | undefined {
  const birthDate = new Date(birthDateISO);
  if (Number.isNaN(birthDate.getTime())) return undefined;
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : undefined;
}

function parseUseImperialValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (!lowered) return undefined;
    if (lowered.includes('imperial') || lowered === 'us') {
      return true;
    }
    if (lowered.includes('metric') || lowered === 'si') {
      return false;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectNestedRecords(input: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown>[] {
  if (seen.has(input)) {
    return [];
  }
  seen.add(input);
  const collected: Record<string, unknown>[] = [input];

  for (const value of Object.values(input)) {
    if (isRecord(value)) {
      collected.push(...collectNestedRecords(value, seen));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) {
          collected.push(...collectNestedRecords(item, seen));
        }
      }
    }
  }

  return collected;
}

function gatherAthleteRecords(athlete: IntervalsAthleteResponse): Record<string, unknown>[] {
  const seen = new WeakSet<object>();
  const records: Record<string, unknown>[] = [];

  const addRecords = (value: unknown) => {
    if (isRecord(value)) {
      records.push(...collectNestedRecords(value, seen));
    }
  };

  addRecords(athlete as unknown as Record<string, unknown>);
  addRecords(athlete.profile);
  addRecords(athlete.metrics);

  return records;
}

function extractNumber(records: Record<string, unknown>[], keys: string[]): number | undefined {
  for (const record of records) {
    for (const key of keys) {
      const numeric = toFiniteNumber(record[key]);
      if (typeof numeric === 'number') {
        return numeric;
      }
    }
  }
  return undefined;
}

function extractWeightKg(records: Record<string, unknown>[]): number | undefined {
  const candidates: { key: string; unit: 'kg' | 'lb' }[] = [
    { key: 'weight_kg', unit: 'kg' },
    { key: 'weightKg', unit: 'kg' },
    { key: 'weight', unit: 'kg' },
    { key: 'weight_lb', unit: 'lb' },
    { key: 'weightLb', unit: 'lb' },
  ];
  for (const record of records) {
    for (const candidate of candidates) {
      const numeric = toFiniteNumber(record[candidate.key]);
      if (typeof numeric === 'number' && numeric > 0) {
        return candidate.unit === 'lb' ? numeric * KG_PER_LB : numeric;
      }
    }
  }
  return undefined;
}

function extractHeightCm(records: Record<string, unknown>[]): number | undefined {
  for (const record of records) {
    const cmCandidates = ['height_cm', 'heightCm'];
    for (const key of cmCandidates) {
      const numeric = toFiniteNumber(record[key]);
      if (typeof numeric === 'number' && numeric > 0) {
        return numeric;
      }
    }

    const rawHeight = toFiniteNumber(record['height']);
    if (typeof rawHeight === 'number' && rawHeight > 0) {
      return rawHeight > 3 ? rawHeight : rawHeight * 100;
    }

    const feet = toFiniteNumber(record['height_ft'] ?? record['heightFt']);
    const inches = toFiniteNumber(record['height_in'] ?? record['heightIn']);
    if (typeof feet === 'number') {
      const totalInches = feet * 12 + (typeof inches === 'number' ? inches : 0);
      if (totalInches > 0) {
        return totalInches * 2.54;
      }
    }
  }

  return undefined;
}

function extractSex(records: Record<string, unknown>[]): 'M' | 'F' | undefined {
  for (const record of records) {
    const value = record['sex'] ?? record['gender'];
    const parsed = parseSex(value);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function extractBirthDate(records: Record<string, unknown>[]): string | undefined {
  for (const record of records) {
    const candidate = record['birth_date'] ?? record['birthDate'] ?? record['dob'];
    const parsed = parseBirthDate(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function extractUseImperial(records: Record<string, unknown>[]): boolean | undefined {
  for (const record of records) {
    const candidate =
      record['use_imperial'] ??
      record['useImperial'] ??
      record['units'] ??
      record['unit'] ??
      record['unit_system'] ??
      record['preferred_units'];
    const parsed = parseUseImperialValue(candidate);
    if (typeof parsed === 'boolean') {
      return parsed;
    }
  }
  return undefined;
}

function shiftDateKey(dateKey: string, offsetDays: number): string {
  const reference = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(reference.getTime())) {
    return dateKey;
  }
  reference.setUTCDate(reference.getUTCDate() + offsetDays);
  return reference.toISOString().slice(0, 10);
}

function parseWeightSeries(response: unknown): WeightEntry[] {
  const entries = new Map<string, number>();

  const addEntry = (dateValue: unknown, weightValue: unknown) => {
    const dateKey = extractDateParam(typeof dateValue === 'string' ? dateValue : undefined);
    const weight = toFiniteNumber(weightValue);
    if (!dateKey || typeof weight !== 'number' || weight <= 0) {
      return;
    }
    entries.set(dateKey, weight);
  };

  const resolveWeightValue = (record: Record<string, unknown>): unknown => {
    if (record.weight !== undefined) return record.weight;
    const fields = record.fields;
    if (fields && typeof fields === 'object' && (fields as Record<string, unknown>).weight !== undefined) {
      return (fields as Record<string, unknown>).weight;
    }
    const metrics = record.metrics;
    if (metrics && typeof metrics === 'object' && (metrics as Record<string, unknown>).weight !== undefined) {
      return (metrics as Record<string, unknown>).weight;
    }
    if (record.value !== undefined) return record.value;
    if (record.v !== undefined) return record.v;
    return undefined;
  };

  const processRecord = (record: Record<string, unknown>, fallbackKey?: string) => {
    const dateCandidate = record.date ?? record.d ?? record.day ?? record.start ?? fallbackKey;
    addEntry(dateCandidate, resolveWeightValue(record));
  };

  const normaliseResponse = (input: unknown): void => {
    if (!input) return;

    if (typeof input === 'string') {
      const lines = input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length < 2) return;
      const headers = lines[0].split(',').map((header) => header.trim().toLowerCase());
      const dateIndex = headers.findIndex((header) => header === 'date' || header === 'day');
      const weightIndex = headers.findIndex((header) => header === 'weight' || header === 'weight_kg');
      if (dateIndex === -1 || weightIndex === -1) return;
      for (const line of lines.slice(1)) {
        const values = line.split(',');
        const record: Record<string, unknown> = {};
        record.date = values[dateIndex]?.trim();
        record.weight = values[weightIndex]?.trim();
        processRecord(record);
      }
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        if (item && typeof item === 'object') {
          processRecord(item as Record<string, unknown>);
        }
      }
      return;
    }

    if (input && typeof input === 'object') {
      const recordContainer = input as Record<string, unknown>;
      if (Array.isArray(recordContainer.records)) {
        normaliseResponse(recordContainer.records);
        return;
      }
      for (const [key, value] of Object.entries(recordContainer)) {
        if (typeof value === 'number' || typeof value === 'string') {
          addEntry(key, value);
        } else if (value && typeof value === 'object') {
          processRecord(value as Record<string, unknown>, key);
        }
      }
    }
  };

  normaliseResponse(response);

  return Array.from(entries.entries())
    .map(([dateISO, weight_kg]) => ({ dateISO, weight_kg, source: 'intervals' as const }))
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
}

function inferSessionType(
  name: string,
  tags: string[],
  labels: string[],
  typeHints: (string | undefined)[],
  steps: Step[] | undefined,
  intensityHints: (number | undefined)[],
  defaultType: SessionType,
): SessionType {
  const combined = [name, ...tags, ...labels, ...typeHints.filter((hint): hint is string => typeof hint === 'string')]
    .map((value) => value.toLowerCase())
    .join(' ');

  if (
    combined.includes('rest') ||
    combined.includes('off bike') ||
    combined.includes('recovery day') ||
    combined.includes('day off')
  )
    return 'Rest';
  if (combined.includes('race') || combined.includes('crits') || combined.includes('time trial')) return 'Race';
  if (
    combined.includes('vo2') ||
    combined.includes('v02') ||
    combined.includes('max aerobic') ||
    combined.includes('anaerobic')
  )
    return 'VO2';
  if (
    combined.includes('threshold') ||
    combined.includes('sweet spot') ||
    combined.includes('sweetspot') ||
    combined.includes('over under') ||
    combined.includes('over-under')
  )
    return 'Threshold';
  if (combined.includes('tempo') || combined.includes('steady state')) return 'Tempo';
  if (combined.includes('endurance') || combined.includes('aerobic') || combined.includes('z2')) return 'Endurance';
  if (combined.includes('recovery ride') || combined.includes('easy spin')) return 'Endurance';

  const maxPct = steps?.reduce((max, step) => {
    if (step.target_type === '%FTP') {
      const hi = step.target_hi ?? step.target_lo ?? 0;
      return Math.max(max, hi);
    }
    if (step.target_type === 'Watts' && step.target_hi) return Math.max(max, step.target_hi);
    return max;
  }, 0);

  if (maxPct && maxPct >= 115) return 'VO2';
  if (maxPct && maxPct >= 100) return 'Threshold';

  const intensity = intensityHints
    .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined))
    .filter((value): value is number => typeof value === 'number')
    .reduce((max, value) => (value > max ? value : max), 0);

  if ((!steps || steps.length === 0) && intensity > 0) {
    if (intensity >= 1.15) return 'VO2';
    if (intensity >= 1) return 'Threshold';
    if (intensity >= 0.85) return 'Tempo';
  }
  if (combined.includes('recovery')) return 'Endurance';

  return defaultType;
}

function ensureDurationHours(seconds: number | undefined, startISO?: string, endISO?: string): number {
  if (seconds && seconds > 0) return seconds / 3600;
  if (startISO && endISO) {
    const start = Date.parse(startISO);
    const end = Date.parse(endISO);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      return (end - start) / 3_600_000;
    }
  }
  return 0;
}

function buildEndISO(startISO: string | undefined, seconds: number | undefined, fallbackEnd?: string): string | undefined {
  if (fallbackEnd) return normaliseIso(fallbackEnd);
  if (!startISO || !seconds) return undefined;
  const start = Date.parse(startISO);
  if (Number.isNaN(start)) return undefined;
  const endMs = start + seconds * 1000;
  return new Date(endMs).toISOString();
}

function extractDateParam(iso?: string): string | undefined {
  if (!iso) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(iso);
  if (match) return match[0];
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function mapTagsToDefaultType(tags: string[], fallback: SessionType): SessionType {
  const lowered = tags.map((tag) => tag.toLowerCase());
  if (lowered.includes('vo2') || lowered.includes('vo₂')) return 'VO2';
  if (lowered.includes('threshold')) return 'Threshold';
  if (lowered.includes('tempo')) return 'Tempo';
  if (lowered.includes('race')) return 'Race';
  if (lowered.includes('rest')) return 'Rest';
  return fallback;
}

function truncate(value: string, limit = 200): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function summariseErrorBody(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') return truncate(parsed);
    if (parsed && typeof parsed === 'object') {
      const candidates = ['message', 'error', 'detail', 'title'] as const;
      for (const key of candidates) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim()) return truncate(value.trim());
      }
      return truncate(JSON.stringify(parsed));
    }
  } catch {
    // fall through to returning the raw trimmed body
  }
  return truncate(trimmed);
}

function normaliseApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  const withoutLeadingSlash = trimmed.replace(/^\/+/, '');
  if (withoutLeadingSlash.startsWith(ICU_API_PREFIX)) {
    return withoutLeadingSlash.slice(ICU_API_PREFIX.length);
  }
  return withoutLeadingSlash;
}

function estimateFromIf(
  ftp: number | undefined,
  intensityFactor: number | undefined,
  durationHr: number,
): number | undefined {
  if (!ftp || !intensityFactor || intensityFactor <= 0 || durationHr <= 0) return undefined;
  const avgWatts = ftp * intensityFactor;
  return (avgWatts * durationHr * 3600) / 1000;
}

function estimateFromTss(
  ftp: number | undefined,
  plannedTss: number | undefined,
  durationHr: number,
): number | undefined {
  if (!ftp || !plannedTss || plannedTss <= 0 || durationHr <= 0) return undefined;
  const ifactor = Math.sqrt(plannedTss / (durationHr * 100));
  if (!Number.isFinite(ifactor) || ifactor <= 0) return undefined;
  return estimateFromIf(ftp, ifactor, durationHr);
}

function sumStepKilojoules(steps: Step[], ftp: number | undefined): number | undefined {
  if (steps.length === 0) return undefined;
  const requiresFtp = steps.some((step) => step.target_type === '%FTP');
  if (requiresFtp && !ftp) return undefined;
  let total = 0;
  for (const step of steps) {
    if (step.target_type === '%FTP') {
      const lo = step.target_lo ?? step.target_hi ?? 0;
      const hi = step.target_hi ?? step.target_lo ?? 0;
      const pct = (lo + hi) / 2 / 100;
      total += pct * (ftp ?? 0) * step.duration_s;
    } else if (step.target_type === 'Watts') {
      const lo = step.target_lo ?? step.target_hi ?? 0;
      const hi = step.target_hi ?? step.target_lo ?? 0;
      const watts = (lo + hi) / 2;
      total += watts * step.duration_s;
    }
  }
  if (total <= 0) return undefined;
  return total / 1000;
}

function totalStepDurationSeconds(steps: Step[] | undefined): number | undefined {
  if (!steps || steps.length === 0) {
    return undefined;
  }
  let total = 0;
  for (const step of steps) {
    const duration = Number(step.duration_s);
    if (Number.isFinite(duration) && duration > 0) {
      total += duration;
    }
  }
  return total > 0 ? total : undefined;
}

function parseKjFromDescription(desc?: string): number | undefined {
  if (!desc) return undefined;
  const text = desc.replace(/<[^>]+>/g, ' ');
  const match = /\b(\d{2,5})\s*kJ\b|\bkJ(?:\(Cal\))?\s*(\d{2,5})\b/i.exec(text);
  if (!match) return undefined;
  const raw = match[1] ?? match[2];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

interface SimpleZwoNode {
  tag: string;
  get(name: string): string | undefined;
}

function buildStepsFromZwoNodes(nodes: SimpleZwoNode[]): Step[] | undefined {
  if (nodes.length === 0) return undefined;

  const steps: Step[] = [];
  let cursor = 0;

  const appendStep = (duration: number, lo: number, hi: number, targetType: Step['target_type']) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const durationSeconds = Math.max(1, Math.round(duration));
    steps.push({
      start_s: cursor,
      duration_s: durationSeconds,
      target_type: targetType,
      target_lo: lo,
      target_hi: hi,
    });
    cursor += durationSeconds;
  };

  const parsePower = (value: string | undefined): number => {
    if (!value) return 0;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return numeric <= 1 ? numeric * 100 : numeric;
  };

  for (const node of nodes) {
    const tag = node.tag.toLowerCase();
    if (!tag) continue;

    if (tag === 'steadystate') {
      const duration = Number(node.get('Duration'));
      const power = parsePower(node.get('Power'));
      appendStep(duration, power, power, '%FTP');
    } else if (tag === 'warmup' || tag === 'cooldown') {
      const duration = Number(node.get('Duration'));
      const low = parsePower(node.get('PowerLow'));
      const high = parsePower(node.get('PowerHigh'));
      appendStep(duration, low, high, '%FTP');
    } else if (tag === 'intervalst') {
      const repeats = Number(node.get('Repeat'));
      const onDuration = Number(node.get('OnDuration'));
      const offDuration = Number(node.get('OffDuration'));
      const onPower = parsePower(node.get('OnPower'));
      const offPower = parsePower(node.get('OffPower'));
      const repeatCount = Number.isFinite(repeats) && repeats > 0 ? Math.round(repeats) : 1;
      for (let r = 0; r < repeatCount; r += 1) {
        appendStep(onDuration, onPower, onPower, '%FTP');
        if (Number.isFinite(offDuration) && offDuration > 0) {
          appendStep(offDuration, offPower, offPower, '%FTP');
        }
      }
    } else if (tag === 'freeride') {
      const duration = Number(node.get('Duration'));
      const watts = Number(node.get('FlatRoadSpeed'));
      if (Number.isFinite(watts) && watts > 0) {
        appendStep(duration, watts, watts, 'Watts');
      } else {
        appendStep(duration, 55, 65, '%FTP');
      }
    }
  }

  return steps.length > 0 ? steps : undefined;
}

function parseStructuredSteps(structured: unknown): Step[] | undefined {
  if (!structured) return undefined;

  if (Array.isArray(structured)) {
    const steps: Step[] = [];
    let cursor = 0;
    for (const item of structured) {
      if (!item || typeof item !== 'object') continue;
      const duration = Number('duration' in item ? (item as any).duration : (item as any).Duration);
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const targetType = (item as any).target_type ?? (item as any).TargetType;
      if (typeof targetType === 'string' && targetType.toLowerCase() === 'watts') {
        const lo = Number((item as any).target_lo ?? (item as any).TargetPower ?? (item as any).TargetLow);
        const hi = Number((item as any).target_hi ?? (item as any).TargetPower ?? (item as any).TargetHigh ?? lo);
        steps.push({
          start_s: cursor,
          duration_s: Math.round(duration),
          target_type: 'Watts',
          target_lo: Number.isFinite(lo) ? lo : undefined,
          target_hi: Number.isFinite(hi) ? hi : undefined,
        });
      } else {
        const lo = Number(
          (item as any).target_lo ??
            (item as any).TargetPower ??
            (item as any).Power ??
            (item as any).PowerLow ??
            (item as any).power_low,
        );
        const hi = Number(
          (item as any).target_hi ??
            (item as any).PowerHigh ??
            (item as any).power_high ??
            (item as any).Power ??
            (item as any).power,
        );
        const loPct = Number.isFinite(lo) ? lo * (lo <= 1 ? 100 : 1) : undefined;
        const hiPct = Number.isFinite(hi) ? hi * (hi <= 1 ? 100 : 1) : loPct;
        steps.push({
          start_s: cursor,
          duration_s: Math.round(duration),
          target_type: '%FTP',
          target_lo: loPct,
          target_hi: hiPct,
        });
      }
      cursor += Math.round(duration);
    }
    return steps.length > 0 ? steps : undefined;
  }

  if (typeof structured === 'string') {
    return parseZwoSteps(structured);
  }

  if (structured && typeof structured === 'object') {
    const record = structured as Record<string, unknown>;
    const candidateKeys = ['steps', 'Steps', 'workout', 'Workout', 'doc', 'workout_doc', 'WorkoutDoc'];
    for (const key of candidateKeys) {
      if (record[key] !== undefined) {
        const parsed = parseStructuredSteps(record[key]);
        if (parsed && parsed.length > 0) {
          return parsed;
        }
      }
    }
  }

  return undefined;
}

function parseZwoSteps(zwo: string): Step[] | undefined {
  if (!zwo.trim()) return undefined;

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(zwo, 'application/xml');
      const workout = doc.querySelector('workout') ?? doc.querySelector('Workout');
      if (!workout) return undefined;
      const nodes: SimpleZwoNode[] = [];
      const elements = workout.children;
      for (let i = 0; i < elements.length; i += 1) {
        const element = elements[i];
        nodes.push({
          tag: element.tagName ?? '',
          get: (name: string) =>
            element.getAttribute(name) ??
            element.getAttribute(name.toLowerCase()) ??
            undefined,
        });
      }
      return buildStepsFromZwoNodes(nodes);
    } catch (error) {
      console.warn('Failed to parse ZWO structured workout', error);
    }
  }

  const elementRegex = /<(Warmup|Cooldown|SteadyState|IntervalsT|FreeRide)\b([^>]*)>/gi;
  const nodes: SimpleZwoNode[] = [];
  let match: RegExpExecArray | null;
  while ((match = elementRegex.exec(zwo)) !== null) {
    const [, rawTag, rawAttrs] = match;
    const attrMap: Record<string, string> = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawAttrs ?? '')) !== null) {
      const [, key, value] = attrMatch;
      attrMap[key] = value;
      attrMap[key.toLowerCase()] = value;
    }
    nodes.push({
      tag: rawTag,
      get: (name: string) => attrMap[name] ?? attrMap[name.toLowerCase()],
    });
  }

  const parsed = buildStepsFromZwoNodes(nodes);
  if (parsed && parsed.length > 0) {
    return parsed;
  }

  return undefined;
}

function extractPlannedKilojoules(
  event: IntervalsEventSummary,
  steps: Step[] | undefined,
  ftp: number | undefined,
  durationHr: number,
): PlannedKilojoulesResult {
  const directCandidates = [event.planned_work_kj, event.planned_work, event.plannedWork];
  for (const candidate of directCandidates) {
    const parsed = toFiniteNumber(candidate);
    if (typeof parsed === 'number' && parsed > 0) {
      return { planned_kJ: parsed, source: 'ICU Structured' };
    }
  }

  const joules = toFiniteNumber((event as any).joules ?? event.joules);
  if (typeof joules === 'number' && joules > 0) {
    return { planned_kJ: joules / 1000, source: 'ICU Structured' };
  }

  // Prefer explicit energy totals mentioned in the description before falling back to estimates.
  const desc = typeof event.description === 'string' ? event.description : undefined;
  const fromDescription = parseKjFromDescription(desc);
  if (typeof fromDescription === 'number') {
    return { planned_kJ: fromDescription, source: 'Description' };
  }

  let fallback: PlannedKilojoulesResult | undefined;

  if (steps && steps.length > 0) {
    const estimated = sumStepKilojoules(steps, ftp);
    if (typeof estimated === 'number') {
      fallback = { planned_kJ: estimated, source: 'Estimated (steps)' };
    }
  }

  const icuIntensityPct = toFiniteNumber((event as any).icu_intensity);
  const icuTrainingLoad = toFiniteNumber((event as any).icu_training_load);
  const plannedIntensityFactor = toFiniteNumber(event.planned_intensity_factor);

  if (!fallback && typeof ftp === 'number' && durationHr > 0) {
    const intensity =
      typeof icuIntensityPct === 'number' && icuIntensityPct > 0
        ? icuIntensityPct / 100
        : plannedIntensityFactor;
    if (typeof intensity === 'number' && intensity > 0) {
      const fromIf = estimateFromIf(ftp, intensity, durationHr);
      if (typeof fromIf === 'number') {
        fallback = { planned_kJ: fromIf, source: 'Estimated (IF/TSS)' };
      }
    }

    if (!fallback) {
      const tssCandidates = [
        icuTrainingLoad,
        toFiniteNumber(event.planned_tss),
        toFiniteNumber((event as any).plannedTss),
      ];
      for (const tssCandidate of tssCandidates) {
        if (typeof tssCandidate !== 'number' || tssCandidate <= 0) continue;
        const fromTss = estimateFromTss(ftp, tssCandidate, durationHr);
        if (typeof fromTss === 'number') {
          fallback = { planned_kJ: fromTss, source: 'Estimated (IF/TSS)' };
          break;
        }
      }
    }
  }

  return fallback ?? { planned_kJ: undefined, source: 'Estimated (fallback)' };
}

async function fetchStructuredFile(
  fetcher: (path: string, responseType?: 'json' | 'text') => Promise<unknown>,
  athleteId: number,
  event: IntervalsEventSummary,
): Promise<Step[] | undefined> {
  const detail = (await fetcher(`/athlete/${athleteId}/events/${event.id}.json?resolve=true`, 'json')) as
    | IntervalsEventDetail
    | undefined;
  if (!detail) return undefined;

  const structured =
    (detail as any).workout_doc ?? detail.structuredWorkout ?? detail.steps ?? (detail as any).structured_workout;
  const parsedSteps = parseStructuredSteps(structured ?? detail.steps);
  if (parsedSteps && parsedSteps.length > 0) return parsedSteps;

  const hasDownloadableFile = Boolean(
    detail.structured_workout_id ??
      detail.structuredWorkoutId ??
      detail.workout_file_id ??
      detail.workoutFileId ??
      detail.workout_file?.id ??
      detail.files?.find((file) => file.ext === 'zwo' || file.type === 'structured'),
  );
  if (!hasDownloadableFile) return undefined;

  const response = await fetcher(`/athlete/${athleteId}/events/${event.id}/download.zwo?resolve=true`, 'text');
  if (typeof response === 'string') return parseZwoSteps(response);

  return undefined;
}

export class IntervalsProvider implements PlannedWorkoutProvider {
  private readonly apiKey: string;
  private readonly debug?: IntervalsDebugLogger;

  private athleteId?: number; // allow 0 (me) explicitly
  private athleteFtp?: number;
  private latestContext?: IntervalsAthleteContext;

  constructor(apiKey: string, debug?: IntervalsDebugLogger, options?: { athleteId?: number }) {
    this.apiKey = apiKey;
    this.debug = debug;
    if (options && Number.isFinite(options.athleteId as number)) {
      const rounded = Math.round(options.athleteId as number);
      // Allow 0 to mean "me" per Intervals.icu semantics
      if (rounded >= 0) this.athleteId = rounded;
    }
  }

  private log(level: IntervalsDebugLevel, message: string, detail?: string): void {
    if (this.debug) this.debug({ level, message, detail });
  }

  private updateLatestProfile(update: IntervalsAthleteProfile): void {
    const entries = Object.entries(update).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return;
    }
    if (!this.latestContext) {
      this.latestContext = {};
    }
    const current = this.latestContext.profile ?? {};
    this.latestContext.profile = {
      ...current,
      ...(entries as [keyof IntervalsAthleteProfile, any][]).reduce<IntervalsAthleteProfile>((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as IntervalsAthleteProfile),
    };
  }

  private async fetchFromApi(path: string, responseType: 'json' | 'text' = 'json'): Promise<any> {
    const url = path.startsWith('http') ? new URL(path) : new URL(normaliseApiPath(path), ICU_BASE_URL);
    const summaryPath = `${url.pathname}${url.search}`;

    const passwordLength = this.apiKey.trim().length;
    this.log('info', 'Auth check', `u=API_KEY passLen=${passwordLength}`);
    this.log('info', 'GET', summaryPath);

    const authorization = encodeBasicAuth(this.apiKey);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: authorization,
          Accept: responseType === 'json' ? 'application/json' : 'text/plain',
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Network error';
      this.log('error', `Network error while requesting ${summaryPath}`, detail);
      throw error;
    }

    if (!response.ok) {
      const body = await response.text();
      const detail = summariseErrorBody(body);
      const statusText = response.statusText ? ` ${response.statusText}` : '';
      const suffix = detail ? `: ${detail}` : '';
      const summaryMessage = `Intervals.icu responded ${response.status}${statusText} for GET ${summaryPath}`;

      let guidance: string | undefined;
      if (response.status === 403) {
        if (/\/athlete\/\d+\/events/.test(summaryPath)) {
          guidance =
            'Access denied (403). Using a personal API key? Use Basic auth with username "API_KEY" and your key as the password. If using OAuth, the token must include CALENDAR:READ. Also ensure you have access to the requested athlete (use /athlete/0 for your own account).';
        } else {
          guidance =
            'Access denied (403). Verify authentication: personal keys require Basic auth (username "API_KEY", password = key). For OAuth, include the necessary scopes and ensure athlete access.';
        }
      } else if (response.status === 404) {
        guidance = 'Resource not found (404). Check athlete ID, event ID, and path.';
      }

      this.log('error', summaryMessage, detail);
      if (guidance) {
        this.log('error', guidance, detail);
        throw new Error(
          `${guidance} (Original error: Intervals.icu request failed (${response.status}${statusText}) for GET ${summaryPath}${suffix})`,
        );
      }
      throw new Error(
        `Intervals.icu request failed (${response.status}${statusText}) for GET ${summaryPath}${suffix}`,
      );
    }

    this.log('info', `GET ${summaryPath} → ${response.status}`, response.statusText || undefined);
    return responseType === 'json' ? response.json() : response.text();
  }

  private async loadAthleteProfile(path: string): Promise<void> {
    const athlete = (await this.fetchFromApi(path)) as IntervalsAthleteResponse;
    if (!athlete) {
      throw new Error('Unable to load Intervals.icu athlete profile');
    }

    const parsedId = toFiniteNumber(athlete.id);
    const resolvedAthleteId =
      typeof parsedId === 'number' && parsedId >= 0
        ? Math.round(parsedId)
        : typeof this.athleteId === 'number'
          ? this.athleteId
          : undefined;

    if (typeof resolvedAthleteId !== 'number') {
      throw new Error('Unable to load Intervals.icu athlete profile');
    }
    this.athleteId = resolvedAthleteId;
    const records = gatherAthleteRecords(athlete);
    const ftp = extractNumber(records, ['ftp', 'ftp_watts', 'ftpWatts']);
    if (typeof ftp === 'number') {
      this.athleteFtp = ftp;
    }

    const weightKg = extractWeightKg(records);
    const heightCm = extractHeightCm(records);
    const sex = extractSex(records);
    const birthDate = extractBirthDate(records);
    const ageYears = birthDate ? computeAgeYears(birthDate) : undefined;
    const useImperial = extractUseImperial(records);

    this.updateLatestProfile({
      ftp_watts: typeof ftp === 'number' ? ftp : undefined,
      weight_kg: weightKg,
      height_cm: heightCm,
      sex,
      age_years: ageYears,
      useImperial,
    });
  }

  private logLoadedAthlete(): void {
    if (typeof this.athleteId !== 'number') return;
    this.log(
      'info',
      `Loaded athlete profile ${this.athleteId}`,
      typeof this.athleteFtp === 'number' ? `FTP ${this.athleteFtp}` : undefined,
    );
  }

  private async ensureAthlete(): Promise<void> {
    // If caller provided an athleteId (including 0 = me), we can proceed without lookup.
    if (typeof this.athleteId === 'number') {
      // If we already have ftp, we’re good; otherwise try refresh but don’t fail hard.
      if (typeof this.athleteFtp === 'number') {
        this.updateLatestProfile({ ftp_watts: this.athleteFtp });
        return;
      }
      try {
        const label = this.athleteId === 0 ? 'current athlete (0)' : `athlete profile ${this.athleteId}`;
        this.log('info', `Refreshing ${label}`);
        await this.loadAthleteProfile(`/athlete/${this.athleteId}`);
        this.logLoadedAthlete();
      } catch (error) {
        const detail = error instanceof Error ? error.message : undefined;
        this.log('warn', `Unable to refresh athlete profile ${this.athleteId}`, detail);
      }
      return;
    }

    // No athleteId supplied—attempt automatic lookup (may 405).
    this.log('info', 'Loading Intervals.icu athlete profile');
    try {
      await this.loadAthleteProfile('/athlete');
      this.logLoadedAthlete();
    } catch (error) {
      const detail = error instanceof Error ? error.message : undefined;
      if (error instanceof Error && /\b405\b/.test(error.message)) {
        const guidance =
          'Intervals.icu rejected the automatic athlete lookup (405). Set your athlete ID in settings, or pass athleteId=0 to target your own account.';
        this.log('error', guidance, detail);
        throw new Error(`${guidance} (Original error: ${error.message})`);
      }
      this.log('error', 'Unable to load Intervals.icu athlete profile', detail);
      throw error;
    }
  }

  private buildEventsUrl(startISO: string, endISO: string): string {
    if (typeof this.athleteId !== 'number') {
      throw new Error('Athlete ID is not loaded');
    }
    const url = new URL(normaliseApiPath(`athlete/${this.athleteId}/events.json`), ICU_BASE_URL);
    const oldest = extractDateParam(startISO);
    const newest = extractDateParam(endISO);
    if (oldest) url.searchParams.set('oldest', oldest);
    if (newest) url.searchParams.set('newest', newest);
    url.searchParams.set('category', 'WORKOUT');
    url.searchParams.set('resolve', 'true');
    return url.pathname + url.search;
  }

  private async loadStructuredSteps(event: IntervalsEventSummary): Promise<Step[] | undefined> {
    const inline = (event as any).workout_file_base64;
    const inlineExt = (event as any).workout_filename;
    if (inline && typeof inline === 'string' && /zwo$/i.test(typeof inlineExt === 'string' ? inlineExt : '')) {
      try {
        const decoded = typeof Buffer !== 'undefined' ? Buffer.from(inline, 'base64').toString('utf-8') : atob(inline);
        const parsedInline = parseZwoSteps(decoded);
        if (parsedInline && parsedInline.length > 0) {
          return parsedInline;
        }
      } catch {
        // ignore inline parsing issues and fall back to API fetch below
      }
    }

    if (typeof this.athleteId !== 'number') return undefined;
    try {
      this.log('info', `Fetching structured workout for event ${event.id}`);
      return await fetchStructuredFile(this.fetchFromApi.bind(this), this.athleteId, event);
    } catch (error) {
      console.warn('Failed to load structured workout for event', event.id, error);
      const detail = error instanceof Error ? error.message : undefined;
      this.log('warn', `Failed to load structured workout for event ${event.id}`, detail);
      return undefined;
    }
  }

  private async loadWeightHistory(startISO: string, endISO: string): Promise<WeightEntry[]> {
    if (typeof this.athleteId !== 'number') {
      return [];
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const endKey = extractDateParam(endISO);
    const newest = endKey && endKey < todayKey ? endKey : todayKey;
    const oldest = shiftDateKey(newest, -365);
    const baseParams = new URLSearchParams({ oldest, newest, dir: 'asc' });
    const paramsWithCols = new URLSearchParams(baseParams);
    paramsWithCols.set('cols', 'weight');

    const buildCandidates = (params: URLSearchParams): { path: string; responseType: 'json' | 'text' }[] => [
      { path: `/athlete/${this.athleteId}/wellness.csv?${params.toString()}`, responseType: 'text' },
      { path: `/athlete/${this.athleteId}/wellness.json?${params.toString()}`, responseType: 'json' },
    ];

    const candidates = [...buildCandidates(paramsWithCols), ...buildCandidates(baseParams)];

    for (const candidate of candidates) {
      try {
        const response = await this.fetchFromApi(candidate.path, candidate.responseType);
        const weights = parseWeightSeries(response);
        if (weights.length > 0) {
          this.log('info', `Loaded ${weights.length} weight entries`, `${oldest} → ${newest}`);
          return weights;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : undefined;
        this.log('warn', `Unable to load weight history from ${candidate.path}`, detail);
      }
    }

    return [];
  }

  async getPlannedWorkouts(startISO: string, endISO: string): Promise<PlannedWorkout[]> {
    this.log('info', 'Preparing to sync planned workouts', `${startISO} → ${endISO}`);
    await this.ensureAthlete();
    if (typeof this.athleteId !== 'number') return [];

    this.latestContext = this.latestContext?.profile ? { profile: { ...this.latestContext.profile } } : {};

    try {
      const weights = await this.loadWeightHistory(startISO, endISO);
      if (weights.length > 0) {
        this.latestContext = this.latestContext ?? {};
        this.latestContext.weights = weights;
        const latestWeight = weights[weights.length - 1]?.weight_kg;
        if (typeof latestWeight === 'number') {
          this.updateLatestProfile({ weight_kg: latestWeight });
        }
      }
    } catch {
      // loadWeightHistory already logs warnings; continue without blocking workouts
    }

    const path = this.buildEventsUrl(startISO, endISO);
    const events = (await this.fetchFromApi(path)) as IntervalsEventSummary[];
    if (!Array.isArray(events)) return [];

    this.log('info', `Received ${events.length} planned events`);

    const workouts: PlannedWorkout[] = [];

    for (const event of events) {
      const start =
        normaliseIso(event.start_date ?? event.start ?? event.start_time ?? event.start_date_local) ?? undefined;
      if (!start) continue;

      const steps =
        parseStructuredSteps(event.workout_doc ?? event.steps) ?? (await this.loadStructuredSteps(event));
      const durationSeconds = secondsFromEvent(event) ?? totalStepDurationSeconds(steps);
      const end = buildEndISO(start, durationSeconds, event.end ?? event.end_date ?? event.end_date_local);
      const tags = extractTags(event.tags);
      const labels = Array.isArray(event.labels) ? event.labels.map((label) => String(label)) : [];
      const defaultType = mapTagsToDefaultType([...tags, ...labels], 'Endurance');
      const sessionName = event.title ?? event.name ?? 'Workout';
      const icuIntensityPct = toFiniteNumber((event as any).icu_intensity);
      const inferredType = inferSessionType(
        sessionName,
        tags,
        labels,
        [event.type, event.workout_type, event.sport, event.category, event.description],
        steps,
        [
          toFiniteNumber(event.planned_intensity_factor),
          typeof icuIntensityPct === 'number' ? icuIntensityPct / 100 : undefined,
        ],
        defaultType,
      );
      let ftp = event.ftp_override ?? event.ftp ?? this.athleteFtp;
      const docFtp = (() => {
        const doc = (event as any).workout_doc;
        const v = doc && typeof doc === 'object' ? toFiniteNumber((doc as any).ftp) : undefined;
        return typeof v === 'number' && v > 0 ? v : undefined;
      })();
      if (typeof ftp !== 'number' && typeof docFtp === 'number') {
        ftp = docFtp;
      }
      const durationHr = ensureDurationHours(durationSeconds, start, end);
      if (typeof ftp === 'number') {
        this.updateLatestProfile({ ftp_watts: ftp });
      }
      const { planned_kJ, source } = extractPlannedKilojoules(event, steps, ftp, durationHr);

      this.log(
        'info',
        `Event ${event.id} kJ`,
        `kJ=${planned_kJ ?? 'NA'} src=${source} ftp=${(ftp ?? 'NA')} durHr=${durationHr.toFixed(
          2,
        )} IF%=${(event as any).icu_intensity ?? 'NA'}`,
      );

      workouts.push({
        id: String(event.id),
        source: 'intervals',
        title: sessionName,
        type: inferredType,
        startISO: start,
        endISO: end ?? start,
        duration_hr: durationHr,
        planned_kJ,
        ftp_watts_at_plan: ftp,
        steps,
        kj_source: source,
      });
    }

    const sorted = workouts.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
    this.log('info', `Prepared ${sorted.length} workouts for planner`);
    return sorted;
  }

  getLatestAthleteContext(): IntervalsAthleteContext | undefined {
    if (!this.latestContext) {
      return undefined;
    }
    const profile = this.latestContext.profile ? { ...this.latestContext.profile } : undefined;
    const weights = this.latestContext.weights
      ? this.latestContext.weights.map((entry) => ({ ...entry }))
      : undefined;
    return { profile, weights };
  }
}

export interface IntervalsProviderOptions {
  athleteId?: number; // allow 0 for “me”
}

export function createIntervalsProvider(
  apiKey: string,
  debug?: IntervalsDebugLogger,
  options?: IntervalsProviderOptions,
): IntervalsProvider {
  return new IntervalsProvider(apiKey, debug, options);
}
