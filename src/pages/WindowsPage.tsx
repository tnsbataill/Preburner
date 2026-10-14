import { describePlannerNote } from '../calc/noteFormatting.js';
import { usePlannerStore } from '../state/plannerStore.js';
import type { WindowPlan } from '../types.js';

const LONG_WINDOW_THRESHOLD_HOURS = 36; // highlight long gaps (~1.5-2 days) between sessions

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function groupWindowsByDate(windows: WindowPlan[]): [string, WindowPlan[]][] {
  const map = new Map<string, WindowPlan[]>();
  for (const window of windows) {
    const key = window.windowEndISO.slice(0, 10);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(window);
  }
  return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
}

function formatDurationHours(startISO: string, endISO: string): number {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / (1000 * 60 * 60));
}

function PrintableDaySheet({ windows }: { windows: WindowPlan[] }) {
  if (windows.length === 0) {
    return (
      <section className="print-only space-y-2">
        <h1 className="text-xl font-semibold">Fuel windows</h1>
        <p>No planned sessions available for printing.</p>
      </section>
    );
  }

  const grouped = groupWindowsByDate(windows);

  return (
    <section className="print-only space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Preburner day sheet</h1>
        <p className="text-sm">Overview of upcoming fuel windows and macro targets.</p>
      </header>
      {grouped.map(([dateKey, dayWindows]) => {
        const readableDate = new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
        return (
          <article key={dateKey} className="space-y-2">
            <h2 className="text-lg font-semibold">{readableDate}</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th scope="col">Focus</th>
                  <th scope="col">Window</th>
                  <th scope="col">Need (kcal)</th>
                  <th scope="col">Target (kcal)</th>
                  <th scope="col">Carbs</th>
                  <th scope="col">Macros</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {dayWindows.map((window) => {
                  const durationHours = formatDurationHours(window.windowStartISO, window.windowEndISO);
                  const longGap = durationHours >= LONG_WINDOW_THRESHOLD_HOURS;
                  const printableNotes = longGap
                    ? [...window.notes, `Long gap (${durationHours.toFixed(0)}h) — plan carbs across the full break.`]
                    : window.notes;

                  return (
                    <tr key={`${window.prevWorkoutId}-${window.nextWorkoutId}`}>
                      <td>{window.nextWorkoutType}</td>
                      <td>
                        {formatTime(window.windowStartISO)}–{formatTime(window.windowEndISO)}
                      </td>
                      <td>{formatNumber(window.need_kcal)}</td>
                      <td>{formatNumber(window.target_kcal)}</td>
                      <td>
                        {formatNumber(window.carbs.g_per_hr, 1)} g/hr • pre {formatNumber(window.carbs.pre_g, 1)} g • during{' '}
                        {formatNumber(window.carbs.during_g, 1)} g • post {formatNumber(window.carbs.post_g, 1)} g
                      </td>
                      <td>
                        P {formatNumber(window.macros.protein_g, 1)} g / F {formatNumber(window.macros.fat_g, 1)} g / C{' '}
                        {formatNumber(window.macros.carb_g, 1)} g
                      </td>
                      <td>
                        {printableNotes.length > 0
                          ? printableNotes.map((note) => describePlannerNote(note, formatNumber)).join('; ')
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </article>
        );
      })}
    </section>
  );
}

function formatDayHeading(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function WindowsPage() {
  const windows = usePlannerStore((state) => state.windows);
  const handlePrint = () => {
    if (typeof window === 'undefined') {
      return;
    }
    window.print();
  };

  const groupedWindows = groupWindowsByDate(windows);

  return (
    <section className="space-y-6">
      <div className="screen-only space-y-6">
        <header className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold text-slate-100">Fuel windows</h2>
              <p className="text-sm text-slate-400">
                Each window tracks the energy need between workouts, the target deficit, and the recommended carbohydrate
                and macro breakdown. Notes highlight safety rules such as hard-day protection and deficit caps.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePrint}
              className="self-start rounded-md border border-emerald-400/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition-colors hover:bg-emerald-400/10"
              disabled={windows.length === 0}
            >
              Print day sheet
            </button>
          </div>
        </header>

        <div className="grid gap-4">
          {groupedWindows.length === 0 ? (
            <p className="text-sm text-slate-400">No planned windows available. Sync workouts to populate the planner.</p>
          ) : null}
          {groupedWindows.map(([dateKey, dayWindows]) => (
            <section
              key={dateKey}
              className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-4 shadow-sm shadow-slate-950/30"
            >
              <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  {formatDayHeading(dateKey)}
                </h3>
                <p className="text-[0.65rem] text-slate-500">{dayWindows.length} window{dayWindows.length === 1 ? '' : 's'}</p>
              </header>

              <div className="space-y-3">
                {dayWindows.map((window) => {
                  const durationHours = formatDurationHours(window.windowStartISO, window.windowEndISO);
                  const longGap = durationHours >= LONG_WINDOW_THRESHOLD_HOURS;
                  const derivedNotes = longGap
                    ? [
                        ...window.notes,
                        `Long gap (${durationHours.toFixed(0)}h) — split carbs across both days in this window.`,
                      ]
                    : window.notes;

                  return (
                    <article
                      key={`${window.prevWorkoutId}-${window.nextWorkoutId}`}
                      className={`space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40 ${
                        longGap ? 'ring-1 ring-amber-400/40' : ''
                      }`}
                    >
                      <header className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                        <div className="space-y-1">
                          <h4 className="text-base font-semibold text-slate-100">{window.nextWorkoutType} focus</h4>
                          <p className="text-[0.65rem] uppercase tracking-wide text-slate-500">Next: {window.nextWorkoutId}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 text-right text-[0.65rem] text-slate-400">
                          <span>
                            {formatDate(window.windowStartISO)} → {formatDate(window.windowEndISO)}
                          </span>
                          {longGap ? (
                            <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-200">
                              ~2 day gap
                            </span>
                          ) : null}
                        </div>
                      </header>

                      <dl className="grid gap-3 text-xs text-slate-300 sm:grid-cols-5">
                        <div>
                          <dt className="uppercase tracking-wide text-slate-500">Need</dt>
                          <dd className="font-mono text-slate-100">{formatNumber(window.need_kcal)} kcal</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-slate-500">Target</dt>
                          <dd className="font-mono text-slate-100">{formatNumber(window.target_kcal)} kcal</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-slate-500">Activity factor</dt>
                          <dd>{formatNumber(window.activityFactorApplied, 2)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-slate-500">Carbs</dt>
                          <dd>
                            {formatNumber(window.carbs.g_per_hr, 1)} g/hr • pre {formatNumber(window.carbs.pre_g, 1)} g • during{' '}
                            {formatNumber(window.carbs.during_g, 1)} g • post {formatNumber(window.carbs.post_g, 1)} g
                          </dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-slate-500">Macros</dt>
                          <dd>
                            P {formatNumber(window.macros.protein_g, 1)} g • F {formatNumber(window.macros.fat_g, 1)} g • C{' '}
                            {formatNumber(window.macros.carb_g, 1)} g
                          </dd>
                        </div>
                      </dl>

                      {derivedNotes.length > 0 ? (
                        <ul className="list-disc space-y-1 pl-5 text-xs text-amber-300/80">
                          {derivedNotes.map((note) => (
                            <li key={note}>{describePlannerNote(note, formatNumber)}</li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <PrintableDaySheet windows={windows} />
    </section>
  );
}
