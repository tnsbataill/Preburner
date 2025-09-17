import type { IntervalTarget } from './types';
import { plannedWorkouts } from './samples/workouts';
import { sampleProfile } from './samples/profile';

function formatTarget(range: Pick<IntervalTarget, 'lower' | 'upper' | 'unit'>) {
  const unitLabel = range.unit
    .replace('percentFtp', '% FTP')
    .replace('percentMaxHr', '% max HR')
    .replace('min_per_km', 'min/km')
    .replace('min_per_mi', 'min/mi');

  return `${range.lower}–${range.upper} ${unitLabel}`;
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <main className="mx-auto flex max-w-5xl flex-col gap-8">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Preburner Samples</h1>
          <p className="mt-2 text-slate-400">
            Minimal Vite + React + Tailwind project with domain contracts and seed data.
          </p>
        </header>

        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-950/40">
          <h2 className="text-2xl font-semibold text-amber-300">Profile</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-lg font-medium">{sampleProfile.name}</p>
              <p className="text-sm text-slate-400">
                {sampleProfile.experienceLevel.charAt(0).toUpperCase() +
                  sampleProfile.experienceLevel.slice(1)}{' '}
                athlete · Prefers {sampleProfile.preferredDiscipline}
              </p>
              <p className="mt-2 text-sm text-slate-400">{sampleProfile.notes}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-slate-400">FTP</dt>
                <dd className="text-slate-100">{sampleProfile.metrics.ftp} W</dd>
              </div>
              <div>
                <dt className="text-slate-400">Max HR</dt>
                <dd className="text-slate-100">{sampleProfile.metrics.maxHeartRate} bpm</dd>
              </div>
              {sampleProfile.metrics.lactateThresholdHeartRate ? (
                <div>
                  <dt className="text-slate-400">LTHR</dt>
                  <dd className="text-slate-100">
                    {sampleProfile.metrics.lactateThresholdHeartRate} bpm
                  </dd>
                </div>
              ) : null}
              {sampleProfile.metrics.vo2Max ? (
                <div>
                  <dt className="text-slate-400">VO₂ Max</dt>
                  <dd className="text-slate-100">{sampleProfile.metrics.vo2Max}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-slate-400">Days / week</dt>
                <dd className="text-slate-100">{sampleProfile.availability.daysPerWeek}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Longest session</dt>
                <dd className="text-slate-100">
                  {sampleProfile.availability.longestSessionMinutes} minutes
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-emerald-300">Planned Workouts</h2>
          {plannedWorkouts.map((workout) => (
            <article
              key={workout.id}
              className="rounded-lg border border-emerald-900/60 bg-emerald-900/20 p-6 shadow-lg shadow-emerald-950/30"
            >
              <header className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-emerald-200">{workout.title}</h3>
                  <p className="text-sm text-emerald-300/70">
                    {workout.focus} · {workout.discipline} · {workout.totalMinutes} min
                  </p>
                </div>
                <p className="text-sm text-emerald-300/70">Scheduled: {workout.scheduledFor}</p>
              </header>
              <p className="mt-3 text-sm text-emerald-100/80">{workout.description}</p>
              <ul className="mt-4 space-y-3 text-sm">
                {workout.intervals.map((interval) => (
                  <li
                    key={interval.id}
                    className="rounded-md border border-emerald-800/40 bg-emerald-800/30 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-emerald-200">
                        {interval.name}
                        <span className="ml-2 text-xs uppercase tracking-wide text-emerald-300/70">
                          {interval.type}
                        </span>
                      </span>
                      <span className="font-mono text-xs text-emerald-200/80">
                        {interval.durationMinutes} min
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-emerald-100/80">
                      <span>Primary: {formatTarget(interval.primaryTarget)}</span>
                      {interval.secondaryTargets?.map((target) => (
                        <span key={`${interval.id}-${target.kind}`}>
                          Secondary: {formatTarget(target)}
                        </span>
                      ))}
                    </div>
                    {interval.notes ? (
                      <p className="mt-2 text-xs text-emerald-100/70">{interval.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              {workout.notes ? (
                <p className="mt-4 text-xs text-emerald-200/80">{workout.notes}</p>
              ) : null}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
