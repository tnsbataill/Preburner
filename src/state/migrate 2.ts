// One-time import from the v1 app's IndexedDB ("PreburnerPlanner") so the
// Intervals key, athlete and preferences carry over. Read-only on the old DB.

export interface LegacyImport {
  intervalsKey?: string;
  athleteId?: string;
  weeklyRateKg?: number;
  proteinGPerKg?: number;
  fatMinGPerKg?: number;
  efficiency?: number;
  units?: 'metric' | 'imperial';
}

function readStore<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) return resolve(undefined);
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

export async function readLegacy(): Promise<LegacyImport | undefined> {
  if (typeof indexedDB === 'undefined' || !('databases' in indexedDB)) return undefined;
  const dbs = await indexedDB.databases().catch(() => []);
  if (!dbs.some((d) => d.name === 'PreburnerPlanner')) return undefined;
  const db = await new Promise<IDBDatabase | undefined>((resolve) => {
    const req = indexedDB.open('PreburnerPlanner');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
    // Never create/upgrade the legacy DB.
    req.onupgradeneeded = () => {
      req.transaction?.abort();
      resolve(undefined);
    };
  });
  if (!db) return undefined;
  try {
    const conn = await readStore<{ apiKey?: string; athleteId?: string }>(db, 'connections', 'intervals');
    const settings = await readStore<{ overrides?: Record<string, unknown> }>(db, 'settings', 'active');
    const o = settings?.overrides ?? {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const out: LegacyImport = {
      intervalsKey: conn?.apiKey || undefined,
      athleteId: conn?.athleteId || undefined,
      weeklyRateKg: num(o.targetKgPerWeek),
      proteinGPerKg: num(o.protein_g_per_kg),
      fatMinGPerKg: num(o.fat_g_per_kg_min),
      efficiency: num(o.efficiency),
    };
    return Object.values(out).some((v) => v !== undefined) ? out : undefined;
  } finally {
    db.close();
  }
}
