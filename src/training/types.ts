import type { DateKey, Weekday, WorkoutStep } from '../engine/types';

// Training-plan layer types. Load is split into three intensity domains so the
// response model can learn how this athlete responds to each:
//   low  = below ~76% FTP (recovery / endurance)
//   mid  = 76–105% FTP (tempo, sweet spot, threshold)
//   high = above 105% FTP (VO2max, anaerobic)

export type Domain = 'low' | 'mid' | 'high';
export type DomainLoad = Record<Domain, number>;

export type Objective = 'ftp' | 'event' | 'ctl';

export type SessionKind =
  | 'recovery'
  | 'endurance'
  | 'long'
  | 'tempo'
  | 'sweetspot'
  | 'threshold'
  | 'overunder'
  | 'vo2'
  | 'anaerobic'
  | 'openers'
  | 'ftptest';

export type HardKind = Extract<SessionKind, 'tempo' | 'sweetspot' | 'threshold' | 'overunder' | 'vo2' | 'anaerobic'>;

export type Phase = 'base' | 'build' | 'recovery' | 'taper' | 'test';

/** One block of a structured session; `reps` > 1 repeats `steps`. */
export interface Block {
  reps: number;
  steps: Array<{ durationS: number; lo: number; hi: number; label?: string }>;
}

export interface PlannedSession {
  id: string;
  date: DateKey;
  kind: SessionKind;
  /** progression level within its kind (1-based) */
  level: number;
  /** level as originally planned; adaptation stays within ±2 of it */
  plannedLevel?: number;
  title: string;
  durationMin: number;
  blocks: Block[];
  steps: WorkoutStep[];
  ifactor: number;
  tss: number;
  domain: DomainLoad;
  hard: boolean;
  /** Intervals.icu workout-builder text */
  structure: string;
  purpose: string;
}

export interface PlanWeek {
  index: number;
  start: DateKey;
  phase: Phase;
  targetTss: number;
  plannedTss: number;
  hours: number;
  hardSessions: number;
  /** true when availability capped the week below its target */
  availabilityLimited: boolean;
}

/**
 * Tunable plan shape. The optimizer searches this space; evidence-based limits
 * (hard days/week, no back-to-back hard days, ramp cap) are enforced by the
 * generator regardless of the genome.
 */
export interface Genome {
  /** load weeks before each recovery week (2 = 2:1, 3 = 3:1) */
  cadence: 2 | 3 | 4;
  /** recovery-week load as a fraction of the preceding load week */
  recoveryDepth: number;
  /** target CTL gain per load week */
  rampPerWeek: number;
  /** hard sessions per load week (2..3) */
  hardPerWeek: 2 | 3;
  /** share of build-phase hard sessions that are VO2/anaerobic (rest threshold/over-under) */
  vo2Share: number;
  /** fraction of weeks (excluding the final week) spent in base */
  baseFrac: number;
  /** share of base-phase hard sessions that are threshold rather than sweet spot/tempo */
  baseThresholdShare: number;
}

export interface PlanRequest {
  start: DateKey;
  weeks: number;
  objective: Objective;
  /** for objective 'event' */
  eventDate?: DateKey;
  ftp: number;
  /** current fitness/fatigue at start - 1 */
  ctl: number;
  atl: number;
  availabilityHours: Record<Weekday, number>;
  maxRampPerWeek: number;
  /** preferred long-ride weekday; defaults to the biggest weekend slot */
  longRideDay?: Weekday;
  /** open with an FTP test on the first hard day (when FTP is uncertain) */
  baselineTest?: boolean;
  /** starting progression levels per kind (from history); default derived from CTL */
  startLevels?: Partial<Record<HardKind, number>>;
}

export interface TrainingPlan {
  id: string;
  createdAt: string;
  request: PlanRequest;
  genome: Genome;
  weeks: PlanWeek[];
  sessions: PlannedSession[];
  /** model projection for the plan, filled by the optimizer */
  projection?: PlanProjection;
}

export interface PlanProjection {
  /** projected performance (FTP watts) on the final day: median and 10/90th pct */
  finalFtp: { p10: number; p50: number; p90: number };
  startFtp: number;
  daily: Array<{ date: DateKey; ctl: number; atl: number; perf: number }>;
  /** probability any week enters overload in the model ensemble */
  overloadRisk: number;
  objectiveValue: number;
}
