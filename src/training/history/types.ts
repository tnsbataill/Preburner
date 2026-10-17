import type { DateKey } from '../../engine/types';
import type { DomainLoad } from '../types';

// The compact training history every source (Strava archive, Intervals,
// simulation) is reduced to. Raw power streams never get stored. Only these
// per-ride summaries and daily wellness do.

export interface RideRecord {
  id: string;
  date: DateKey;
  /** local start, minutes after midnight (for de-duplication across sources) */
  startMin?: number;
  durationMin: number;
  /** TSS against the FTP set at the time */
  tss: number;
  domain: DomainLoad;
  /** FTP the athlete had configured when riding */
  ftpSet: number;
  /** best mean power over 5 / 20 / 60 min, watts */
  best5?: number;
  best20?: number;
  best60?: number;
  /** ride contained a maximal test effort (FTP test, ramp test, race) */
  isTest?: boolean;
  /** structured session where targets could not be held */
  failed?: boolean;
  /** why a planned session didn't go to plan, as the athlete reported it */
  issue?: RideIssue;
  /** session RPE the athlete reported, 1-10 */
  rpe?: number;
  /** how the athlete felt, Intervals scale: 1 strong, 2 good, 3 normal, 4 poor, 5 weak */
  feel?: number;
  /** planned session kind/level this ride executed (for RPE-driven progression) */
  kind?: string;
  level?: number;
  /** planned session this ride executed */
  plannedId?: string;
  /** load estimated from summary numbers (kcal, average power, HR), not a power stream:
   * fine for summed load, too coarse to say what kind of session it was */
  estimated?: boolean;
  /** recorded, but only reached Intervals via Strava, whose data the API won't share */
  noData?: boolean;
  /** load filled in from the planned session (the ride itself had no data) */
  assumed?: boolean;
  source: 'strava' | 'intervals' | 'sim';
}

/** Why a planned session was skipped. */
export type MissedReason = 'time' | 'travel' | 'equipment' | 'tired' | 'sick' | 'injured';
/** Why a ridden session didn't go to plan (cut short or targets missed). */
export type RideIssue = 'time' | 'equipment' | 'too-hard' | 'unwell';

export interface WellnessRecord {
  date: DateKey;
  /** natural log of rMSSD (ms) */
  lnRmssd?: number;
  rhr?: number;
  sleepHours?: number;
}

/** An observation of FTP-equivalent performance. */
export interface PerfObs {
  date: DateKey;
  watts: number;
  /** test = deliberate maximal test; max = likely near-maximal effort; bound = sub-maximal (lower bound) */
  kind: 'test' | 'max' | 'bound';
}

export interface TrainingHistory {
  rides: RideRecord[];
  wellness: WellnessRecord[];
}
