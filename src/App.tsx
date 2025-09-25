import { useMemo } from 'react';
import { buildWindows } from './calc/prescribe';
import { allocateWeeklyDeficits } from './calc/weekly';
import { plannedWorkouts } from './samples/workouts';
import { sampleProfile } from './samples/profile';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(value: number, digits = 0) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export default function App() {
  const { windows, weekly } = useMemo(() => {
    const baseWindows = buildWindows(sampleProfile, plannedWorkouts);
    return allocateWeeklyDeficits(sampleProfile, baseWindows, plannedWorkouts);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <main className="mx-auto flex max-w-5xl flex-col gap-8">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Preburner Core Engine</h1>
          <p className="mt-2 text-slate-400">
            Pure-function calculations using the sample profile and workouts.
          </p>
        </header>

        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-950/40">
          <h2 className="text-2xl font-semibold text-amber-300">Profile</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Sex</dt>
              <dd className="text-sm">{sampleProfile.sex}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Age</dt>
              <dd className="text-sm">{sampleProfile.age_years}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Weight</dt>
              <dd className="text-sm">{formatNumber(sampleProfile.weight_kg, 1)} kg</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Height</dt>
              <dd className="text-sm">{formatNumber(sampleProfile.height_cm, 0)} cm</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">FTP</dt>
              <dd className="text-sm">{sampleProfile.ftp_watts} W</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Efficiency</dt>
              <dd className="text-sm">{(sampleProfile.efficiency * 100).toFixed(1)}%</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Activity factor</dt>
              <dd className="text-sm">{sampleProfile.activityFactorDefault.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Deficit cap / window</dt>
              <dd className="text-sm">{formatNumber(sampleProfile.deficitCapPerWindow)} kcal</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Weekly target</dt>
              <dd className="text-sm">
                {formatNumber(Math.abs(sampleProfile.targetKgPerWeek) * sampleProfile.kcalPerKg)} kcal
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-emerald-300">Planned Workouts</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {plannedWorkouts.map((workout) => (
              <article
                key={workout.id}
                className="rounded-lg border border-emerald-900/60 bg-emerald-900/10 p-4 shadow-lg shadow-emerald-950/20"
              >
                <header className="flex flex-col gap-1">
                  <h3 className="text-lg font-semibold text-emerald-100">{workout.title}</h3>
                  <p className="text-xs uppercase tracking-wide text-emerald-300/70">
                    {workout.type} • {formatNumber(workout.duration_hr, 2)} h
                  </p>
                  <p className="text-xs text-emerald-200/80">{formatDate(workout.startISO)}</p>
                </header>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-emerald-300/70">Planned energy</dt>
                    <dd className="font-mono text-emerald-100">{formatNumber(workout.planned_kJ ?? 0)} kJ</dd>
                  </div>
                  <div>
                    <dt className="text-emerald-300/70">kJ source</dt>
                    <dd className="text-emerald-100/80">{workout.kj_source}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-sky-300">Windows</h2>
          <div className="grid gap-3">
            {windows.map((window) => (
              <article
                key={`${window.prevWorkoutId}-${window.nextWorkoutId}`}
                className="rounded-lg border border-sky-900/60 bg-sky-900/10 p-4 shadow-lg shadow-sky-950/20"
              >
                <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-sky-100">{window.nextWorkoutType} window</h3>
                    <p className="text-xs text-sky-200/80">Next workout: {window.nextWorkoutId}</p>
                  </div>
                  <p className="text-xs text-sky-200/70">
                    {formatDate(window.windowStartISO)} → {formatDate(window.windowEndISO)}
                  </p>
                </header>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                  <div>
                    <dt className="text-sky-300/70">Need</dt>
                    <dd className="font-mono text-sky-100">{formatNumber(window.need_kcal)} kcal</dd>
                  </div>
                  <div>
                    <dt className="text-sky-300/70">Target</dt>
                    <dd className="font-mono text-sky-100">{formatNumber(window.target_kcal)} kcal</dd>
                  </div>
                  <div>
                    <dt className="text-sky-300/70">Activity factor</dt>
                    <dd className="text-sky-100">{window.activityFactorApplied.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-sky-300/70">Carb plan</dt>
                    <dd className="text-sky-100">
                      {formatNumber(window.carbs.g_per_hr, 1)} g/hr · pre {formatNumber(window.carbs.pre_g, 1)} g ·
                      during {formatNumber(window.carbs.during_g, 1)} g
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sky-300/70">Macros</dt>
                    <dd className="text-sky-100">
                      P {formatNumber(window.macros.protein_g, 1)} g · F {formatNumber(window.macros.fat_g, 1)} g · C
                      {" "}
                      {formatNumber(window.macros.carb_g, 1)} g
                    </dd>
                  </div>
                </dl>
                {window.notes.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-sky-200/80">
                    {window.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-fuchsia-300">Weekly summary</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {weekly.map((week) => (
              <article
                key={week.weekKey}
                className="rounded-lg border border-fuchsia-900/60 bg-fuchsia-900/10 p-4 shadow-lg shadow-fuchsia-950/20"
              >
                <header className="flex flex-col gap-1">
                  <h3 className="text-lg font-semibold text-fuchsia-100">{week.weekKey}</h3>
                  <p className="text-xs text-fuchsia-200/80">
                    {formatDate(week.weekStartISO)} → {formatDate(week.weekEndISO)}
                  </p>
                </header>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-fuchsia-300/70">Target deficit</dt>
                    <dd className="font-mono text-fuchsia-100">
                      {formatNumber(week.weeklyTargetDeficit_kcal)} kcal
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fuchsia-300/70">Allocated</dt>
                    <dd className="font-mono text-fuchsia-100">
                      {formatNumber(week.weeklyAllocated_kcal)} kcal
                    </dd>
                  </div>
                  {week.carryOver_kcal ? (
                    <div>
                      <dt className="text-fuchsia-300/70">Carryover</dt>
                      <dd className="font-mono text-fuchsia-100">
                        {formatNumber(week.carryOver_kcal)} kcal
                      </dd>
                    </div>
                  ) : null}
                  <div className="sm:col-span-2">
                    <dt className="text-fuchsia-300/70">Macro totals</dt>
                    <dd className="text-fuchsia-100">
                      P {formatNumber(week.macros.protein_g, 1)} g · F {formatNumber(week.macros.fat_g, 1)} g · C{' '}
                      {formatNumber(week.macros.carb_g, 1)} g
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
