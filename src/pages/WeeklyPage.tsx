import { usePlannerStore } from '../state/plannerStore.js';

const LB_PER_KG = 2.2046226218;

function formatDelta(value: number, useImperial: boolean): string {
  const converted = useImperial ? value * LB_PER_KG : value;
  const magnitude = Math.abs(converted).toFixed(1);
  if (converted > 0) {
    return `+${magnitude}`;
  }
  if (converted < 0) {
    return `-${magnitude}`;
  }
  return `±${magnitude}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function WeeklyPage() {
  const weekly = usePlannerStore((state) => state.weekly);
  const weightSummary = usePlannerStore((state) => state.weightSummary);
  const useImperial = usePlannerStore((state) => state.profile.useImperial);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">Weekly placement</h2>
        <p className="text-sm text-slate-400">
          Compare the target deficit against allocations from each window. When sliders adjust macro rules or deficits,
          the bars update instantly.
        </p>
      </header>

      <div
        className={`rounded-lg border p-4 text-xs sm:text-sm ${
          weightSummary
            ? weightSummary.expectedDeltaKg < -0.1 && weightSummary.actualDeltaKg > 0.25
              ? 'border-rose-800/60 bg-rose-950/50 text-rose-100'
              : weightSummary.expectedDeltaKg < -0.1 &&
                  weightSummary.actualDeltaKg <= weightSummary.expectedDeltaKg - 0.2
                ? 'border-emerald-700/60 bg-emerald-950/50 text-emerald-100'
                : 'border-slate-800 bg-slate-950/60 text-slate-200'
            : 'border-slate-800 bg-slate-950/40 text-slate-300'
        }`}
      >
        {weightSummary ? (
          <div className="space-y-1">
            <p className="font-semibold uppercase tracking-wide text-[0.7rem] text-slate-400">
              Weight trend (last {weightSummary.days} day{weightSummary.days === 1 ? '' : 's'})
            </p>
            <p>
              Actual change: <span className="font-mono">{formatDelta(weightSummary.actualDeltaKg, useImperial)}</span>{' '}
              vs expected{' '}
              <span className="font-mono">{formatDelta(weightSummary.expectedDeltaKg, useImperial)}</span>
            </p>
            <p className="text-[0.7rem] text-slate-400">
              Windowed from {new Date(`${weightSummary.startISO}T00:00:00Z`).toLocaleDateString()} to{' '}
              {new Date(`${weightSummary.endISO}T00:00:00Z`).toLocaleDateString()}.
            </p>
          </div>
        ) : (
          <p className="text-[0.75rem] text-slate-400">
            Log at least two weight entries to compare actual vs expected change over the last week.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {weekly.map((week) => {
          const target = Math.abs(week.weeklyTargetDeficit_kcal);
          const allocated = Math.abs(week.weeklyAllocated_kcal);
          const progress = target === 0 ? 0 : Math.min(1, allocated / target);

          return (
            <article
              key={week.weekKey}
              className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40"
            >
              <header className="space-y-1">
                <h3 className="text-lg font-semibold text-slate-100">{week.weekKey}</h3>
                <p className="text-xs text-slate-400">
                  {formatDate(week.weekStartISO)} → {formatDate(week.weekEndISO)}
                </p>
              </header>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                  <span>Deficit placement</span>
                  <span className="font-semibold text-slate-200">{week.weeklyAllocated_kcal.toFixed(0)} / {target.toFixed(0)} kcal</span>
                </div>
                <div className="h-3 rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-[width] duration-300"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>

              {week.carryOver_kcal ? (
                <p className="text-xs text-slate-400">Carryover: {week.carryOver_kcal.toFixed(0)} kcal</p>
              ) : null}

              <dl className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">Protein</dt>
                  <dd>{week.macros.protein_g.toFixed(1)} g</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide text-slate-500">Fat</dt>
                  <dd>{week.macros.fat_g.toFixed(1)} g</dd>
                </div>
                <div className="col-span-2">
                  <dt className="uppercase tracking-wide text-slate-500">Carbs</dt>
                  <dd>{week.macros.carb_g.toFixed(1)} g</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
