import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { demoWeights, demoWellness, demoWorkouts } from '../demo/demoData';
import { DEFAULT_SETTINGS } from '../engine/defaults';
import { addDays, todayKey } from '../engine/time';
import type { DateKey, Settings, WeightEntry, WellnessDay, Workout } from '../engine/types';
import { IntervalsClient } from '../intervals/client';
import { syncIntervals, syncTrainingHistory } from '../intervals/sync';
import { type AthleteSnapshot, type PlanOptions, planFromHistory } from '../training/planner';
import { readArchive, toRideRecords } from '../training/history/strava';
import { readZipStream } from '../training/history/zip';
import { INITIAL_TRAINING, type Feedback, type TrainingState, applyFeedback, demoTrainingHistory, historyRides, runAdaptation, sessionEvent } from './training';
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
  training: TrainingState;
  syncing: boolean;

  update: (fn: (s: AppState) => Partial<AppState>) => void;
  patchSettings: <K extends keyof Settings>(key: K, patch: Partial<Settings[K]>) => void;
  setWorkoutTime: (id: string, min: number | null) => void;
  toggleEaten: (key: string) => void;
  addWeight: (date: DateKey, kg: number) => void;
  loadDemo: () => void;
  sync: () => Promise<void>;
  resetAll: () => void;

  generateTrainingPlan: (opts: PlanOptions) => void;
  discardTrainingPlan: () => Promise<void>;
  applyTrainingPlan: () => Promise<void>;
  importStrava: (file: File, onProgress?: (fraction: number) => void) => Promise<void>;
  setFeedback: (rideId: string, fb: Feedback) => Promise<void>;
  adaptTraining: () => void;
}

/** Everything the planner needs, from the store. */
export function trainingSnapshot(s: Pick<AppState, 'training' | 'settings'>, today: DateKey): AthleteSnapshot {
  return {
    rides: historyRides(s.training).filter((r) => r.date < today),
    wellness: s.training.wellness,
    ftpSet: s.training.ftp ?? s.settings.profile.ftp,
    availabilityHours: s.settings.goals.availabilityHours,
    maxRampPerWeek: s.settings.goals.maxRampPerWeek,
    today: addDays(today, -1),
  };
}

function demoState(settings: Settings) {
  const today = todayKey(settings.profile.timezone);
  return {
    workouts: demoWorkouts(today, settings.profile.ftp),
    wellness: demoWellness(today),
    weights: demoWeights(today, settings.profile.weightKg),
  };
}

function demoTraining(settings: Settings, keep?: TrainingState): TrainingState {
  const h = demoTrainingHistory(todayKey(settings.profile.timezone));
  return { ...INITIAL_TRAINING, ...keep, stravaRides: [], intervalsRides: h.rides, wellness: h.wellness };
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
  training: demoTraining(DEFAULT_SETTINGS),
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

      loadDemo: () => set((s) => ({ ...demoState(s.settings), training: demoTraining(s.settings), connection: { ...s.connection, mode: 'demo', syncError: undefined } })),

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
          // Longer history for the training model; failure here is non-fatal.
          try {
            const hist = await syncTrainingHistory(client, todayKey(settings.profile.timezone), get().settings.profile.ftp);
            set((s) => ({ training: { ...s.training, intervalsRides: hist.rides, wellness: hist.wellness } }));
          } catch (err) {
            console.warn('Preburner: training history sync failed', err);
          }
          get().adaptTraining();
        } catch (err) {
          set((s) => ({ syncing: false, connection: { ...s.connection, syncError: err instanceof Error ? err.message : String(err) } }));
        }
      },

      generateTrainingPlan: (opts) => {
        const s = get();
        const today = todayKey(s.settings.profile.timezone);
        const { plan } = planFromHistory(trainingSnapshot(s, today), opts);
        set((st) => ({
          training: { ...st.training, plan, ftp: plan.request.ftp, appliedAt: undefined, dirtyIds: [], adjustments: [], lastAdapt: undefined, readiness: undefined },
        }));
        get().adaptTraining();
      },

      discardTrainingPlan: async () => {
        const { connection, training, workouts } = get();
        if (connection.mode === 'intervals' && connection.intervalsKey && training.appliedAt) {
          const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
          const today = todayKey(get().settings.profile.timezone);
          // Remove the plan's future events from the calendar (past ones stay as history).
          for (const w of workouts.filter((x) => x.externalId?.startsWith('preburner-plan-') && x.date >= today && !x.completed)) {
            if (w.id.startsWith('icu-')) await client.deleteEvent(Number(w.id.slice(4)));
          }
        }
        set((s) => ({ training: { ...s.training, plan: undefined, appliedAt: undefined, dirtyIds: [], adjustments: [], readiness: undefined, lastAdapt: undefined } }));
        if (connection.mode === 'intervals') await get().sync();
      },

      applyTrainingPlan: async () => {
        const { connection, training, settings } = get();
        const plan = training.plan;
        if (!plan) return;
        if (connection.mode !== 'intervals' || !connection.intervalsKey) {
          set((s) => ({ training: { ...s.training, appliedAt: new Date().toISOString(), dirtyIds: [] } }));
          return;
        }
        const today = todayKey(settings.profile.timezone);
        const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
        const todo = training.appliedAt ? plan.sessions.filter((x) => training.dirtyIds.includes(x.id)) : plan.sessions;
        const events = todo.filter((x) => x.date >= today).map((x) => sessionEvent(x, settings.schedule));
        for (let i = 0; i < events.length; i += 50) await client.upsertEvents(events.slice(i, i + 50));
        set((s) => ({ training: { ...s.training, appliedAt: new Date().toISOString(), dirtyIds: [] } }));
        await get().sync();
      },

      importStrava: async (file, onProgress) => {
        let read = 0;
        const reader = await readZipStream(file.stream(), (n) => {
          read += n;
          onProgress?.(Math.min(0.95, read / Math.max(1, file.size)));
        });
        const { activities, report } = readArchive(reader, get().settings.profile.timezone);
        const rides = toRideRecords(activities, get().settings.profile.ftp);
        onProgress?.(1);
        set((s) => ({ training: { ...s.training, stravaRides: rides, stravaReport: { ...report, importedAt: new Date().toISOString() } } }));
      },

      setFeedback: async (rideId, fb) => {
        set((s) => ({ training: { ...s.training, feedback: { ...s.training.feedback, [rideId]: { ...s.training.feedback[rideId], ...fb } } } }));
        set((s) => {
          const patch = applyFeedback(s.training, rideId, todayKey(s.settings.profile.timezone));
          return patch ? { training: { ...s.training, ...patch } } : {};
        });
        const { connection } = get();
        // Keep Intervals the source of truth for RPE/feel when the ride lives there.
        if (connection.mode === 'intervals' && connection.intervalsKey && rideId.startsWith('act-')) {
          const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
          await client.updateActivity(rideId.slice(4), { ...(fb.rpe ? { icu_rpe: fb.rpe } : {}), ...(fb.feel ? { feel: fb.feel } : {}) }).catch((err) => console.warn('Preburner: could not save feedback to Intervals', err));
        }
      },

      adaptTraining: () => {
        const s = get();
        const patch = runAdaptation(s.training, todayKey(s.settings.profile.timezone), s.settings.profile.ftp);
        if (patch) set((st) => ({ training: { ...st.training, ...patch } }));
      },

      resetAll: () => {
        clearCoachHistory();
        set({ ...initial, ...demoState(DEFAULT_SETTINGS), training: demoTraining(DEFAULT_SETTINGS) });
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
        merged.training = { ...INITIAL_TRAINING, ...p.training };
        // Demo data is always regenerated relative to today.
        if (merged.connection.mode === 'demo') Object.assign(merged, demoState(merged.settings), { training: demoTraining(merged.settings, merged.training) });
        return merged;
      },
    },
  ),
);

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}
