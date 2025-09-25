import { Profile } from '../types';

export const sampleProfile: Profile = {
  sex: 'F',
  age_years: 34,
  height_cm: 170,
  weight_kg: 68,
  ftp_watts: 250,
  efficiencyPreset: 'Competitive',
  efficiency: 0.23,
  activityFactorDefault: 1.32,
  activityFactorOverrides: {
    '2024-06-14': 1.38,
  },
  targetKgPerWeek: -0.35,
  kcalPerKg: 7700,
  deficitCapPerWindow: 600,
  windowPctCap: 0.3,
  protein_g_per_kg: 1.7,
  fat_g_per_kg_min: 0.6,
  carbBands: {
    Endurance: [55, 70],
    Tempo: [65, 85],
    Threshold: [80, 100],
    VO2: [90, 110],
    Race: [90, 120],
    Rest: [0, 0],
  },
  carbSplit: {
    pre: 0.2,
    during: 0.6,
    post: 0.2,
  },
  gluFruRatio: 0.8,
  useImperial: true,
};
