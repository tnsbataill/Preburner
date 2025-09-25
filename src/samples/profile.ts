import { Profile } from '../types';
import rawProfile from '../../data/samples/profile.json';

type ProfileJson = typeof rawProfile;

const internal: ProfileJson['internal'] = rawProfile.internal;

export const sampleProfile: Profile = {
  sex: internal.sex,
  age_years: internal.age_years,
  height_cm: internal.height_cm,
  weight_kg: internal.weight_kg,
  ftp_watts: internal.ftp_watts,
  efficiencyPreset: internal.efficiencyPreset,
  efficiency: internal.efficiency,
  activityFactorDefault: internal.activityFactorDefault,
  activityFactorOverrides: internal.activityFactorOverrides,
  targetKgPerWeek: internal.targetKgPerWeek,
  kcalPerKg: internal.kcalPerKg,
  deficitCapPerWindow: internal.deficitCapPerWindow,
  windowPctCap: internal.windowPctCap,
  protein_g_per_kg: internal.protein_g_per_kg,
  fat_g_per_kg_min: internal.fat_g_per_kg_min,
  carbBands: internal.carbBands,
  carbSplit: internal.carbSplit,
  gluFruRatio: internal.gluFruRatio,
  useImperial: internal.useImperial,
};
