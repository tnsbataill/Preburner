import { useMemo, useState } from 'react';
import { describePlannerNote } from '../calc/noteFormatting.js';
import { estimateWorkoutKilojoules } from '../calc/prescribe.js';
import { usePlannerStore } from '../state/plannerStore.js';
import type { PlannedWorkout, WindowPlan } from '../types.js';
import { capturePlannerSnapshot } from '../dev/snapshot.js';
import { addDays, startOfDay, prepareWindowSlices, distributeWindowTargets } from '../utils/windowSlices.js';

function formatDateDetail(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTimeRange(startISO: string, endISO: string): string {
  const start = new Date(startISO).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const end = new Date(endISO).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${start} → ${end}`;
}

function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function hoursBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / (1000 * 60 * 60));
}

function isSameDay(iso: string, comparison: Date): boolean {
  const date = new Date(iso);
  return date.toDateString() === comparison.toDateString();
}

function buildWorkoutLookup(workouts: PlannedWorkout[]): Map<string, PlannedWorkout> {
  return new Map(workouts.map((workout) => [workout.id, workout]));
}

export function computeDailyTargets(
  current: WindowPlan,
  currentWorkout: PlannedWorkout | undefined,
  previousWorkout: PlannedWorkout | undefined,
) {
  const targets: { label: string; value: number }[] = [];
  const currentSlices = distributeWindowTargets(current, currentWorkout, previousWorkout);
  for (const slice of currentSlices) {
    targets.push({ label: formatDateDetail(slice.labelISO), value: slice.value });
  }

  return targets;
}

interface DayTimelineColumn {
  iso: string;
  weekday: string;
  monthDay: string;
  isToday: boolean;
  isWindowDay: boolean;
  isWindowStart: boolean;
  isWindowEnd: boolean;
}

interface DayTimelineProjection {
  columns: DayTimelineColumn[];
  barStartPercent: number;
  barWidthPercent: number;
}

function buildDayTimeline(
  window: WindowPlan,
  prevWorkout: PlannedWorkout | undefined,
): DayTimelineProjection {
  const start = new Date(window.windowStartISO);
  const end = new Date(window.windowEndISO);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return {
      columns: [],
      barStartPercent: 0,
      barWidthPercent: 100,
    };
  }

  const preparedSlices = prepareWindowSlices(window, prevWorkout);
  const hasPreparedSlices = preparedSlices.length > 0;
  const windowStartDay = hasPreparedSlices
    ? startOfDay(new Date(preparedSlices[0].dayStartISO))
    : startOfDay(start);
  const windowEndDay = hasPreparedSlices
    ? startOfDay(new Date(preparedSlices[preparedSlices.length - 1].dayStartISO))
    : startOfDay(end);
  const columnMap = new Map<number, Date>();

  const register = (date: Date) => {
    const time = date.getTime();
    if (!Number.isFinite(time) || columnMap.has(time)) {
      return;
    }
    columnMap.set(time, date);
  };

  register(addDays(windowStartDay, -1));

  let cursor = new Date(windowStartDay);
  while (cursor.getTime() <= windowEndDay.getTime()) {
    register(new Date(cursor));
    cursor = addDays(cursor, 1);
  }

  register(addDays(windowEndDay, 1));

  const columnDates = Array.from(columnMap.values()).sort((a, b) => a.getTime() - b.getTime());

  if (columnDates.length === 0) {
    columnDates.push(windowStartDay);
    columnDates.push(addDays(windowStartDay, 1));
  }

  const spanStart = columnDates[0];
  const spanEnd = addDays(columnDates[columnDates.length - 1], 1);
  const spanMs = spanEnd.getTime() - spanStart.getTime();

  const normalizedSpanMs = spanMs <= 0 ? 1 : spanMs;

  const displayStart = hasPreparedSlices ? windowStartDay : start;
  const displayEnd = hasPreparedSlices ? addDays(windowEndDay, 1) : end;

  const startOffset = Math.max(0, displayStart.getTime() - spanStart.getTime());
  const endOffset = Math.max(0, displayEnd.getTime() - spanStart.getTime());
  const rawWidthMs = Math.max(0, endOffset - startOffset);

  let barStartPercent = (startOffset / normalizedSpanMs) * 100;
  let barWidthPercent = (rawWidthMs / normalizedSpanMs) * 100;

  const MIN_WIDTH_PERCENT = 6;
  if (barWidthPercent < MIN_WIDTH_PERCENT) {
    barWidthPercent = MIN_WIDTH_PERCENT;
  }
  if (barStartPercent + barWidthPercent > 100) {
    barStartPercent = Math.max(0, 100 - barWidthPercent);
  }

  barStartPercent = Math.max(0, Math.min(100, barStartPercent));
  barWidthPercent = Math.max(0, Math.min(100 - barStartPercent, barWidthPercent));

  const windowDayKeys = new Set<number>();
  if (hasPreparedSlices) {
    for (const slice of preparedSlices) {
      windowDayKeys.add(slice.dayKey);
    }
  } else {
    let markerCursor = new Date(windowStartDay);
    while (markerCursor.getTime() <= windowEndDay.getTime()) {
      windowDayKeys.add(markerCursor.getTime());
      markerCursor = addDays(markerCursor, 1);
    }
  }
  const windowStartKey = windowStartDay.getTime();
  const windowEndKey = windowEndDay.getTime();

  const columns: DayTimelineColumn[] = columnDates.map((date) => {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
    const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
    const iso = date.toISOString();
    const time = date.getTime();

    return {
      iso,
      weekday,
      monthDay,
      isToday: isSameDay(iso, new Date()),
      isWindowDay: windowDayKeys.has(time),
      isWindowStart: time === windowStartKey,
      isWindowEnd: time === windowEndKey,
    };
  });

  return {
    columns,
    barStartPercent,
    barWidthPercent,
  };
}

export function TimelinePage() {
  const windows = usePlannerStore((state) => state.windows);
  const workouts = usePlannerStore((state) => state.workouts);
  const profile = usePlannerStore((state) => state.profile);
  const weeklyEnergyTarget = profile.targetKgPerWeek * profile.kcalPerKg;
  const dailyEnergyTarget = weeklyEnergyTarget / 7;
  const isDeficitTarget = weeklyEnergyTarget < 0;
  const workoutLookup = useMemo(() => buildWorkoutLookup(workouts), [workouts]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const isDev = import.meta.env.DEV;
  const [snapshotStatus, setSnapshotStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const saveSnapshotFile = (fileName: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveSnapshot = async () => {
    const snapshot = capturePlannerSnapshot();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `planner-snapshot-${timestamp}.json`;
    setSnapshotStatus('saving');
    setSnapshotMessage(null);
    setSnapshotError(null);

    if (isDev) {
      try {
        const response = await fetch('/__dev/save-snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, data: snapshot }),
        });
        if (response.ok) {
          const result = await response.json();
          setSnapshotStatus('success');
          setSnapshotMessage(result.path ?? `src/samples/snapshots/${fileName}`);
          return;
        }
        const errorText = await response.text();
        throw new Error(errorText || 'Save snapshot request failed');
      } catch (error) {
        setSnapshotError(error instanceof Error ? error.message : 'Failed to save snapshot');
      }
    }

    try {
      saveSnapshotFile(fileName, snapshot);
      setSnapshotStatus('success');
      setSnapshotMessage(`Downloaded ${fileName}`);
    } catch (error) {
      setSnapshotStatus('error');
      setSnapshotError(error instanceof Error ? error.message : 'Unable to download snapshot');
    }
  };

  if (windows.length === 0) {
    return (
      <section className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/80 p-8 text-center">
        <h2 className="text-2xl font-semibold text-slate-100">Timeline</h2>
        <p className="text-sm text-slate-400">
          Sync workouts to populate the timeline. Each session will appear here with fueling targets and carb strategy.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-slate-100">Timeline</h2>
            <p className="text-sm text-slate-400">
              Scroll through the upcoming plan. Each card highlights the fuel window leading into the next workout, along with carb
              bands, macro targets, and any safety guards that were applied.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition-colors hover:bg-emerald-500/20"
              onClick={() => setShowDiagnostics((value) => !value)}
            >
              {showDiagnostics ? 'Hide diagnostics' : 'Show diagnostics'}
            </button>
            <button
              type="button"
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition-colors hover:bg-emerald-500/20"
              onClick={handleSaveSnapshot}
              disabled={snapshotStatus === 'saving'}
            >
              {snapshotStatus === 'saving' ? 'Saving…' : 'Save snapshot'}
            </button>
          </div>
        </div>
        {snapshotMessage ? (
          <p className="text-[0.65rem] text-emerald-300">Snapshot saved: {snapshotMessage}</p>
        ) : null}
        {snapshotError ? (
          <p className="text-[0.65rem] text-rose-300">Snapshot error: {snapshotError}</p>
        ) : null}
      </header>

      <div className="-mx-4 overflow-hidden">
        <div className="overflow-x-auto px-4 pb-4">
          <div className="flex snap-x snap-mandatory gap-4">
            {windows.map((window) => {
              const workout = workoutLookup.get(window.nextWorkoutId);
              const previousWorkout =
                window.prevWorkoutId && window.prevWorkoutId !== 'START'
                  ? workoutLookup.get(window.prevWorkoutId)
                  : undefined;
              const targets = computeDailyTargets(window, workout, previousWorkout);
              const workoutEnergy = (() => {
                if (!workout) return undefined;
                if (typeof workout.planned_kJ === 'number' && workout.kj_source !== 'Estimated (fallback)') {
                  return workout.planned_kJ;
                }
                return estimateWorkoutKilojoules(workout);
              })();
              const deficitApplied = Math.max(0, window.need_kcal - window.target_kcal);
              const windowHours = hoursBetween(window.windowStartISO, window.windowEndISO);
              const notes =
                window.notes.length > 0
                  ? window.notes.map((note) => describePlannerNote(note, formatNumber))
                  : [];
              const dayTimeline = buildDayTimeline(window, previousWorkout);
              const barEndPercent = Math.min(100, dayTimeline.barStartPercent + dayTimeline.barWidthPercent);

              return (
                <article
                  key={`${window.prevWorkoutId}-${window.nextWorkoutId}`}
                  className="snap-center min-w-[320px] max-w-[320px] rounded-2xl border border-slate-800/70 bg-slate-950/80 p-5 shadow-lg shadow-slate-950/30 backdrop-blur"
                >
                  <div className="space-y-2">
                    <div
                      className="grid items-stretch gap-1"
                      style={{ gridTemplateColumns: `repeat(${Math.max(dayTimeline.columns.length, 1)}, minmax(0, 1fr))` }}
                    >
                      {dayTimeline.columns.map((column) => (
                        <div
                          key={column.iso}
                          className={`relative flex flex-col items-center justify-center rounded-md border px-2 py-1 text-[0.6rem] font-semibold tracking-wide ${
                            column.isToday
                              ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200'
                              : column.isWindowDay
                                ? 'border-slate-200/40 bg-slate-100/5 text-slate-100'
                                : 'border-slate-800/80 bg-slate-950/70 text-slate-500'
                          }`}
                        >
                          <span>{column.weekday}</span>
                          <span className="text-[0.55rem] font-normal text-slate-400">{column.monthDay}</span>
                          {column.isWindowStart ? (
                            <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-emerald-300" aria-hidden="true" />
                          ) : null}
                          {column.isWindowEnd ? (
                            <span className="absolute -bottom-1 right-1 h-1 w-1 rounded-full bg-emerald-300" aria-hidden="true" />
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="relative h-2 rounded-full bg-slate-900/60">
                      <div
                        className="absolute inset-y-0 rounded-full bg-emerald-400/70"
                        style={{ left: `${dayTimeline.barStartPercent}%`, width: `${dayTimeline.barWidthPercent}%` }}
                      />
                      <span
                        className="absolute -top-[0.3rem] h-3 w-3 -translate-x-1/2 rounded-full border border-emerald-300/80 bg-emerald-500/60"
                        style={{ left: `${dayTimeline.barStartPercent}%` }}
                        aria-hidden="true"
                      />
                      <span
                        className="absolute -top-[0.3rem] h-3 w-3 -translate-x-1/2 rounded-full border border-emerald-300/80 bg-emerald-500/60"
                        style={{ left: `${barEndPercent}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <section className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <header className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-wide text-emerald-200/80">{formatTimeRange(window.windowStartISO, window.windowEndISO)}</span>
                        <h3 className="text-lg font-semibold text-emerald-50">{window.nextWorkoutType} focus</h3>
                        <p className="text-[0.65rem] text-emerald-200/70">
                          Fueling need {formatNumber(window.need_kcal)} kcal · Target {formatNumber(window.target_kcal)} kcal
                          {deficitApplied > 0 ? ` · Deficit applied ${formatNumber(deficitApplied)} kcal` : ''}
                        </p>
                      </header>

                      <dl className="grid grid-cols-2 gap-3 text-xs text-emerald-100/80">
                        <div>
                          <dt className="uppercase tracking-wide text-emerald-200/70">Resting</dt>
                          <dd className="font-mono text-emerald-50">{formatNumber(window.resting_kcal)} kcal</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-emerald-200/70">Workout</dt>
                          <dd className="font-mono text-emerald-50">{formatNumber(window.workout_kcal)} kcal</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-emerald-200/70">Activity factor</dt>
                          <dd>{formatNumber(window.activityFactorApplied, 2)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wide text-emerald-200/70">Window length</dt>
                          <dd>{formatNumber(windowHours, 1)} h</dd>
                        </div>
                      </dl>

                      <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-emerald-100">
                        <p className="mb-2 text-[0.65rem] uppercase tracking-wide text-emerald-200/70">Daily target</p>
                        <ul className="space-y-1">
                          <li className="flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[0.75rem]">
                                {isDeficitTarget ? 'Daily deficit target' : 'Daily surplus target'}
                              </span>
                              <span className="font-mono text-sm text-emerald-50">
                                {formatNumber(Math.abs(dailyEnergyTarget))} kcal
                              </span>
                            </div>
                            {Math.abs(weeklyEnergyTarget) > 0 ? (
                              <p className="text-[0.6rem] text-emerald-200/70">
                                Weekly target {formatNumber(Math.abs(weeklyEnergyTarget))} kcal
                              </p>
                            ) : null}
                          </li>
                          <li className="flex items-center justify-between gap-3">
                            <span className="text-[0.75rem]">Window deficit (total)</span>
                            <span className="font-mono text-sm text-emerald-50">{formatNumber(deficitApplied)} kcal</span>
                          </li>
                          {targets.map((target) => (
                            <li key={target.label} className="flex items-center justify-between gap-3">
                              <span className="text-[0.75rem]">{target.label}</span>
                              <span className="font-mono text-sm text-emerald-50">{formatNumber(target.value)} kcal</span>
                            </li>
                          ))}
                        </ul>
                        {showDiagnostics ? (
                          <div className="mt-3 space-y-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 p-2 text-[0.6rem] text-emerald-100">
                            <p className="font-semibold uppercase tracking-wide text-emerald-200/70">Diagnostics</p>
                            <p>Window span: {formatNumber(windowHours / 24, 2)} day{windowHours / 24 !== 1 ? 's' : ''}</p>
                            <p>Workout carbs: {formatNumber(window.workoutCarb_kcal)} kcal</p>
                            <p>
                              Base macros → Protein {formatNumber(window.macros.protein_g, 1)} g · Fat {formatNumber(window.macros.fat_g, 1)} g · Carbs{' '}
                              {formatNumber(window.macros.carb_g, 1)} g
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="space-y-3 rounded-xl border border-slate-800/70 bg-slate-950/70 p-4">
                      <header className="flex items-center justify-between">
                        <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">Carb strategy</span>
                        <span className="text-xs text-slate-300">{formatNumber(window.carbs.g_per_hr, 1)} g/hr</span>
                      </header>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        {[{ key: 'pre', label: 'Pre-Carbs', value: window.carbs.pre_g }, { key: 'during', label: 'During', value: window.carbs.during_g }, { key: 'post', label: 'Post', value: window.carbs.post_g }].map((segment) => (
                          <div
                            key={segment.key}
                            className="space-y-1 rounded-lg border border-slate-800/80 bg-slate-900/80 p-2 shadow-sm shadow-slate-950/40"
                          >
                            <p className="text-[0.55rem] uppercase tracking-wide text-slate-500">{segment.label}</p>
                            <p className="font-mono text-sm text-slate-100">{formatNumber(segment.value, 1)} g</p>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="space-y-3 rounded-xl border border-slate-800/70 bg-slate-950/70 p-4">
                      <header className="flex items-baseline justify-between">
                        <div>
                          <p className="text-[0.65rem] uppercase tracking-wide text-slate-500">Next session</p>
                          <h4 className="text-base font-semibold text-slate-100">{workout?.title ?? window.nextWorkoutId}</h4>
                        </div>
                        <span className="text-xs text-slate-400">
                          {formatDateDetail(workout?.startISO ?? window.windowEndISO)}
                        </span>
                      </header>
                      <dl className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                        <div>
                          <dt>Type</dt>
                          <dd className="font-mono text-slate-100">{workout?.type ?? window.nextWorkoutType}</dd>
                        </div>
                        <div>
                          <dt>Duration</dt>
                          <dd className="font-mono text-slate-100">
                            {workout ? `${workout.duration_hr.toFixed(2)} h` : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>Planned energy</dt>
                          <dd className="font-mono text-slate-100">
                            {typeof workoutEnergy === 'number' ? `${formatNumber(workoutEnergy)} kJ` : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>FTP at plan</dt>
                          <dd className="font-mono text-slate-100">
                            {workout?.ftp_watts_at_plan ?? '—'}
                          </dd>
                        </div>
                      </dl>
                      <div className="rounded-lg border border-slate-800/70 bg-slate-900/60 p-3">
                        <p className="text-[0.65rem] uppercase tracking-wide text-slate-500">Macro targets</p>
                        <ul className="mt-2 space-y-1 text-xs text-slate-300">
                          <li className="flex items-center justify-between">
                            <span>Protein</span>
                            <span className="font-mono text-slate-100">{formatNumber(window.macros.protein_g, 1)} g</span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>Fat</span>
                            <span className="font-mono text-slate-100">{formatNumber(window.macros.fat_g, 1)} g</span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>Carbs</span>
                            <span className="font-mono text-slate-100">{formatNumber(window.macros.carb_g, 1)} g</span>
                          </li>
                        </ul>
                      </div>
                      {notes.length > 0 ? (
                        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                          <p className="mb-2 text-[0.65rem] uppercase tracking-wide text-amber-200/80">Safety notes</p>
                          <ul className="space-y-1">
                            {notes.map((note, index) => (
                              <li key={`${note}-${index}`}>• {note}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
