import { Profile } from '../types';

export const sampleProfile: Profile = {
  id: 'profile-avery-rider',
  name: 'Avery Rider',
  unitSystem: 'metric',
  experienceLevel: 'intermediate',
  preferredDiscipline: 'bike',
  metrics: {
    ftp: 250,
    maxHeartRate: 190,
    lactateThresholdHeartRate: 172,
    vo2Max: 58,
    weightKg: 72,
  },
  availability: {
    daysPerWeek: 5,
    longestSessionMinutes: 120,
    earlyMorningOk: true,
  },
  notes: 'Build block focused on aerobic durability and top-end repeatability ahead of late-summer stage race.',
  lastUpdated: '2024-06-08T00:00:00Z',
};
