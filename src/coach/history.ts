// The coach's API transcript (thinking blocks + tool results) can get large, so
// it lives under its own localStorage key: if it ever hits the quota, only the
// coach conversation is affected, never settings or meal ticks. When it grows
// too big we start a fresh conversation rather than trimming — editing earlier
// turns would invalidate the model's thinking blocks.

const KEY = 'preburner-v2-coach-history';
const MAX_CHARS = 1_500_000;

export function loadCoachHistory(): unknown[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as unknown[]) : [];
  } catch {
    return [];
  }
}

/** Returns false when the history was too large and has been reset. */
export function saveCoachHistory(history: unknown[]): boolean {
  try {
    const raw = JSON.stringify(history);
    if (raw.length > MAX_CHARS) {
      localStorage.removeItem(KEY);
      return false;
    }
    localStorage.setItem(KEY, raw);
    return true;
  } catch {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
    return false;
  }
}

export function clearCoachHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
