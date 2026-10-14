import type { PlannedWorkout, WindowPlan } from '../types.js';

const MS_PER_HOUR = 60 * 60 * 1000;

export interface WindowDailySlice {
  labelISO: string;
  dayStartISO: string;
  value: number;
  isWorkoutDay: boolean;
}

export interface EnumeratedWindowSlice {
  dayKey: number;
  dayStartISO: string;
  labelISO: string;
  hours: number;
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function enumerateWindowSlices(window: WindowPlan): EnumeratedWindowSlice[] {
  const start = new Date(window.windowStartISO);
  const end = new Date(window.windowEndISO);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return [];
  }

  const slices: EnumeratedWindowSlice[] = [];
  let cursor = start;

  while (cursor < end) {
    const dayStart = startOfDay(cursor);
    const dayEnd = addDays(dayStart, 1);
    const segmentEnd = new Date(Math.min(dayEnd.getTime(), end.getTime()));
    const hours = Math.max(0, (segmentEnd.getTime() - cursor.getTime()) / MS_PER_HOUR);
    const dayStartISO = dayStart.toISOString();
    const labelDate = new Date(dayStartISO);
    labelDate.setUTCHours(12, 0, 0, 0);

    slices.push({
      dayKey: dayStart.getTime(),
      dayStartISO,
      labelISO: labelDate.toISOString(),
      hours,
    });

    cursor = segmentEnd;
  }

  return slices;
}

function isSameDay(iso: string, comparison: Date): boolean {
  const date = new Date(iso);
  return date.toDateString() === comparison.toDateString();
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function prepareWindowSlices(
  window: WindowPlan,
  prevWorkout: PlannedWorkout | undefined,
): EnumeratedWindowSlice[] {
  const slices = enumerateWindowSlices(window);

  if (!prevWorkout || slices.length <= 1) {
    return slices;
  }

  const prevEnd = new Date(prevWorkout.endISO);
  if (!Number.isFinite(prevEnd.getTime())) {
    return slices;
  }

  const firstSlice = slices[0];
  if (!isSameDay(firstSlice.dayStartISO, prevEnd)) {
    return slices;
  }

  const [, ...remaining] = slices;
  if (remaining.length === 0) {
    return slices;
  }

  const [firstRemaining, ...rest] = remaining;
  const mergedFirst: EnumeratedWindowSlice = {
    ...firstRemaining,
    hours: firstRemaining.hours + firstSlice.hours,
  };

  return [mergedFirst, ...rest];
}

export function distributeWindowTargets(
  window: WindowPlan,
  workout: PlannedWorkout | undefined,
  prevWorkout: PlannedWorkout | undefined,
): WindowDailySlice[] {
  const slices = prepareWindowSlices(window, prevWorkout);
  if (slices.length === 0) {
    return [
      {
        labelISO: window.windowEndISO,
        dayStartISO: window.windowEndISO,
        value: roundTo(window.target_kcal),
        isWorkoutDay: true,
      },
    ];
  }

  const workoutReference = (() => {
    if (workout) {
      const startTime = new Date(workout.startISO);
      if (Number.isFinite(startTime.getTime())) return startTime;
    }
    return new Date(window.windowEndISO);
  })();
  const workoutDayKey = startOfDay(workoutReference).getTime();

  const totalHours = slices.reduce((sum, slice) => sum + slice.hours, 0);
  if (totalHours <= 0) {
    return [
      {
        labelISO: slices[0].labelISO,
        dayStartISO: slices[0].dayStartISO,
        value: roundTo(window.target_kcal),
        isWorkoutDay: slices[0].dayKey === workoutDayKey,
      },
    ];
  }

  const totalRest = window.resting_kcal;
  const totalWorkout = window.workout_kcal;
  const totalNeed = totalRest + totalWorkout;
  const desiredTotal = window.target_kcal;
  const deficit = Math.max(0, totalNeed - desiredTotal);

  const sliceValues = slices.map((slice) => {
    const restShare = totalRest * (slice.hours / totalHours);
    const isWorkoutDay = slice.dayKey === workoutDayKey;
    const workoutShare = isWorkoutDay ? totalWorkout : 0;
    return {
      restShare,
      isWorkoutDay,
      value: restShare + workoutShare,
    };
  });

  let remainingDeficit = deficit;

  for (const slice of sliceValues.filter((entry) => !entry.isWorkoutDay)) {
    if (remainingDeficit <= 0) break;
    const reduction = Math.min(slice.value, remainingDeficit);
    slice.value = Math.max(0, slice.value - reduction);
    remainingDeficit -= reduction;
  }

  if (remainingDeficit > 0) {
    for (const slice of sliceValues.filter((entry) => entry.isWorkoutDay)) {
      if (remainingDeficit <= 0) break;
      const reduction = Math.min(slice.value, remainingDeficit);
      slice.value = Math.max(0, slice.value - reduction);
      remainingDeficit -= reduction;
    }
  }

  const currentTotal = sliceValues.reduce((sum, slice) => sum + slice.value, 0);
  const adjustment = desiredTotal - currentTotal;
  if (Math.abs(adjustment) > 0.01) {
    const targetSlice =
      sliceValues.find((slice) => slice.isWorkoutDay) ?? sliceValues[sliceValues.length - 1];
    targetSlice.value = Math.max(0, targetSlice.value + adjustment);
  }

  return sliceValues.map((slice, index) => ({
    labelISO: slices[index].labelISO,
    dayStartISO: slices[index].dayStartISO,
    value: roundTo(slice.value),
    isWorkoutDay: slice.isWorkoutDay,
  }));
}
