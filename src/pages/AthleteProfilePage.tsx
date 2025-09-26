import { useMemo } from 'react';
import { harrisBenedictRmr } from '../calc/prescribe.js';
import { usePlannerStore } from '../state/plannerStore.js';
import type { SessionType } from '../types.js';

const SESSION_TYPES: SessionType[] = ['Endurance', 'Tempo', 'Threshold', 'VO2', 'Race', 'Rest'];
const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 0.3937007874;

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

function formatHeight(cm: number | undefined): string {
  if (typeof cm !== 'number' || Number.isNaN(cm)) {
    return '—';
  }
  const totalInches = cm * IN_PER_CM;
  const feet = Math.floor(totalInches / 12);
  const rawInches = totalInches - feet * 12;
  const inches = Math.round(rawInches);
  const carryFeet = inches === 12 ? 1 : 0;
  const finalFeet = feet + carryFeet;
  const finalInches = carryFeet ? 0 : inches;
  const imperial = `${finalFeet}'${finalInches}\"`;
  return `${cm.toFixed(1)} cm (${imperial})`;
}

function formatWeight(kg: number | undefined): string {
  if (typeof kg !== 'number' || Number.isNaN(kg)) {
    return '—';
  }
  const pounds = kg * LB_PER_KG;
  return `${kg.toFixed(1)} kg (${pounds.toFixed(1)} lb)`;
}

function formatSignedKg(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const pounds = value * LB_PER_KG;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} kg (${sign}${pounds.toFixed(2)} lb)`;
}

function formatPercent(value: number | undefined, fraction = false): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const percent = fraction ? value * 100 : value;
  return `${percent.toFixed(0)}%`;
}

function formatNumber(value: number | undefined, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

export function AthleteProfilePage() {
  const profile = usePlannerStore((state) => state.profile);
  const dataSource = usePlannerStore((state) => state.dataSource);
  const lastSyncISO = usePlannerStore((state) => state.lastSyncISO);
  const workouts = usePlannerStore((state) => state.workouts);
  const weights = usePlannerStore((state) => state.weights);
  const weightSummary = usePlannerStore((state) => state.weightSummary);

  const latestWeightEntry = useMemo(() => {
    if (weights.length === 0) {
      return undefined;
    }
    const sorted = [...weights].sort((a, b) => new Date(a.dateISO).getTime() - new Date(b.dateISO).getTime());
    return sorted[sorted.length - 1];
  }, [weights]);

  const ftpStats = useMemo(() => {
    const ftpValues = workouts
      .map((workout) => workout.ftp_watts_at_plan)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (ftpValues.length === 0) {
      return undefined;
    }
    const min = Math.min(...ftpValues);
    const max = Math.max(...ftpValues);
    return {
      min,
      max,
      hasRange: min !== max,
    };
  }, [workouts]);

  const ftpWkg = useMemo(() => {
    if (typeof profile.ftp_watts !== 'number') {
      return undefined;
    }
    const kg = latestWeightEntry?.weight_kg ?? profile.weight_kg;
    if (typeof kg !== 'number' || kg <= 0) {
      return undefined;
    }
    return profile.ftp_watts / kg;
  }, [latestWeightEntry?.weight_kg, profile.ftp_watts, profile.weight_kg]);

  const rmr = useMemo(() => Math.round(harrisBenedictRmr(profile)), [profile]);

  const carbBandEntries = useMemo(
    () =>
      SESSION_TYPES.map((type) => {
        const band = profile.carbBands[type] ?? [0, 0];
        return { type, low: band[0], high: band[1] };
      }),
    [profile.carbBands],
  );

  const lastSyncLabel =
    dataSource === 'intervals'
      ? lastSyncISO
        ? `Last sync: ${new Date(lastSyncISO).toLocaleString()}`
        : 'Last sync: Awaiting first sync'
      : 'Using sample data (sync not required).';

  const weightChangeActual = weightSummary?.actualDeltaKg;
  const weightChangeExpected = weightSummary?.expectedDeltaKg;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-100">Athlete Profile</h2>
        <p className="text-sm text-slate-400">
          Review the athlete metrics currently driving the nutrition plan. Values sync from{' '}
          {dataSource === 'intervals' ? 'Intervals.icu' : 'the bundled sample profile'} when available.
        </p>
        <p className="text-xs text-slate-500">{lastSyncLabel}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4">
          <header>
            <h3 className="text-lg font-semibold text-slate-100">Body metrics</h3>
          </header>
          <dl className="grid grid-cols-1 gap-3 text-sm text-slate-400 sm:grid-cols-2">
            <div>
              <dt>Sex</dt>
              <dd className="font-semibold text-slate-100">{profile.sex === 'M' ? 'Male' : 'Female'}</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd className="font-semibold text-slate-100">{profile.age_years} years</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd className="font-semibold text-slate-100">{formatHeight(profile.height_cm)}</dd>
            </div>
            <div>
              <dt>Body weight (profile)</dt>
              <dd className="font-semibold text-slate-100">{formatWeight(profile.weight_kg)}</dd>
            </div>
            <div>
              <dt>Latest logged weight</dt>
              <dd className="font-semibold text-slate-100">
                {latestWeightEntry ? `${formatWeight(latestWeightEntry.weight_kg)} on ${formatDate(latestWeightEntry.dateISO)}` : '—'}
              </dd>
            </div>
            <div>
              <dt>Unit preference</dt>
              <dd className="font-semibold text-slate-100">{profile.useImperial ? 'Imperial' : 'Metric'}</dd>
            </div>
          </dl>
        </article>

        <article className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4">
          <header>
            <h3 className="text-lg font-semibold text-slate-100">Performance &amp; metabolism</h3>
          </header>
          <dl className="grid grid-cols-1 gap-3 text-sm text-slate-400 sm:grid-cols-2">
            <div>
              <dt>FTP (profile)</dt>
              <dd className="font-semibold text-slate-100">
                {typeof profile.ftp_watts === 'number' ? `${profile.ftp_watts.toFixed(0)} W` : '—'}
              </dd>
            </div>
            <div>
              <dt>Plan FTP range</dt>
              <dd className="font-semibold text-slate-100">
                {ftpStats
                  ? ftpStats.hasRange
                    ? `${ftpStats.min.toFixed(0)} – ${ftpStats.max.toFixed(0)} W`
                    : `${ftpStats.min.toFixed(0)} W`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>FTP (W/kg)</dt>
              <dd className="font-semibold text-slate-100">{formatNumber(ftpWkg, 2)}</dd>
            </div>
            <div>
              <dt>Efficiency</dt>
              <dd className="font-semibold text-slate-100">{`${formatNumber(profile.efficiency, 2)} (${formatPercent(profile.efficiency, true)})`}</dd>
            </div>
            <div>
              <dt>Efficiency preset</dt>
              <dd className="font-semibold text-slate-100">{profile.efficiencyPreset}</dd>
            </div>
            <div>
              <dt>Estimated RMR</dt>
              <dd className="font-semibold text-slate-100">{rmr.toLocaleString()} kcal/day</dd>
            </div>
          </dl>
        </article>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4">
          <header>
            <h3 className="text-lg font-semibold text-slate-100">Nutrition targets</h3>
          </header>
          <dl className="grid grid-cols-1 gap-3 text-sm text-slate-400 sm:grid-cols-2">
            <div>
              <dt>Activity factor default</dt>
              <dd className="font-semibold text-slate-100">{formatNumber(profile.activityFactorDefault, 2)}</dd>
            </div>
            <div>
              <dt>Target weight change</dt>
              <dd className="font-semibold text-slate-100">{formatSignedKg(profile.targetKgPerWeek)}/week</dd>
            </div>
            <div>
              <dt>Energy per kg</dt>
              <dd className="font-semibold text-slate-100">{profile.kcalPerKg.toLocaleString()} kcal/kg</dd>
            </div>
            <div>
              <dt>Window deficit cap</dt>
              <dd className="font-semibold text-slate-100">{profile.deficitCapPerWindow.toFixed(0)} kcal</dd>
            </div>
            <div>
              <dt>Window cap (% of need)</dt>
              <dd className="font-semibold text-slate-100">{profile.windowPctCap ? formatPercent(profile.windowPctCap, true) : '—'}</dd>
            </div>
            <div>
              <dt>Protein floor</dt>
              <dd className="font-semibold text-slate-100">{formatNumber(profile.protein_g_per_kg, 2)} g/kg</dd>
            </div>
            <div>
              <dt>Fat floor</dt>
              <dd className="font-semibold text-slate-100">{formatNumber(profile.fat_g_per_kg_min, 2)} g/kg</dd>
            </div>
            <div>
              <dt>Glucose:fructose target</dt>
              <dd className="font-semibold text-slate-100">{formatNumber(profile.gluFruRatio, 2)}</dd>
            </div>
          </dl>
        </article>

        <article className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4">
          <header>
            <h3 className="text-lg font-semibold text-slate-100">Weight trend</h3>
          </header>
          <dl className="grid grid-cols-1 gap-3 text-sm text-slate-400">
            <div>
              <dt>Summary range</dt>
              <dd className="font-semibold text-slate-100">
                {weightSummary
                  ? `${formatDate(weightSummary.startISO)} → ${formatDate(weightSummary.endISO)} (${weightSummary.days} days)`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Actual change</dt>
              <dd className="font-semibold text-slate-100">{formatSignedKg(weightChangeActual)}</dd>
            </div>
            <div>
              <dt>Expected change</dt>
              <dd className="font-semibold text-slate-100">{formatSignedKg(weightChangeExpected)}</dd>
            </div>
            <div>
              <dt>Data source</dt>
              <dd className="font-semibold text-slate-100">{dataSource === 'intervals' ? 'Intervals.icu sync' : 'Sample dataset'}</dd>
            </div>
          </dl>
        </article>
      </div>

      <article className="space-y-4 rounded-lg border border-slate-800/80 bg-slate-950/70 p-4">
        <header className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-100">Carbohydrate strategy</h3>
          <p className="text-xs text-slate-400">
            Carb bands drive the fueling recommendations for each workout type. Split percentages inform the pre/during/post
            distribution.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
            <thead>
              <tr className="text-slate-400">
                <th className="py-2 pr-4 font-medium">Session type</th>
                <th className="py-2 pr-4 font-medium">Band (g/hr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/60 text-slate-200">
              {carbBandEntries.map((entry) => (
                <tr key={entry.type}>
                  <td className="py-2 pr-4 font-semibold">{entry.type}</td>
                  <td className="py-2 pr-4">
                    {`${entry.low.toFixed(0)} – ${entry.high.toFixed(0)} g/hr`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 text-sm text-slate-400 sm:grid-cols-3">
          <div>
            <h4 className="text-xs uppercase tracking-wide text-slate-500">Pre-session</h4>
            <p className="font-semibold text-slate-100">{formatPercent(profile.carbSplit.pre, true)}</p>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wide text-slate-500">During</h4>
            <p className="font-semibold text-slate-100">{formatPercent(profile.carbSplit.during, true)}</p>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wide text-slate-500">Post-session</h4>
            <p className="font-semibold text-slate-100">{formatPercent(profile.carbSplit.post, true)}</p>
          </div>
        </div>
      </article>
    </section>
  );
}
