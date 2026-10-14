import { useMemo } from 'react';
import { WINDOW_EMPTY_FLAG, WINDOW_UNDER_RECOVERY_FLAG } from '../calc/weekly.js';
import { estimateWorkoutKilojoules } from '../calc/prescribe.js';
import { usePlannerStore } from '../state/plannerStore.js';

const LB_PER_KG = 2.2046226218;
const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

function formatWeight(weightKg: number, useImperial: boolean): string {
  if (!Number.isFinite(weightKg)) {
    return '—';
  }
  const pounds = weightKg * LB_PER_KG;
  if (useImperial) {
    return `${pounds.toFixed(1)} lb (${weightKg.toFixed(1)} kg)`;
  }
  return `${weightKg.toFixed(1)} kg (${pounds.toFixed(1)} lb)`;
}

function formatHeight(heightCm: number, useImperial: boolean): string {
  if (!Number.isFinite(heightCm)) {
    return '—';
  }
  if (useImperial) {
    const totalInches = heightCm / CM_PER_INCH;
    const feet = Math.floor(totalInches / INCHES_PER_FOOT);
    const inches = totalInches - feet * INCHES_PER_FOOT;
    const roundedInches = Math.round(inches * 10) / 10;
    return `${feet} ft ${roundedInches.toFixed(1)} in (${heightCm.toFixed(0)} cm)`;
  }
  const inches = heightCm / CM_PER_INCH;
  return `${heightCm.toFixed(0)} cm (${inches.toFixed(1)} in)`;
}

function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function describeWindowNote(note: string): string {
  if (note === WINDOW_EMPTY_FLAG) {
    return 'Safety flag: >1 kg overnight drop detected — deficit halved for this window.';
  }
  if (note === WINDOW_UNDER_RECOVERY_FLAG) {
    return 'Safety flag: Weight loss exceeding target — deficit paused to prioritise recovery.';
  }
  return note;
}

function OnboardingHomeCard() {
  const profile = usePlannerStore((state) => state.profile);
  const windows = usePlannerStore((state) => state.windows);
  const workouts = usePlannerStore((state) => state.workouts);
  const weightSummary = usePlannerStore((state) => state.weightSummary);
  const lastSyncISO = usePlannerStore((state) => state.lastSyncISO);
  const isRefreshing = usePlannerStore((state) => state.isRefreshing);

  const now = Date.now();

  const { activeWindow, upcomingWindow } = useMemo(() => {
    let current: typeof windows[number] | undefined;
    let next: typeof windows[number] | undefined;
    for (const window of windows) {
      const start = new Date(window.windowStartISO).getTime();
      const end = new Date(window.windowEndISO).getTime();
      if (!current && start <= now && end >= now) {
        current = window;
      }
      if (!next && start > now) {
        next = window;
      }
      if (current && next) break;
    }
    return { activeWindow: current, upcomingWindow: next };
  }, [windows, now]);

  const nextWorkout = useMemo(() => {
    return workouts.find((workout) => new Date(workout.startISO).getTime() >= now) ?? workouts[0];
  }, [workouts, now]);

  const totalNeed = useMemo(
    () => windows.reduce((sum, window) => sum + window.need_kcal, 0),
    [windows],
  );

  const totalTarget = useMemo(
    () => windows.reduce((sum, window) => sum + window.target_kcal, 0),
    [windows],
  );

  const deficit = Math.max(0, totalNeed - totalTarget);

  const weightDelta = weightSummary
    ? weightSummary.actualDeltaKg - weightSummary.expectedDeltaKg
    : undefined;

  const windowToShow = activeWindow ?? upcomingWindow;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">Dashboard</h2>
        <p className="text-sm text-slate-400">
          Snapshot of the latest sync from Intervals.icu. Dip into the planner and windows views for full detail.
        </p>
        <p className="text-xs text-slate-500">
          Last sync: {formatDateTime(lastSyncISO)} {isRefreshing ? '(refreshing…)' : ''}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {windowToShow ? (
          <article className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40">
            <header className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {activeWindow ? 'Current window' : 'Next window'}
                </p>
                <h3 className="text-lg font-semibold text-slate-100">{windowToShow.nextWorkoutType} focus</h3>
              </div>
              <span className="text-[0.65rem] text-slate-400">
                {formatTime(windowToShow.windowStartISO)} → {formatTime(windowToShow.windowEndISO)}
              </span>
            </header>
          <dl className="grid grid-cols-2 gap-3 text-xs text-slate-300">
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Need</dt>
                <dd className="font-mono text-slate-100">{formatNumber(windowToShow.need_kcal)} kcal</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Target</dt>
                <dd className="font-mono text-slate-100">{formatNumber(windowToShow.target_kcal)} kcal</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Carbs (pre/during/post)</dt>
                <dd>
                  {formatNumber(windowToShow.carbs.pre_g, 1)} g / {formatNumber(windowToShow.carbs.during_g, 1)} g /{' '}
                  {formatNumber(windowToShow.carbs.post_g, 1)} g
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Macros (P/F/C)</dt>
                <dd>
                  {formatNumber(windowToShow.macros.protein_g, 1)} g / {formatNumber(windowToShow.macros.fat_g, 1)} g /{' '}
                  {formatNumber(windowToShow.macros.carb_g, 1)} g
                </dd>
              </div>
            </dl>
            {windowToShow.notes.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-[0.65rem] text-amber-300/80">
                {windowToShow.notes.map((note) => (
                  <li key={note}>{describeWindowNote(note)}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}

        {nextWorkout ? (
          <article className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40">
            <header className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Next session</p>
                <h3 className="text-lg font-semibold text-slate-100">{nextWorkout.title ?? nextWorkout.id}</h3>
              </div>
              <span className="text-[0.65rem] text-slate-400">{formatDateTime(nextWorkout.startISO)}</span>
            </header>
            <dl className="grid grid-cols-2 gap-3 text-xs text-slate-300">
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Type</dt>
                <dd>{nextWorkout.type}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Duration</dt>
                <dd>{formatNumber(nextWorkout.duration_hr, 2)} h</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">Energy</dt>
                <dd className="font-mono text-slate-100">
                  {formatNumber(
                    typeof nextWorkout.planned_kJ === 'number'
                      ? nextWorkout.planned_kJ
                      : estimateWorkoutKilojoules(nextWorkout),
                  )}{' '}
                  kJ
                </dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide text-slate-500">FTP at plan</dt>
                <dd>{formatNumber(nextWorkout.ftp_watts_at_plan ?? profile.ftp_watts ?? 0, 0)} W</dd>
              </div>
            </dl>
          </article>
        ) : null}

        <article className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40">
          <header className="flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Week overview</p>
            <span className="text-[0.65rem] text-slate-400">{windows.length} windows</span>
          </header>
          <dl className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between">
              <dt>Total need</dt>
              <dd>{formatNumber(totalNeed)} kcal</dd>
            </div>
            <div className="flex justify-between">
              <dt>Total target</dt>
              <dd>{formatNumber(totalTarget)} kcal</dd>
            </div>
            <div className="flex justify-between">
              <dt>Planned deficit</dt>
              <dd>{formatNumber(deficit)} kcal</dd>
            </div>
          </dl>
          {deficit > 0 && profile.targetKgPerWeek !== 0 ? (
            <p className="text-[0.65rem] text-slate-400">
              Goal: {formatNumber(profile.targetKgPerWeek, 2)} kg/week ⇒ {formatNumber(profile.targetKgPerWeek * profile.kcalPerKg)} kcal
            </p>
          ) : null}
        </article>

        <article className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 shadow-sm shadow-slate-950/40">
          <header className="flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Weight trend</p>
            <span className="text-[0.65rem] text-slate-400">
              {weightSummary
                ? `${weightSummary.startISO} → ${weightSummary.endISO}`
                : 'Need at least two entries'}
            </span>
          </header>
          {weightSummary ? (
            <dl className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between">
                <dt>Observed change</dt>
                <dd>{formatNumber(weightSummary.actualDeltaKg, 2)} kg</dd>
              </div>
              <div className="flex justify-between">
                <dt>Expected change</dt>
                <dd>{formatNumber(weightSummary.expectedDeltaKg, 2)} kg</dd>
              </div>
              <div className="flex justify-between">
                <dt>Difference</dt>
                <dd className={weightDelta && Math.abs(weightDelta) > 0.1 ? 'text-amber-300' : ''}>
                  {weightDelta ? formatNumber(weightDelta, 2) : '0.00'} kg
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-400">Log weights to unlock the rolling trend view.</p>
          )}
        </article>
      </div>
    </section>
  );
}

export function OnboardingPage() {
  const profile = usePlannerStore((state) => state.profile);
  const workouts = usePlannerStore((state) => state.workouts);
  const dataSource = usePlannerStore((state) => state.dataSource);
  const lastSyncISO = usePlannerStore((state) => state.lastSyncISO);
  const syncError = usePlannerStore((state) => state.syncError);
  const dataReady = dataSource === 'intervals' && workouts.length > 0 && !syncError;

  if (dataReady) {
    return <OnboardingHomeCard />;
  }

  const weightDisplay = formatWeight(profile.weight_kg, profile.useImperial);
  const heightDisplay = formatHeight(profile.height_cm, profile.useImperial);
  const efficiencyDisplay = `${(profile.efficiency * 100).toFixed(1)}%`;
  const activityDisplay = profile.activityFactorDefault.toFixed(2);
  const weeklyGoalKcal = Math.round(profile.targetKgPerWeek * profile.kcalPerKg);
  const weeklyGoalDisplay = `${weeklyGoalKcal.toLocaleString()} kcal deficit`;

  const lastSyncLabel = lastSyncISO
    ? new Date(lastSyncISO).toLocaleString()
    : dataSource === 'intervals'
      ? 'Awaiting first sync'
      : 'Sample data in use';

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-100">Welcome to Preburner</h2>
        <p className="text-sm text-slate-400">
          Connect your Intervals.icu account or explore the sandbox data. Enter an API key in the settings panel to sync your
          next week of structured workouts, then adjust the sliders on the left to see how the nutrition engine adapts in real
          time.
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
              <dd>{weightDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Height</dt>
              <dd>{heightDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Efficiency</dt>
              <dd>{efficiencyDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Activity factor</dt>
              <dd>{activityDisplay}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Weekly goal</dt>
              <dd>{weeklyGoalDisplay}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Upcoming workouts</h3>
          <p className="mt-3 text-xs text-slate-400">
            {workouts.length} sessions loaded from {dataSource === 'intervals' ? 'Intervals.icu' : 'the built-in sample dataset'}.
          </p>
          <dl className="mt-3 space-y-1 text-[0.7rem] text-slate-500">
            <div className="flex justify-between">
              <dt>Last sync</dt>
              <dd className="text-slate-300">{lastSyncLabel}</dd>
            </div>
          </dl>
          {syncError ? (
            <p className="mt-2 rounded-md border border-rose-900/40 bg-rose-950/40 p-2 text-rose-200">
              Sync issue: {syncError}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:col-span-2 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-200">Next steps</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-slate-400">
            <li>Press “Refresh from Intervals.icu” once your API key is saved.</li>
            <li>Visit the Planner view to confirm session energy targets.</li>
            <li>Open the Windows view to review fuel windows between workouts.</li>
            <li>Check the Weekly view for deficit placement vs. target.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
