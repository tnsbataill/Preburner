import { AlertTriangle, ArrowRight, Info, ShieldCheck, Siren } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GlycogenChart } from '../components/GlycogenChart';
import { Timeline, focusSlot } from '../components/Timeline';
import { FeedbackPrompt, ReadinessCard } from '../components/TrainingCards';
import { WeighInCard } from '../components/WeighIn';
import { bandFor } from '../engine/plan';
import { addDays, diffDays, formatClock, formatDate, formatDuration, nowMinutes, weekdayShort } from '../engine/time';
import type { DayPlan, PlanFlag } from '../engine/types';
import { useApp } from '../state/store';
import { usePlan } from '../state/usePlan';
import { INTENSITY_COLOR, LOAD_LABEL, fmtInt } from '../ui/format';
import { Card, Chip, Ring, SectionTitle, cx } from '../ui/primitives';

function useHashDate(today: string): [string, (d: string) => void] {
  const read = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('date') ?? today;
  const [date, setDate] = useState(read);
  useEffect(() => {
    const on = () => setDate(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);
  const set = (d: string) => {
    window.history.replaceState(null, '', `#/today${d === today ? '' : `?date=${d}`}`);
    setDate(d);
  };
  return [date, set];
}

function useNow(tz?: string) {
  const [now, setNow] = useState(() => nowMinutes(tz));
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes(tz)), 30_000);
    return () => clearInterval(t);
  }, [tz]);
  return now;
}

function DateStrip({ days, selected, today, onSelect }: { days: DayPlan[]; selected: string; today: string; onSelect: (d: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll only the strip horizontally — scrollIntoView would also move the page.
    const strip = ref.current;
    const el = strip?.querySelector<HTMLElement>('[data-selected="true"]');
    if (strip && el) strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [selected]);
  return (
    <div ref={ref} className="scrollbar-none relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {days.map((d) => {
        const isSel = d.date === selected;
        return (
          <button
            key={d.date}
            data-selected={isSel}
            onClick={() => onSelect(d.date)}
            className={cx(
              'flex w-12 shrink-0 flex-col items-center gap-1 rounded-2xl border py-2 transition',
              isSel ? 'border-ember/50 bg-ember/10' : 'border-transparent hover:bg-raised',
            )}
          >
            <span className={cx('text-[10px] font-semibold uppercase', d.date === today ? 'text-ember' : 'text-muted')}>{weekdayShort(d.date)}</span>
            <span className={cx('num text-base font-semibold', isSel ? 'text-ink' : d.date < today ? 'text-faint' : 'text-ink')}>{Number(d.date.slice(8))}</span>
            <span className="flex h-1.5 gap-0.5">
              {d.workouts.slice(0, 3).map((w) => (
                <span key={w.id} className="h-1.5 w-1.5 rounded-full" style={{ background: INTENSITY_COLOR[w.intensity] }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NextUp({ day, nowMin }: { day: DayPlan; nowMin: number }) {
  const next = day.slots.find((s) => (s.endMin ?? s.startMin) >= nowMin);
  if (!next) {
    return (
      <Card className="flex items-center justify-between p-4">
        <div>
          <div className="label mb-1">Up next</div>
          <div className="font-medium">Done for today — sleep well.</div>
        </div>
      </Card>
    );
  }
  const inMin = next.startMin - nowMin;
  const live = next.kind === 'during' && inMin <= 0;
  const when = live ? 'Now' : inMin <= 0 ? 'Now' : inMin < 60 ? `in ${inMin} min` : `in ${formatDuration(inMin)}`;
  return (
    <button onClick={() => focusSlot(next.id)} className="group relative block w-full overflow-hidden rounded-2xl p-[1px] text-left ember-bg shadow-glow">
      <div className="flex items-center gap-4 rounded-[19px] bg-surface/95 p-4 transition group-hover:bg-surface/85">
        <div className="min-w-0 flex-1">
          <div className="label mb-1 text-ember">Up next · {when}</div>
          <div className="truncate text-lg font-semibold">{next.label}</div>
          <div className="num text-sm text-muted">
            {formatClock(next.startMin)} ·{' '}
            {next.fueling ? `${next.fueling.carbPerHour} g carbs/h, ${next.fueling.fluidMlPerHour} ml/h` : `${next.macros.carbG}C · ${next.macros.proteinG}P · ${next.macros.fatG}F`}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-ember">
          Details <ArrowRight size={18} className="transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function FlagList({ flags }: { flags: PlanFlag[] }) {
  if (!flags.length) return null;
  const icon = { info: Info, warn: AlertTriangle, alert: Siren };
  const tone = { info: 'text-protein', warn: 'text-warn', alert: 'text-bad' };
  return (
    <div className="space-y-2">
      {flags.map((f) => {
        const Icon = f.code === 'protected' ? ShieldCheck : icon[f.level];
        return (
          <div key={f.code} className="flex gap-2.5 rounded-xl bg-raised/60 p-3 text-sm">
            <Icon size={16} className={cx('mt-0.5 shrink-0', f.code === 'protected' ? 'text-good' : tone[f.level])} />
            <span className="text-muted">{f.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function DaySummary({ day, weightKg }: { day: DayPlan; weightKg: number }) {
  const [lo, hi] = bandFor(day.loadClass);
  const proteinTarget = day.macros.proteinG;
  const e = day.energy;
  const parts = [
    { label: 'Resting', v: e.bmr, c: 'rgb(var(--faint))' },
    { label: 'Daily life', v: e.neat, c: 'rgb(var(--muted))' },
    { label: 'Training', v: e.exercise, c: 'rgb(var(--ember))' },
  ];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="label mb-1">Eat today</div>
          <div className="num text-4xl font-semibold tracking-tight">
            {fmtInt(e.target)}
            <span className="ml-1 text-base font-medium text-muted">kcal</span>
          </div>
          <div className="mt-1 text-sm text-muted">
            {e.deficit > 40 ? (
              <span>
                <b className="text-ink">{fmtInt(e.deficit)}</b> under burn of {fmtInt(e.tdee)}
              </span>
            ) : e.deficit < -40 ? (
              <span>
                <b className="text-ink">{fmtInt(-e.deficit)}</b> over burn — fuelling up
              </span>
            ) : (
              <span>matches today's burn</span>
            )}
          </div>
        </div>
        <Chip color={day.protectedDay ? 'rgb(var(--good))' : 'rgb(var(--muted))'}>{day.protectedDay ? 'Key day' : LOAD_LABEL[day.loadClass]}</Chip>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          { k: 'Carbs', g: day.macros.carbG, c: 'rgb(var(--carb))', sub: `${day.carbGPerKg} g/kg`, max: hi * weightKg },
          { k: 'Protein', g: day.macros.proteinG, c: 'rgb(var(--protein))', sub: `${(proteinTarget / weightKg).toFixed(1)} g/kg`, max: 2.4 * weightKg },
          { k: 'Fat', g: day.macros.fatG, c: 'rgb(var(--fat))', sub: `${(day.macros.fatG / weightKg).toFixed(1)} g/kg`, max: 1.5 * weightKg },
        ].map((m) => (
          <div key={m.k} className="flex flex-col items-center gap-1.5">
            <Ring value={m.g} max={m.max} color={m.c} size={74} stroke={7}>
              <div className="text-center leading-none">
                <div className="num text-[15px] font-semibold">{m.g}</div>
                <div className="text-[9px] text-muted">g</div>
              </div>
            </Ring>
            <div className="text-center">
              <div className="text-xs font-medium">{m.k}</div>
              <div className="num text-[10px] text-muted">{m.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[11px] text-faint">
        Guideline for a {LOAD_LABEL[day.loadClass].toLowerCase()}: {lo}–{hi} g/kg carbs
      </div>

      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-xs text-muted">
          <span>Where today's {fmtInt(e.tdee)} kcal go</span>
          <span className="num">EA {e.energyAvailability}</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full">
          {parts.map((p) => (
            <div key={p.label} style={{ width: `${(p.v / e.tdee) * 100}%`, background: p.c }} />
          ))}
        </div>
        <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {parts.map((p) => (
            <span key={p.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: p.c }} />
              {p.label} {fmtInt(p.v)}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Phone-only one-line totals so the day's numbers are visible above the timeline. */
function CompactSummary({ day }: { day: DayPlan }) {
  return (
    <button onClick={() => document.getElementById('summary')?.scrollIntoView({ behavior: 'smooth' })} className="card num flex w-full items-center justify-between gap-3 px-4 py-3 text-left lg:hidden">
      <div>
        <span className="text-xl font-semibold">{fmtInt(day.energy.target)}</span>
        <span className="ml-1 text-xs text-muted">kcal</span>
      </div>
      <div className="flex gap-3 text-sm">
        <span>
          <b className="text-carb">{day.macros.carbG}</b>
          <span className="text-muted">C</span>
        </span>
        <span>
          <b className="text-protein">{day.macros.proteinG}</b>
          <span className="text-muted">P</span>
        </span>
        <span>
          <b className="text-fat">{day.macros.fatG}</b>
          <span className="text-muted">F</span>
        </span>
      </div>
    </button>
  );
}

export function TodayPage() {
  const { plan, today, currentWeightKg } = usePlan();
  const tz = useApp((s) => s.settings.profile.timezone);
  const nowMin = useNow(tz);
  const [date, setDate] = useHashDate(today);
  const day = plan.days.find((d) => d.date === date) ?? plan.days.find((d) => d.date === today)!;
  const isToday = day.date === today;
  const strip = useMemo(() => plan.days.filter((d) => diffDays(today, d.date) >= -3 && diffDays(today, d.date) <= 13), [plan.days, today]);
  const rel = diffDays(today, day.date);
  const relLabel = rel === 0 ? 'Today' : rel === 1 ? 'Tomorrow' : rel === -1 ? 'Yesterday' : formatDate(day.date, { weekday: true });

  return (
    <div className="space-y-5">
      <DateStrip days={strip} selected={day.date} today={today} onSelect={setDate} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label mb-1">{rel === 0 || Math.abs(rel) === 1 ? formatDate(day.date, { weekday: true }) : formatDate(addDays(day.date, 0))}</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{relLabel}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {day.workouts.length === 0 && <Chip>Rest day</Chip>}
          {day.workouts.map((w) => (
            <Chip key={w.id} color={INTENSITY_COLOR[w.intensity]}>
              {w.intensity} · {formatDuration(w.durationMin)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {isToday && <NextUp day={day} nowMin={nowMin} />}
          <CompactSummary day={day} />
          <Timeline day={day} nowMin={isToday ? nowMin : undefined} />
        </div>
        <div id="summary" className="scroll-mt-20 space-y-4 lg:sticky lg:top-8 lg:self-start">
          <DaySummary day={day} weightKg={currentWeightKg} />
          <Card className="p-5">
            <SectionTitle>Fuel tank</SectionTitle>
            <GlycogenChart points={plan.glycogen} day={day} nowMin={isToday ? nowMin : undefined} />
          </Card>
          <FlagList flags={day.flags} />
          {isToday && <ReadinessCard />}
          {isToday && <FeedbackPrompt compact />}
          {isToday && <WeighInCard />}
        </div>
      </div>
    </div>
  );
}
