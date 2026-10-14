import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { demoWeights, demoWellness, demoWorkouts } from '../demo/demoData';
import { DEFAULT_SETTINGS } from '../engine/defaults';
import { todayKey } from '../engine/time';
import type { DateKey, Settings, WeightEntry, WellnessDay, Workout } from '../engine/types';
import { IntervalsClient } from '../intervals/client';
import { syncIntervals } from '../intervals/sync';
import { clearCoachHistory } from '../coach/history';
import type { CoachMessage, Proposal } from '../coach/types';

export type Mode = 'demo' | 'intervals';

export interface Connection {
  mode: Mode;
  intervalsKey?: string;
  athleteId?: string;
  anthropicKey?: string;
  coachModel: string;
  lastSync?: string;
  syncError?: string;
  syncLog?: string[];
}

export type Theme = 'system' | 'dark' | 'light';

export interface AppState {
  onboarded: boolean;
  theme: Theme;
  settings: Settings;
  connection: Connection;
  workouts: Workout[];
  wellness: WellnessDay[];
  weights: WeightEntry[];
  /** user-set start times for sessions, keyed by workout id */
  timeOverrides: Record<string, number>;
  /** meal slots ticked off, keyed `${date}|${kind}|${startMin}` */
  eaten: Record<string, true>;
  /** sessions added locally (manual or accepted coach proposals in demo mode) */
  localWorkouts: Workout[];
  hiddenWorkoutIds: string[];
  coach: { messages: CoachMessage[]; proposals: Proposal[] };
  syncing: boolean;

  update: (fn: (s: AppState) => Partial<AppState>) => void;
  patchSettings: <K extends keyof Settings>(key: K, patch: Partial<Settings[K]>) => void;
  setWorkoutTime: (id: string, min: number | null) => void;
  toggleEaten: (key: string) => void;
  addWeight: (date: DateKey, kg: number) => void;
  loadDemo: () => void;
  sync: () => Promise<void>;
  resetAll: () => void;
}

function demoState(settings: Settings) {
  const today = todayKey(settings.profile.timezone);
  return {
    workouts: demoWorkouts(today, settings.profile.ftp),
    wellness: demoWellness(today),
    weights: demoWeights(today, settings.profile.weightKg),
  };
}

const initial = {
  onboarded: false,
  theme: 'system' as Theme,
  settings: DEFAULT_SETTINGS,
  connection: { mode: 'demo' as Mode, coachModel: 'claude-opus-5-5' },
  ...demoState(DEFAULT_SETTINGS),
  timeOverrides: {},
  eaten: {},
  localWorkouts: [],
  hiddenWorkoutIds: [],
  coach: { messages: [], proposals: [] },
  syncing: false,
};

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...initial,

      update: (fn) => set((s) => fn(s)),

      patchSettings: (key, patch) =>
        set((s) => ({ settings: { ...s.settings, [key]: { ...s.settings[key], ...patch } } })),

      setWorkoutTime: (id, min) =>
        set((s) => {
          const next = { ...s.timeOverrides };
          if (min === null) delete next[id];
          else next[id] = min;
          return { timeOverrides: next };
        }),

      toggleEaten: (key) =>
        set((s) => {
          const next = { ...s.eaten };
          if (next[key]) delete next[key];
          else next[key] = true;
          return { eaten: next };
        }),

      addWeight: (date, kg) =>
        set((s) => ({
          weights: [...s.weights.filter((w) => !(w.date === date && w.source === 'manual')), { date, kg, source: 'manual' as const }].sort(
            (a, b) => (a.date < b.date ? -1 : 1),
          ),
        })),

      loadDemo: () => set((s) => ({ ...demoState(s.settings), connection: { ...s.connection, mode: 'demo', syncError: undefined } })),

      sync: async () => {
        const { connection, settings } = get();
        if (!connection.intervalsKey) return;
        set({ syncing: true });
        try {
          const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
          const res = await syncIntervals(client, todayKey(settings.profile.timezone), settings.profile.ftp);
          set((s) => ({
            syncing: false,
            workouts: res.workouts,
            wellness: res.wellness,
            // keep manual weigh-ins, replace synced ones
            weights: [...s.weights.filter((w) => w.source === 'manual'), ...res.weights].sort((a, b) => (a.date < b.date ? -1 : 1)),
            settings: { ...s.settings, profile: { ...s.settings.profile, ...stripUndefined(res.profile) } },
            connection: { ...s.connection, mode: 'intervals', athleteId: res.athleteId, lastSync: new Date().toISOString(), syncError: undefined, syncLog: res.log },
          }));
        } catch (err) {
          set((s) => ({ syncing: false, connection: { ...s.connection, syncError: err instanceof Error ? err.message : String(err) } }));
        }
      },

      resetAll: () => {
        clearCoachHistory();
        set({ ...initial, ...demoState(DEFAULT_SETTINGS) });
      },
    }),
    {
      name: 'preburner-v2',
      version: 1,
      // A failed write (quota, private mode) must never crash the app.
      storage: createJSONStorage(() => ({
        getItem: (k) => {
          try {
            return localStorage.getItem(k);
          } catch {
            return null;
          }
        },
        setItem: (k, v) => {
          try {
            localStorage.setItem(k, v);
          } catch (err) {
            console.warn('Preburner: could not save state', err);
          }
        },
        removeItem: (k) => {
          try {
            localStorage.removeItem(k);
          } catch {
            /* ignore */
          }
        },
      })),
      partialize: (s) => {
        const { syncing: _s, update: _u, ...rest } = s;
        void _s;
        void _u;
        return rest as unknown as AppState;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const merged = { ...current, ...p };
        // Deep-merge settings so new fields get defaults after upgrades.
        merged.settings = {
          profile: { ...DEFAULT_SETTINGS.profile, ...p.settings?.profile },
          schedule: { ...DEFAULT_SETTINGS.schedule, ...p.settings?.schedule },
          nutrition: { ...DEFAULT_SETTINGS.nutrition, ...p.settings?.nutrition },
          goals: { ...DEFAULT_SETTINGS.goals, ...p.settings?.goals },
        };
        // Demo data is always regenerated relative to today.
        if (merged.connection.mode === 'demo') Object.assign(merged, demoState(merged.settings));
        return merged;
      },
    },
  ),
);

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}
