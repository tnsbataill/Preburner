export type UUID = string;

export type Discipline = 'bike' | 'run' | 'swim' | 'strength';

export type WorkoutFocus = 'Endurance' | 'VO2' | 'Tempo' | 'Threshold' | 'Recovery';

export type WorkoutIntervalType =
  | 'warmup'
  | 'steady'
  | 'interval'
  | 'recovery'
  | 'cooldown'
  | 'skills';

export type TargetKind = 'power' | 'heartRate' | 'pace' | 'cadence' | 'rpe';

export interface NumericTarget {
  kind: Exclude<TargetKind, 'pace'>;
  unit: 'percentFtp' | 'watts' | 'bpm' | 'percentMaxHr' | 'rpm' | 'rpe';
  lower: number;
  upper: number;
  notes?: string;
}

export interface PaceTarget {
  kind: 'pace';
  unit: 'min_per_km' | 'min_per_mi';
  lower: number;
  upper: number;
  notes?: string;
}

export type IntervalTarget = NumericTarget | PaceTarget;

export interface WorkoutInterval {
  id: UUID;
  type: WorkoutIntervalType;
  name: string;
  durationMinutes: number;
  primaryTarget: IntervalTarget;
  secondaryTargets?: IntervalTarget[];
  notes?: string;
}

export interface PlannedWorkout {
  id: UUID;
  title: string;
  focus: WorkoutFocus;
  discipline: Discipline;
  scheduledFor: string; // ISO8601 date string
  totalMinutes: number;
  description?: string;
  intervals: WorkoutInterval[];
  notes?: string;
}

export interface ProfileMetrics {
  ftp: number;
  maxHeartRate: number;
  lactateThresholdHeartRate?: number;
  vo2Max?: number;
  weightKg?: number;
}

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ProfileAvailability {
  daysPerWeek: number;
  longestSessionMinutes: number;
  earlyMorningOk: boolean;
}

export interface Profile {
  id: UUID;
  name: string;
  unitSystem: 'metric' | 'imperial';
  experienceLevel: ExperienceLevel;
  preferredDiscipline: Discipline;
  metrics: ProfileMetrics;
  availability: ProfileAvailability;
  notes?: string;
  lastUpdated: string; // ISO8601 timestamp
}
