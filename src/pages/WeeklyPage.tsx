import { usePlannerStore } from '../state/plannerStoreOld.js';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function WeeklyPage() {
  const weekly = usePlannerStore((state) => state.weekly);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">Weekly placement</h2>
        <p className="text-sm text-slate-400">
          Compare the target deficit against allocations from each window. When sliders adjust macro rules or deficits,
          the bars update instantly.
        </p>
      </header>

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
