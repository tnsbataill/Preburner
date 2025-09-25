import type { PlannedWorkout, Profile, SessionType } from '../types.js';

const HARD_SESSION_TYPES: SessionType[] = ['Threshold', 'VO2', 'Race'];

export interface CarbComputationResult {
  g_per_hr: number;
  pre_g: number;
  during_g: number;
  post_g: number;
  gluFruRatio: number;
  overFuelGuardApplied: boolean;
}

const EASY_SESSION_TYPES: SessionType[] = ['Endurance', 'Tempo'];

function selectBandValue(band: [number, number], type: SessionType): number {
  const [min, max] = band;
  if (type === 'Rest') {
    return 0;
  }
  if (HARD_SESSION_TYPES.includes(type)) {
    return max;
  }
  if (type === 'Tempo') {
    return (min + max) / 2;
  }
  return min;
}

export function computeCarbPlan(
  profile: Profile,
  workout: PlannedWorkout,
  windowNeedKcal: number,
): CarbComputationResult {
  const band = profile.carbBands[workout.type] ?? profile.carbBands.Endurance;
  const gPerHr = selectBandValue(band, workout.type);

  if (gPerHr === 0 || workout.duration_hr <= 0) {
    return {
      g_per_hr: 0,
      pre_g: 0,
      during_g: 0,
      post_g: 0,
      gluFruRatio: profile.gluFruRatio,
      overFuelGuardApplied: false,
    };
  }

  const during = gPerHr * workout.duration_hr;
  const split = profile.carbSplit;
  const pre = split.during === 0 ? 0 : (split.pre / split.during) * during;
  const post = split.during === 0 ? 0 : (split.post / split.during) * during;

  let totalCarbGrams = pre + during + post;
  let appliedGuard = false;

  if (EASY_SESSION_TYPES.includes(workout.type) && totalCarbGrams > 0) {
    const guardLimitKcal = windowNeedKcal * 0.6;
    const carbKcal = totalCarbGrams * 4;
    if (carbKcal > guardLimitKcal && guardLimitKcal > 0) {
      const scale = guardLimitKcal / carbKcal;
      totalCarbGrams *= scale;
      appliedGuard = true;
    }
  }

  if (appliedGuard) {
    const totalWithoutDuring = pre + post;
    const scale = totalCarbGrams / (during + totalWithoutDuring);
    return {
      g_per_hr: gPerHr * scale,
      pre_g: pre * scale,
      during_g: during * scale,
      post_g: post * scale,
      gluFruRatio: profile.gluFruRatio,
      overFuelGuardApplied: true,
    };
  }

  return {
    g_per_hr: gPerHr,
    pre_g: pre,
    during_g: during,
    post_g: post,
    gluFruRatio: profile.gluFruRatio,
    overFuelGuardApplied: false,
  };
}
