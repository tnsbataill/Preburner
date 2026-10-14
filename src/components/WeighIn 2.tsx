import { Scale } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../state/store';
import { useToday } from '../state/usePlan';
import { LB_PER_KG } from '../ui/format';
import { Button, Card, inputCls } from '../ui/primitives';

export function WeighInCard() {
  const today = useToday();
  const units = useApp((s) => s.settings.profile.units);
  const existing = useApp((s) => s.weights.find((w) => w.date === today));
  const addWeight = useApp((s) => s.addWeight);
  const [value, setValue] = useState('');
  const unit = units === 'imperial' ? 'lb' : 'kg';
  const save = () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    addWeight(today, units === 'imperial' ? n / LB_PER_KG : n);
    setValue('');
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raised text-muted">
        <Scale size={18} />
      </div>
      {existing ? (
        <div className="text-sm">
          Weighed in today:{' '}
          <b className="num">
            {(units === 'imperial' ? existing.kg * LB_PER_KG : existing.kg).toFixed(1)} {unit}
          </b>
          <span className="text-muted"> · {existing.source === 'intervals' ? 'from Intervals' : 'manual'}</span>
        </div>
      ) : (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input className={`${inputCls} num`} inputMode="decimal" placeholder={`Morning weight (${unit})`} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" disabled={!value}>
            Log
          </Button>
        </form>
      )}
    </Card>
  );
}
