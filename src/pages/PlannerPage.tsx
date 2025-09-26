import { useMemo } from 'react';
import { usePlannerStore } from '../state/plannerStore.js';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PlannerPage() {
  const workouts = usePlannerStore((state) => state.workouts);
  const profile = usePlannerStore((state) => state.profile);
  const dataSource = usePlannerStore((state) => state.dataSource);
  const lastSyncISO = usePlannerStore((state) => state.lastSyncISO);
  const syncError = usePlannerStore((state) => state.syncError);
  const isRefreshing = usePlannerStore((state) => state.isRefreshing);

  const totalPlannedKj = useMemo(
    () =>
      workouts.reduce((sum, workout) => {
        return sum + (workout.planned_kJ ?? 0);
      }, 0),
    [workouts],
  );

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">Planner</h2>
        <p className="text-sm text-slate-400">
          Review the upcoming sessions pulled from {dataSource === 'intervals' ? 'Intervals.icu' : 'the sample dataset'}. Planned
          energy totals drive the fueling windows and macro targets below.
        </p>
        <p className="text-xs text-slate-500">
          {dataSource === 'intervals'
            ? `Last sync: ${lastSyncISO ? new Date(lastSyncISO).toLocaleString() : 'Awaiting first sync'}`
            : 'Tip: Enter your Intervals.icu API key to replace the sample plan.'}
        </p>
        {syncError ? (
          <p className="text-xs text-rose-300">Sync issue: {syncError}</p>
        ) : null}
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-300">{workouts.length} sessions scheduled.</p>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Total planned energy:{' '}
            <span className="font-semibold text-slate-200">{totalPlannedKj.toFixed(0)} kJ</span>
          </p>
        </div>
        {isRefreshing ? (
          <p className="mt-2 text-xs text-slate-500">Refreshing workouts…</p>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {workouts.map((workout) => (
            <article
              key={workout.id}
              className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40"
            >
              <header className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-100">{workout.title ?? workout.id}</h3>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {workout.type} • {workout.duration_hr.toFixed(2)} h • FTP {profile.ftp_watts ?? '—'} W
                </p>
                <p className="text-xs text-slate-400">{formatDate(workout.startISO)}</p>
              </header>
              <dl className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                <div>
                  <dt>Planned energy</dt>
                  <dd className="font-mono text-slate-200">{workout.planned_kJ?.toFixed(0) ?? '—'} kJ</dd>
                </div>
                <div>
                  <dt>kJ source</dt>
                  <dd>{workout.kj_source}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
