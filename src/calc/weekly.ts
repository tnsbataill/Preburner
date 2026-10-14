import type { PlannedWorkout, Profile, SessionType, WeeklyPlan, WindowPlan } from '../types.js';
import { computeMacroTargets, isHardSession } from './prescribe.js';

function cloneWindow(window: WindowPlan): WindowPlan {
  return {
    ...window,
    carbs: { ...window.carbs },
    macros: { ...window.macros },
    notes: window.notes.filter(
      (note) =>
        !note.startsWith('Deficit applied:') &&
        !note.startsWith(DEFICIT_APPLIED_NOTE_PREFIX) &&
        !note.startsWith(DEFICIT_MAXED_NOTE_PREFIX),
    ),
  };
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getIsoWeekInfo(dateISO: string) {
  const date = new Date(dateISO);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const weekStart = new Date(target);
  weekStart.setUTCDate(target.getUTCDate() - (day - 1));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  const pad = (value: number) => value.toString().padStart(2, '0');

  return {
    weekKey: `${target.getUTCFullYear()}-W${pad(weekNumber)}`,
    weekStartISO: `${weekStart.toISOString().slice(0, 10)}T00:00:00.000Z`,
    weekEndISO: `${weekEnd.toISOString().slice(0, 10)}T23:59:59.999Z`,
  };
}

export const WINDOW_EMPTY_FLAG = 'EMPTY_FLAG';
export const WINDOW_UNDER_RECOVERY_FLAG = 'UNDER_RECOVERY_FLAG';
export const DEFICIT_APPLIED_NOTE_PREFIX = 'DEFICIT_APPLIED:';
export const DEFICIT_MAXED_NOTE_PREFIX = 'DEFICIT_MAXED:';

export interface WeeklyResult {
  windows: WindowPlan[];
  weekly: WeeklyPlan[];
}

export function allocateWeeklyDeficits(
  profile: Profile,
  windows: WindowPlan[],
  workouts: PlannedWorkout[],
): WeeklyResult {
  if (windows.length === 0) {
    return { windows: [], weekly: [] };
  }

  const workoutMap = new Map(workouts.map((workout) => [workout.id, workout]));
  const clonedWindows = windows.map((window) => {
    const cloned = cloneWindow(window);
    cloned.macros = computeMacroTargets(profile, cloned.target_kcal, cloned.workoutCarb_kcal);
    return cloned;
  });
  const grouped = new Map<string, WindowPlan[]>();

  for (const window of clonedWindows) {
    const info = getIsoWeekInfo(window.windowEndISO);
    if (!grouped.has(info.weekKey)) {
      grouped.set(info.weekKey, []);
    }
    grouped.get(info.weekKey)!.push(window);
  }

  const weeklyPlans: WeeklyPlan[] = [];
  const weekEntries = Array.from(grouped.entries()).sort(([aKey], [bKey]) => (aKey < bKey ? -1 : 1));

  const EPSILON = 1e-3;

  for (const [weekKey, weekWindows] of weekEntries) {
    weekWindows.sort((a, b) => new Date(a.windowEndISO).getTime() - new Date(b.windowEndISO).getTime());

    const { weekStartISO, weekEndISO } = getIsoWeekInfo(weekWindows[0].windowEndISO);
    const weeklyTargetKcal = profile.targetKgPerWeek * profile.kcalPerKg;
    const requestedDeficit = weeklyTargetKcal < -EPSILON ? -weeklyTargetKcal : 0;

    const pctCap = profile.windowPctCap ?? 0.3;
    const entries = weekWindows.map((window) => {
      const nextWorkout = workoutMap.get(window.nextWorkoutId);
      const nextType: SessionType | undefined = nextWorkout?.type ?? window.nextWorkoutType;
      const hardDay = nextType ? isHardSession(nextType) : false;
      let maxDeficit = Math.min(profile.deficitCapPerWindow, window.need_kcal * pctCap);

      return {
        window,
        maxDeficit: Math.max(0, maxDeficit),
        allocated: 0,
      };
    });

    const totalCapacity = entries.reduce((sum, entry) => sum + entry.maxDeficit, 0);
    let remainingDeficit = Math.min(requestedDeficit, totalCapacity);

    let active = entries.filter((entry) => entry.maxDeficit > EPSILON);

    while (remainingDeficit > EPSILON && active.length > 0) {
      const share = remainingDeficit / active.length;
      let progressed = false;

      for (const entry of active) {
        const capacityLeft = entry.maxDeficit - entry.allocated;
        if (capacityLeft <= EPSILON) {
          continue;
        }
        const applied = Math.min(capacityLeft, share);
        if (applied > EPSILON) {
          entry.allocated += applied;
          remainingDeficit -= applied;
          progressed = true;
        }
      }

      if (!progressed) {
        break;
      }

      active = entries.filter((entry) => entry.maxDeficit - entry.allocated > EPSILON);
    }

    const allocated = entries.reduce((sum, entry) => sum + entry.allocated, 0);
    const carryOver = Math.max(0, requestedDeficit - allocated);

    const macroAccumulator = { protein_g: 0, fat_g: 0, carb_g: 0 };

    for (const entry of entries) {
      const { window, allocated: deficit } = entry;
      const appliedDeficit = Math.max(0, Math.min(window.need_kcal, deficit));
      const target = Math.max(0, window.need_kcal - appliedDeficit);
      window.target_kcal = target;
      if (appliedDeficit > EPSILON) {
        window.notes.push(`${DEFICIT_APPLIED_NOTE_PREFIX}${Math.round(appliedDeficit)}`);
      }
      window.macros = computeMacroTargets(profile, window.target_kcal, window.workoutCarb_kcal);
      macroAccumulator.protein_g += window.macros.protein_g;
      macroAccumulator.fat_g += window.macros.fat_g;
      macroAccumulator.carb_g += window.macros.carb_g;
    }

    if (carryOver > EPSILON && allocated > EPSILON) {
      const carryRounded = Math.round(carryOver);
      for (const entry of entries) {
        const { window, allocated: applied } = entry;
        if (applied > EPSILON && entry.maxDeficit - applied <= EPSILON) {
          window.notes.push(`${DEFICIT_MAXED_NOTE_PREFIX}${Math.round(applied)}:${carryRounded}`);
        }
      }
    }

    weeklyPlans.push({
      weekKey,
      weekStartISO,
      weekEndISO,
      weeklyTargetDeficit_kcal: Math.round(requestedDeficit),
      weeklyAllocated_kcal: Math.round(allocated),
      carryOver_kcal: carryOver > EPSILON ? Math.round(carryOver) : undefined,
      macros: {
        protein_g: round(macroAccumulator.protein_g),
        fat_g: round(macroAccumulator.fat_g),
        carb_g: round(macroAccumulator.carb_g),
      },
    });
  }

  return { windows: clonedWindows, weekly: weeklyPlans };
}
