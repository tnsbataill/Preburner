import type { PlannedWorkout, WeightEntry } from '../types.js';
import type { PlannerOverrides } from './types.js';

interface SettingsRecord {
  id: string;
  overrides: PlannerOverrides;
}

interface IntervalsSettingsRecord {
  id: string;
  apiKey: string;
  startDateISO: string;
  rangeDays: number;
  athleteId?: string;
}

interface WorkoutCacheRecord {
  id: string;
  startISO: string;
  endISO: string;
  workouts: PlannedWorkout[];
  fetchedISO: string;
}

interface WeightRecord {
  dateISO: string;
  weight_kg: number;
}

export interface StoredIntervalsSettings {
  apiKey: string;
  startDateISO: string;
  rangeDays: number;
  athleteId?: string;
}

export interface StoredWorkoutCache {
  workouts: PlannedWorkout[];
  fetchedISO: string;
}

type PlannerDatabase = import('dexie').Dexie;

let dbPromise: Promise<PlannerDatabase | undefined> | undefined;

async function getDatabase(): Promise<PlannerDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    return undefined;
  }

  if (!dbPromise) {
    dbPromise = import('dexie').then(({ default: Dexie }) => {
      const db = new Dexie('PreburnerPlanner');
      db.version(1).stores({
        settings: '&id',
      });
      db.version(2).stores({
        settings: '&id',
        connections: '&id',
        workoutCache: '&id',
      });
      db.version(3).stores({
        settings: '&id',
        connections: '&id',
        workoutCache: '&id',
        weights: '&dateISO',
      });
      return db;
    });
  }

  return dbPromise;
}

export async function loadStoredOverrides(): Promise<PlannerOverrides | undefined> {
  const db = await getDatabase();
  if (!db) {
    return undefined;
  }

  const table = db.table<SettingsRecord, string>('settings');
  const record = await table.get('active');
  return record?.overrides;
}

export async function persistOverrides(overrides: PlannerOverrides): Promise<void> {
  const db = await getDatabase();
  if (!db) {
    return;
  }

  const table = db.table<SettingsRecord, string>('settings');
  await table.put({ id: 'active', overrides });
}

export async function loadIntervalsSettings(): Promise<StoredIntervalsSettings | undefined> {
  const db = await getDatabase();
  if (!db) {
    return undefined;
  }

  const table = db.table<IntervalsSettingsRecord, string>('connections');
  const record = await table.get('intervals');
  if (!record) {
    return undefined;
  }

  return {
    apiKey: record.apiKey,
    startDateISO: record.startDateISO,
    rangeDays: record.rangeDays,
    athleteId: record.athleteId,
  };
}

export async function persistIntervalsSettings(settings: StoredIntervalsSettings): Promise<void> {
  const db = await getDatabase();
  if (!db) {
    return;
  }

  const table = db.table<IntervalsSettingsRecord, string>('connections');
  await table.put({ id: 'intervals', ...settings });
}

function buildCacheId(startISO: string, endISO: string): string {
  return `${startISO}__${endISO}`;
}

export async function loadCachedWorkouts(
  startISO: string,
  endISO: string,
): Promise<StoredWorkoutCache | undefined> {
  const db = await getDatabase();
  if (!db) {
    return undefined;
  }

  const table = db.table<WorkoutCacheRecord, string>('workoutCache');
  const record = await table.get(buildCacheId(startISO, endISO));
  if (!record) {
    return undefined;
  }

  return {
    workouts: record.workouts,
    fetchedISO: record.fetchedISO,
  };
}

export async function persistCachedWorkouts(
  startISO: string,
  endISO: string,
  workouts: PlannedWorkout[],
  fetchedISO: string,
): Promise<void> {
  const db = await getDatabase();
  if (!db) {
    return;
  }

  const table = db.table<WorkoutCacheRecord, string>('workoutCache');
  await table.put({
    id: buildCacheId(startISO, endISO),
    startISO,
    endISO,
    workouts,
    fetchedISO,
  });
}

export async function clearCachedWorkouts(): Promise<void> {
  const db = await getDatabase();
  if (!db) {
    return;
  }

  await db.table<WorkoutCacheRecord, string>('workoutCache').clear();
}

export async function loadStoredWeights(): Promise<WeightEntry[]> {
  const db = await getDatabase();
  if (!db) {
    return [];
  }

  const table = db.table<WeightRecord, string>('weights');
  const records = await table.toArray();
  return records.map((record) => ({ dateISO: record.dateISO, weight_kg: record.weight_kg }));
}

export async function persistWeights(weights: WeightEntry[]): Promise<void> {
  const db = await getDatabase();
  if (!db) {
    return;
  }

  const table = db.table<WeightRecord, string>('weights');
  await table.clear();
  if (weights.length > 0) {
    await table.bulkPut(weights.map((weight) => ({ dateISO: weight.dateISO, weight_kg: weight.weight_kg })));
  }
}
