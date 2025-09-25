import { usePlannerStore } from '../state/plannerStore.js';

export function OnboardingPage() {
  const profile = usePlannerStore((state) => state.profile);
  const workouts = usePlannerStore((state) => state.workouts);
  const dataSource = usePlannerStore((state) => state.dataSource);
  const lastSyncISO = usePlannerStore((state) => state.lastSyncISO);
  const syncError = usePlannerStore((state) => state.syncError);

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
              <dd>{profile.weight_kg.toFixed(1)} kg</dd>
            </div>
            <div className="flex justify-between">
              <dt>Height</dt>
              <dd>{profile.height_cm.toFixed(0)} cm</dd>
            </div>
            <div className="flex justify-between">
              <dt>Efficiency</dt>
              <dd>{(profile.efficiency * 100).toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt>Activity factor</dt>
              <dd>{profile.activityFactorDefault.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Weekly goal</dt>
              <dd>{(profile.targetKgPerWeek * profile.kcalPerKg).toFixed(0)} kcal deficit</dd>
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
