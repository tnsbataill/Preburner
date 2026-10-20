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
import type { MissedReason, RideIssue } from '../training/history/types';
import type { MealSuggestion } from '../coach/meal';
import { INITIAL_TRAINING, type Feedback, type TrainingState, answerMissed, answerRideIssue, applyFeedback, demoTrainingHistory, detectAddedEvents, historyRides, reconcilePlanEvents, runAdaptation, trainingWellness } from './training';
import { readHealthExport } from '../health/appleHealth';
import { type RideDetails, planChanges, queueReviews, reviewCandidates, snapshotPlan } from '../training/review';
import { recentBodyFat } from '../health/merge';
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
  /** AI-calculated meals, keyed like `eaten` (date|kind|start) */
  mealSuggestions: Record<string, MealSuggestion>;
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
  setMealSuggestion: (key: string, meal: MealSuggestion | undefined) => void;
  addWeight: (date: DateKey, kg: number) => void;
  loadDemo: () => void;
  sync: () => Promise<void>;
  resetAll: () => void;

  generateTrainingPlan: (opts: PlanOptions) => void;
  discardTrainingPlan: () => Promise<void>;
  applyTrainingPlan: () => Promise<void>;
  importStrava: (file: File, onProgress?: (fraction: number) => void) => Promise<void>;
  /** snapshots/history.json produced by scripts/build-history.ts */
  importHistoryJson: (file: File) => Promise<void>;
  /** Apple Health export (zip or export.xml) */
  importAppleHealth: (file: File, onProgress?: (fraction: number) => void) => Promise<void>;
  setFeedback: (rideId: string, fb: Feedback) => Promise<void>;
  adaptTraining: () => void;
  answerMissed: (sessionId: string, reason: MissedReason) => void;
  answerRideIssue: (rideId: string, issue: RideIssue, sessionId?: string) => void;
  /** queue rides already in the app that haven't been reviewed (e.g. on first open) */
  ensureReviews: () => void;
  markReviewed: (rideId: string) => void;
  setRideDetails: (rideId: string, details: RideDetails) => void;
  /** a session planned in the app (kept locally, not sent to Intervals) */
  addLocalWorkout: (w: Workout) => void;
  removeLocalWorkout: (id: string) => void;
  /** dismiss the "new on Intervals" notice; hide also leaves the event out */
  acknowledgeAdded: (id: string, hide?: boolean) => void;
  /** "ride it instead": the added event takes the place of that day's plan session */
  replaceWithAdded: (id: string) => void;
}

/** Everything the planner needs, from the store. */
export function trainingSnapshot(s: Pick<AppState, 'training' | 'settings'>, today: DateKey): AthleteSnapshot {
  return {
    rides: historyRides(s.training).filter((r) => r.date < today),
    wellness: trainingWellness(s.training),
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
  mealSuggestions: {} as Record<string, MealSuggestion>,
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

      setMealSuggestion: (key, meal) =>
        set((s) => {
          const next = { ...s.mealSuggestions };
          if (meal) next[key] = meal;
          else delete next[key];
          // Keep the last 60; older days don't matter.
          const keys = Object.keys(next).sort();
          for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete next[k];
          return { mealSuggestions: next };
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
        // What the app knew before this sync: rides that arrive now are new,
        // and the plan as it stands is what their changes are measured against.
        const today = todayKey(settings.profile.timezone);
        const before = get().training;
        const known = new Set(reviewCandidates(before.intervalsRides, before.stravaRides, today).map((r) => r.id));
        const baseline = snapshotPlan(before.plan?.sessions, today, before.ftp ?? settings.profile.ftp, before.readiness?.level);
        try {
          const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
          const res = await syncIntervals(client, todayKey(settings.profile.timezone), settings.profile.ftp);
          set((s) => ({
            syncing: false,
            workouts: res.workouts,
            wellness: res.wellness,
            // Keep manual weigh-ins and replace synced ones. Coming from demo
            // mode, everything there was made up (older demo data was even
            // labelled "manual"), so only Intervals' weights remain.
            weights: [...(s.connection.mode === 'demo' ? [] : s.weights.filter((w) => w.source === 'manual')), ...res.weights].sort((a, b) => (a.date < b.date ? -1 : 1)),
            settings: { ...s.settings, profile: { ...s.settings.profile, ...stripUndefined(res.profile) } },
            // Intervals resolves %FTP against its own FTP, so the plan's working
            // FTP follows it as soon as it changes, not at the next daily adaptation.
            training: {
              ...s.training,
              ...(res.profile.ftp ? { ftp: res.profile.ftp } : {}),
              addedExternal: detectAddedEvents(s.training, s.workouts, res.workouts, today),
            },
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
          set((s) => ({ training: { ...s.training, reviews: queueReviews(s.training.reviews ?? {}, reviewCandidates(s.training.intervalsRides, s.training.stravaRides, today), known, baseline) } }));
        } catch (err) {
          set((s) => ({ syncing: false, connection: { ...s.connection, syncError: err instanceof Error ? err.message : String(err) } }));
        }
      },

      generateTrainingPlan: (opts) => {
        const s = get();
        const today = todayKey(s.settings.profile.timezone);
        // Races already on the calendar are kept and planned around.
        const races = [...s.workouts, ...s.localWorkouts].filter((w) => /^RACE_/.test(w.category ?? '') && !w.completed && w.date >= today).map((w) => w.date);
        // On Intervals, zones resolve against Intervals' FTP, so plan with that and
        // surface the model's estimate as a suggestion when they disagree.
        const intervals = s.connection.mode === 'intervals';
        const { plan, analysis } = planFromHistory(trainingSnapshot(s, today), {
          ...opts,
          blockedDates: [...(opts.blockedDates ?? []), ...races],
          ...(intervals ? { ftp: s.settings.profile.ftp } : {}),
        });
        const est = analysis.ftpEstimate;
        const ftpSuggestion =
          // Only with tests or max efforts behind it; a guess from load alone isn't advice.
          intervals && analysis.ftpEvidence > 0 && Math.abs(est - s.settings.profile.ftp) > 0.03 * s.settings.profile.ftp
            ? { ftp: est, reason: `Your recent rides put FTP at about ${est} W (Intervals has ${s.settings.profile.ftp} W)`, date: today }
            : undefined;
        set((st) => ({
          training: { ...st.training, plan, ftp: plan.request.ftp, ftpSuggestion, appliedAt: undefined, dirtyIds: [], adjustments: [], lastAdapt: undefined, readiness: undefined, replacedSessions: undefined },
        }));
        get().adaptTraining();
      },

      discardTrainingPlan: async () => {
        const { connection, workouts, settings } = get();
        if (connection.mode === 'intervals' && connection.intervalsKey) {
          const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
          // Remove the plan's future events (past ones stay as history).
          const { deleteIds } = reconcilePlanEvents(undefined, workouts, { dirtyIds: [] }, todayKey(settings.profile.timezone), settings.schedule);
          for (const id of deleteIds) await client.deleteEvent(id);
        }
        set((s) => ({ training: { ...s.training, plan: undefined, appliedAt: undefined, dirtyIds: [], adjustments: [], readiness: undefined, lastAdapt: undefined, replacedSessions: undefined } }));
        if (connection.mode === 'intervals') await get().sync();
      },

      applyTrainingPlan: async () => {
        const { connection, training, settings, workouts } = get();
        if (!training.plan) return;
        if (connection.mode !== 'intervals' || !connection.intervalsKey) {
          set((s) => ({ training: { ...s.training, appliedAt: new Date().toISOString(), dirtyIds: [] } }));
          return;
        }
        const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
        const { upsert, deleteIds } = reconcilePlanEvents(training.plan, workouts, training, todayKey(settings.profile.timezone), settings.schedule);
        for (let i = 0; i < upsert.length; i += 50) await client.upsertEvents(upsert.slice(i, i + 50));
        for (const id of deleteIds) await client.deleteEvent(id);
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

      importAppleHealth: async (file, onProgress) => {
        const today = todayKey(get().settings.profile.timezone);
        const res = await readHealthExport(file, { since: addDays(today, -400), onProgress });
        const data = { ...res, importedAt: new Date().toISOString() };
        // A recent body-fat reading sets fat-free mass, which the energy-availability floor uses.
        const bf = recentBodyFat(data, today);
        set((s) => ({
          training: { ...s.training, appleHealth: { ...data, report: { ...data.report, appliedBodyFat: bf } } },
          ...(bf && { settings: { ...s.settings, profile: { ...s.settings.profile, bodyFatPct: bf.pct } } }),
        }));
      },

      importHistoryJson: async (file) => {
        const data = JSON.parse(await file.text()) as { rides?: unknown };
        if (!Array.isArray(data.rides)) throw new Error('Not a Preburner history file (no "rides" list).');
        const rides = (data.rides as Array<Record<string, unknown>>).filter((r) => typeof r.date === 'string' && typeof r.tss === 'number') as unknown as typeof INITIAL_TRAINING.stravaRides;
        set((s) => ({
          training: {
            ...s.training,
            stravaRides: rides,
            stravaReport: { activities: rides.length, rides: rides.length, withPower: rides.filter((r) => r.best20).length, withFile: 0, withRpe: rides.filter((r) => r.rpe).length, skipped: {}, first: rides[0]?.date, last: rides.at(-1)?.date, importedAt: new Date().toISOString() },
          },
        }));
      },

      setFeedback: async (rideId, fb) => {
        set((s) => ({ training: { ...s.training, feedback: { ...s.training.feedback, [rideId]: { ...s.training.feedback[rideId], ...fb } } } }));
        set((s) => {
          const patch = applyFeedback(s.training, rideId, todayKey(s.settings.profile.timezone));
          return patch ? { training: { ...s.training, ...patch } } : {};
        });
        const { connection } = get();
        // Keep Intervals the source of truth for RPE/feel when the ride lives there.
        // A Strava-only ride can't be written to (Intervals answers 422), so it stays in-app.
        const stravaOnly = get().training.intervalsRides.some((r) => r.id === rideId && r.noData);
        if (connection.mode === 'intervals' && connection.intervalsKey && rideId.startsWith('act-') && !stravaOnly) {
          const client = new IntervalsClient(connection.intervalsKey, connection.athleteId || '0');
          await client.updateActivity(rideId.slice(4), { ...(fb.rpe ? { icu_rpe: fb.rpe } : {}), ...(fb.feel ? { feel: fb.feel } : {}) }).catch((err) => console.warn('Preburner: could not save feedback to Intervals', err));
        }
      },

      ensureReviews: () =>
        set((s) => {
          const today = todayKey(s.settings.profile.timezone);
          const t = s.training;
          const reviews = queueReviews(t.reviews ?? {}, reviewCandidates(t.intervalsRides, t.stravaRides, today), new Set(), snapshotPlan(t.plan?.sessions, today, t.ftp ?? s.settings.profile.ftp, t.readiness?.level));
          return reviews === t.reviews ? {} : { training: { ...t, reviews } };
        }),

      markReviewed: (rideId) =>
        set((s) => {
          const r = s.training.reviews?.[rideId];
          if (!r) return {};
          // Freeze the summary: later changes belong to later rides and days.
          const changes = planChanges(r.baseline, s.training.plan?.sessions, todayKey(s.settings.profile.timezone));
          return { training: { ...s.training, reviews: { ...s.training.reviews, [rideId]: { ...r, doneAt: new Date().toISOString(), changes } } } };
        }),

      setRideDetails: (rideId, details) =>
        set((s) => ({ training: { ...s.training, rideDetails: { ...s.training.rideDetails, [rideId]: { ...s.training.rideDetails?.[rideId], ...details } } } })),

      addLocalWorkout: (w) => set((s) => ({ localWorkouts: [...s.localWorkouts.filter((x) => x.id !== w.id), w] })),

      removeLocalWorkout: (id) =>
        set((s) => {
          const timeOverrides = { ...s.timeOverrides };
          delete timeOverrides[id];
          return { localWorkouts: s.localWorkouts.filter((w) => w.id !== id), timeOverrides };
        }),

      acknowledgeAdded: (id, hide) =>
        set((s) => {
          const a = s.training.addedExternal?.[id];
          return {
            ...(a ? { training: { ...s.training, addedExternal: { ...s.training.addedExternal, [id]: { ...a, seen: true } } } } : {}),
            ...(hide ? { hiddenWorkoutIds: [...new Set([...s.hiddenWorkoutIds, id])] } : {}),
          };
        }),

      replaceWithAdded: (id) =>
        set((s) => {
          const a = s.training.addedExternal?.[id];
          const sessions = s.training.plan?.sessions.filter((x) => x.date === a?.date) ?? [];
          if (!a || !sessions.length) return {};
          const replaced = { ...s.training.replacedSessions };
          for (const x of sessions) replaced[x.id] = { by: id, date: a.date };
          // Already on Intervals: the next sync of the plan takes it off.
          const dirtyIds = s.training.appliedAt ? [...new Set([...s.training.dirtyIds, ...sessions.map((x) => x.id)])] : s.training.dirtyIds;
          return { training: { ...s.training, replacedSessions: replaced, dirtyIds, addedExternal: { ...s.training.addedExternal, [id]: { ...a, seen: true } } } };
        }),

      answerMissed: (sessionId, reason) =>
        set((s) => ({ training: { ...s.training, ...answerMissed(s.training, sessionId, reason, todayKey(s.settings.profile.timezone)) } })),

      answerRideIssue: (rideId, issue, sessionId) =>
        set((s) => ({ training: { ...s.training, ...answerRideIssue(s.training, rideId, issue, todayKey(s.settings.profile.timezone), sessionId) } })),

      adaptTraining: () => {
        const s = get();
        // A suggestion the athlete has applied in Intervals is done.
        const sug = s.training.ftpSuggestion;
        if (sug && Math.abs(sug.ftp - s.settings.profile.ftp) <= 2) set((st) => ({ training: { ...st.training, ftpSuggestion: undefined } }));
        const patch = runAdaptation(s.training, todayKey(s.settings.profile.timezone), s.settings.profile.ftp, undefined, s.connection.mode);
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
