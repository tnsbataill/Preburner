import { create } from 'zustand';
import { createFakeProvider } from '../adapters/fake.js';
import { createIntervalsProvider, type IntervalsDebugEntry } from '../adapters/intervals.js';
import { buildWindows } from '../calc/prescribe.js';
import { allocateWeeklyDeficits } from '../calc/weekly.js';
import { sampleProfile } from '../samples/profile.js';
import type {
  PlannedWorkout,
  Profile,
  SessionType,
  WindowPlan,
  WeeklyPlan,
} from '../types.js';
import {
  loadCachedWorkouts,
  loadIntervalsSettings,
  loadStoredOverrides,
  persistCachedWorkouts,
  persistIntervalsSettings,
  persistOverrides,
  type StoredIntervalsSettings,
} from './storage.js';
import type { PlannerOverrides, PlannerPage, PlannerStatus } from './types.js';

const SAMPLE_START_ISO = '2024-06-10T00:00:00.000Z';
const SAMPLE_END_ISO = '2024-06-20T00:00:00.000Z';
const DEFAULT_RANGE_DAYS = 10;

interface IntervalsConnectionSettings {
  apiKey: string;
  startDateISO: string;
  rangeDays: number;
}

type PlannerDataSource = 'sample' | 'intervals';

interface SyncLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
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
): { profile: Profile; windows: WindowPlan[]; weekly: WeeklyPlan[] } {
  const profile = applyOverrides(baseProfile, overrides);
  if (workouts.length === 0) {
    return { profile, windows: [], weekly: [] };
  }

  const windows = buildWindows(profile, workouts);
  const { windows: adjusted, weekly } = allocateWeeklyDeficits(profile, windows, workouts);
  return { profile, windows: adjusted, weekly };
}

function clampRangeDays(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RANGE_DAYS;
  }
  return Math.min(14, Math.max(7, Math.round(value)));
}

function createDefaultConnection(): IntervalsConnectionSettings {
  return {
    apiKey: '',
    startDateISO: SAMPLE_START_ISO.slice(0, 10),
    rangeDays: DEFAULT_RANGE_DAYS,
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
  return merged;
}

function computeIntervalsRange(settings: IntervalsConnectionSettings): {
  startISO: string;
  endISO: string;
} {
  const parsed = new Date(`${settings.startDateISO}T00:00:00Z`);
  const startDate = Number.isNaN(parsed.getTime()) ? new Date(SAMPLE_START_ISO) : parsed;
  const endDate = new Date(startDate.getTime() + settings.rangeDays * 24 * 60 * 60 * 1000);
  return { startISO: startDate.toISOString(), endISO: endDate.toISOString() };
}

function shouldResetLastSync(key: keyof IntervalsConnectionSettings): boolean {
  return key === 'rangeDays' || key === 'startDateISO';
}

export const usePlannerStore = create<PlannerState>((set, get) => {
  const baseProfile = { ...sampleProfile, carbBands: cloneCarbBands(sampleProfile.carbBands) };
  const defaultOverrides = createDefaultOverrides(baseProfile);
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
    baseProfile,
    profile: applyOverrides(baseProfile, defaultOverrides),
    overrides: defaultOverrides,
    workouts: [],
    windows: [],
    weekly: [],
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
        const [storedOverrides, storedConnection] = await Promise.all([
          loadStoredOverrides(),
          loadIntervalsSettings(),
        ]);

        const overrides = mergeOverrides(defaultOverrides, storedOverrides);
        const connection = mergeConnectionSettings(defaultConnection, storedConnection);
        const { startISO, endISO } = computeIntervalsRange(connection);

        let workouts: PlannedWorkout[] = [];
        let dataSource: PlannerDataSource = 'sample';
        let lastSyncISO: string | undefined;
        let syncError: string | undefined;

        if (connection.apiKey) {
          pushSyncLog('info', 'Intervals.icu API key detected');
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
              const provider = createIntervalsProvider(connection.apiKey.trim(), forwardIntervalsDebug);
              workouts = await provider.getPlannedWorkouts(startISO, endISO);
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

        const { profile, windows, weekly } = recomputePlan(baseProfile, overrides, workouts);
        set({
          status: 'ready',
          overrides,
          workouts,
          profile,
          windows,
          weekly,
          connection,
          dataSource,
          lastSyncISO,
          syncError,
          error: undefined,
        });
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
      const overrides = { ...state.overrides, [key]: value } as PlannerOverrides;
      const { profile, windows, weekly } = recomputePlan(state.baseProfile, overrides, state.workouts);
      set({ overrides, profile, windows, weekly });
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
      const { profile, windows, weekly } = recomputePlan(state.baseProfile, overrides, state.workouts);
      set({ overrides, profile, windows, weekly });
      void persistOverrides(overrides);
    },
    updateCarbSplit(part, value) {
      const state = get();
      const split = { ...state.overrides.carbSplit, [part]: value } as Profile['carbSplit'];
      const overrides = { ...state.overrides, carbSplit: split } as PlannerOverrides;
      const { profile, windows, weekly } = recomputePlan(state.baseProfile, overrides, state.workouts);
      set({ overrides, profile, windows, weekly });
      void persistOverrides(overrides);
    },
    updateConnectionSetting(key, value) {
      const state = get();
      const updated: IntervalsConnectionSettings = { ...state.connection };
      if (key === 'apiKey') {
        updated.apiKey = String(value ?? '');
      } else if (key === 'startDateISO') {
        updated.startDateISO = String(value ?? '');
      } else if (key === 'rangeDays') {
        const numeric = typeof value === 'number' ? value : Number(value);
        updated.rangeDays = clampRangeDays(numeric);
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

        if (connection.apiKey) {
          const provider = createIntervalsProvider(connection.apiKey.trim(), forwardIntervalsDebug);
          workouts = await provider.getPlannedWorkouts(startISO, endISO);
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

        const { profile, windows, weekly } = recomputePlan(state.baseProfile, overrides, workouts);
        set({
          workouts,
          profile,
          windows,
          weekly,
          dataSource,
          lastSyncISO,
          status: 'ready',
          error: undefined,
          syncError: undefined,
          isRefreshing: false,
        });
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
  };
});

