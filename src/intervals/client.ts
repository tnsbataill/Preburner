// Thin Intervals.icu REST client. Personal API keys use HTTP Basic with the
// literal username "API_KEY". Field names follow docs/openapi-spec.json.

export const ICU_BASE = 'https://intervals.icu/api/v1';

export type Fetcher = typeof fetch;

export class IntervalsError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
  ) {
    super(message);
  }
}

export interface IcuAthlete {
  id: string;
  name?: string;
  firstname?: string;
  sex?: string;
  weight?: number;
  icu_weight?: number;
  height?: number;
  icu_date_of_birth?: string;
  timezone?: string;
  measurement_preference?: string;
  icu_resting_hr?: number;
  sportSettings?: Array<{ types?: string[]; ftp?: number; indoor_ftp?: number; lthr?: number }>;
}

export interface IcuEvent {
  id: number;
  start_date_local: string;
  end_date_local?: string;
  category: string;
  type?: string;
  name?: string;
  description?: string;
  moving_time?: number;
  time_target?: number;
  icu_training_load?: number;
  load_target?: number;
  icu_intensity?: number;
  joules?: number;
  icu_ftp?: number;
  carbs_per_hour?: number;
  indoor?: boolean;
  tags?: string[];
  external_id?: string;
  workout_doc?: unknown;
  paired_activity_id?: string;
}

export interface IcuActivity {
  id: string;
  start_date_local: string;
  type?: string;
  name?: string;
  moving_time?: number;
  elapsed_time?: number;
  icu_training_load?: number;
  icu_intensity?: number;
  icu_joules?: number;
  icu_ftp?: number;
  calories?: number;
  carbs_ingested?: number;
  paired_event_id?: number;
  trainer?: boolean;
  icu_weighted_avg_watts?: number;
  /** modelled FTP from this ride's power curve */
  icu_pm_ftp?: number;
  icu_zone_times?: Array<{ id: string; secs: number }>;
  icu_rpe?: number;
  /** 1 strong .. 5 weak */
  feel?: number;
  source?: string;
  external_id?: string;
}

export interface IcuWellness {
  id: string; // date
  ctl?: number;
  atl?: number;
  weight?: number;
  restingHR?: number;
  hrv?: number;
  sleepSecs?: number;
  kcalConsumed?: number;
  bodyFat?: number;
  sleepScore?: number;
}

export type NewEvent = {
  start_date_local: string;
  category: 'WORKOUT' | 'NOTE' | 'RACE_A' | 'RACE_B' | 'RACE_C';
  type?: string;
  name: string;
  description?: string;
  moving_time?: number;
  load_target?: number;
  carbs_per_hour?: number;
  external_id?: string;
  tags?: string[];
  color?: string;
};

export function basicAuth(apiKey: string): string {
  const pair = `API_KEY:${apiKey.trim()}`;
  return `Basic ${typeof btoa === 'function' ? btoa(pair) : Buffer.from(pair).toString('base64')}`;
}

export class IntervalsClient {
  athleteId: string;

  constructor(
    private apiKey: string,
    athleteId = '0',
    private fetcher: Fetcher = (...args) => fetch(...args),
    private base = ICU_BASE,
  ) {
    this.athleteId = athleteId || '0';
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await this.fetcher(url.toString(), {
      method,
      headers: {
        Authorization: basicAuth(this.apiKey),
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hint =
        res.status === 401
          ? 'API key rejected — check Settings → Developer in Intervals.icu.'
          : res.status === 403
            ? 'Access denied — enable API access to planned workouts in Intervals.icu settings.'
            : res.status === 429
              ? 'Rate limited by Intervals.icu — try again in a minute.'
              : '';
      throw new IntervalsError(`${method} ${path} → ${res.status}. ${hint} ${text.slice(0, 200)}`.trim(), res.status, path);
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
  }

  private a(path = '') {
    return `/athlete/${this.athleteId}${path}`;
  }

  async athlete(): Promise<IcuAthlete> {
    const a = await this.request<IcuAthlete>('GET', this.a());
    // Pin the real id so later calls don't depend on the "0 = me" alias.
    if (a?.id) this.athleteId = String(a.id);
    return a;
  }

  events(oldest: string, newest: string): Promise<IcuEvent[]> {
    return this.request('GET', this.a('/events.json'), undefined, {
      oldest,
      newest,
      category: 'WORKOUT,RACE_A,RACE_B,RACE_C,NOTE',
      resolve: 'true',
    });
  }

  activities(oldest: string, newest: string): Promise<IcuActivity[]> {
    return this.request('GET', this.a('/activities'), undefined, { oldest, newest });
  }

  wellness(oldest: string, newest: string): Promise<IcuWellness[]> {
    return this.request('GET', this.a('/wellness.json'), undefined, { oldest, newest });
  }

  /** Create or update by external_id — re-applying the same proposal is idempotent. */
  upsertEvents(events: NewEvent[]): Promise<IcuEvent[]> {
    return this.request('POST', this.a('/events/bulk'), events, { upsert: 'true' });
  }

  updateEvent(id: number, patch: Partial<NewEvent>): Promise<IcuEvent> {
    return this.request('PUT', this.a(`/events/${id}`), patch);
  }

  deleteEvent(id: number): Promise<void> {
    return this.request('DELETE', this.a(`/events/${id}`));
  }

  /** Write RPE / feel back to a completed activity. */
  updateActivity(id: string, patch: Pick<IcuActivity, 'icu_rpe' | 'feel'>): Promise<IcuActivity> {
    return this.request('PUT', `/activity/${id}`, patch);
  }

  putWellness(date: string, patch: Partial<IcuWellness>): Promise<IcuWellness> {
    return this.request('PUT', this.a(`/wellness/${date}`), { id: date, ...patch });
  }
}
