import { useId, useMemo } from 'react';
import { estimateWorkoutKilojoules } from '../calc/prescribe.js';
import { usePlannerStore } from '../state/plannerStore.js';
import type { SessionType } from '../types.js';

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
  const setWorkoutType = usePlannerStore((state) => state.setWorkoutType);
  const resetWorkoutType = usePlannerStore((state) => state.resetWorkoutType);

  const sessionTypes: SessionType[] = ['Endurance', 'Tempo', 'Threshold', 'VO2', 'Race', 'Rest'];
  const idPrefix = useId();

  const totalPlannedKj = useMemo(
    () =>
      workouts.reduce((sum, workout) => {
        const planned = typeof workout.planned_kJ === 'number' ? workout.planned_kJ : undefined;
        const estimated = planned ?? estimateWorkoutKilojoules(workout);
        return sum + estimated;
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
            <span className="font-semibold text-slate-200">{Math.round(totalPlannedKj)} kJ</span>
          </p>
        </div>
        {isRefreshing ? (
          <p className="mt-2 text-xs text-slate-500">Refreshing workouts…</p>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {workouts.map((workout) => {
            const hasDirectPlanned =
              typeof workout.planned_kJ === 'number' && workout.kj_source !== 'Estimated (fallback)';
            const kjSource = workout.kj_source ?? (hasDirectPlanned ? 'ICU Structured' : 'Estimated (fallback)');
            const plannedValue = hasDirectPlanned
              ? workout.planned_kJ!
              : estimateWorkoutKilojoules(workout);
            const plannedKjDisplay = Math.round(plannedValue).toLocaleString();
            const ftpDisplay = workout.ftp_watts_at_plan ?? profile.ftp_watts;
            const selectId = `${idPrefix}-${workout.id}-session-type`;
            const overrideActive =
              typeof workout.originalType === 'string' && workout.originalType !== workout.type;

            return (
              <article
                key={workout.id}
                className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40"
              >
                <header className="space-y-1">
                  <h3 className="text-lg font-semibold text-slate-100">{workout.title ?? workout.id}</h3>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {workout.type} • {workout.duration_hr.toFixed(2)} h • FTP{' '}
                    {typeof ftpDisplay === 'number' ? ftpDisplay.toFixed(0) : '—'} W
                  </p>
                  <p className="text-xs text-slate-400">{formatDate(workout.startISO)}</p>
                </header>
                <dl className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <div>
                    <dt>Planned energy</dt>
                    <dd className="font-mono text-slate-200">{plannedKjDisplay} kJ</dd>
                  </div>
                  <div>
                    <dt>kJ source</dt>
                    <dd>{kjSource}</dd>
                  </div>
                </dl>
                <div className="space-y-2 rounded-md border border-slate-800/60 bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between text-[0.7rem] uppercase tracking-wide text-slate-500">
                    <label htmlFor={selectId}>Session type</label>
                    {overrideActive ? (
                      <span className="font-semibold text-amber-300">Override</span>
                    ) : (
                      <span className="font-semibold text-slate-400">Default</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      id={selectId}
                      className="flex-1 rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
                      value={workout.type}
                      onChange={(event) => setWorkoutType(workout.id, event.target.value as SessionType)}
                    >
                      {sessionTypes.map((sessionType) => (
                        <option key={sessionType} value={sessionType}>
                          {sessionType}
                        </option>
                      ))}
                    </select>
                    {overrideActive ? (
                      <button
                        type="button"
                        onClick={() => resetWorkoutType(workout.id)}
                        className="rounded-md border border-amber-400/60 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-200 transition-colors hover:bg-amber-400/10"
                      >
                        Reset to {workout.originalType}
                      </button>
                    ) : null}
                  </div>
                  {overrideActive ? (
                    <p className="text-[0.65rem] text-amber-300">
                      Original type: {workout.originalType}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
