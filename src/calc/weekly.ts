import { PlannedWorkout, Profile, SessionType, WeeklyPlan, WindowPlan } from '../types';
import { isHardSession } from './prescribe';

function cloneWindow(window: WindowPlan): WindowPlan {
  return {
    ...window,
    carbs: { ...window.carbs },
    notes: [...window.notes],
  };
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
  const clonedWindows = windows.map(cloneWindow);
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

  for (const [weekKey, weekWindows] of weekEntries) {
    weekWindows.sort((a, b) => new Date(a.windowEndISO).getTime() - new Date(b.windowEndISO).getTime());

    const { weekStartISO, weekEndISO } = getIsoWeekInfo(weekWindows[0].windowEndISO);
    const weeklyTarget = Math.abs(profile.targetKgPerWeek) * profile.kcalPerKg;
    let remainingDeficit = weeklyTarget;

    for (const window of weekWindows) {
      const nextWorkout = workoutMap.get(window.nextWorkoutId);
      const nextType: SessionType | undefined = nextWorkout?.type ?? window.nextWorkoutType;
      const hardDay = nextType ? isHardSession(nextType) : false;
      const pctCap = profile.windowPctCap ?? 0.3;
      let canTake = hardDay ? 0 : Math.min(profile.deficitCapPerWindow, window.need_kcal * pctCap);

      if (window.notes.includes(WINDOW_UNDER_RECOVERY_FLAG)) {
        canTake = 0;
      } else if (window.notes.includes(WINDOW_EMPTY_FLAG)) {
        canTake *= 0.5;
      }

      const deficit = Math.min(canTake, remainingDeficit);
      if (deficit > 0) {
        window.target_kcal = Math.max(0, window.need_kcal - deficit);
        window.notes.push(`Deficit applied: ${Math.round(deficit)}`);
      }
      remainingDeficit -= deficit;
    }

    const allocated = weeklyTarget - remainingDeficit;
    weeklyPlans.push({
      weekKey,
      weekStartISO,
      weekEndISO,
      weeklyTargetDeficit_kcal: Math.round(weeklyTarget),
      weeklyAllocated_kcal: Math.round(allocated),
      carryOver_kcal: remainingDeficit > 0 ? Math.round(remainingDeficit) : undefined,
    });
  }

  return { windows: clonedWindows, weekly: weeklyPlans };
}
