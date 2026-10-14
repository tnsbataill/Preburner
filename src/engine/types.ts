// Core domain types. All times are athlete-local wall clock: a date key
// ('YYYY-MM-DD') plus minutes after local midnight. We never convert to UTC,
// so evening sessions can't drift onto the wrong day and DST is a non-issue.

export type DateKey = string; // YYYY-MM-DD
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type Sex = 'M' | 'F';

export type Intensity = 'Recovery' | 'Endurance' | 'Tempo' | 'Threshold' | 'VO2' | 'Race';

export type KjSource = 'planned' | 'description' | 'steps' | 'intensity' | 'load' | 'duration' | 'actual';

export interface WorkoutStep {
  durationS: number;
  /** fraction of FTP, e.g. 0.95 */
  lo: number;
  hi: number;
}

export interface Workout {
  id: string;
  source: 'intervals' | 'demo' | 'manual' | 'preburner';
  date: DateKey;
  /** Minutes after local midnight. null = time not known (e.g. TrainerRoad date-only sync). */
  startMin: number | null;
  durationMin: number;
  title: string;
  sport: string;
  intensity: Intensity;
  /** Intensity factor (NP/FTP), 0..1.3 */
  ifactor: number;
  /** Training stress / load (TSS-like) */
  load: number;
  kj: number;
  kjSource: KjSource;
  steps?: WorkoutStep[];
  indoor?: boolean;
  /** Carbs/hour explicitly set on the Intervals event, if any */
  carbsPerHourOverride?: number;
  /** Category on Intervals (WORKOUT, RACE_A...) */
  category?: string;
  completed?: boolean;
  description?: string;
}

export interface WeightEntry {
  date: DateKey;
  kg: number;
  source: 'manual' | 'intervals';
}

export interface WellnessDay {
  date: DateKey;
  ctl?: number;
  atl?: number;
  weight?: number;
  restingHR?: number;
  hrv?: number;
  sleepHours?: number;
  kcalConsumed?: number;
}

export interface TrainingSlot {
  /** minutes after midnight */
  startMin: number;
}

export interface Schedule {
  wakeMin: number;
  sleepMin: number;
  breakfastMin: number;
  lunchMin: number;
  dinnerMin: number;
  /** default start time per weekday when a workout has no time */
  defaultTrainingMin: Record<Weekday, number>;
  preSleepProtein: boolean;
}

export interface AthleteProfile {
  name?: string;
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  bodyFatPct?: number;
  ftp: number;
  /** gross mechanical efficiency, 0.18..0.25 */
  efficiency: number;
  /** non-exercise activity multiplier on BMR, 1.2 desk .. 1.6 very active job */
  neatFactor: number;
  units: 'metric' | 'imperial';
  timezone?: string;
}

export interface NutritionPrefs {
  proteinGPerKg: number;
  fatMinGPerKg: number;
  /** baseline carb need on a zero-training day, g/kg */
  baseCarbGPerKg: number;
  /** maximum trained gut absorption, g/h */
  maxCarbPerHour: number;
  /** fructose per glucose, e.g. 0.8 = 1:0.8 */
  fructoseRatio: number;
  sweatRateLPerH: number;
  sodiumMgPerL: number;
}

export interface Goals {
  targetWeightKg?: number;
  targetWeightDate?: DateKey;
  /** explicit weekly rate override; negative = lose */
  weeklyRateKg?: number;
  maxDailyDeficit: number;
  /** A-race / target event */
  eventName?: string;
  eventDate?: DateKey;
  targetCtl?: number;
  targetTsb?: number;
  targetFtp?: number;
  /** available training hours per weekday */
  availabilityHours: Record<Weekday, number>;
  maxRampPerWeek: number;
}

export interface Settings {
  profile: AthleteProfile;
  schedule: Schedule;
  nutrition: NutritionPrefs;
  goals: Goals;
}

// ---- Engine outputs ----

export type SlotKind =
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'snack'
  | 'pre-meal'
  | 'pre-snack'
  | 'during'
  | 'recovery'
  | 'pre-sleep';

export interface Macros {
  carbG: number;
  proteinG: number;
  fatG: number;
}

export interface MealSlot {
  id: string;
  kind: SlotKind;
  label: string;
  startMin: number;
  /** for 'during' slots */
  endMin?: number;
  macros: Macros;
  kcal: number;
  workoutId?: string;
  /** short why */
  rationale: string;
  ideas: string[];
  /** during-session specifics */
  fueling?: {
    carbPerHour: number;
    fluidMlPerHour: number;
    sodiumMgPerHour: number;
    glucoseG: number;
    fructoseG: number;
  };
  /** low fat / low fiber guidance */
  lowResidue?: boolean;
}

export type DayLoadClass = 'rest' | 'light' | 'moderate' | 'high' | 'very-high';

export interface DayEnergy {
  bmr: number;
  neat: number;
  /** net exercise kcal (gross minus resting already counted) */
  exercise: number;
  tdee: number;
  deficit: number;
  target: number;
  /** grams of carbohydrate oxidised in sessions */
  sessionCarbG: number;
  energyAvailability: number;
}

export interface DayPlan {
  date: DateKey;
  weekday: Weekday;
  workouts: Array<Workout & { resolvedStartMin: number; timeAssumed: boolean }>;
  loadClass: DayLoadClass;
  /** class of tomorrow, drives evening carb top-up */
  nextLoadClass: DayLoadClass;
  protectedDay: boolean;
  energy: DayEnergy;
  macros: Macros;
  carbGPerKg: number;
  slots: MealSlot[];
  flags: PlanFlag[];
}

export interface PlanFlag {
  level: 'info' | 'warn' | 'alert';
  code: string;
  message: string;
}

export interface GlycogenPoint {
  date: DateKey;
  min: number;
  /** grams */
  muscle: number;
  liver: number;
  /** 0..1 */
  pct: number;
}

export interface FitnessPoint {
  date: DateKey;
  load: number;
  ctl: number;
  atl: number;
  tsb: number;
  projected: boolean;
}

export interface WeekSummary {
  weekStart: DateKey;
  days: DateKey[];
  load: number;
  hours: number;
  kcal: number;
  macros: Macros;
  targetDeficit: number;
  placedDeficit: number;
  expectedChangeKg: number;
}

export interface Plan {
  days: DayPlan[];
  weeks: WeekSummary[];
  glycogen: GlycogenPoint[];
  weeklyRateKg: number;
  flags: PlanFlag[];
}
