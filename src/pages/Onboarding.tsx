import { ArrowRight, Flame, Link2, PlayCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatClock, parseClock } from '../engine/time';
import type { Weekday } from '../engine/types';
import { type LegacyImport, readLegacy } from '../state/migrate';
import { useApp } from '../state/store';
import { LB_PER_KG, fmtRate } from '../ui/format';
import { Button, Field, NumberInput, Segmented, Slider, cx, inputCls } from '../ui/primitives';

type Step = 'welcome' | 'rhythm' | 'goal';

export function Onboarding() {
  const s = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [key, setKey] = useState(s.connection.intervalsKey ?? '');
  const [legacy, setLegacy] = useState<LegacyImport>();
  const { schedule, goals, profile } = s.settings;
  const imperial = profile.units === 'imperial';

  useEffect(() => {
    void readLegacy().then((l) => {
      if (!l) return;
      setLegacy(l);
      if (l.intervalsKey) setKey(l.intervalsKey);
      s.update((st) => ({
        connection: { ...st.connection, athleteId: l.athleteId ?? st.connection.athleteId },
        settings: {
          ...st.settings,
          profile: { ...st.settings.profile, efficiency: l.efficiency ?? st.settings.profile.efficiency },
          nutrition: { ...st.settings.nutrition, proteinGPerKg: l.proteinGPerKg ?? st.settings.nutrition.proteinGPerKg, fatMinGPerKg: l.fatMinGPerKg ?? st.settings.nutrition.fatMinGPerKg },
          goals: { ...st.settings.goals, weeklyRateKg: l.weeklyRateKg ?? st.settings.goals.weeklyRateKg },
        },
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    s.update((st) => ({ connection: { ...st.connection, intervalsKey: key.trim(), mode: 'intervals' } }));
    await s.sync();
    if (!useApp.getState().connection.syncError) setStep('rhythm');
  };

  const finish = () => s.update(() => ({ onboarded: true }));
  const weekdayTime = schedule.defaultTrainingMin[2];
  const weekendTime = schedule.defaultTrainingMin[6];
  const setTraining = (days: Weekday[], v: number) => s.patchSettings('schedule', { defaultTrainingMin: { ...schedule.defaultTrainingMin, ...Object.fromEntries(days.map((d) => [d, v])) } });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60" style={{ background: 'radial-gradient(60% 60% at 50% 0%, rgb(var(--ember) / 0.25), transparent 70%)' }} />
      <div className="safe-top relative mx-auto flex min-h-full max-w-lg flex-col px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] [--pad-top:2.5rem] sm:[--pad-top:4rem]">
        <div className="mb-10 flex items-center gap-2.5">
          <div className="ember-bg grid h-9 w-9 place-items-center rounded-xl text-white shadow-glow">
            <Flame size={20} />
          </div>
          <span className="text-lg font-semibold tracking-tight">Preburner</span>
          <div className="ml-auto flex gap-1">
            {(['welcome', 'rhythm', 'goal'] as Step[]).map((x) => (
              <span key={x} className={cx('h-1.5 w-6 rounded-full', x === step ? 'ember-bg' : 'bg-line')} />
            ))}
          </div>
        </div>

        {step === 'welcome' && (
          <div className="animate-fade-up space-y-6">
            <div>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight">
                Eat for the work <span className="ember-text">you're about to do.</span>
              </h1>
              <p className="mt-3 text-muted">
                Preburner reads your training plan from Intervals.icu and times every meal, snack and bottle around it — fuelled hard days, lean easy days, and a coach that tunes the plan toward your goals.
              </p>
            </div>
            {legacy?.intervalsKey && (
              <div className="flex gap-2 rounded-xl border border-good/30 bg-good/10 p-3 text-sm">
                <Sparkles size={16} className="mt-0.5 shrink-0 text-good" />
                <span>Found your key and preferences from the previous version — just hit connect.</span>
              </div>
            )}
            <div className="card space-y-3 p-5">
              <Field label="Intervals.icu API key" hint={<a className="underline" href="https://intervals.icu/settings" target="_blank" rel="noreferrer">where do I find it?</a>}>
                <input type="password" autoComplete="off" className={cx(inputCls, 'font-mono text-xs')} placeholder="Settings → Developer → API key" value={key} onChange={(e) => setKey(e.target.value)} />
              </Field>
              <Button variant="primary" className="w-full" disabled={!key.trim() || s.syncing} onClick={() => void connect()}>
                {s.syncing ? <RefreshCw size={16} className="animate-spin" /> : <Link2 size={16} />} Connect Intervals.icu
              </Button>
              {s.connection.syncError && <p className="text-sm text-bad">{s.connection.syncError}</p>}
            </div>
            <button
              onClick={() => {
                s.loadDemo();
                setStep('rhythm');
              }}
              className="flex w-full items-center justify-center gap-2 text-sm text-muted hover:text-ink"
            >
              <PlayCircle size={16} /> Explore with demo data first
            </button>
          </div>
        )}

        {step === 'rhythm' && (
          <div className="animate-fade-up space-y-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Your daily rhythm</h1>
              <p className="mt-2 text-muted">Meals are placed around your sessions. TrainerRoad workouts sync without a time, so tell us when you usually ride.</p>
            </div>
            <div className="card grid grid-cols-2 gap-4 p-5">
              {(
                [
                  ['Wake', 'wakeMin'],
                  ['Sleep', 'sleepMin'],
                  ['Lunch', 'lunchMin'],
                  ['Dinner', 'dinnerMin'],
                ] as const
              ).map(([label, k]) => (
                <Field key={k} label={label}>
                  <input type="time" className={cx(inputCls, 'num')} value={formatClock(schedule[k], false)} onChange={(e) => parseClock(e.target.value) !== undefined && s.patchSettings('schedule', { [k]: parseClock(e.target.value)! })} />
                </Field>
              ))}
              <Field label="Weekday rides">
                <input type="time" className={cx(inputCls, 'num')} value={formatClock(weekdayTime, false)} onChange={(e) => parseClock(e.target.value) !== undefined && setTraining([1, 2, 3, 4, 5], parseClock(e.target.value)!)} />
              </Field>
              <Field label="Weekend rides">
                <input type="time" className={cx(inputCls, 'num')} value={formatClock(weekendTime, false)} onChange={(e) => parseClock(e.target.value) !== undefined && setTraining([0, 6], parseClock(e.target.value)!)} />
              </Field>
            </div>
            <Button variant="primary" className="w-full" onClick={() => setStep('goal')}>
              Continue <ArrowRight size={16} />
            </Button>
          </div>
        )}

        {step === 'goal' && (
          <div className="animate-fade-up space-y-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">What are you working toward?</h1>
              <p className="mt-2 text-muted">You can refine all of this later in Settings.</p>
            </div>
            <div className="card space-y-5 p-5">
              <Segmented value={profile.units} onChange={(v) => s.patchSettings('profile', { units: v })} options={[{ value: 'imperial', label: 'lb' }, { value: 'metric', label: 'kg' }]} size="sm" />
              <Field label="Weight change">
                <Slider value={goals.weeklyRateKg ?? 0} min={-0.75} max={0.25} step={0.05} onChange={(v) => s.patchSettings('goals', { weeklyRateKg: v, targetWeightKg: undefined })} format={(v) => (v === 0 ? 'maintain' : fmtRate(v, profile.units))} />
              </Field>
              {s.connection.mode === 'demo' && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Weight">
                    <NumberInput value={Math.round((imperial ? profile.weightKg * LB_PER_KG : profile.weightKg) * 10) / 10} step={0.1} suffix={imperial ? 'lb' : 'kg'} onChange={(v) => v && s.patchSettings('profile', { weightKg: imperial ? v / LB_PER_KG : v })} />
                  </Field>
                  <Field label="FTP">
                    <NumberInput value={profile.ftp} suffix="W" onChange={(v) => v && s.patchSettings('profile', { ftp: v })} />
                  </Field>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Target event">
                  <input className={inputCls} placeholder="optional" value={goals.eventName ?? ''} onChange={(e) => s.patchSettings('goals', { eventName: e.target.value || undefined })} />
                </Field>
                <Field label="Date">
                  <input type="date" className={inputCls} value={goals.eventDate ?? ''} onChange={(e) => s.patchSettings('goals', { eventDate: e.target.value || undefined })} />
                </Field>
              </div>
            </div>
            <Button variant="primary" className="w-full" onClick={finish}>
              Show my plan <ArrowRight size={16} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
