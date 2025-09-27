import { usePlannerStore } from '../state/plannerStore.js';

const LB_PER_KG = 2.2046226218;
const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

function formatWeight(weightKg: number, useImperial: boolean): string {
  if (!Number.isFinite(weightKg)) {
    return '—';
  }
  const pounds = weightKg * LB_PER_KG;
  if (useImperial) {
    return `${pounds.toFixed(1)} lb (${weightKg.toFixed(1)} kg)`;
  }
  return `${weightKg.toFixed(1)} kg (${pounds.toFixed(1)} lb)`;
}

function formatHeight(heightCm: number, useImperial: boolean): string {
  if (!Number.isFinite(heightCm)) {
    return '—';
  }
  if (useImperial) {
    const totalInches = heightCm / CM_PER_INCH;
    const feet = Math.floor(totalInches / INCHES_PER_FOOT);
    const inches = totalInches - feet * INCHES_PER_FOOT;
    const roundedInches = Math.round(inches * 10) / 10;
    return `${feet} ft ${roundedInches.toFixed(1)} in (${heightCm.toFixed(0)} cm)`;
  }
  const inches = heightCm / CM_PER_INCH;
  return `${heightCm.toFixed(0)} cm (${inches.toFixed(1)} in)`;
}

export function OnboardingPage() {
  const profile = usePlannerStore((state) => state.profile);
  const workouts = usePlannerStore((state) => state.workouts);
  const dataSource = usePlannerStore((state) => state.dataSource);
  const lastSyncISO = usePlannerStore((state) => state.lastSyncISO);
  const syncError = usePlannerStore((state) => state.syncError);

  const weightDisplay = formatWeight(profile.weight_kg, profile.useImperial);
  const heightDisplay = formatHeight(profile.height_cm, profile.useImperial);
  const efficiencyDisplay = `${(profile.efficiency * 100).toFixed(1)}%`;
  const activityDisplay = profile.activityFactorDefault.toFixed(2);
  const weeklyGoalKcal = Math.round(profile.targetKgPerWeek * profile.kcalPerKg);
  const weeklyGoalDisplay = `${weeklyGoalKcal.toLocaleString()} kcal deficit`;

  const lastSyncLabel = lastSyncISO
    ? new Date(lastSyncISO).toLocaleString()
    : dataSource === 'intervals'
      ? 'Awaiting first sync'
      : 'Sample data in use';

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-100">Welcome to Preburner</h2>
        <p className="text-sm text-slate-400">
          Connect your Intervals.icu account or explore the sandbox data. Enter an API key in the settings panel to sync your
          next week of structured workouts, then adjust the sliders on the left to see how the nutrition engine adapts in real
          time.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Profile snapshot</h3>
          <dl className="mt-3 space-y-2 text-xs text-slate-400">
            <div className="flex justify-between">
              <dt>Age</dt>
              <dd>{profile.age_years}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Weight</dt>
              <dd>{weightDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Height</dt>
              <dd>{heightDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Efficiency</dt>
              <dd>{efficiencyDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Activity factor</dt>
              <dd>{activityDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Weekly goal</dt>
              <dd>{weeklyGoalDisplay}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Upcoming workouts</h3>
          <p className="mt-3 text-xs text-slate-400">
            {workouts.length} sessions loaded from {dataSource === 'intervals' ? 'Intervals.icu' : 'the built-in sample dataset'}.
          </p>
          <dl className="mt-3 space-y-1 text-[0.7rem] text-slate-500">
            <div className="flex justify-between">
              <dt>Last sync</dt>
              <dd className="text-slate-300">{lastSyncLabel}</dd>
            </div>
          </dl>
          {syncError ? (
            <p className="mt-2 rounded-md border border-rose-900/40 bg-rose-950/40 p-2 text-rose-200">
              Sync issue: {syncError}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:col-span-2 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-200">Next steps</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-slate-400">
            <li>Press “Refresh from Intervals.icu” once your API key is saved.</li>
            <li>Visit the Planner view to confirm session energy targets.</li>
            <li>Open the Windows view to review fuel windows between workouts.</li>
            <li>Check the Weekly view for deficit placement vs. target.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
