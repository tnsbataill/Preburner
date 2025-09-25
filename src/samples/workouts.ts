import { PlannedWorkout } from '../types';

export const plannedWorkouts: PlannedWorkout[] = [
  {
    id: 'wkt-endurance-001',
    source: 'intervals',
    title: 'Aerobic Endurance Ride',
    type: 'Endurance',
    startISO: '2024-06-12T13:00:00Z',
    endISO: '2024-06-12T15:15:00Z',
    duration_hr: 2.25,
    planned_kJ: 1350,
    ftp_watts_at_plan: 250,
    kj_source: 'ICU Structured',
  },
  {
    id: 'wkt-tempo-001',
    source: 'intervals',
    title: 'Sweet Spot Tempo Finish',
    type: 'Tempo',
    startISO: '2024-06-14T16:00:00Z',
    endISO: '2024-06-14T17:30:00Z',
    duration_hr: 1.5,
    planned_kJ: 900,
    ftp_watts_at_plan: 250,
    kj_source: 'ICU Structured',
    steps: [
      { start_s: 0, duration_s: 900, target_type: '%FTP', target_lo: 55, target_hi: 65 },
      { start_s: 900, duration_s: 1800, target_type: '%FTP', target_lo: 88, target_hi: 92 },
    ],
  },
  {
    id: 'wkt-vo2-001',
    source: 'intervals',
    title: 'VO₂ Max 4x3',
    type: 'VO2',
    startISO: '2024-06-15T14:30:00Z',
    endISO: '2024-06-15T15:20:00Z',
    duration_hr: 0.83,
    planned_kJ: 750,
    ftp_watts_at_plan: 250,
    kj_source: 'ICU Structured',
  },
];
