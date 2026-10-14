import { Check, ChevronDown, Clock, Droplets, Pencil, Send, Zap } from 'lucide-react';
import { IntervalsClient } from '../intervals/client';
import { useState } from 'react';
import { formatClock, formatDuration } from '../engine/time';
import type { DayPlan, MealSlot } from '../engine/types';
import type { ResolvedWorkout } from '../engine/scheduler';
import { useApp } from '../state/store';
import { INTENSITY_COLOR, SLOT_ACCENT } from '../ui/format';
import { Chip, cx } from '../ui/primitives';
import { WorkoutTimeSheet } from './WorkoutTimeSheet';

export const slotKey = (date: string, s: MealSlot) => `${date}|${s.kind}|${s.startMin}`;

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
  const [open, setOpen] = useState(false);
  const key = slotKey(date, slot);
  const eaten = useApp((s) => !!s.eaten[key]);
  const toggle = useApp((s) => s.toggleEaten);
  const peri = slot.kind === 'pre-meal' || slot.kind === 'pre-snack' || slot.kind === 'recovery';
  return (
    <div className={cx('card p-3.5 transition sm:p-4', eaten && 'opacity-60', peri && 'border-l-[3px]')} style={peri ? { borderLeftColor: SLOT_ACCENT[slot.kind] } : undefined}>
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
          onClick={() => toggle(key)}
          aria-label={eaten ? 'Mark not eaten' : 'Mark eaten'}
          className={cx(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full border transition',
            eaten ? 'ember-bg border-transparent text-white' : past ? 'border-ember/50 text-ember' : 'border-line text-faint hover:border-ember/50 hover:text-ember',
          )}
        >
          <Check size={16} strokeWidth={2.5} />
        </button>
      </div>
      <button onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ChevronDown size={14} className={cx('transition', open && 'rotate-180')} />
        {open ? 'Less' : 'Why & ideas'}
      </button>
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

function SendFuelToIntervals({ workout, carbPerHour }: { workout: ResolvedWorkout; carbPerHour: number }) {
  const conn = useApp((s) => s.connection);
  const sync = useApp((s) => s.sync);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const eventId = workout.id.startsWith('icu-') ? Number(workout.id.slice(4)) : undefined;
  if (conn.mode !== 'intervals' || !conn.intervalsKey || !eventId || workout.completed || workout.carbsPerHourOverride === carbPerHour) return null;
  const send = async () => {
    if (!confirm(`Set carbs/hour on "${workout.title}" in Intervals.icu to ${carbPerHour} g/h?`)) return;
    setState('sending');
    try {
      await new IntervalsClient(conn.intervalsKey!, conn.athleteId).updateEvent(eventId, { carbs_per_hour: carbPerHour });
      setState('sent');
      void sync();
    } catch {
      setState('error');
    }
  };
  return (
    <button onClick={() => void send()} disabled={state === 'sending' || state === 'sent'} className="mt-2 ml-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink disabled:opacity-60">
      <Send size={11} /> {state === 'sent' ? 'Sent to Intervals' : state === 'error' ? 'Failed — retry' : state === 'sending' ? 'Sending…' : 'Send g/h to Intervals'}
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
  return (
    <div className="card relative overflow-hidden p-4" style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}>
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
          </div>
        </div>
        <div className="num mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{formatDuration(workout.durationMin)}</span>
          <span>IF {workout.ifactor.toFixed(2)}</span>
          <span>{workout.kj} kJ</span>
          <span>load {workout.load}</span>
        </div>
        {workout.timeAssumed && !workout.completed && (
          <button onClick={() => setEditing(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-warn/50 px-2 py-1 text-xs text-warn hover:bg-warn/10">
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
        {f && f.carbPerHour > 0 && (
          <p className="mt-2 text-xs text-muted">
            e.g. {bottles} × 750 ml bottle with 40 g mix{gels > 0 ? ` + ${gels} gel${gels === 1 ? '' : 's'} (25 g)` : ''}. Start eating in the first 15 min.
          </p>
        )}
        {!workout.timeAssumed && !workout.completed && (
          <button onClick={() => setEditing(true)} className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <Pencil size={11} /> Change time
          </button>
        )}
        {f && f.carbPerHour > 0 && <SendFuelToIntervals workout={workout} carbPerHour={f.carbPerHour} />}
      </div>
      <WorkoutTimeSheet open={editing} onClose={() => setEditing(false)} workout={workout} />
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
