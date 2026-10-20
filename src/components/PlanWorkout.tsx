import { CalendarPlus, Flame, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { netExerciseKcal } from '../engine/energy';
import { formatClock, formatDuration, parseClock, weekdayOf } from '../engine/time';
import type { DayPlan } from '../engine/types';
import { workoutForKcal } from '../engine/workout';
import { useApp } from '../state/store';
import { isReplaced } from '../state/training';
import { useEffectiveWorkouts } from '../state/usePlan';
import { INTENSITY_COLOR } from '../ui/format';
import { Button, Card, Chip, Field, NumberInput, SectionTitle, Sheet, inputCls } from '../ui/primitives';

// Sessions the athlete plans in the app, and planned sessions that showed up
// on Intervals after the training plan was made.

/** Plan a ride on a day by its calorie burn and length. Kept locally. */
export function PlanWorkoutSheet({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const profile = useApp((s) => s.settings.profile);
  const schedule = useApp((s) => s.settings.schedule);
  const trainingFtp = useApp((s) => s.training.ftp);
  const add = useApp((s) => s.addLocalWorkout);
  const [kcal, setKcal] = useState<number | undefined>(800);
  const [durationMin, setDurationMin] = useState<number | undefined>(90);
  const [start, setStart] = useState(formatClock(schedule.defaultTrainingMin[weekdayOf(date)], false));
  const [title, setTitle] = useState('');
  const ftp = trainingFtp ?? profile.ftp;
  const valid = !!kcal && kcal >= 50 && !!durationMin && durationMin >= 10;
  const preview = useMemo(
    () => (valid ? workoutForKcal({ id: 'preview', date, kcal: kcal!, durationMin: durationMin!, ftp, efficiency: profile.efficiency }) : undefined),
    [valid, date, kcal, durationMin, ftp, profile.efficiency],
  );
  const net = preview ? Math.round(netExerciseKcal(preview.kj, preview.durationMin, profile)) : 0;
  const save = () => {
    if (!valid) return;
    add(workoutForKcal({ id: `manual-${crypto.randomUUID()}`, date, title, kcal: kcal!, durationMin: durationMin!, ftp, efficiency: profile.efficiency, startMin: parseClock(start) ?? null }));
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Plan a workout">
      <p className="mb-4 text-sm text-muted">Set what you want to burn and for how long. Meals and fuelling for the day are rebuilt around it. It stays in Preburner and isn't sent to Intervals.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Calories burned">
          <NumberInput value={kcal} onChange={setKcal} step={50} min={50} suffix="kcal" aria-label="Calories burned" />
        </Field>
        <Field label="Duration">
          <NumberInput value={durationMin} onChange={setDurationMin} step={15} min={10} suffix="min" aria-label="Duration" />
        </Field>
        <Field label="Start time">
          <input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
        </Field>
        <Field label="Name" hint="optional">
          <input className={inputCls} value={title} placeholder={preview ? `${preview.intensity} ride` : 'Ride'} onChange={(e) => setTitle(e.target.value)} aria-label="Name" />
        </Field>
      </div>
      {preview && (
        <div className="num mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-raised/60 p-3 text-xs text-muted" data-testid="plan-preview">
          <Chip color={INTENSITY_COLOR[preview.intensity]}>{preview.intensity}</Chip>
          <span>{Math.round((preview.kj * 1000) / (preview.durationMin * 60))} W avg</span>
          <span>IF {preview.ifactor.toFixed(2)}</span>
          <span>{preview.kj} kJ</span>
          <span>load {preview.load}</span>
          <span className="basis-full text-faint">
            Adds {net} kcal to the day; the other {kcal! - net} you'd burn at rest in that time anyway.
          </span>
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={save} disabled={!valid}>
          <Plus size={16} /> Add workout
        </Button>
      </div>
    </Sheet>
  );
}

export function PlanWorkoutButton({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <CalendarPlus size={16} /> Plan a workout
      </Button>
      {open && <PlanWorkoutSheet open onClose={() => setOpen(false)} date={date} />}
    </>
  );
}

/** Planned sessions added on Intervals since the plan was made, on this day. */
export function AddedOnIntervalsCard({ day }: { day: DayPlan }) {
  const added = useApp((s) => s.training.addedExternal);
  const ack = useApp((s) => s.acknowledgeAdded);
  const replace = useApp((s) => s.replaceWithAdded);
  const training = useApp((s) => s.training);
  const workouts = useEffectiveWorkouts();
  const fresh = workouts.filter((w) => w.date === day.date && added?.[w.id] && !added[w.id].seen);
  if (!fresh.length) return null;
  // The plan's session that day, whether still local or already on Intervals.
  const planned = training.plan?.sessions.find((x) => x.date === day.date && !isReplaced(training, x));
  return (
    <Card className="border-ember/40 p-4" data-testid="added-on-intervals">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <Flame size={14} className="text-ember" /> New on Intervals
        </span>
      </SectionTitle>
      {fresh.map((w) => (
        <div key={w.id} className="mt-2">
          <div className="font-medium">{w.title}</div>
          <div className="num text-xs text-muted">
            {formatDuration(w.durationMin)} · {w.intensity} · {w.kj} kJ
          </div>
          <p className="mt-1.5 text-sm text-muted">
            It isn't part of your plan, so it's been added to the day{planned ? ` alongside ${planned.title}. Fuelling counts both until you choose` : ''}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {planned && (
              <Button variant="primary" onClick={() => replace(w.id)}>
                Ride it instead
              </Button>
            )}
            <Button variant={planned ? 'outline' : 'primary'} onClick={() => ack(w.id)}>
              {planned ? 'Ride both' : 'Keep it'}
            </Button>
            <Button variant="ghost" onClick={() => ack(w.id, true)}>
              Leave it out
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
