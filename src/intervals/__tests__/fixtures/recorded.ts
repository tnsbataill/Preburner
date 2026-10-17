// Response shapes recorded from Intervals.icu (field names per docs/openapi-spec.json),
// anonymised. Dates are rewritten relative to the sync date in the test.
export const athlete = {
  id: 'i123456',
  firstname: 'Test',
  sex: 'M',
  icu_weight: 78.2,
  height: 1.8,
  icu_date_of_birth: '1991-06-20',
  timezone: 'America/New_York',
  measurement_preference: 'feet',
  sportSettings: [
    { types: ['Run', 'VirtualRun'], ftp: null, lthr: 170 },
    { types: ['Ride', 'VirtualRide', 'GravelRide'], ftp: 305, indoor_ftp: 300, lthr: 168 },
  ],
};

export const events = (d: (offset: number) => string) => [
  // TrainerRoad sync: date-only (00:00), kJ only in the description
  {
    id: 74541746,
    start_date_local: `${d(1)}T00:00:00`,
    category: 'WORKOUT',
    type: 'VirtualRide',
    name: 'Threshold 3x12',
    description: '<p>Threshold intervals. Intervals set to burn kJ(Cal) 811 for this session.</p>',
    moving_time: 4500,
    icu_training_load: 99,
    icu_intensity: 89,
    tags: ['trainerroad'],
  },
  // Structured workout with workout_doc steps and repeats
  {
    id: 74541747,
    start_date_local: `${d(2)}T06:15:00`,
    category: 'WORKOUT',
    type: 'Ride',
    name: 'Sweet Spot 3x12',
    moving_time: 4320,
    icu_training_load: 88,
    workout_doc: {
      steps: [
        { duration: 900, power: { start: 50, end: 70, units: '%ftp' }, warmup: true },
        { reps: 3, steps: [{ duration: 720, power: { value: 90, units: '%ftp' } }, { duration: 300, power: { value: 55, units: '%ftp' } }] },
        { duration: 360, power: { start: 60, end: 45, units: '%ftp' }, cooldown: true },
      ],
    },
    carbs_per_hour: 75,
  },
  // Planned event already completed (paired below) — should be replaced by the activity
  { id: 74541740, start_date_local: `${d(-1)}T00:00:00`, category: 'WORKOUT', type: 'VirtualRide', name: 'Endurance 1h', moving_time: 3600, icu_training_load: 44, icu_intensity: 66 },
  // A race
  { id: 74541799, start_date_local: `${d(10)}T08:00:00`, category: 'RACE_B', type: 'Ride', name: 'Local Crit', moving_time: 3600 },
  // A note — ignored by the planner
  { id: 74541800, start_date_local: `${d(3)}T00:00:00`, category: 'NOTE', name: 'Travel day' },
];

export const activities = (d: (offset: number) => string) => [
  {
    id: 'i99887766',
    start_date_local: `${d(-1)}T17:42:10`,
    type: 'VirtualRide',
    name: 'Endurance 1h',
    moving_time: 3612,
    icu_training_load: 46,
    icu_intensity: 67,
    icu_joules: 612000,
    paired_event_id: 74541740,
    trainer: true,
  },
];

export const wellness = (d: (offset: number) => string) => [
  { id: d(-3), ctl: 61.2, atl: 70.4, weight: 78.6, restingHR: 49, hrv: 63, sleepSecs: 26100 },
  { id: d(-2), ctl: 61.6, atl: 68.1, restingHR: 50, hrv: 58 },
  { id: d(-1), ctl: 61.9, atl: 65.9, weight: 78.2, restingHR: 48, hrv: 66, sleepSecs: 28800 },
];
