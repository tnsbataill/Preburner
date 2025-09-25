import { create } from 'zustand';
import { createFakeProvider } from '../adapters/fake.js';
import { buildWindows } from '../calc/prescribe.js';
import { allocateWeeklyDeficits } from '../calc/weekly.js';
import { sampleProfile } from '../samples/profile.js';
import type {
  PlannedWorkout,
  Profile,
  SessionType,
  WindowPlan,
  WeeklyPlan,
} from '../types.js';
import { loadStoredOverrides, persistOverrides } from './storage.js';
import type { PlannerOverrides, PlannerPage, PlannerStatus } from './types.js';

const DEFAULT_START_ISO = '2024-06-10T00:00:00.000Z';
const DEFAULT_END_ISO = '2024-06-20T00:00:00.000Z';

interface PlannerState {
  status: PlannerStatus;
  error?: string;
  page: PlannerPage;
  baseProfile: Profile;
  profile: Profile;
  overrides: PlannerOverrides;
  workouts: PlannedWorkout[];
  windows: WindowPlan[];
  weekly: WeeklyPlan[];
  init(): Promise<void>;
  setPage(page: PlannerPage): void;
  updateOverride<K extends keyof PlannerOverrides>(key: K, value: PlannerOverrides[K]): void;
  updateCarbBand(type: SessionType, index: 0 | 1, value: number): void;
  updateCarbSplit(part: 'pre' | 'during' | 'post', value: number): void;
}

function cloneCarbBands(bands: Profile['carbBands']): Profile['carbBands'] {
  return Object.entries(bands).reduce((acc, [key, values]) => {
    acc[key as SessionType] = [values[0], values[1]];
    return acc;
  }, {} as Profile['carbBands']);
}

function cloneCarbSplit(split: Profile['carbSplit']): Profile['carbSplit'] {
  return { ...split };
}

function createDefaultOverrides(profile: Profile): PlannerOverrides {
  return {
    efficiencyPreset: profile.efficiencyPreset,
    efficiency: profile.efficiency,
    activityFactorDefault: profile.activityFactorDefault,
    targetKgPerWeek: profile.targetKgPerWeek,
    deficitCapPerWindow: profile.deficitCapPerWindow,
    protein_g_per_kg: profile.protein_g_per_kg,
    fat_g_per_kg_min: profile.fat_g_per_kg_min,
    carbBands: cloneCarbBands(profile.carbBands),
    carbSplit: cloneCarbSplit(profile.carbSplit),
    gluFruRatio: profile.gluFruRatio,
  };
}

function mergeOverrides(base: PlannerOverrides, stored?: PlannerOverrides): PlannerOverrides {
  if (!stored) {
    return base;
  }

  const result: PlannerOverrides = {
    ...base,
    ...stored,
    carbBands: cloneCarbBands(base.carbBands),
    carbSplit: cloneCarbSplit(base.carbSplit),
  };

  if (stored.carbBands) {
    for (const [key, values] of Object.entries(stored.carbBands)) {
      const session = key as SessionType;
      if (result.carbBands[session]) {
        result.carbBands[session] = [values[0], values[1]];
      }
    }
  }

  if (stored.carbSplit) {
    result.carbSplit = cloneCarbSplit(stored.carbSplit);
  }

  return result;
}

function applyOverrides(base: Profile, overrides: PlannerOverrides): Profile {
  return {
    ...base,
    efficiencyPreset: overrides.efficiencyPreset,
    efficiency: overrides.efficiency,
    activityFactorDefault: overrides.activityFactorDefault,
    targetKgPerWeek: overrides.targetKgPerWeek,
    deficitCapPerWindow: overrides.deficitCapPerWindow,
    protein_g_per_kg: overrides.protein_g_per_kg,
    fat_g_per_kg_min: overrides.fat_g_per_kg_min,
    carbBands: cloneCarbBands(overrides.carbBands),
    carbSplit: cloneCarbSplit(overrides.carbSplit),
    gluFruRatio: overrides.gluFruRatio,
  };
}

function recomputePlan(
  baseProfile: Profile,
  overrides: PlannerOverrides,
  workouts: PlannedWorkout[],
): { profile: Profile; windows: WindowPlan[]; weekly: WeeklyPlan[] } {
  const profile = applyOverrides(baseProfile, overrides);
  if (workouts.length === 0) {
    return { profile, windows: [], weekly: [] };
  }

  const windows = buildWindows(profile, workouts);
  const { windows: adjusted, weekly } = allocateWeeklyDeficits(profile, windows, workouts);
  return { profile, windows: adjusted, weekly };
}

export const usePlannerStore = create<PlannerState>((set, get) => {
  const baseProfile = { ...sampleProfile, carbBands: cloneCarbBands(sampleProfile.carbBands) };
  const defaultOverrides = createDefaultOverrides(baseProfile);

  return {
    status: 'idle',
    page: 'onboarding',
    baseProfile,
    profile: applyOverrides(baseProfile, defaultOverrides),
    overrides: defaultOverrides,
    workouts: [],
    windows: [],
    weekly: [],
    async init() {
      if (get().status !== 'idle') {
        return;
      }

      set({ status: 'loading' });

      try {
        const stored = await loadStoredOverrides();
        const overrides = mergeOverrides(defaultOverrides, stored);
        const provider = createFakeProvider();
        const workouts = await provider.getPlannedWorkouts(DEFAULT_START_ISO, DEFAULT_END_ISO);
        const { profile, windows, weekly } = recomputePlan(baseProfile, overrides, workouts);
        set({
          status: 'ready',
          overrides,
          workouts,
          profile,
          windows,
          weekly,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error loading plan';
        set({ status: 'error', error: message });
      }
    },
    setPage(page) {
      set({ page });
    },
    updateOverride(key, value) {
      const state = get();
      const overrides = { ...state.overrides, [key]: value } as PlannerOverrides;
      const { profile, windows, weekly } = recomputePlan(state.baseProfile, overrides, state.workouts);
      set({ overrides, profile, windows, weekly });
      void persistOverrides(overrides);
    },
    updateCarbBand(type, index, value) {
      const state = get();
      const bands = cloneCarbBands(state.overrides.carbBands);
      const band = bands[type] ?? [0, 0];
      if (index === 0) {
        band[0] = value;
        if (band[1] < value) {
          band[1] = value;
        }
      } else {
        band[1] = Math.max(value, band[0]);
      }
      bands[type] = band;
      const overrides = { ...state.overrides, carbBands: bands } as PlannerOverrides;
      const { profile, windows, weekly } = recomputePlan(state.baseProfile, overrides, state.workouts);
      set({ overrides, profile, windows, weekly });
      void persistOverrides(overrides);
    },
    updateCarbSplit(part, value) {
      const state = get();
      const split = { ...state.overrides.carbSplit, [part]: value } as Profile['carbSplit'];
      const overrides = { ...state.overrides, carbSplit: split } as PlannerOverrides;
      const { profile, windows, weekly } = recomputePlan(state.baseProfile, overrides, state.workouts);
      set({ overrides, profile, windows, weekly });
      void persistOverrides(overrides);
    },
  };
});
