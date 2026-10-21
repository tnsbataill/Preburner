import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { WeightChart } from '../components/WeightChart';
import { WorkoutProfile } from '../components/WorkoutProfile';
import { observedRate } from '../engine/goals';
import { addDays, diffDays, formatDate, formatDuration, weekStartOf, weekdayShort } from '../engine/time';
import type { DayPlan } from '../engine/types';
import { useApp } from '../state/store';
import { usePlan } from '../state/usePlan';
import { useWeights } from '../state/useHealth';
import { INTENSITY_COLOR, fmtInt, fmtRate, fmtWeight } from '../ui/format';
import { Bar, Card, SectionTitle, Stat, cx } from '../ui/primitives';

function DayColumn({ day, today, maxKcal }: { day: DayPlan; today: string; maxKcal: number }) {
  const isToday = day.date === today;
  const past = day.date < today;
  const hours = day.workouts.reduce((s, w) => s + w.durationMin, 0);
  return (
    <a
      href={`#/today?date=${day.date}`}
      className={cx(
        'card group flex flex-col gap-3 p-3.5 transition hover:border-ember/40 lg:min-h-[260px]',
        isToday && 'border-ember/50 shadow-glow',
        past && 'opacity-70',
      )}
    >
      <div className="flex items-baseline justify-between lg:block">
        <div className="flex items-baseline gap-2 lg:block">
          <div className={cx('text-[11px] font-semibold uppercase tracking-wider', isToday ? 'text-ember' : 'text-muted')}>{weekdayShort(day.date)}</div>
          <div className="num text-lg font-semibold">{Number(day.date.slice(8))}</div>
        </div>
        {day.protectedDay && <ShieldCheck size={15} className="text-good lg:mt-1" aria-label="Key day — no deficit" />}
      </div>

      <div className="flex min-h-[44px] flex-col gap-1.5">
        {day.workouts.length === 0 ? (
          <div className="text-xs text-faint">Rest</div>
        ) : (
          day.workouts.map((w) => (
            <div key={w.id} className="rounded-lg px-2 py-1.5 text-xs" style={{ background: `color-mix(in srgb, ${INTENSITY_COLOR[w.intensity]} 14%, transparent)` }}>
              <div className="line-clamp-2 font-medium leading-snug" style={{ color: INTENSITY_COLOR[w.intensity] }}>
                {w.title}
              </div>
              <div className="num text-[10px] text-muted">
                {formatDuration(w.durationMin)} · {w.load} load
              </div>
              <WorkoutProfile steps={w.steps} ftpLine={false} className="mt-1.5 h-8 w-full rounded-sm lg:h-6" />
            </div>
          ))
        )}
      </div>

      <div className="mt-auto space-y-2">
        <div>
          <div className="num flex items-baseline justify-between">
            <span className="text-[15px] font-semibold">{fmtInt(day.energy.target)}</span>
            <span className="text-[10px] text-muted">kcal</span>
          </div>
          <Bar value={day.energy.target} max={maxKcal} color="rgb(var(--ember))" marker={day.energy.tdee} className="mt-1" />
        </div>
        <div className="num flex justify-between text-[11px]">
          <span className="text-carb">{day.carbGPerKg} g/kg</span>
          {day.energy.deficit > 40 ? <span className="text-muted">−{fmtInt(day.energy.deficit)}</span> : day.energy.deficit < -40 ? <span className="text-good">+{fmtInt(-day.energy.deficit)}</span> : <span className="text-faint">even</span>}
        </div>
        {hours > 0 && <div className="sr-only">{hours} minutes</div>}
      </div>
    </a>
  );
}

export function WeekPage() {
  const { plan, today, trend, currentWeightKg } = usePlan();
  const settings = useApp((s) => s.settings);
  const weights = useWeights();
  const units = settings.profile.units;
  const weekKeys = useMemo(() => plan.weeks.map((w) => w.weekStart), [plan.weeks]);
  const [idx, setIdx] = useState(() => Math.max(0, weekKeys.indexOf(weekStartOf(today))));
  const week = plan.weeks[idx];
  const days = plan.days.filter((d) => d.date >= week.weekStart && d.date <= addDays(week.weekStart, 6));
  const maxKcal = Math.max(...plan.days.map((d) => Math.max(d.energy.target, d.energy.tdee)));
  const actualRate = observedRate(weights);
  const placedPct = week.targetDeficit > 0 ? Math.round((week.placedDeficit / week.targetDeficit) * 100) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label mb-1">Week of {formatDate(week.weekStart)}</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {diffDays(weekStartOf(today), week.weekStart) === 0 ? 'This week' : diffDays(weekStartOf(today), week.weekStart) === 7 ? 'Next week' : diffDays(weekStartOf(today), week.weekStart) === -7 ? 'Last week' : `Week of ${formatDate(week.weekStart)}`}
          </h1>
        </div>
        <div className="flex gap-1">
          <button disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="rounded-xl border border-line p-2 disabled:opacity-30" aria-label="Previous week">
            <ChevronLeft size={18} />
          </button>
          <button disabled={idx >= plan.weeks.length - 1} onClick={() => setIdx(idx + 1)} className="rounded-xl border border-line p-2 disabled:opacity-30" aria-label="Next week">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-tour="week-stats">
        <Card className="p-4">
          <Stat label="Training" value={week.hours} unit="h" sub={`${week.load} load`} />
        </Card>
        <Card className="p-4">
          <Stat label="Avg intake" value={fmtInt(week.kcal / Math.max(1, week.days.length))} unit="kcal/day" sub={`${Math.round(week.macros.carbG / week.days.length)} g carbs/day`} />
        </Card>
        <Card className="p-4">
          <Stat
            label={plan.weeklyRateKg < 0 ? 'Deficit placed' : plan.weeklyRateKg > 0 ? 'Surplus' : 'Energy balance'}
            value={plan.weeklyRateKg < 0 ? fmtInt(week.placedDeficit) : plan.weeklyRateKg > 0 ? fmtInt(-week.placedDeficit) : 'Even'}
            unit={plan.weeklyRateKg !== 0 ? 'kcal' : undefined}
            sub={placedPct !== undefined ? `${placedPct}% of ${fmtInt(week.targetDeficit)} target` : 'maintenance'}
          />
          {placedPct !== undefined && <Bar value={week.placedDeficit} max={week.targetDeficit} color="rgb(var(--ember))" className="mt-2" />}
        </Card>
        <Card className="p-4">
          <Stat label="Expected change" value={fmtWeight(week.expectedChangeKg, units, 2).replace(/^(\d)/, '+$1')} sub={`goal ${fmtRate(plan.weeklyRateKg, units)}`} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((d) => (
          <DayColumn key={d.date} day={d} today={today} maxKcal={maxKcal} />
        ))}
      </div>
      <p className="-mt-3 text-xs text-muted">
        <ShieldCheck size={12} className="mr-1 inline text-good" />
        Key days carry no deficit — the bar marker shows burn, the fill shows what to eat.
      </p>

      <Card className="p-5">
        <SectionTitle
          action={
            <span className="num text-xs text-muted">
              trend {fmtWeight(currentWeightKg, units)}
              {actualRate !== undefined && ` · actual ${fmtRate(actualRate, units)}`}
            </span>
          }
        >
          Weight trend
        </SectionTitle>
        <WeightChart trend={trend} today={today} units={units} goal={{ date: settings.goals.targetWeightDate, kg: settings.goals.targetWeightKg }} rateKg={plan.weeklyRateKg} />
        {actualRate !== undefined && Math.abs(actualRate - plan.weeklyRateKg) > 0.25 && (
          <p className="mt-3 rounded-xl bg-raised/60 p-3 text-sm text-muted">
            Your trend is moving {fmtRate(actualRate, units)} vs a plan of {fmtRate(plan.weeklyRateKg, units)}. If that holds for another week, adjust daily-life activity in Settings — your real burn is{' '}
            {actualRate > plan.weeklyRateKg ? 'lower' : 'higher'} than estimated.
          </p>
        )}
      </Card>

      {plan.flags.length > 0 && (
        <div className="space-y-2">
          {plan.flags.map((f, i) => (
            <div key={i} className="rounded-xl bg-raised/60 p-3 text-sm text-muted">
              {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
