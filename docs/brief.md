0) One-liner

A free PWA (web app) that pulls planned workouts from Intervals.icu (TrainerRoad → Intervals.icu → this app) and prescribes daily + session-to-session calories and macros using the podcast method: session-to-session windows, protected hard days, and capped deficits guided by a weekly weight-change target.

1) Tech/Hosting

Frontend: React + TypeScript + Vite + Tailwind

Data: IndexedDB (Dexie) + localStorage for small flags

PWA: Installable on desktop/mobile; offline cache for UI/data

Hosting: GitHub Pages (free)

APIs: Intervals.icu API key v1 (direct from browser). Add OAuth2 + Cloudflare Worker later if needed.

2) Integrations
Intervals.icu (Primary)

Auth v1: Personal API key (user pastes it once; stored locally)

Scope: CALENDAR:READ

Pull: Calendar events with category=WORKOUT for date range (e.g., today → +14 days)

Structured file (optional but recommended): Download .zwo/.fit/.erg/.mrc with resolve=true for step detail

Use: Extract date/time, sport/type, duration, %FTP targets → compute planned kJ if not directly provided

Fallback (Optional)

File import: .zwo/.fit/.tcx/.csv drag-drop. Parse steps/metadata to estimate planned kJ.

Later (v2)

Strava OAuth: Completed rides for actual kJ to validate/refine efficiency/absorption.

3) Core Method (Calculations)
3.1 Session-to-Session Windows

Window = end of workout A → end of workout B (not midnight).

For each window:

Exercise kcal = planned_kJ_next_session / efficiency

Resting kcal = RMR * (window_hours / 24) * activity_factor

Need kcal = exercise kcal + resting kcal

Target kcal = Need kcal – allocated_deficit

3.2 Efficiency (TP-style presets)

Preset selects default gross efficiency; “Advanced” exposes a slider:

World-Class: 0.24

Elite: 0.22

Competitive: 0.20

Enthusiast: 0.18

Advanced slider range: 0.18–0.24

3.3 RMR & Activity

RMR: Harris-Benedict (internal SI, UI in lb/ft)

Activity factor: slider 1.2–1.4 (per-day override allowed)

3.4 Weight-Change Target → Weekly Deficit

Slider: –1.0 to +0.5 kg/week (0 default = maintenance)

weekly_deficit_kcal = abs(kg_per_week) * 7700 (exposed as advanced constant)

Allocation rules:

Only into easy/rest windows

Cap per window: default 600 kcal (slider 0–800)

Optional % of need cap (default 30%)

Never allocate on hard windows (Threshold/VO2/Race)

3.5 Macros

Protein: default 1.6–1.8 g/kg/day (slider 1.2–2.2)

Fat: floor ≥0.6 g/kg/day (slider 0.5–1.0)

Carbs: remainder of daily target plus explicit intra-ride carbs:

Per session type g/hr bands (defaults below)

Pre/During/Post splits (percentages)

Glu:fru ratio slider (e.g., 1.0 → 0.6)

Over-fuel guard: trim on easy days if intake would exceed need

Default carb bands (g/hr):

Endurance: 50–80

Tempo: 60–90

Threshold: 80–100

VO2/Race: 90–120
(Used as min/max; chosen value can be auto-suggested from type, editable by user.)

3.6 Weight Feedback (optional but included v1)

Daily morning weight entry (lb/kg)

Graph with 7-day rolling average

Flags:

>1 kg overnight drop → mark next window “EMPTY_FLAG” (halve next window’s deficit cap)

Unexpected gain during deficit week → “UNDER_RECOVERY_FLAG” (set next window deficit = 0)

4) UI / Screens
4.1 Onboarding

Units (lb/ft), age/height/weight, FTP

Efficiency preset (with “Advanced”)

Activity factor default

Macros defaults (protein/fat floors, carb bands, pre/during/post)

Weekly weight change target slider (defaults to maintenance)

4.2 Connections

Intervals.icu: enter API key; test; pick date window (e.g., 14 days)

(Later) Strava connect (completed rides)

4.3 Planner

Calendar list of planned sessions with: type, duration, planned kJ source badge (“ICU Structured”, “Estimated (steps)”, “Estimated (IF/TSS)”)

Click session → shows intra-ride carb plan (g/hr) & pre/during/post grams

4.4 Windows View

Cards for each session-to-session window:

Need kcal, Target kcal, deficit applied chip

Carb plan for the upcoming session (pre/during/post)

Notes/warnings (hard-day protection, over-fuel guard, weight flags)

4.5 Weekly Summary

Totals (kcal, carbs/protein/fat)

Deficit placed vs target (bar + % achieved)

Weight trend mini-chart (actual vs expected)

4.6 Settings

All sliders (efficiency, activity, carb bands, glu:fru, pre/during/post %, deficit caps, kcal/kg)

Export JSON/CSV; import profile; reset defaults

5) Data Contracts (TypeScript shapes)
// Enums & types
export type SessionType = "Endurance"|"Tempo"|"Threshold"|"VO2"|"Race"|"Rest";

export type EfficiencyPreset = "WorldClass"|"Elite"|"Competitive"|"Enthusiast";

export interface Profile {
  // Identity/units
  sex: "M"|"F";
  age_years: number;
  height_cm: number;   // UI captures ft/in, convert to cm
  weight_kg: number;   // UI captures lb, convert to kg
  ftp_watts?: number;

  // Efficiency presets + advanced
  efficiencyPreset: EfficiencyPreset; // maps to default efficiency
  efficiency: number;                 // 0.18–0.24 (advanced)

  // Metabolic factors
  activityFactorDefault: number;      // 1.2–1.4
  activityFactorOverrides?: Record<string, number>; // ISO date -> factor

  // Weight target
  targetKgPerWeek: number;            // -1.0 .. +0.5 (0 default)
  kcalPerKg: number;                  // default 7700
  deficitCapPerWindow: number;        // default 600
  windowPctCap?: number;              // default 0.30 (30%)

  // Macros
  protein_g_per_kg: number;           // default 1.7
  fat_g_per_kg_min: number;           // default 0.6

  carbBands: Record<SessionType, [number, number]>; // g/hr min,max
  carbSplit: { pre: number; during: number; post: number }; // sums to 1
  gluFruRatio: number;                 // e.g. 1.0 means pure glucose; 0.6 ~ 1:0.6

  // UI flags
  useImperial: boolean;                // lb/ft in UI; calc in SI
}

export interface PlannedWorkout {
  id: string;                    // ICU event id
  source: "intervals"|"file";
  title?: string;
  type: SessionType;             // mapped from ICU/steps; fallback by name
  startISO: string;
  endISO: string;
  duration_hr: number;
  planned_kJ?: number;           // may be absent; estimate if missing
  ftp_watts_at_plan?: number;    // from ICU or user profile at the time
  steps?: Step[];                // parsed from ZWO/FIT/etc
  kj_source: "ICU Structured"|"Estimated (steps)"|"Estimated (IF/TSS)";
}

export interface Step {
  start_s: number;
  duration_s: number;
  target_type: "%FTP"|"Watts"|"RPE";
  target_lo?: number;
  target_hi?: number;
}

export interface WindowPlan {
  windowStartISO: string;
  windowEndISO: string;
  prevWorkoutId: string;
  nextWorkoutId: string;

  need_kcal: number;
  target_kcal: number;

  activityFactorApplied: number;

  // Intra-ride carb prescription for upcoming session
  carbs: {
    g_per_hr: number;
    pre_g: number;
    during_g: number;
    post_g: number;
    gluFruRatio: number;
  };

  notes: string[]; // e.g., "Deficit 600 kcal applied", "Hard day protected"
}

export interface WeeklyPlan {
  weekKey: string;              // e.g., "2025-W37"
  weekStartISO: string;
  weekEndISO: string;
  weeklyTargetDeficit_kcal: number;
  weeklyAllocated_kcal: number;
  carryOver_kcal?: number;
}

export interface WeightEntry {
  dateISO: string;              // morning date
  weight_kg: number;
}

export interface AppState {
  profile: Profile;
  workouts: PlannedWorkout[];   // future 7–14 days
  windows: WindowPlan[];
  weekly: WeeklyPlan[];
  weights: WeightEntry[];
  connections: {
    intervalsApiKey?: string;
    stravaConnected?: boolean;
  };
  lastSyncISO?: string;
}

6) Mapping & Estimation

Type mapping (ICU → SessionType):

ICU/structured name/tags → heuristics:

contains “VO2” → VO2

“Threshold/Sweet Spot” → Threshold

“Tempo” → Tempo

race/crit/hard group ride → Race

default → Endurance (or Rest if no work)

Planned kJ estimation (when missing):

If steps with %FTP and ftp_watts_at_plan known:
kJ = Σ( avg_target_watts_step * duration_s / 1000 )

For ranges, use midpoint; ignore very short recoveries if needed.

If only duration + IF/TSS:

Approximate avg watts via FTP×IF; kJ = avg_watts * duration_s / 1000

Mark kj_source accordingly.

7) Algorithms (Pseudocode)

Build windows:

sort workouts by start
for i in 0..n-1:
  prev = workouts[i]
  next = workouts[i+1] ?? prev
  windowStart = prev.endISO
  windowEnd   = next.endISO (or +24h if none)

  windowHours = hours(windowStart..windowEnd)

  exercise_kcal = (next.planned_kJ || estimate(next)) / profile.efficiency
  RMR = harrisBenedict(profile)
  resting_kcal = RMR * (windowHours/24) * (profile.activityFactorOverrides[date] ?? profile.activityFactorDefault)

  need_kcal = exercise_kcal + resting_kcal
  target_kcal = need_kcal  // deficit allocation happens in weekly allocator

  carbs = computeCarbsForSession(next, profile) // g/hr + pre/during/post

  push WindowPlan { ... }


Weekly deficit allocator:

group windows by ISO week (by windowEnd)
for each week:
  weeklyRemaining = abs(profile.targetKgPerWeek) * profile.kcalPerKg
  for window in chronological order:
    nextType = typeOf(nextWorkoutForWindow)
    hard = nextType in {Threshold, VO2, Race}

    canTake = hard ? 0 : min(profile.deficitCapPerWindow, window.need_kcal * (profile.windowPctCap ?? 0.30))

    // Weight flags (from prior day)
    if window.notes includes "EMPTY_FLAG": canTake *= 0.5
    if "UNDER_RECOVERY_FLAG": canTake = 0

    windowDeficit = min(canTake, weeklyRemaining)
    window.target_kcal = max(0, window.need_kcal - windowDeficit)
    weeklyRemaining -= windowDeficit


Carbs for session:

[minHr, maxHr] = profile.carbBands[next.type]
gHr = autoSuggestWithin(minHr..maxHr) // e.g., min for Endurance, max for hard days
during_g = gHr * next.duration_hr
pre_g = profile.carbSplit.pre    / profile.carbSplit.during * during_g
post_g= profile.carbSplit.post   / profile.carbSplit.during * during_g
apply over-fuel guard on easy days

8) Defaults

Efficiency preset: Competitive (0.20)

Activity factor: 1.3

Deficit cap/window: 600 kcal (0–800)

Window % cap: 30%

Target weight change: 0 kg/week (maintenance)

Protein: 1.7 g/kg; Fat: ≥0.6 g/kg

Carb bands (g/hr): End 50–80, Tempo 60–90, Thr 80–100, VO2/Race 90–120

Carb split: pre 0.2 / during 0.6 / post 0.2

Glu:fru: 1.0 (pure glucose) to start

9) Quality & Safety

Badges: show kJ source on each session.

Guards: never apply deficits on hard windows; don’t drop below protein/fat floors; warn on extreme plans.

Accessibility: keyboardable sliders, semantic labels.

Privacy: API key + athlete data stored locally only (no server).

Disclaimer: not medical advice; show RED-S caution for aggressive weight loss.

10) Roadmap

v1: ICU API key, planner & windows, deficits & macros, weight tracking, export CSV/JSON, PWA on GH Pages.
v2: Strava for actuals, “Insights” tab w/ rule-based tips (under/over recovery, consistent under-absorption).
v3: AI review: adaptive suggestions for efficiency/absorption/deficit placement; ICU write-back (annotations); multi-sport.
