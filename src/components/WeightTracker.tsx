import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { usePlannerStore, type WeightTrendPoint } from '../state/plannerStore.js';

const LB_PER_KG = 2.2046226218;

type WeightTimeframe = '1m' | '3m' | '1y';

const TIMEFRAME_OPTIONS: { id: WeightTimeframe; label: string; days: number }[] = [
  { id: '1m', label: '1M', days: 30 },
  { id: '3m', label: '3M', days: 90 },
  { id: '1y', label: '1Y', days: 365 },
];

function toDisplay(weightKg: number, useImperial: boolean): number {
  return useImperial ? weightKg * LB_PER_KG : weightKg;
}

function formatWeight(weightKg: number, useImperial: boolean): string {
  return toDisplay(weightKg, useImperial).toFixed(1);
}

interface ChartData {
  path: string;
  minKg: number;
  maxKg: number;
  actual: { x: number; y: number }[];
}

function computeChart(points: WeightTrendPoint[]): { minKg: number; maxKg: number; range: number } {
  const values: number[] = [];
  for (const point of points) {
    values.push(point.weight_kg);
    values.push(typeof point.rollingAvg_kg === 'number' ? point.rollingAvg_kg : point.weight_kg);
  }
  const minKg = Math.min(...values);
  const maxKg = Math.max(...values);
  const range = maxKg - minKg || Math.max(1, maxKg * 0.05 || 1);
  return { minKg, maxKg, range };
}

function buildChart(points: WeightTrendPoint[]): ChartData | undefined {
  if (points.length < 2) {
    return undefined;
  }
  const { minKg, maxKg, range } = computeChart(points);
  const denominator = range === 0 ? 1 : range;
  const avgCoords = points.map((point, index) => {
    const value = typeof point.rollingAvg_kg === 'number' ? point.rollingAvg_kg : point.weight_kg;
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 100 - ((value - minKg) / denominator) * 100;
    return { x, y };
  });
  const actual = points.map((point, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 100 - ((point.weight_kg - minKg) / denominator) * 100;
    return { x, y };
  });
  const path = avgCoords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(2)},${coord.y.toFixed(2)}`)
    .join(' ');
  return { path, minKg, maxKg, actual };
}

function subtractDays(days: number): string {
  const reference = new Date();
  reference.setUTCDate(reference.getUTCDate() - days);
  return reference.toISOString().slice(0, 10);
}

function filterTrend(points: WeightTrendPoint[], timeframe: WeightTimeframe): WeightTrendPoint[] {
  const option = TIMEFRAME_OPTIONS.find((item) => item.id === timeframe);
  if (!option) {
    return points;
  }
  const threshold = subtractDays(option.days);
  return points.filter((point) => point.dateISO >= threshold);
}

export function WeightTracker() {
  const status = usePlannerStore((state) => state.status);
  const weights = usePlannerStore((state) => state.weights);
  const weightTrend = usePlannerStore((state) => state.weightTrend);
  const useImperial = usePlannerStore((state) => state.profile.useImperial);
  const upsertWeight = usePlannerStore((state) => state.upsertWeightEntry);
  const deleteWeight = usePlannerStore((state) => state.deleteWeightEntry);

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryValue, setEntryValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<WeightTimeframe>('3m');

  const filteredTrend = useMemo(() => filterTrend(weightTrend, timeframe), [timeframe, weightTrend]);
  const chart = useMemo(() => buildChart(filteredTrend), [filteredTrend]);
  const hasAnyTrend = weightTrend.length >= 2;
  const recentEntries = useMemo(() => [...weights].slice(-7).reverse(), [weights]);

  const unitLabel = useImperial ? 'lb' : 'kg';
  const disableForm = status === 'loading';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numeric = Number(entryValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError('Enter a valid weight value.');
      return;
    }
    const normalizedDate = entryDate || new Date().toISOString().slice(0, 10);
    upsertWeight(normalizedDate, numeric, useImperial ? 'lb' : 'kg');
    setEntryValue('');
    setError(null);
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-emerald-200">Weight tracking</h2>
        <p className="text-xs text-slate-400">
          Log morning weight to tune deficit safety checks. Entries are stored locally in your browser, and synced
          Intervals.icu history is merged automatically when available.
        </p>
      </header>

      <form
        className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))] sm:items-end"
        onSubmit={handleSubmit}
      >
        <label className="space-y-1 text-xs uppercase tracking-wide text-slate-400">
          <span>Date</span>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
            type="date"
            value={entryDate}
            onChange={(event) => setEntryDate(event.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            disabled={disableForm}
          />
        </label>
        <label className="space-y-1 text-xs uppercase tracking-wide text-slate-400">
          <span>Weight ({unitLabel})</span>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder={`e.g. ${useImperial ? '165.2' : '75.0'}`}
            value={entryValue}
            onChange={(event) => setEntryValue(event.target.value)}
            disabled={disableForm}
          />
        </label>
        <button
          type="submit"
          className={`rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
            disableForm
              ? 'cursor-not-allowed border border-slate-700 bg-slate-800 text-slate-500'
              : 'border border-emerald-500/60 bg-emerald-500 text-slate-900 hover:bg-emerald-400'
          }`}
          disabled={disableForm}
        >
          Save entry
        </button>
      </form>
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">7-day rolling trend</h3>
        <div className="flex items-center gap-2">
          <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">Timeframe</span>
          <div className="flex gap-1">
            {TIMEFRAME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTimeframe(option.id)}
                className={`rounded border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide transition-colors ${
                  timeframe === option.id
                    ? 'border-emerald-500/60 bg-emerald-500 text-slate-900'
                    : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {chart ? (
          <div className="space-y-2">
            <div className="flex justify-between text-[0.65rem] uppercase tracking-wide text-slate-500">
              <span>
                Low {formatWeight(chart.minKg, useImperial)} {unitLabel}
              </span>
              <span>
                High {formatWeight(chart.maxKg, useImperial)} {unitLabel}
              </span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-32 w-full">
              <path
                d={chart.path}
                fill="none"
                stroke="rgb(16 185 129)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {chart.actual.map((coord, index) => (
                <circle key={index} cx={coord.x} cy={coord.y} r={1.4} fill="rgb(56 189 248)" />
              ))}
            </svg>
            <p className="text-[0.65rem] text-slate-400">Line = 7-day average • Dots = logged weights.</p>
          </div>
        ) : (
          <p className="text-[0.7rem] text-slate-400">
            {hasAnyTrend ? 'Not enough data in the selected timeframe.' : 'Enter at least two weights to plot the rolling average.'}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Recent entries</h3>
        {recentEntries.length > 0 ? (
          <ul className="space-y-1 text-xs text-slate-300">
            {recentEntries.map((entry) => (
              <li
                key={entry.dateISO}
                className="flex items-center justify-between rounded-md border border-slate-800/60 bg-slate-950/60 px-3 py-2"
              >
                <span className="text-slate-400">
                  {new Date(`${entry.dateISO}T00:00:00Z`).toLocaleDateString()}
                </span>
                <span className="font-mono text-sm text-slate-100">
                  {formatWeight(entry.weight_kg, useImperial)} {unitLabel}
                </span>
                {entry.source === 'intervals' ? (
                  <span className="text-[0.6rem] uppercase tracking-wide text-emerald-300">Synced</span>
                ) : (
                  <button
                    type="button"
                    className="text-[0.65rem] font-semibold uppercase tracking-wide text-rose-300 hover:text-rose-200"
                    onClick={() => deleteWeight(entry.dateISO)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.7rem] text-slate-400">No weights logged yet.</p>
        )}
      </div>
    </section>
  );
}
