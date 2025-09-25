import type { PlannedWorkout, SessionType, Step } from '../types.js';
import type { PlannedWorkoutProvider } from './provider.js';

const ICU_BASE_URL = 'https://intervals.icu/api/v1/';
const ICU_API_PREFIX = 'api/v1/';

export type IntervalsDebugLevel = 'info' | 'warn' | 'error';

export interface IntervalsDebugEntry {
  level?: IntervalsDebugLevel;
  message: string;
  detail?: string;
}

type IntervalsDebugLogger = (entry: IntervalsDebugEntry) => void;

interface IntervalsAthleteResponse {
  id: number;
  ftp?: number;
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
  duration?: number;
  planned_duration?: number;
  planned_duration_total?: number;
  planned_work_kj?: number;
  planned_work?: number;
  plannedWork?: number;
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
  steps?: unknown;
}

interface IntervalsEventDetail extends IntervalsEventSummary {
  structuredWorkout?: unknown;
  workout_file?: { id: number; ext?: string };
  files?: { id: number; ext?: string; type?: string }[];
}

interface PlannedKilojoulesResult {
  planned_kJ?: number;
  source: PlannedWorkout['kj_source'];
}

function encodeBasicAuth(key: string): string {
  if (typeof btoa === 'function') {
    return `Basic ${btoa(`${key}:`)}`;
  }
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

function normaliseIso(iso?: string): string | undefined {
  if (!iso) {
    return undefined;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function secondsFromEvent(event: IntervalsEventSummary): number | undefined {
  if (typeof event.planned_duration_total === 'number' && event.planned_duration_total > 0) {
    return event.planned_duration_total;
  }
  if (typeof event.planned_duration === 'number' && event.planned_duration > 0) {
    return event.planned_duration;
  }
  if (typeof event.duration === 'number' && event.duration > 0) {
    return event.duration;
  }
  return undefined;
}

function extractTags(collection: IntervalsTagCollection): string[] {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection.map((tag) => String(tag));
  }
  return Object.keys(collection).map((key) => key);
}

function inferSessionType(
  name: string,
  tags: string[],
  steps: Step[] | undefined,
  defaultType: SessionType,
): SessionType {
  const lowered = name.toLowerCase();
  const tagString = tags.map((tag) => tag.toLowerCase()).join(' ');

  if (tagString.includes('rest') || lowered.includes('rest day') || lowered.includes('off bike')) {
    return 'Rest';
  }

  if (tagString.includes('race') || lowered.includes('race') || lowered.includes('crits')) {
    return 'Race';
  }

  if (lowered.includes('vo2') || lowered.includes('v02') || tagString.includes('vo2')) {
    return 'VO2';
  }

  if (lowered.includes('threshold') || lowered.includes('sweet spot') || lowered.includes('sweetspot')) {
    return 'Threshold';
  }

  if (lowered.includes('tempo') || tagString.includes('tempo')) {
    return 'Tempo';
  }

  const maxPct = steps?.reduce((max, step) => {
    if (step.target_type === '%FTP') {
      const hi = step.target_hi ?? step.target_lo ?? 0;
      return Math.max(max, hi);
    }
    if (step.target_type === 'Watts' && step.target_hi) {
      return Math.max(max, step.target_hi);
    }
    return max;
  }, 0);

  if (maxPct && maxPct >= 115) {
    return 'VO2';
  }
  if (maxPct && maxPct >= 100) {
    return 'Threshold';
  }

  if (lowered.includes('recovery')) {
    return 'Endurance';
  }

  return defaultType;
}

function ensureDurationHours(seconds: number | undefined, startISO?: string, endISO?: string): number {
  if (seconds && seconds > 0) {
    return seconds / 3600;
  }
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
  if (fallbackEnd) {
    return normaliseIso(fallbackEnd);
  }
  if (!startISO || !seconds) {
    return undefined;
  }
  const start = Date.parse(startISO);
  if (Number.isNaN(start)) {
    return undefined;
  }
  const endMs = start + seconds * 1000;
  return new Date(endMs).toISOString();
}

function mapTagsToDefaultType(tags: string[], fallback: SessionType): SessionType {
  const lowered = tags.map((tag) => tag.toLowerCase());
  if (lowered.includes('vo2') || lowered.includes('vo₂')) {
    return 'VO2';
  }
  if (lowered.includes('threshold')) {
    return 'Threshold';
  }
  if (lowered.includes('tempo')) {
    return 'Tempo';
  }
  if (lowered.includes('race')) {
    return 'Race';
  }
  if (lowered.includes('rest')) {
    return 'Rest';
  }
  return fallback;
}

function truncate(value: string, limit = 200): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}

function summariseErrorBody(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') {
      return truncate(parsed);
    }
    if (parsed && typeof parsed === 'object') {
      const candidates = ['message', 'error', 'detail', 'title'] as const;
      for (const key of candidates) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim()) {
          return truncate(value.trim());
        }
      }
      return truncate(JSON.stringify(parsed));
    }
  } catch (error) {
    // fall through to returning the raw trimmed body
  }
  return truncate(trimmed);
}

function normaliseApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }
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
  if (!ftp || !intensityFactor || intensityFactor <= 0 || durationHr <= 0) {
    return undefined;
  }
  const avgWatts = ftp * intensityFactor;
  return (avgWatts * durationHr * 3600) / 1000;
}

function estimateFromTss(
  ftp: number | undefined,
  plannedTss: number | undefined,
  durationHr: number,
): number | undefined {
  if (!ftp || !plannedTss || plannedTss <= 0 || durationHr <= 0) {
    return undefined;
  }
  const ifactor = Math.sqrt(plannedTss / (durationHr * 100));
  if (!Number.isFinite(ifactor) || ifactor <= 0) {
    return undefined;
  }
  return estimateFromIf(ftp, ifactor, durationHr);
}

function sumStepKilojoules(steps: Step[], ftp: number | undefined): number | undefined {
  if (!ftp || steps.length === 0) {
    return undefined;
  }
  let total = 0;
  for (const step of steps) {
    if (step.target_type === '%FTP') {
      const lo = step.target_lo ?? step.target_hi ?? 0;
      const hi = step.target_hi ?? step.target_lo ?? 0;
      const pct = (lo + hi) / 2 / 100;
      total += pct * ftp * step.duration_s;
    } else if (step.target_type === 'Watts') {
      const lo = step.target_lo ?? step.target_hi ?? 0;
      const hi = step.target_hi ?? step.target_lo ?? 0;
      const watts = (lo + hi) / 2;
      total += watts * step.duration_s;
    }
  }
  if (total <= 0) {
    return undefined;
  }
  return total / 1000;
}

function parseStructuredSteps(structured: unknown): Step[] | undefined {
  if (!structured) {
    return undefined;
  }

  if (Array.isArray(structured)) {
    const steps: Step[] = [];
    let cursor = 0;
    for (const item of structured) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const duration = Number('duration' in item ? (item as any).duration : (item as any).Duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        continue;
      }
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

  return undefined;
}

function parseZwoSteps(zwo: string): Step[] | undefined {
  if (!zwo.trim()) {
    return undefined;
  }

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(zwo, 'application/xml');
      const workout = doc.querySelector('workout') ?? doc.querySelector('Workout');
      if (!workout) {
        return undefined;
      }
      const steps: Step[] = [];
      let cursor = 0;

      const appendStep = (duration: number, lo: number, hi: number) => {
        const durationSeconds = Math.max(1, Math.round(duration));
        steps.push({
          start_s: cursor,
          duration_s: durationSeconds,
          target_type: '%FTP',
          target_lo: lo,
          target_hi: hi,
        });
        cursor += durationSeconds;
      };

      const parsePower = (value: string | null): number => {
        if (!value) {
          return 0;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return 0;
        }
        return numeric <= 1 ? numeric * 100 : numeric;
      };

      const elements = workout.children;
      for (let i = 0; i < elements.length; i += 1) {
        const node = elements[i];
        const tag = node.tagName?.toLowerCase();
        if (!tag) {
          continue;
        }
        if (tag === 'steadystate') {
          const duration = Number(node.getAttribute('Duration'));
          const power = parsePower(node.getAttribute('Power'));
          appendStep(duration, power, power);
        } else if (tag === 'warmup' || tag === 'cooldown') {
          const duration = Number(node.getAttribute('Duration'));
          const low = parsePower(node.getAttribute('PowerLow'));
          const high = parsePower(node.getAttribute('PowerHigh'));
          appendStep(duration, low, high);
        } else if (tag === 'intervalst') {
          const repeats = Number(node.getAttribute('Repeat'));
          const onDuration = Number(node.getAttribute('OnDuration'));
          const offDuration = Number(node.getAttribute('OffDuration'));
          const onPower = parsePower(node.getAttribute('OnPower'));
          const offPower = parsePower(node.getAttribute('OffPower'));
          const repeatCount = Number.isFinite(repeats) && repeats > 0 ? Math.round(repeats) : 1;
          for (let r = 0; r < repeatCount; r += 1) {
            appendStep(onDuration, onPower, onPower);
            if (offDuration > 0) {
              appendStep(offDuration, offPower, offPower);
            }
          }
        } else if (tag === 'freeride') {
          const duration = Number(node.getAttribute('Duration'));
          const watts = Number(node.getAttribute('FlatRoadSpeed'));
          if (Number.isFinite(watts) && watts > 0) {
            const durationSeconds = Math.max(1, Math.round(duration));
            steps.push({
              start_s: cursor,
              duration_s: durationSeconds,
              target_type: 'Watts',
              target_lo: watts,
              target_hi: watts,
            });
            cursor += durationSeconds;
          } else {
            appendStep(duration, 55, 65);
          }
        }
      }

      return steps.length > 0 ? steps : undefined;
    } catch (error) {
      console.warn('Failed to parse ZWO structured workout', error);
    }
  }

  return undefined;
}

function extractPlannedKilojoules(
  event: IntervalsEventSummary,
  steps: Step[] | undefined,
  ftp: number | undefined,
  durationHr: number,
): PlannedKilojoulesResult {
  const directCandidates = [
    event.planned_work_kj,
    event.planned_work,
    event.plannedWork,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === 'number' && candidate > 0) {
      return { planned_kJ: candidate, source: 'ICU Structured' };
    }
  }

  if (steps && steps.length > 0) {
    const estimated = sumStepKilojoules(steps, ftp);
    if (typeof estimated === 'number') {
      return { planned_kJ: estimated, source: 'Estimated (steps)' };
    }
  }

  const fromIf = estimateFromIf(ftp, event.planned_intensity_factor, durationHr);
  if (typeof fromIf === 'number') {
    return { planned_kJ: fromIf, source: 'Estimated (IF/TSS)' };
  }

  const fromTss = estimateFromTss(ftp, event.planned_tss ?? (event as any).plannedTss, durationHr);
  if (typeof fromTss === 'number') {
    return { planned_kJ: fromTss, source: 'Estimated (IF/TSS)' };
  }

  return { planned_kJ: undefined, source: 'Estimated (IF/TSS)' };
}

async function fetchStructuredFile(
  fetcher: (path: string, responseType?: 'json' | 'text') => Promise<unknown>,
  athleteId: number,
  event: IntervalsEventSummary,
): Promise<Step[] | undefined> {
  const detail = (await fetcher(`/athlete/${athleteId}/events/${event.id}`, 'json')) as
    | IntervalsEventDetail
    | undefined;
  if (!detail) {
    return undefined;
  }

  const structured = detail.structuredWorkout ?? detail.steps ?? (detail as any).structured_workout;
  const parsedSteps = parseStructuredSteps(structured ?? detail.steps);
  if (parsedSteps && parsedSteps.length > 0) {
    return parsedSteps;
  }

  const fileId =
    detail.structured_workout_id ??
    detail.structuredWorkoutId ??
    detail.workout_file_id ??
    detail.workoutFileId ??
    detail.workout_file?.id ??
    detail.files?.find((file) => file.ext === 'zwo' || file.type === 'structured')?.id;
  if (!fileId) {
    return undefined;
  }

  const response = await fetcher(
    `/athlete/${athleteId}/files/${fileId}?ext=zwo&resolve=true`,
    'text',
  );
  if (typeof response === 'string') {
    return parseZwoSteps(response);
  }

  return undefined;
}

export class IntervalsProvider implements PlannedWorkoutProvider {
  private readonly apiKey: string;

  private readonly debug?: IntervalsDebugLogger;

  private athleteId?: number;

  private athleteFtp?: number;

  constructor(apiKey: string, debug?: IntervalsDebugLogger) {
    this.apiKey = apiKey;
    this.debug = debug;
  }

  private log(level: IntervalsDebugLevel, message: string, detail?: string): void {
    if (this.debug) {
      this.debug({ level, message, detail });
    }
  }

  private async fetchFromApi(path: string, responseType: 'json' | 'text' = 'json'): Promise<any> {
    const url = path.startsWith('http')
      ? new URL(path)
      : new URL(normaliseApiPath(path), ICU_BASE_URL);
    const summaryPath = `${url.pathname}${url.search}`;

    this.log('info', `GET ${summaryPath}`, 'Sending request to Intervals.icu');

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: encodeBasicAuth(this.apiKey),
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
      this.log('error', `Intervals.icu responded ${response.status}${statusText} for GET ${summaryPath}`, detail);
      throw new Error(
        `Intervals.icu request failed (${response.status}${statusText}) for GET ${summaryPath}${suffix}`,
      );
    }

    this.log('info', `GET ${summaryPath} → ${response.status}`, response.statusText || undefined);

    return responseType === 'json' ? response.json() : response.text();
  }

  private async ensureAthlete(): Promise<void> {
    if (typeof this.athleteId === 'number') {
      return;
    }
    this.log('info', 'Loading Intervals.icu athlete profile');
    const athlete = (await this.fetchFromApi('/athlete')) as IntervalsAthleteResponse;
    if (!athlete || typeof athlete.id !== 'number') {
      throw new Error('Unable to load Intervals.icu athlete profile');
    }
    this.athleteId = athlete.id;
    if (typeof athlete.ftp === 'number') {
      this.athleteFtp = athlete.ftp;
    }
    this.log(
      'info',
      `Loaded athlete profile ${this.athleteId}`,
      typeof this.athleteFtp === 'number' ? `FTP ${this.athleteFtp}` : undefined,
    );
  }

  private buildEventsUrl(startISO: string, endISO: string): string {
    if (typeof this.athleteId !== 'number') {
      throw new Error('Athlete ID is not loaded');
    }
    const url = new URL(`/athlete/${this.athleteId}/events`, ICU_BASE_URL);
    url.searchParams.set('start', startISO);
    url.searchParams.set('end', endISO);
    url.searchParams.set('category', 'WORKOUT');
    return url.pathname + url.search;
  }

  private async loadStructuredSteps(event: IntervalsEventSummary): Promise<Step[] | undefined> {
    if (typeof this.athleteId !== 'number') {
      return undefined;
    }
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

  async getPlannedWorkouts(startISO: string, endISO: string): Promise<PlannedWorkout[]> {
    this.log('info', 'Preparing to sync planned workouts', `${startISO} → ${endISO}`);
    await this.ensureAthlete();
    if (typeof this.athleteId !== 'number') {
      return [];
    }

    const path = this.buildEventsUrl(startISO, endISO);
    const events = (await this.fetchFromApi(path)) as IntervalsEventSummary[];
    if (!Array.isArray(events)) {
      return [];
    }

    this.log('info', `Received ${events.length} planned events`);

    const workouts: PlannedWorkout[] = [];

    for (const event of events) {
      const start =
        normaliseIso(event.start_date ?? event.start ?? event.start_time ?? event.start_date_local) ??
        undefined;
      if (!start) {
        continue;
      }
      const durationSeconds = secondsFromEvent(event);
      const end = buildEndISO(start, durationSeconds, event.end ?? event.end_date);
      const steps = parseStructuredSteps(event.steps) ?? (await this.loadStructuredSteps(event));
      const tags = extractTags(event.tags);
      const defaultType = mapTagsToDefaultType(tags, 'Endurance');
      const sessionName = event.title ?? event.name ?? 'Workout';
      const inferredType = inferSessionType(sessionName, tags, steps, defaultType);
      const ftp = event.ftp_override ?? event.ftp ?? this.athleteFtp;
      const durationHr = ensureDurationHours(durationSeconds, start, end);
      const { planned_kJ, source } = extractPlannedKilojoules(event, steps, ftp, durationHr);

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

    const sorted = workouts.sort(
      (a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime(),
    );
    this.log('info', `Prepared ${sorted.length} workouts for planner`);
    return sorted;
  }
}

export function createIntervalsProvider(
  apiKey: string,
  debug?: IntervalsDebugLogger,
): IntervalsProvider {
  return new IntervalsProvider(apiKey, debug);
}

