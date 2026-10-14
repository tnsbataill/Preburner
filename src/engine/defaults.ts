import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  profile: {
    sex: 'M',
    ageYears: 35,
    heightCm: 178,
    weightKg: 75,
    ftp: 260,
    efficiency: 0.22,
    neatFactor: 1.35,
    units: 'imperial',
  },
  schedule: {
    wakeMin: 6 * 60 + 30,
    sleepMin: 22 * 60 + 30,
    breakfastMin: 7 * 60 + 15,
    lunchMin: 12 * 60 + 30,
    dinnerMin: 18 * 60 + 45,
    // Weekdays after work, weekends mid-morning.
    defaultTrainingMin: { 0: 9 * 60, 1: 17 * 60 + 30, 2: 17 * 60 + 30, 3: 17 * 60 + 30, 4: 17 * 60 + 30, 5: 17 * 60 + 30, 6: 8 * 60 + 30 },
    preSleepProtein: true,
  },
  nutrition: {
    proteinGPerKg: 1.8,
    fatMinGPerKg: 0.7,
    baseCarbGPerKg: 3,
    maxCarbPerHour: 90,
    fructoseRatio: 0.8,
    sweatRateLPerH: 0.9,
    sodiumMgPerL: 700,
  },
  goals: {
    weeklyRateKg: 0,
    maxDailyDeficit: 700,
    availabilityHours: { 0: 3, 1: 1, 2: 1.5, 3: 1, 4: 1.5, 5: 0, 6: 3.5 },
    maxRampPerWeek: 6,
  },
};

export const EFFICIENCY_PRESETS = [
  { label: 'Developing', value: 0.2 },
  { label: 'Trained', value: 0.22 },
  { label: 'Well-trained', value: 0.23 },
  { label: 'Elite', value: 0.24 },
];

export const NEAT_PRESETS = [
  { label: 'Desk job, little walking', value: 1.25 },
  { label: 'Desk job, some walking', value: 1.35 },
  { label: 'On feet much of the day', value: 1.5 },
  { label: 'Physical job', value: 1.65 },
];
