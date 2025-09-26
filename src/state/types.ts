import type { Profile } from '../types.js';

export type PlannerPage = 'onboarding' | 'planner' | 'windows' | 'weekly' | 'settings';

export type PlannerOverrides = Pick<
  Profile,
  |
    'efficiencyPreset'
  |
    'efficiency'
  |
    'activityFactorDefault'
  |
    'targetKgPerWeek'
  |
    'deficitCapPerWindow'
  |
    'protein_g_per_kg'
  |
    'fat_g_per_kg_min'
  |
    'carbBands'
  |
    'carbSplit'
  |
    'gluFruRatio'
>;

export type PlannerStatus = 'idle' | 'loading' | 'ready' | 'error';
