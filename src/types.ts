export type SessionType = 'Endurance' | 'Tempo' | 'Threshold' | 'VO2' | 'Race' | 'Rest';

export type EfficiencyPreset = 'WorldClass' | 'Elite' | 'Competitive' | 'Enthusiast';

export interface Profile {
  sex: 'M' | 'F';
  age_years: number;
  height_cm: number;
  weight_kg: number;
  ftp_watts?: number;
  efficiencyPreset: EfficiencyPreset;
  efficiency: number;
  activityFactorDefault: number;
  activityFactorOverrides?: Record<string, number>;
  targetKgPerWeek: number;
  kcalPerKg: number;
  deficitCapPerWindow: number;
  windowPctCap?: number;
  protein_g_per_kg: number;
  fat_g_per_kg_min: number;
  carbBands: Record<SessionType, [number, number]>;
  carbSplit: { pre: number; during: number; post: number };
  gluFruRatio: number;
  useImperial: boolean;
}

export interface Step {
  start_s: number;
  duration_s: number;
  target_type: '%FTP' | 'Watts' | 'RPE';
  target_lo?: number;
  target_hi?: number;
}

export interface PlannedWorkout {
  id: string;
  source: 'intervals' | 'file';
  title?: string;
  type: SessionType;
  startISO: string;
  endISO: string;
  duration_hr: number;
  planned_kJ?: number;
  ftp_watts_at_plan?: number;
  steps?: Step[];
  kj_source:
    | 'ICU Structured'
    | 'Estimated (steps)'
    | 'Estimated (IF/TSS)'
    | 'Description'
    | 'Estimated (fallback)';
}

export interface CarbPlan {
  g_per_hr: number;
  pre_g: number;
  during_g: number;
  post_g: number;
  gluFruRatio: number;
}

export interface MacroTargets {
  protein_g: number;
  fat_g: number;
  carb_g: number;
}

export interface WindowPlan {
  windowStartISO: string;
  windowEndISO: string;
  prevWorkoutId: string;
  nextWorkoutId: string;
  nextWorkoutType: SessionType;
  need_kcal: number;
  target_kcal: number;
  activityFactorApplied: number;
  carbs: CarbPlan;
  macros: MacroTargets;
  notes: string[];
}

export interface WeeklyPlan {
  weekKey: string;
  weekStartISO: string;
  weekEndISO: string;
  weeklyTargetDeficit_kcal: number;
  weeklyAllocated_kcal: number;
  carryOver_kcal?: number;
  macros: MacroTargets;
}

export interface WeightEntry {
  dateISO: string;
  weight_kg: number;
  source?: 'manual' | 'intervals';
}
