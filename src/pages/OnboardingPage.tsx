import { usePlannerStore } from '../state/plannerStore.js';

export function OnboardingPage() {
  const profile = usePlannerStore((state) => state.profile);
  const workouts = usePlannerStore((state) => state.workouts);

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-100">Welcome to Preburner</h2>
        <p className="text-sm text-slate-400">
          This guided sandbox loads a sample athlete and upcoming sessions. Adjust the sliders on the left to see how the
          nutrition engine adapts in real time.
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
          <h3 className="text-sm font-semibold text-slate-200">Sample workouts</h3>
          <p className="mt-3 text-xs text-slate-400">
            Loaded from the fake adapter. {workouts.length} sessions are ready for planning this week.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:col-span-2 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-200">Next steps</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-slate-400">
            <li>Visit the Planner view to confirm session energy targets.</li>
            <li>Open the Windows view to review fuel windows between workouts.</li>
            <li>Check the Weekly view for deficit placement vs. target.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
