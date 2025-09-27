import { create } from 'zustand';
import { createFakeProvider } from '../adapters/fake.js';
import { createIntervalsProvider, type IntervalsDebugEntry } from '../adapters/intervals.js';
import { buildWindows } from '../calc/prescribe.js';
import {
  WINDOW_EMPTY_FLAG,
  WINDOW_UNDER_RECOVERY_FLAG,
  allocateWeeklyDeficits,
} from '../calc/weekly.js';
import { sampleProfile } from '../samples/profile.js';
import type {
  EfficiencyPreset,
  PlannedWorkout,
  Profile,
  SessionType,
  WindowPlan,
  WeeklyPlan,
  WeightEntry,
} from '../types.js';
import {
  loadCachedWorkouts,
  loadIntervalsSettings,
  loadStoredOverrides,
  persistCachedWorkouts,
  persistIntervalsSettings,
  persistOverrides,
  loadStoredWeights,
  persistWeights,
  type StoredIntervalsSettings,
} from './storage.js';
import type { PlannerOverrides, PlannerPage, PlannerStatus } from './types.js';

const SAMPLE_START_ISO = '2024-06-10T00:00:00.000Z';
const SAMPLE_END_ISO = '2024-06-20T00:00:00.000Z';
const DEFAULT_RANGE_DAYS = 7;

const EFFICIENCY_PRESET_VALUES: Record<EfficiencyPreset, number> = {
  WorldClass: 0.19,
  Elite: 0.21,
  Competitive: 0.23,
  Enthusiast: 0.25,
};

interface IntervalsConnectionSettings {
  apiKey: string;
  startDateISO: string;
  rangeDays: number;
  athleteId: string;
}

type PlannerDataSource = 'sample' | 'intervals';

interface SyncLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const KG_PER_LB = 0.45359237;

type ExternalProfileUpdate = Partial<
  Pick<Profile, 'sex' | 'age_years' | 'height_cm' | 'weight_kg' | 'ftp_watts' | 'useImperial'>
>;

export interface WeightTrendPoint {
  dateISO: string;
  weight_kg: number;
  rollingAvg_kg?: number;
}

export interface WeightSummary {
  startISO: string;
  endISO: string;
  days: number;
  actualDeltaKg: number;
  expectedDeltaKg: number;
}

interface PlannerState {
  status: PlannerStatus;
  error?: string;
  syncError?: string;
  page: PlannerPage;
  baseProfile: Profile;
  profile: Profile;
  overrides: PlannerOverrides;
  workouts: PlannedWorkout[];
  windows: WindowPlan[];
  weekly: WeeklyPlan[];
  weights: WeightEntry[];
  weightTrend: WeightTrendPoint[];
  weightSummary?: WeightSummary;
  connection: IntervalsConnectionSettings;
  dataSource: PlannerDataSource;
  lastSyncISO?: string;
  isRefreshing: boolean;
  syncLog: SyncLogEntry[];
  init(): Promise<void>;
  setPage(page: PlannerPage): void;
  updateOverride<K extends keyof PlannerOverrides>(key: K, value: PlannerOverrides[K]): void;
  updateCarbBand(type: SessionType, index: 0 | 1, value: number): void;
  updateCarbSplit(part: 'pre' | 'during' | 'post', value: number): void;
  updateConnectionSetting<K extends keyof IntervalsConnectionSettings>(
    key: K,
    value: IntervalsConnectionSettings[K],
  ): void;
  refreshWorkouts(): Promise<void>;
  setWorkoutType(workoutId: string, type: SessionType): void;
  resetWorkoutType(workoutId: string): void;
  upsertWeightEntry(dateISO: string, value: number, unit: 'kg' | 'lb'): void;
  deleteWeightEntry(dateISO: string): void;
}

function cloneCarbBands(bands: Profile['carbBands']): Profile['carbBands'] {
  return Object.entries(bands).reduce((acc, [key, values]) => {
    acc[key as SessionType] = [values[0], values[1]];
    return acc;
  }, {} as Profile['carbBands']);
}

function cloneCarbSplit(split: Profile['carbSplit']): Profile['carbSplit'] {
  return { ...split };
}

function efficiencyFromPreset(preset: EfficiencyPreset): number {
  return EFFICIENCY_PRESET_VALUES[preset] ?? sampleProfile.efficiency;
}

function resolvePresetForEfficiency(value: number): EfficiencyPreset | undefined {
  const entries = Object.entries(EFFICIENCY_PRESET_VALUES) as [EfficiencyPreset, number][];
  for (const [preset, presetValue] of entries) {
    if (Math.abs(presetValue - value) < 0.0005) {
      return preset;
    }
  }
  return undefined;
}

function normalizeDateKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return new Date().toISOString().slice(0, 10);
  }
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeWeightEntry(entry: WeightEntry): WeightEntry {
  const normalizedSource: WeightEntry['source'] = entry.source === 'intervals' ? 'intervals' : 'manual';
  return {
    dateISO: normalizeDateKey(entry.dateISO),
    weight_kg: entry.weight_kg,
    source: normalizedSource,
  };
}

function sortWeights(weights: WeightEntry[]): WeightEntry[] {
  return [...weights].sort((a, b) => {
    const aMs = new Date(`${normalizeDateKey(a.dateISO)}T00:00:00Z`).getTime();
    const bMs = new Date(`${normalizeDateKey(b.dateISO)}T00:00:00Z`).getTime();
    return aMs - bMs;
  });
}

function upsertWeightList(weights: WeightEntry[], entry: WeightEntry): WeightEntry[] {
  const normalized = normalizeWeightEntry(entry);
  const filtered = weights.filter((existing) => normalizeDateKey(existing.dateISO) !== normalized.dateISO);
  filtered.push(normalized);
  return sortWeights(filtered);
}

function removeWeightByDate(weights: WeightEntry[], dateISO: string): WeightEntry[] {
  const normalized = normalizeDateKey(dateISO);
  return weights.filter((entry) => {
    if (normalizeDateKey(entry.dateISO) !== normalized) {
      return true;
    }
    return entry.source === 'intervals';
  });
}

function mergeImportedWeights(existing: WeightEntry[], imported: WeightEntry[]): WeightEntry[] {
  if (imported.length === 0) {
    return sortWeights(existing);
  }

  const manualDates = new Set(
    existing
      .filter((entry) => entry.source !== 'intervals')
      .map((entry) => normalizeDateKey(entry.dateISO)),
  );

  const byDate = new Map<string, WeightEntry>();
  for (const entry of existing) {
    const normalized = normalizeWeightEntry(entry);
    byDate.set(normalized.dateISO, normalized);
  }

  for (const entry of imported) {
    const normalized = normalizeWeightEntry({ ...entry, source: 'intervals' });
    if (manualDates.has(normalized.dateISO)) {
      continue;
    }
    byDate.set(normalized.dateISO, normalized);
  }

  return sortWeights(Array.from(byDate.values()));
}

function latestWeightKg(weights: WeightEntry[]): number | undefined {
  if (weights.length === 0) {
    return undefined;
  }
  const sorted = sortWeights(weights);
  return sorted[sorted.length - 1]?.weight_kg;
}

function cloneProfile(profile: Profile): Profile {
  return {
    ...profile,
    carbBands: cloneCarbBands(profile.carbBands),
    carbSplit: cloneCarbSplit(profile.carbSplit),
    activityFactorOverrides: profile.activityFactorOverrides
      ? { ...profile.activityFactorOverrides }
      : undefined,
  };
}

function applyExternalProfile(
  base: Profile,
  update?: ExternalProfileUpdate,
  weightFallback?: number,
): Profile {
  const next = cloneProfile(base);
  if (update) {
    if (update.sex === 'M' || update.sex === 'F') {
      next.sex = update.sex;
    }
    if (typeof update.age_years === 'number' && Number.isFinite(update.age_years)) {
      next.age_years = Math.max(0, Math.round(update.age_years));
    }
    if (typeof update.height_cm === 'number' && Number.isFinite(update.height_cm)) {
      next.height_cm = update.height_cm;
    }
    if (typeof update.weight_kg === 'number' && Number.isFinite(update.weight_kg)) {
      next.weight_kg = update.weight_kg;
    }
    if (typeof update.ftp_watts === 'number' && Number.isFinite(update.ftp_watts)) {
      next.ftp_watts = update.ftp_watts;
    }
    if (typeof update.useImperial === 'boolean') {
      next.useImperial = update.useImperial;
    }
  }
  if (typeof weightFallback === 'number' && Number.isFinite(weightFallback)) {
    next.weight_kg = weightFallback;
  }
  return next;
}

function computeWeightTrend(weights: WeightEntry[]): WeightTrendPoint[] {
  const sorted = sortWeights(weights);
  return sorted.map((entry, index) => {
    const currentDate = new Date(`${entry.dateISO}T00:00:00Z`);
    const windowStart = currentDate.getTime() - 6 * MS_PER_DAY;
    let sum = 0;
    let count = 0;
    for (let j = index; j >= 0; j -= 1) {
      const candidate = sorted[j];
      const candidateMs = new Date(`${candidate.dateISO}T00:00:00Z`).getTime();
      if (candidateMs < windowStart) {
        break;
      }
      sum += candidate.weight_kg;
      count += 1;
    }
    const rolling = count > 0 ? sum / count : entry.weight_kg;
    return { dateISO: entry.dateISO, weight_kg: entry.weight_kg, rollingAvg_kg: rolling };
  });
}

function computeWeightSummary(profile: Profile, weights: WeightEntry[]): WeightSummary | undefined {
  if (weights.length < 2) {
    return undefined;
  }
  const sorted = sortWeights(weights);
  const latest = sorted[sorted.length - 1];
  const latestDate = new Date(`${latest.dateISO}T00:00:00Z`);
  const windowStart = latestDate.getTime() - 6 * MS_PER_DAY;
  let baseline = sorted[sorted.length - 2];
  for (let i = sorted.length - 2; i >= 0; i -= 1) {
    const candidate = sorted[i];
    const candidateMs = new Date(`${candidate.dateISO}T00:00:00Z`).getTime();
    baseline = candidate;
    if (candidateMs <= windowStart) {
      break;
    }
  }
  if (!baseline) {
    return undefined;
  }
  const baselineDate = new Date(`${baseline.dateISO}T00:00:00Z`);
  const days = Math.max(1, Math.round((latestDate.getTime() - baselineDate.getTime()) / MS_PER_DAY));
  const actualDeltaKg = latest.weight_kg - baseline.weight_kg;
  const expectedDeltaKg = (profile.targetKgPerWeek / 7) * days;
  return {
    startISO: baseline.dateISO,
    endISO: latest.dateISO,
    days,
    actualDeltaKg,
    expectedDeltaKg,
  };
}

function findWindowAfterDate(windows: WindowPlan[], dateISO: string): WindowPlan | undefined {
  if (windows.length === 0) {
    return undefined;
  }
  const anchor = new Date(`${dateISO}T12:00:00Z`).getTime();
  const match = windows.find((window) => new Date(window.windowEndISO).getTime() >= anchor);
  return match ?? windows[windows.length - 1];
}

function applyWeightFlags(
  windows: WindowPlan[],
  weights: WeightEntry[],
  summary?: WeightSummary,
): void {
  if (windows.length === 0 || weights.length === 0) {
    return;
  }
  const sorted = sortWeights(weights);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const current = sorted[i];
    if (prev.dateISO === current.dateISO) {
      continue;
    }
    const drop = prev.weight_kg - current.weight_kg;
    if (drop >= 1) {
      const window = findWindowAfterDate(windows, current.dateISO);
      if (window && !window.notes.includes(WINDOW_EMPTY_FLAG)) {
        window.notes.push(WINDOW_EMPTY_FLAG);
      }
    }
  }

  if (summary && summary.expectedDeltaKg < -0.1) {
    const extraLossKg = summary.expectedDeltaKg - summary.actualDeltaKg;
    if (extraLossKg >= 0.35) {
      const latest = sorted[sorted.length - 1];
      const window = findWindowAfterDate(windows, latest.dateISO);
      if (window && !window.notes.includes(WINDOW_UNDER_RECOVERY_FLAG)) {
        window.notes.push(WINDOW_UNDER_RECOVERY_FLAG);
      }
    }
  }
}

function createDefaultOverrides(profile: Profile): PlannerOverrides {
  return {
    efficiencyPreset: profile.efficiencyPreset,
    efficiency: profile.efficiency,
    activityFactorDefault: profile.activityFactorDefault,
    targetKgPerWeek: profile.targetKgPerWeek,
    deficitCapPerWindow: profile.deficitCapPerWindow,
    protein_g_per_kg: profile.protein_g_per_kg,
    fat_g_per_kg_min: profile.fat_g_per_kg_min,
    carbBands: cloneCarbBands(profile.carbBands),
    carbSplit: cloneCarbSplit(profile.carbSplit),
    gluFruRatio: profile.gluFruRatio,
  };
}

function mergeOverrides(base: PlannerOverrides, stored?: PlannerOverrides): PlannerOverrides {
  if (!stored) {
    return base;
  }

  const result: PlannerOverrides = {
    ...base,
    ...stored,
    carbBands: cloneCarbBands(base.carbBands),
    carbSplit: cloneCarbSplit(base.carbSplit),
  };

  if (stored.carbBands) {
    for (const [key, values] of Object.entries(stored.carbBands)) {
      const session = key as SessionType;
      if (result.carbBands[session]) {
        result.carbBands[session] = [values[0], values[1]];
      }
    }
  }

  if (stored.carbSplit) {
    result.carbSplit = cloneCarbSplit(stored.carbSplit);
  }

  return result;
}

function applyOverrides(base: Profile, overrides: PlannerOverrides): Profile {
  return {
    ...base,
    efficiencyPreset: overrides.efficiencyPreset,
    efficiency: overrides.efficiency,
    activityFactorDefault: overrides.activityFactorDefault,
    targetKgPerWeek: overrides.targetKgPerWeek,
    deficitCapPerWindow: overrides.deficitCapPerWindow,
    protein_g_per_kg: overrides.protein_g_per_kg,
    fat_g_per_kg_min: overrides.fat_g_per_kg_min,
    carbBands: cloneCarbBands(overrides.carbBands),
    carbSplit: cloneCarbSplit(overrides.carbSplit),
    gluFruRatio: overrides.gluFruRatio,
  };
}

function recomputePlan(
  baseProfile: Profile,
  overrides: PlannerOverrides,
  workouts: PlannedWorkout[],
  weights: WeightEntry[],
): { profile: Profile; windows: WindowPlan[]; weekly: WeeklyPlan[]; weightSummary?: WeightSummary } {
  const profile = applyOverrides(baseProfile, overrides);
  const weightSummary = computeWeightSummary(profile, weights);
  if (workouts.length === 0) {
    return { profile, windows: [], weekly: [], weightSummary };
  }

  const windows = buildWindows(profile, workouts);
  applyWeightFlags(windows, weights, weightSummary);
  const { windows: adjusted, weekly } = allocateWeeklyDeficits(profile, windows, workouts);
  return { profile, windows: adjusted, weekly, weightSummary };
}

function clampRangeDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RANGE_DAYS;
  }
  return Math.min(14, Math.max(7, Math.round(value)));
}

function createDefaultConnection(): IntervalsConnectionSettings {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return {
    apiKey: '',
    startDateISO: todayUTC.toISOString().slice(0, 10),
    rangeDays: DEFAULT_RANGE_DAYS,
    athleteId: '',
  };
}

function mergeConnectionSettings(
  base: IntervalsConnectionSettings,
  stored?: StoredIntervalsSettings,
): IntervalsConnectionSettings {
  if (!stored) {
    return base;
  }

  const merged: IntervalsConnectionSettings = { ...base };
  if (typeof stored.apiKey === 'string') {
    merged.apiKey = stored.apiKey;
  }
  if (typeof stored.startDateISO === 'string' && stored.startDateISO.length >= 4) {
    merged.startDateISO = stored.startDateISO;
  }
  if (typeof stored.rangeDays === 'number') {
    merged.rangeDays = clampRangeDays(stored.rangeDays);
  }
  if (typeof stored.athleteId === 'string') {
    merged.athleteId = stored.athleteId;
  }
  return merged;
}

function parseAthleteId(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(/\d+/g);
  if (!match || match.length === 0) {
    return undefined;
  }

  const numeric = Number(match[match.length - 1]);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const rounded = Math.round(numeric);
  return rounded >= 0 ? rounded : undefined;
}

function computeIntervalsRange(settings: IntervalsConnectionSettings): {
  startISO: string;
  endISO: string;
} {
  // Use today's date (UTC midnight) as the baseline. If the user selected a future
  // startDateISO, use that; otherwise ignore past dates and start from today.
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const parsed = new Date(`${settings.startDateISO}T00:00:00Z`);
  const candidate = Number.isNaN(parsed.getTime()) ? todayUTC : parsed;
  const startDate = candidate < todayUTC ? todayUTC : candidate;
  const rangeDays = clampRangeDays(settings.rangeDays);
  const endDate = new Date(startDate.getTime() + rangeDays * 24 * 60 * 60 * 1000);
  return { startISO: startDate.toISOString(), endISO: endDate.toISOString() };
}


function shouldResetLastSync(key: keyof IntervalsConnectionSettings): boolean {
  return key === 'rangeDays' || key === 'startDateISO' || key === 'athleteId';
}

export const usePlannerStore = create<PlannerState>((set, get) => {
  const initialBaseProfile = cloneProfile(sampleProfile);
  const defaultOverrides = createDefaultOverrides(initialBaseProfile);
  const defaultConnection = createDefaultConnection();

  const LOG_LIMIT = 50;

  const pushSyncLog = (
    level: SyncLogEntry['level'],
    message: string,
    detail?: string,
  ) => {
    const entry: SyncLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      detail,
    };
    set((state) => {
      const next = [...state.syncLog, entry];
      return {
        syncLog: next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next,
      };
    });
  };

  const resetSyncLog = (
    initial?: { level?: SyncLogEntry['level']; message: string; detail?: string },
  ) => {
    if (initial) {
      const entry: SyncLogEntry = {
        timestamp: new Date().toISOString(),
        level: initial.level ?? 'info',
        message: initial.message,
        detail: initial.detail,
      };
      set({ syncLog: [entry] });
      return;
    }
    set({ syncLog: [] });
  };

  const forwardIntervalsDebug = (entry: IntervalsDebugEntry) => {
    pushSyncLog(entry.level ?? 'info', entry.message, entry.detail);
  };

  const formatRangeDetail = (startISO: string, endISO: string) => {
    const start = new Date(startISO).toLocaleString();
    const end = new Date(endISO).toLocaleString();
    return `${start} → ${end}`;
  };

  return {
    status: 'idle',
    page: 'onboarding',
    baseProfile: initialBaseProfile,
    profile: applyOverrides(initialBaseProfile, defaultOverrides),
    overrides: defaultOverrides,
    workouts: [],
    windows: [],
    weekly: [],
    weights: [],
    weightTrend: [],
    weightSummary: undefined,
    connection: defaultConnection,
    dataSource: 'sample',
    lastSyncISO: undefined,
    isRefreshing: false,
    error: undefined,
    syncError: undefined,
    syncLog: [],
    async init() {
      if (get().status !== 'idle') {
        return;
      }

      set({ status: 'loading', error: undefined });
      resetSyncLog();

      try {
        const [storedOverrides, storedConnection, storedWeights] = await Promise.all([
          loadStoredOverrides(),
          loadIntervalsSettings(),
          loadStoredWeights(),
        ]);

        const overrides = mergeOverrides(defaultOverrides, storedOverrides);
        const connection = mergeConnectionSettings(defaultConnection, storedConnection);
        const { startISO, endISO } = computeIntervalsRange(connection);
        let weights = sortWeights((storedWeights ?? []).map(normalizeWeightEntry));
        let weightTrend = computeWeightTrend(weights);

        let workouts: PlannedWorkout[] = [];
        let dataSource: PlannerDataSource = 'sample';
        let lastSyncISO: string | undefined;
        let syncError: string | undefined;
        let importedWeights: WeightEntry[] = [];
        let externalProfile: ExternalProfileUpdate | undefined;

        if (connection.apiKey) {
          pushSyncLog('info', 'Intervals.icu API key detected');
          const parsedAthleteId = parseAthleteId(connection.athleteId);
          const resolvedAthleteId = typeof parsedAthleteId === 'number' ? parsedAthleteId : 0;
          if (typeof parsedAthleteId === 'number') {
            pushSyncLog('info', 'Using provided athlete ID', String(parsedAthleteId));
          } else {
            pushSyncLog('info', 'Using current athlete (ID 0)');
          }
          pushSyncLog('info', 'Sync window selected', formatRangeDetail(startISO, endISO));
          const cached = await loadCachedWorkouts(startISO, endISO);
          if (cached) {
            workouts = cached.workouts;
            lastSyncISO = cached.fetchedISO;
            dataSource = 'intervals';
            pushSyncLog(
              'info',
              `Loaded ${workouts.length} cached workout${workouts.length === 1 ? '' : 's'}`,
              cached.fetchedISO ? new Date(cached.fetchedISO).toLocaleString() : undefined,
            );
          } else {
            try {
              pushSyncLog('info', 'Requesting workouts from Intervals.icu');
              const provider = createIntervalsProvider(
                connection.apiKey.trim(),
                forwardIntervalsDebug,
                { athleteId: resolvedAthleteId },
              );
              workouts = await provider.getPlannedWorkouts(startISO, endISO);
              const context = provider.getLatestAthleteContext?.();
              if (context) {
                importedWeights = context.weights ?? [];
                externalProfile = context.profile ?? externalProfile;
              }
              dataSource = 'intervals';
              lastSyncISO = new Date().toISOString();
              await persistCachedWorkouts(startISO, endISO, workouts, lastSyncISO);
              pushSyncLog('info', `Synced ${workouts.length} workout${workouts.length === 1 ? '' : 's'}`);
            } catch (error) {
              syncError = error instanceof Error ? error.message : 'Failed to sync Intervals.icu workouts';
              pushSyncLog('error', syncError);
            }
          }
        }

        if (workouts.length === 0) {
          const provider = createFakeProvider();
          workouts = await provider.getPlannedWorkouts(SAMPLE_START_ISO, SAMPLE_END_ISO);
          dataSource = 'sample';
          lastSyncISO = undefined;
          if (connection.apiKey) {
            pushSyncLog('warn', 'No workouts returned from Intervals.icu', 'Falling back to sample data.');
          }
          pushSyncLog('info', `Loaded ${workouts.length} sample workout${workouts.length === 1 ? '' : 's'}`);
          if (!connection.apiKey) {
            pushSyncLog('info', 'Intervals.icu API key not configured', 'Using sample data.');
          }
        }

        if (importedWeights.length > 0) {
          weights = mergeImportedWeights(weights, importedWeights);
          weightTrend = computeWeightTrend(weights);
        }

        const latestKg = latestWeightKg(weights);
        const baseProfileForPlan = applyExternalProfile(initialBaseProfile, externalProfile, latestKg);
        const { profile, windows, weekly, weightSummary } = recomputePlan(
          baseProfileForPlan,
          overrides,
          workouts,
          weights,
        );
        set({
          status: 'ready',
          overrides,
          workouts,
          profile,
          windows,
          weekly,
          weights,
          weightTrend,
          weightSummary,
          baseProfile: baseProfileForPlan,
          connection,
          dataSource,
          lastSyncISO,
          syncError,
          error: undefined,
        });
        void persistWeights(weights);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error loading plan';
        set({ status: 'error', error: message });
        pushSyncLog('error', message);
      }
    },
    setPage(page) {
      set({ page });
    },
    updateOverride(key, value) {
      const state = get();
      let overrides: PlannerOverrides;
      if (key === 'efficiencyPreset') {
        const preset = value as EfficiencyPreset;
        overrides = {
          ...state.overrides,
          efficiencyPreset: preset,
          efficiency: efficiencyFromPreset(preset),
        } as PlannerOverrides;
      } else if (key === 'efficiency') {
        const numeric = typeof value === 'number' ? value : Number(value);
        overrides = {
          ...state.overrides,
          efficiency: Number.isFinite(numeric) ? numeric : state.overrides.efficiency,
        } as PlannerOverrides;
        const matched = resolvePresetForEfficiency(overrides.efficiency);
        if (matched) {
          overrides.efficiencyPreset = matched;
        }
      } else {
        overrides = { ...state.overrides, [key]: value } as PlannerOverrides;
      }
      const { profile, windows, weekly, weightSummary } = recomputePlan(
        state.baseProfile,
        overrides,
        state.workouts,
        state.weights,
      );
      set({ overrides, profile, windows, weekly, weightSummary });
      void persistOverrides(overrides);
    },
    updateCarbBand(type, index, value) {
      const state = get();
      const bands = cloneCarbBands(state.overrides.carbBands);
      const band = bands[type] ?? [0, 0];
      if (index === 0) {
        band[0] = value;
        if (band[1] < value) {
          band[1] = value;
        }
      } else {
        band[1] = Math.max(value, band[0]);
      }
      bands[type] = band;
      const overrides = { ...state.overrides, carbBands: bands } as PlannerOverrides;
      const { profile, windows, weekly, weightSummary } = recomputePlan(
        state.baseProfile,
        overrides,
        state.workouts,
        state.weights,
      );
      set({ overrides, profile, windows, weekly, weightSummary });
      void persistOverrides(overrides);
    },
    updateCarbSplit(part, value) {
      const state = get();
      const split = { ...state.overrides.carbSplit, [part]: value } as Profile['carbSplit'];
      const overrides = { ...state.overrides, carbSplit: split } as PlannerOverrides;
      const { profile, windows, weekly, weightSummary } = recomputePlan(
        state.baseProfile,
        overrides,
        state.workouts,
        state.weights,
      );
      set({ overrides, profile, windows, weekly, weightSummary });
      void persistOverrides(overrides);
    },
    updateConnectionSetting(key, value) {
      const state = get();
      const updated: IntervalsConnectionSettings = { ...state.connection };
      if (key === 'apiKey') {
        const next = String(value ?? '');
        const trimmed = next.trim();
        const hadKey = Boolean(state.connection.apiKey.trim());
        updated.apiKey = next;
        if (!hadKey && trimmed) {
          updated.rangeDays = DEFAULT_RANGE_DAYS;
        }
      } else if (key === 'startDateISO') {
        updated.startDateISO = String(value ?? '');
      } else if (key === 'rangeDays') {
        const numeric = typeof value === 'number' ? value : Number(value);
        updated.rangeDays = clampRangeDays(numeric);
      } else if (key === 'athleteId') {
        updated.athleteId = String(value ?? '');
      }
      const nextState: Partial<PlannerState> = {
        connection: updated,
      };
      if (shouldResetLastSync(key)) {
        nextState.lastSyncISO = undefined;
      }
      if (key === 'apiKey') {
        nextState.syncError = undefined;
      }
      set(nextState);
      void persistIntervalsSettings(updated);
    },
    async refreshWorkouts() {
      const state = get();
      const { connection, overrides } = state;
      const { startISO, endISO } = computeIntervalsRange(connection);
      resetSyncLog({
        message: connection.apiKey ? 'Refreshing from Intervals.icu' : 'Loading sample plan',
        detail: connection.apiKey ? formatRangeDetail(startISO, endISO) : undefined,
      });
      set({ isRefreshing: true, syncError: undefined });

      try {
        let workouts: PlannedWorkout[];
        let dataSource: PlannerDataSource;
        let lastSyncISO: string | undefined;
        let importedWeights: WeightEntry[] = [];
        let externalProfile: ExternalProfileUpdate | undefined;
        let weights = state.weights;

        if (connection.apiKey) {
          const parsedAthleteId = parseAthleteId(connection.athleteId);
          const resolvedAthleteId = typeof parsedAthleteId === 'number' ? parsedAthleteId : 0;
          if (typeof parsedAthleteId === 'number') {
            pushSyncLog('info', 'Using provided athlete ID', String(parsedAthleteId));
          } else {
            pushSyncLog('info', 'Using current athlete (ID 0)');
          }
          const provider = createIntervalsProvider(connection.apiKey.trim(), forwardIntervalsDebug, {
            athleteId: resolvedAthleteId,
          });
          workouts = await provider.getPlannedWorkouts(startISO, endISO);
          const context = provider.getLatestAthleteContext?.();
          if (context) {
            importedWeights = context.weights ?? [];
            externalProfile = context.profile ?? externalProfile;
          }
          dataSource = 'intervals';
          lastSyncISO = new Date().toISOString();
          await persistCachedWorkouts(startISO, endISO, workouts, lastSyncISO);
          if (workouts.length === 0) {
            pushSyncLog('warn', 'Intervals.icu returned zero workouts');
          }
          pushSyncLog('info', `Synced ${workouts.length} workout${workouts.length === 1 ? '' : 's'}`);
        } else {
          const provider = createFakeProvider();
          workouts = await provider.getPlannedWorkouts(SAMPLE_START_ISO, SAMPLE_END_ISO);
          dataSource = 'sample';
          lastSyncISO = undefined;
          pushSyncLog('info', `Loaded ${workouts.length} sample workout${workouts.length === 1 ? '' : 's'}`);
          pushSyncLog('info', 'Intervals.icu API key not configured', 'Using sample data.');
        }

        if (importedWeights.length > 0) {
          weights = mergeImportedWeights(weights, importedWeights);
        }

        const weightTrend = computeWeightTrend(weights);
        const latestKg = latestWeightKg(weights);
        const baseProfileForPlan = applyExternalProfile(state.baseProfile, externalProfile, latestKg);
        const { profile, windows, weekly, weightSummary } = recomputePlan(
          baseProfileForPlan,
          overrides,
          workouts,
          weights,
        );
        set({
          workouts,
          profile,
          windows,
          weekly,
          weightSummary,
          weights,
          weightTrend,
          baseProfile: baseProfileForPlan,
          dataSource,
          lastSyncISO,
          status: 'ready',
          error: undefined,
          syncError: undefined,
          isRefreshing: false,
        });
        void persistWeights(weights);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh workouts';
        pushSyncLog('error', message);
        const hasExisting = get().workouts.length > 0;
        if (hasExisting) {
          set({ isRefreshing: false, syncError: message });
        } else {
          set({ isRefreshing: false, status: 'error', error: message, syncError: message });
        }
      }
    },
    setWorkoutType(workoutId, type) {
      set((state) => {
        let changed = false;
        const updated = state.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }

          const original = workout.originalType ?? workout.type;
          if (type === original) {
            if (!workout.originalType) {
              if (workout.type === original) {
                return workout;
              }
              changed = true;
              return { ...workout, type: original };
            }
            if (workout.type === original && workout.originalType === original) {
              return workout;
            }
            changed = workout.type !== original;
            const { originalType, ...rest } = workout;
            return { ...rest, type: original };
          }

          if (workout.type === type) {
            return workout;
          }

          changed = true;
          return {
            ...workout,
            originalType: original,
            type,
          };
        });

        if (!changed) {
          return {};
        }

        const { profile, windows, weekly, weightSummary } = recomputePlan(
          state.baseProfile,
          state.overrides,
          updated,
          state.weights,
        );

        return { workouts: updated, profile, windows, weekly, weightSummary };
      });
    },
    resetWorkoutType(workoutId) {
      set((state) => {
        let changed = false;
        const updated = state.workouts.map((workout) => {
          if (workout.id !== workoutId) {
            return workout;
          }
          if (!workout.originalType) {
            return workout;
          }
          changed = workout.type !== workout.originalType;
          const { originalType, ...rest } = workout;
          return { ...rest, type: originalType };
        });

        if (!changed) {
          return {};
        }

        const { profile, windows, weekly, weightSummary } = recomputePlan(
          state.baseProfile,
          state.overrides,
          updated,
          state.weights,
        );

        return { workouts: updated, profile, windows, weekly, weightSummary };
      });
    },
    upsertWeightEntry(dateISO, value, unit) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return;
      }
      const normalizedDate = normalizeDateKey(dateISO);
      const weightKg = unit === 'kg' ? numeric : numeric * KG_PER_LB;
      let persisted: WeightEntry[] | undefined;
      set((state) => {
        const nextWeights = upsertWeightList(state.weights, {
          dateISO: normalizedDate,
          weight_kg: weightKg,
          source: 'manual',
        });
        const nextBase = applyExternalProfile(state.baseProfile, undefined, latestWeightKg(nextWeights));
        const weightTrend = computeWeightTrend(nextWeights);
        const { profile, windows, weekly, weightSummary } = recomputePlan(
          nextBase,
          state.overrides,
          state.workouts,
          nextWeights,
        );
        persisted = nextWeights;
        return {
          baseProfile: nextBase,
          weights: nextWeights,
          weightTrend,
          profile,
          windows,
          weekly,
          weightSummary,
        };
      });
      if (persisted) {
        void persistWeights(persisted);
      }
    },
    deleteWeightEntry(dateISO) {
      let persisted: WeightEntry[] | undefined;
      set((state) => {
        const normalized = normalizeDateKey(dateISO);
        const hasManual = state.weights.some(
          (entry) => normalizeDateKey(entry.dateISO) === normalized && entry.source !== 'intervals',
        );
        if (!hasManual) {
          return {};
        }
        const nextWeights = removeWeightByDate(state.weights, dateISO);
        const nextBase = applyExternalProfile(state.baseProfile, undefined, latestWeightKg(nextWeights));
        const weightTrend = computeWeightTrend(nextWeights);
        const { profile, windows, weekly, weightSummary } = recomputePlan(
          nextBase,
          state.overrides,
          state.workouts,
          nextWeights,
        );
        persisted = nextWeights;
        return {
          baseProfile: nextBase,
          weights: nextWeights,
          weightTrend,
          profile,
          windows,
          weekly,
          weightSummary,
        };
      });
      if (persisted) {
        void persistWeights(persisted);
      }
    },
  };
});

