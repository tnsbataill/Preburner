import type { PlannerOverrides } from './types.js';

interface SettingsRecord {
  id: string;
  overrides: PlannerOverrides;
}

let dbPromise: Promise<import('dexie').Dexie | undefined> | undefined;

async function getDatabase(): Promise<import('dexie').Dexie | undefined> {
  if (typeof indexedDB === 'undefined') {
    return undefined;
  }

  if (!dbPromise) {
    dbPromise = import('dexie').then(({ default: Dexie }) => {
      const db = new Dexie('PreburnerPlanner');
      db.version(1).stores({
        settings: '&id',
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
