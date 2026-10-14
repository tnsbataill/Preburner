import { useState } from 'react';
import { formatClock, parseClock } from '../engine/time';
import type { ResolvedWorkout } from '../engine/scheduler';
import { useApp } from '../state/store';
import { Button, Field, Sheet, inputCls } from '../ui/primitives';

const QUICK = [6 * 60, 7 * 60, 12 * 60, 17 * 60 + 30, 18 * 60 + 30];

export function WorkoutTimeSheet({ open, onClose, workout }: { open: boolean; onClose: () => void; workout: ResolvedWorkout }) {
  const setTime = useApp((s) => s.setWorkoutTime);
  const hasOverride = useApp((s) => s.timeOverrides[workout.id] !== undefined);
  const [value, setValue] = useState(formatClock(workout.resolvedStartMin, false));
  const save = (min: number | null) => {
    setTime(workout.id, min);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`When are you riding ${workout.title}?`}>
      <p className="mb-4 text-sm text-muted">
        Meal timing is built around the start time. TrainerRoad syncs to Intervals without a time, so tell Preburner when you'll actually ride.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK.map((m) => (
          <button key={m} onClick={() => save(m)} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:border-ember/60 hover:text-ember">
            {formatClock(m)}
          </button>
        ))}
      </div>
      <Field label="Start time">
        <input type="time" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <div className="mt-5 flex justify-between gap-2">
        {hasOverride ? (
          <Button variant="ghost" onClick={() => save(null)}>
            Reset to default
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={() => save(parseClock(value) ?? workout.resolvedStartMin)}>
          Save time
        </Button>
      </div>
    </Sheet>
  );
}
