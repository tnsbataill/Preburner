import { WINDOW_EMPTY_FLAG, WINDOW_UNDER_RECOVERY_FLAG } from '../calc/weekly.js';
import { usePlannerStore } from '../state/plannerStore.js';

function describeNote(note: string): string {
  if (note === WINDOW_EMPTY_FLAG) {
    return 'Safety flag: >1 kg overnight drop detected — deficit halved for this window.';
  }
  if (note === WINDOW_UNDER_RECOVERY_FLAG) {
    return 'Safety flag: Weight loss exceeding target — deficit paused this window to prioritise recovery.';
  }
  return note;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WindowsPage() {
  const windows = usePlannerStore((state) => state.windows);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">Fuel windows</h2>
        <p className="text-sm text-slate-400">
          Each window tracks the energy need between workouts, the target deficit, and the recommended carbohydrate and
          macro breakdown. Notes highlight safety rules such as hard-day protection and deficit caps.
        </p>
      </header>

      <div className="grid gap-3">
        {windows.map((window) => (
          <article
            key={`${window.prevWorkoutId}-${window.nextWorkoutId}`}
            className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40"
          >
            <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">{window.nextWorkoutType} focus</h3>
                <p className="text-xs uppercase tracking-wide text-slate-500">Next: {window.nextWorkoutId}</p>
              </div>
              <p className="text-xs text-slate-400">
                {formatDate(window.windowStartISO)} → {formatDate(window.windowEndISO)}
              </p>
            </header>

            <dl className="grid gap-3 text-xs text-slate-300 sm:grid-cols-5">
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Need</dt>
                <dd className="font-mono text-slate-100">{window.need_kcal.toFixed(0)} kcal</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Target</dt>
                <dd className="font-mono text-slate-100">{window.target_kcal.toFixed(0)} kcal</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Activity factor</dt>
                <dd>{window.activityFactorApplied.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Carbs</dt>
                <dd>
                  {window.carbs.g_per_hr.toFixed(1)} g/hr • pre {window.carbs.pre_g.toFixed(1)} g • during{' '}
                  {window.carbs.during_g.toFixed(1)} g • post {window.carbs.post_g.toFixed(1)} g
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Macros</dt>
                <dd>
                  P {window.macros.protein_g.toFixed(1)} g • F {window.macros.fat_g.toFixed(1)} g • C{' '}
                  {window.macros.carb_g.toFixed(1)} g
                </dd>
              </div>
            </dl>

            {window.notes.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-amber-300/80">
                {window.notes.map((note) => (
                  <li key={note}>{describeNote(note)}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
