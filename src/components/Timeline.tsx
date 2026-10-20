import { Check, ChevronDown, Clock, Droplets, Loader2, Pencil, RefreshCw, Send, Sparkles, X, Zap } from 'lucide-react';
import { type MealSuggestion, suggestMeal } from '../coach/meal';
import { IntervalsClient } from '../intervals/client';
import { useEffect, useRef, useState } from 'react';
import { formatClock, formatDuration } from '../engine/time';
import type { DayPlan, MealSlot } from '../engine/types';
import type { ResolvedWorkout } from '../engine/scheduler';
import { useApp } from '../state/store';
import { INTENSITY_COLOR, SLOT_ACCENT } from '../ui/format';
import { Chip, cx } from '../ui/primitives';
import { WorkoutProfile } from './WorkoutProfile';
import { WorkoutTimeSheet } from './WorkoutTimeSheet';

export const slotKey = (date: string, s: MealSlot) => `${date}|${s.kind}|${s.startMin}`;

const FOCUS_EVENT = 'preburner:focus-slot';

/** Scroll a timeline item into view and open it (used by the "Up next" card). */
export function focusSlot(id: string) {
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: id }));
}

/** Expand state for a timeline card, plus a brief highlight when focused from elsewhere. */
function useExpandable(id: string) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      setOpen(true);
      setFlash(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setFlash(false), 1400);
    };
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, [id]);
  return { open, toggle: () => setOpen((o) => !o), flash, ref };
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function ExpandHint({ open }: { open: boolean }) {
  return <ChevronDown size={16} className={cx('shrink-0 text-faint transition group-hover:text-muted', open && 'rotate-180')} aria-hidden />;
}

function MacroPills({ m, kcal }: { m: MealSlot['macros']; kcal: number }) {
  return (
    <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      <span>
        <b className="font-semibold text-carb">{m.carbG}</b>
        <span className="text-muted"> g carbs</span>
      </span>
      {m.proteinG > 0 && (
        <span>
          <b className="font-semibold text-protein">{m.proteinG}</b>
          <span className="text-muted"> g protein</span>
        </span>
      )}
      {m.fatG > 0 && (
        <span>
          <b className="font-semibold text-fat">{m.fatG}</b>
          <span className="text-muted"> g fat</span>
        </span>
      )}
      <span className="text-faint">· {kcal} kcal</span>
    </div>
  );
}

function MealCard({ date, slot, past }: { date: string; slot: MealSlot; past: boolean }) {
  const key = slotKey(date, slot);
  const eaten = useApp((s) => !!s.eaten[key]);
  const toggle = useApp((s) => s.toggleEaten);
  const peri = slot.kind === 'pre-meal' || slot.kind === 'pre-snack' || slot.kind === 'recovery';
  const { open, toggle: setOpenToggle, flash, ref } = useExpandable(slot.id);
  return (
    <div
      ref={ref}
      onClick={setOpenToggle}
      className={cx('card group cursor-pointer p-3.5 transition hover:border-line hover:bg-raised/40 sm:p-4', eaten && 'opacity-60', peri && 'border-l-[3px]', flash && 'ring-2 ring-ember/70')}
      style={peri ? { borderLeftColor: SLOT_ACCENT[slot.kind] } : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{slot.label}</h3>
            {slot.lowResidue && <Chip color="rgb(var(--carb))">low fat · low fibre</Chip>}
          </div>
          <div className="mt-1.5">
            <MacroPills m={slot.macros} kcal={slot.kcal} />
          </div>
        </div>
        <button
          onClick={(e) => {
            stop(e);
            toggle(key);
          }}
          aria-label={eaten ? 'Mark not eaten' : 'Mark eaten'}
          className={cx(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full border transition',
            eaten ? 'ember-bg border-transparent text-white' : past ? 'border-ember/50 text-ember' : 'border-line text-faint hover:border-ember/50 hover:text-ember',
          )}
        >
          <Check size={16} strokeWidth={2.5} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          aria-expanded={open}
          onClick={(e) => {
            stop(e);
            setOpenToggle();
          }}
          className="flex items-center gap-1 text-xs text-muted group-hover:text-ink"
        >
          <ChevronDown size={14} className={cx('transition', open && 'rotate-180')} />
          {open ? 'Less' : 'Why & ideas'}
        </button>
      </div>
      <CalculateMeal slotKeyId={key} slot={slot} />
      {open && (
        <div className="mt-2 space-y-2 animate-fade-up">
          <p className="text-sm text-muted">{slot.rationale}</p>
          <div className="flex flex-wrap gap-1.5">
            {slot.ideas.map((i) => (
              <span key={i} className="rounded-lg bg-raised px-2 py-1 text-xs">
                {i}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(5, 0.1 * b);

/** "Calculate meal": a simple meal with gram amounts that hits this slot's macros. */
function CalculateMeal({ slotKeyId, slot }: { slotKeyId: string; slot: MealSlot }) {
  const apiKey = useApp((s) => s.connection.anthropicKey);
  const meal = useApp((s) => s.mealSuggestions[slotKeyId]) as MealSuggestion | undefined;
  const save = useApp((s) => s.setMealSuggestion);
  const [state, setState] = useState<'idle' | 'busy' | 'nokey' | 'error'>('idle');
  const [error, setError] = useState('');
  const run = async (e: React.SyntheticEvent, avoid?: string[]) => {
    stop(e);
    if (!apiKey) return setState('nokey');
    setState('busy');
    try {
      save(slotKeyId, await suggestMeal({ apiKey, slot, avoid }));
      setState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };
  const m = slot.macros;
  const stale = meal && (meal.target.carbG !== m.carbG || meal.target.proteinG !== m.proteinG || meal.target.fatG !== m.fatG);
  if (!meal)
    return (
      <div className="mt-2" onClick={stop}>
        <button onClick={(e) => void run(e)} disabled={state === 'busy'} className="inline-flex items-center gap-1 text-xs font-medium text-ember hover:underline disabled:opacity-60" data-testid="calculate-meal">
          {state === 'busy' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {state === 'busy' ? 'Calculating…' : 'Calculate meal'}
        </button>
        {state === 'nokey' && (
          <p className="mt-1 text-xs text-muted">
            Add your Anthropic API key in{' '}
            <a href="#/settings" className="underline">
              Settings
            </a>{' '}
            to calculate meals.
          </p>
        )}
        {state === 'error' && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
    );
  return (
    <div className="mt-3 rounded-xl border border-line/70 bg-raised/40 p-3" onClick={stop} data-testid="meal-suggestion">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{meal.name}</div>
        <div className="flex shrink-0 items-center gap-2 text-muted">
          <button onClick={(e) => void run(e, [meal.name])} disabled={state === 'busy'} aria-label="Try another meal" title="Try another" className="hover:text-ink disabled:opacity-60">
            {state === 'busy' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button onClick={(e) => (stop(e), save(slotKeyId, undefined))} aria-label="Remove meal" title="Remove" className="hover:text-ink">
            <X size={14} />
          </button>
        </div>
      </div>
      <ul className="num mt-2 space-y-1 text-[13px]">
        {meal.items.map((i) => (
          <li key={i.food} className="flex justify-between gap-3">
            <span>
              <b className="font-semibold">{i.grams} g</b> {i.food}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {i.carbG}C · {i.proteinG}P · {i.fatG}F
            </span>
          </li>
        ))}
      </ul>
      <div className="num mt-2 border-t border-line/60 pt-2 text-xs text-muted">
        Total{' '}
        <span className={near(meal.totals.carbG, m.carbG) ? 'text-carb' : 'text-warn'}>{meal.totals.carbG} g carbs</span> ·{' '}
        <span className={near(meal.totals.proteinG, m.proteinG) ? 'text-protein' : 'text-warn'}>{meal.totals.proteinG} g protein</span> ·{' '}
        <span className={near(meal.totals.fatG, m.fatG) ? 'text-fat' : 'text-warn'}>{meal.totals.fatG} g fat</span> · {meal.totals.kcal} kcal
      </div>
      {meal.tip && <p className="mt-1.5 text-xs text-muted">{meal.tip}</p>}
      {stale && (
        <button onClick={(e) => void run(e)} className="mt-2 text-xs font-medium text-warn hover:underline">
          Targets changed since this was made. Recalculate
        </button>
      )}
      {state === 'error' && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

function SendFuelToIntervals({ workout, carbPerHour }: { workout: ResolvedWorkout; carbPerHour: number }) {
  const conn = useApp((s) => s.connection);
  const sync = useApp((s) => s.sync);
  const [state, setState] = useState<'idle' | 'asking' | 'sending' | 'sent' | 'error'>('idle');
  const eventId = workout.id.startsWith('icu-') ? Number(workout.id.slice(4)) : undefined;
  if (conn.mode !== 'intervals' || !conn.intervalsKey || !eventId || workout.completed || workout.carbsPerHourOverride === carbPerHour) return null;
  const send = async () => {
    setState('sending');
    try {
      await new IntervalsClient(conn.intervalsKey!, conn.athleteId).updateEvent(eventId, { carbs_per_hour: carbPerHour });
      setState('sent');
      void sync();
    } catch {
      setState('error');
    }
  };
  if (state === 'asking')
    return (
      <span className="ml-3 inline-flex items-center gap-2 text-xs text-muted">
        Set {carbPerHour} g/h on Intervals?
        <button onClick={() => void send()} className="font-medium text-ember hover:underline">
          Send
        </button>
        <button onClick={() => setState('idle')} className="hover:text-ink">
          Cancel
        </button>
      </span>
    );
  return (
    <button onClick={() => setState('asking')} disabled={state === 'sending' || state === 'sent'} className="ml-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink disabled:opacity-60">
      <Send size={11} /> {state === 'sent' ? 'Sent to Intervals' : state === 'error' ? 'Failed — retry' : state === 'sending' ? 'Sending…' : 'Send g/h to Intervals'}
    </button>
  );
}

/** Sessions planned in the app can be taken off again. */
function RemoveManual({ id }: { id: string }) {
  const remove = useApp((s) => s.removeLocalWorkout);
  return (
    <button onClick={() => remove(id)} className="ml-3 inline-flex items-center gap-1 text-xs text-muted hover:text-bad">
      <X size={11} /> Remove
    </button>
  );
}

function SessionCard({ slot, workout }: { slot: MealSlot; workout: ResolvedWorkout }) {
  const [editing, setEditing] = useState(false);
  const color = INTENSITY_COLOR[workout.intensity];
  const f = slot.fueling;
  const hours = workout.durationMin / 60;
  const bottles = f ? Math.max(1, Math.round((f.fluidMlPerHour * hours) / 750)) : 0;
  const gels = f && f.carbPerHour > 0 ? Math.max(0, Math.round((slot.macros.carbG - bottles * 40) / 25)) : 0;
  const { open, toggle, flash, ref } = useExpandable(slot.id);
  const description = workout.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return (
    <div
      ref={ref}
      onClick={toggle}
      className={cx('card group relative cursor-pointer overflow-hidden p-4 transition hover:brightness-110', flash && 'ring-2 ring-ember/70')}
      style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />
      <div className="absolute inset-0 opacity-[0.06]" style={{ background: `linear-gradient(110deg, ${color}, transparent 60%)` }} />
      <div className="relative pl-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Zap size={16} style={{ color }} />
            <h3 className="truncate font-semibold">{workout.title}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <Chip color={color}>{workout.intensity}</Chip>
            {workout.completed && <Chip color="rgb(var(--good))">done</Chip>}
            <button
              aria-expanded={open}
              aria-label={open ? 'Hide session details' : 'Show session details'}
              onClick={(e) => {
                stop(e);
                toggle();
              }}
              className="rounded-md p-0.5"
            >
              <ExpandHint open={open} />
            </button>
          </div>
        </div>
        <div className="num mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{formatDuration(workout.durationMin)}</span>
          <span>IF {workout.ifactor.toFixed(2)}</span>
          <span>{workout.kj} kJ</span>
          <span>load {workout.load}</span>
        </div>
        <WorkoutProfile steps={workout.steps} className="mt-3 h-10 w-full rounded-md" />
        {workout.timeAssumed && !workout.completed && (
          <button onClick={(e) => (stop(e), setEditing(true))} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-warn/50 px-2 py-1 text-xs text-warn hover:bg-warn/10">
            <Clock size={12} /> Time assumed — set the real start
          </button>
        )}
        {f && (
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-bg/60 p-3">
            <div>
              <div className="label">Carbs</div>
              <div className="num text-lg font-semibold">
                {f.carbPerHour}
                <span className="text-xs font-normal text-muted"> g/h</span>
              </div>
              <div className="num text-[11px] text-muted">{slot.macros.carbG} g total</div>
            </div>
            <div>
              <div className="label flex items-center gap-1">
                <Droplets size={11} /> Fluid
              </div>
              <div className="num text-lg font-semibold">
                {f.fluidMlPerHour}
                <span className="text-xs font-normal text-muted"> ml/h</span>
              </div>
              <div className="num text-[11px] text-muted">~{bottles} bottle{bottles === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="label">Sodium</div>
              <div className="num text-lg font-semibold">
                {f.sodiumMgPerHour}
                <span className="text-xs font-normal text-muted"> mg/h</span>
              </div>
              {f.fructoseG > 0 ? (
                <div className="num text-[11px] text-muted">
                  {f.glucoseG}g glu : {f.fructoseG}g fru
                </div>
              ) : (
                <div className="text-[11px] text-muted">glucose ok</div>
              )}
            </div>
          </div>
        )}
        {open && (
          <div className="mt-3 space-y-3 animate-fade-up">
            {f && f.carbPerHour > 0 && (
              <p className="text-sm text-muted">
                e.g. {bottles} × 750 ml bottle with 40 g mix{gels > 0 ? ` + ${gels} gel${gels === 1 ? '' : 's'} (25 g)` : ''}. Start eating in the first 15 min.
              </p>
            )}
            <p className="text-sm text-muted">{slot.rationale}</p>
            {description && <p className="line-clamp-4 text-xs text-faint">{description}</p>}
            <div className="flex flex-wrap items-center" onClick={stop}>
              {!workout.timeAssumed && !workout.completed && (
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
                  <Pencil size={11} /> Change time
                </button>
              )}
              {f && f.carbPerHour > 0 && <SendFuelToIntervals workout={workout} carbPerHour={f.carbPerHour} />}
              {workout.source === 'manual' && !workout.completed && <RemoveManual id={workout.id} />}
            </div>
          </div>
        )}
      </div>
      <div onClick={stop}>
        <WorkoutTimeSheet open={editing} onClose={() => setEditing(false)} workout={workout} />
      </div>
    </div>
  );
}

export function Timeline({ day, nowMin }: { day: DayPlan; nowMin?: number }) {
  const items = day.slots;
  const nowIdx = nowMin === undefined ? -1 : items.findIndex((s) => s.startMin > nowMin);
  return (
    <ol className="relative">
      <div className="absolute bottom-3 left-[59px] top-3 w-px bg-line sm:left-[67px]" />
      {items.map((slot, i) => {
        const workout = slot.kind === 'during' ? day.workouts.find((w) => w.id === slot.workoutId) : undefined;
        const past = nowMin !== undefined && (slot.endMin ?? slot.startMin + 30) < nowMin;
        const dot = slot.kind === 'during' && workout ? INTENSITY_COLOR[workout.intensity] : SLOT_ACCENT[slot.kind];
        return (
          <li key={slot.id} className="relative">
            {i === nowIdx && nowMin !== undefined && <NowLine min={nowMin} />}
            <div className="flex gap-3 py-1.5 sm:gap-4">
              <div className={cx('num w-12 shrink-0 pt-4 text-right text-xs font-medium sm:w-14', past ? 'text-faint' : 'text-muted')}>{formatClock(slot.startMin)}</div>
              <div className="relative z-10 mt-[18px] h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-bg" style={{ background: dot }} />
              <div className={cx('min-w-0 flex-1', past && 'opacity-70')}>
                {workout ? <SessionCard slot={slot} workout={workout} /> : <MealCard date={day.date} slot={slot} past={past} />}
              </div>
            </div>
          </li>
        );
      })}
      {nowIdx === -1 && nowMin !== undefined && <NowLine min={nowMin} />}
    </ol>
  );
}

function NowLine({ min }: { min: number }) {
  return (
    <div className="relative flex items-center gap-3 py-1 sm:gap-4">
      <div className="num w-12 shrink-0 text-right text-[11px] font-semibold text-ember sm:w-14">{formatClock(min)}</div>
      <div className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full bg-ember ring-4 ring-ember/20 animate-pulse2" />
      <div className="h-px flex-1 bg-gradient-to-r from-ember/70 to-transparent" />
    </div>
  );
}
