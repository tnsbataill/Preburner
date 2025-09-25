import type { EfficiencyPreset, Profile, SessionType } from '../types.js';
import rawProfile from '../../data/samples/profile.json' with { type: 'json' };

type ProfileJson = typeof rawProfile;

const internal: ProfileJson['internal'] = rawProfile.internal;

const SEX_VALUES: Profile['sex'][] = ['M', 'F'];
const EFFICIENCY_VALUES: EfficiencyPreset[] = ['WorldClass', 'Elite', 'Competitive', 'Enthusiast'];
const SESSION_TYPES: SessionType[] = ['Endurance', 'Tempo', 'Threshold', 'VO2', 'Race', 'Rest'];

function ensureSex(value: string): Profile['sex'] {
  if (SEX_VALUES.includes(value as Profile['sex'])) {
    return value as Profile['sex'];
  }
  throw new Error(`Invalid sex value in sample profile: ${value}`);
}

function ensureEfficiencyPreset(value: string): EfficiencyPreset {
  if (EFFICIENCY_VALUES.includes(value as EfficiencyPreset)) {
    return value as EfficiencyPreset;
  }
  throw new Error(`Invalid efficiency preset in sample profile: ${value}`);
}

function ensureSessionType(value: string): SessionType {
  if (SESSION_TYPES.includes(value as SessionType)) {
    return value as SessionType;
  }
  throw new Error(`Invalid session type in carb band: ${value}`);
}

function ensureBandTuple(values: number[]): [number, number] {
  if (values.length !== 2) {
    throw new Error(`Carb band must contain exactly two entries. Received: ${values}`);
  }
  return [values[0], values[1]];
}

const carbBands = Object.entries(internal.carbBands as Record<string, number[]>).reduce(
  (acc, [key, values]) => {
    const sessionType = ensureSessionType(key);
    acc[sessionType] = ensureBandTuple(values);
    return acc;
  },
  {} as Record<SessionType, [number, number]>,
);

export const sampleProfile: Profile = {
  sex: ensureSex(internal.sex),
  age_years: internal.age_years,
  height_cm: internal.height_cm,
  weight_kg: internal.weight_kg,
  ftp_watts: internal.ftp_watts,
  efficiencyPreset: ensureEfficiencyPreset(internal.efficiencyPreset),
  efficiency: internal.efficiency,
  activityFactorDefault: internal.activityFactorDefault,
  activityFactorOverrides: internal.activityFactorOverrides,
  targetKgPerWeek: internal.targetKgPerWeek,
  kcalPerKg: internal.kcalPerKg,
  deficitCapPerWindow: internal.deficitCapPerWindow,
  windowPctCap: internal.windowPctCap,
  protein_g_per_kg: internal.protein_g_per_kg,
  fat_g_per_kg_min: internal.fat_g_per_kg_min,
  carbBands,
  carbSplit: internal.carbSplit,
  gluFruRatio: internal.gluFruRatio,
  useImperial: internal.useImperial,
};
