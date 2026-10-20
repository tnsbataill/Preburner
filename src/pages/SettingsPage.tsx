import { CheckCircle2, Download, Eye, EyeOff, Link2, RefreshCw, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { EFFICIENCY_PRESETS, NEAT_PRESETS } from '../engine/defaults';
import { formatClock, parseClock } from '../engine/time';
import type { Weekday } from '../engine/types';
import { AppleHealthImport } from '../components/AppleHealthImport';
import { IntervalsKeyHelp } from '../components/IntervalsKeyHelp';
import { useTour } from '../components/Tour';
import { type Theme, useApp } from '../state/store';
import { LB_PER_KG, fmtRate } from '../ui/format';
import { Button, Card, ConfirmButton, cx, Field, inputCls, NumberInput, Segmented, Slider, Toggle } from '../ui/primitives';

const SECTIONS = [
  ['connections', 'Connections'],
  ['health', 'Apple Health'],
  ['profile', 'Profile'],
  ['schedule', 'Daily rhythm'],
  ['goals', 'Goals'],
  ['nutrition', 'Fuelling'],
  ['app', 'App & data'],
] as const;

function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24 p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </Card>
  );
}

function TimeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input type="time" className={cx(inputCls, 'num')} value={formatClock(value, false)} onChange={(e) => parseClock(e.target.value) !== undefined && onChange(parseClock(e.target.value)!)} />;
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} className={cx(inputCls, 'pr-10 font-mono text-xs')} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink" aria-label={show ? 'Hide' : 'Show'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

const WEEKDAYS: Array<[Weekday, string]> = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];

export function SettingsPage() {
  const s = useApp();
  const { profile, schedule, nutrition, goals } = s.settings;
  const imperial = profile.units === 'imperial';
  const [keyDraft, setKeyDraft] = useState(s.connection.intervalsKey ?? '');
  const [anthropicDraft, setAnthropicDraft] = useState(s.connection.anthropicKey ?? '');

  useEffect(() => {
    const section = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('section');
    if (section) document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const connect = async () => {
    s.update((st) => ({ connection: { ...st.connection, intervalsKey: keyDraft.trim(), mode: 'intervals' } }));
    await s.sync();
  };

  const exportData = () => {
    const raw = localStorage.getItem('preburner-v2') ?? '{}';
    const parsed = JSON.parse(raw);
    // Never put secrets in an export file.
    if (parsed.state?.connection) {
      delete parsed.state.connection.intervalsKey;
      delete parsed.state.connection.anthropicKey;
    }
    const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `preburner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const importData = (file: File) => {
    void file.text().then((text) => {
      const parsed = JSON.parse(text);
      const cur = JSON.parse(localStorage.getItem('preburner-v2') ?? '{}');
      parsed.state.connection = { ...parsed.state.connection, intervalsKey: cur.state?.connection?.intervalsKey, anthropicKey: cur.state?.connection?.anthropicKey };
      localStorage.setItem('preburner-v2', JSON.stringify(parsed));
      window.location.reload();
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="label mb-1">Preferences</div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
      </div>
      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink">
            {label}
          </button>
        ))}
      </div>

      <Section id="connections" title="Connections" desc="Keys are stored only in this browser and sent only to Intervals.icu and Anthropic.">
        <div className="space-y-3">
          <Field label="Intervals.icu API key" action={<IntervalsKeyHelp onKey={setKeyDraft} />}>
            <SecretInput value={keyDraft} onChange={setKeyDraft} placeholder="paste your personal API key" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!keyDraft.trim() || s.syncing} onClick={() => void connect()}>
              {s.syncing ? <RefreshCw size={16} className="animate-spin" /> : <Link2 size={16} />}
              {s.connection.mode === 'intervals' ? 'Save & sync' : 'Connect'}
            </Button>
            {s.connection.mode === 'intervals' ? (
              <Button variant="ghost" onClick={() => s.loadDemo()}>
                Switch to demo data
              </Button>
            ) : (
              <span className="text-xs text-muted">Currently showing demo data.</span>
            )}
          </div>
          {s.connection.syncError && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{s.connection.syncError}</p>}
          {s.connection.mode === 'intervals' && s.connection.lastSync && !s.connection.syncError && (
            <div className="rounded-xl bg-raised/60 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-good">
                <CheckCircle2 size={16} /> Connected{profile.name ? ` as ${profile.name}` : ''}
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                {s.connection.syncLog?.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-3 border-t border-line pt-5">
          <Field label="Anthropic API key (for the Coach)" hint={<a className="underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>}>
            <SecretInput value={anthropicDraft} onChange={setAnthropicDraft} placeholder="sk-ant-…" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={anthropicDraft === (s.connection.anthropicKey ?? '')} onClick={() => s.update((st) => ({ connection: { ...st.connection, anthropicKey: anthropicDraft.trim() || undefined } }))}>
              Save key
            </Button>
            <Segmented
              size="sm"
              value={s.connection.coachModel}
              onChange={(v) => s.update((st) => ({ connection: { ...st.connection, coachModel: v } }))}
              options={[
                { value: 'claude-opus-5-5', label: 'Opus 5.5' },
                { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section id="health" title="Apple Health" desc="Weight, body fat, resting HR, HRV and sleep from the Health app's export.">
        <AppleHealthImport />
      </Section>

      <Section id="profile" title="Profile" desc={s.connection.mode === 'intervals' ? 'FTP, weight, height, sex and age sync from Intervals.icu; edits here are overwritten on the next sync.' : undefined}>
        <div className="flex flex-wrap gap-3">
          <Segmented value={profile.units} onChange={(v) => s.patchSettings('profile', { units: v })} options={[{ value: 'imperial', label: 'lb / ft' }, { value: 'metric', label: 'kg / cm' }]} />
          <Segmented value={profile.sex} onChange={(v) => s.patchSettings('profile', { sex: v })} options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Weight">
            <NumberInput value={Math.round((imperial ? profile.weightKg * LB_PER_KG : profile.weightKg) * 10) / 10} step={0.1} suffix={imperial ? 'lb' : 'kg'} onChange={(v) => v && s.patchSettings('profile', { weightKg: imperial ? v / LB_PER_KG : v })} />
          </Field>
          <Field label="Height">
            <NumberInput value={imperial ? Math.round((profile.heightCm / 2.54) * 10) / 10 : profile.heightCm} step={0.5} suffix={imperial ? 'in' : 'cm'} onChange={(v) => v && s.patchSettings('profile', { heightCm: imperial ? v * 2.54 : v })} />
          </Field>
          <Field label="Age">
            <NumberInput value={profile.ageYears} suffix="yrs" onChange={(v) => v && s.patchSettings('profile', { ageYears: v })} />
          </Field>
          <Field label="FTP">
            <NumberInput value={profile.ftp} suffix="W" onChange={(v) => v && s.patchSettings('profile', { ftp: v })} />
          </Field>
          <Field label="Body fat" hint="optional — improves resting estimate">
            <NumberInput value={profile.bodyFatPct} step={0.5} suffix="%" onChange={(v) => s.patchSettings('profile', { bodyFatPct: v })} />
          </Field>
        </div>
        <Field label="Riding efficiency" hint="how much food energy becomes watts">
          <Segmented value={String(profile.efficiency)} onChange={(v) => s.patchSettings('profile', { efficiency: Number(v) })} options={EFFICIENCY_PRESETS.map((p) => ({ value: String(p.value), label: p.label }))} size="sm" />
        </Field>
        <Field label="Daily life (outside training)">
          <select className={inputCls} value={profile.neatFactor} onChange={(e) => s.patchSettings('profile', { neatFactor: Number(e.target.value) })}>
            {NEAT_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} (×{p.value})
              </option>
            ))}
            {!NEAT_PRESETS.some((p) => p.value === profile.neatFactor) && <option value={profile.neatFactor}>Custom ×{profile.neatFactor}</option>}
          </select>
        </Field>
      </Section>

      <Section id="schedule" title="Daily rhythm" desc="Meal timing is built around these. TrainerRoad workouts arrive without a time, so set when you usually ride each day.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Field label="Wake">
            <TimeInput value={schedule.wakeMin} onChange={(v) => s.patchSettings('schedule', { wakeMin: v })} />
          </Field>
          <Field label="Breakfast">
            <TimeInput value={schedule.breakfastMin} onChange={(v) => s.patchSettings('schedule', { breakfastMin: v })} />
          </Field>
          <Field label="Lunch">
            <TimeInput value={schedule.lunchMin} onChange={(v) => s.patchSettings('schedule', { lunchMin: v })} />
          </Field>
          <Field label="Dinner">
            <TimeInput value={schedule.dinnerMin} onChange={(v) => s.patchSettings('schedule', { dinnerMin: v })} />
          </Field>
          <Field label="Sleep">
            <TimeInput value={schedule.sleepMin} onChange={(v) => s.patchSettings('schedule', { sleepMin: v })} />
          </Field>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Usual training start</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {WEEKDAYS.map(([wd, label]) => (
              <label key={wd} className="block">
                <span className="mb-1 block text-xs text-muted">{label}</span>
                <TimeInput value={schedule.defaultTrainingMin[wd]} onChange={(v) => s.patchSettings('schedule', { defaultTrainingMin: { ...schedule.defaultTrainingMin, [wd]: v } })} />
              </label>
            ))}
          </div>
        </div>
        <Toggle checked={schedule.preSleepProtein} onChange={(v) => s.patchSettings('schedule', { preSleepProtein: v })} label="Pre-sleep protein snack" />
      </Section>

      <Section id="goals" title="Goals" desc="Weight changes are paced safely and kept off key training days.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target weight">
            <NumberInput
              value={goals.targetWeightKg ? Math.round((imperial ? goals.targetWeightKg * LB_PER_KG : goals.targetWeightKg) * 10) / 10 : undefined}
              step={0.1}
              suffix={imperial ? 'lb' : 'kg'}
              placeholder="optional"
              onChange={(v) => s.patchSettings('goals', { targetWeightKg: v ? (imperial ? v / LB_PER_KG : v) : undefined, weeklyRateKg: v ? undefined : goals.weeklyRateKg })}
            />
          </Field>
          <Field label="By">
            <input type="date" className={inputCls} value={goals.targetWeightDate ?? ''} onChange={(e) => s.patchSettings('goals', { targetWeightDate: e.target.value || undefined, weeklyRateKg: e.target.value && goals.targetWeightKg ? undefined : goals.weeklyRateKg })} />
          </Field>
        </div>
        {!(goals.targetWeightKg && goals.targetWeightDate) && (
          <Field label="Or a fixed weekly rate">
            <Slider value={goals.weeklyRateKg ?? 0} min={-1} max={0.5} step={0.05} onChange={(v) => s.patchSettings('goals', { weeklyRateKg: v })} format={(v) => fmtRate(v, profile.units)} />
          </Field>
        )}
        <Field label="Max deficit on any day">
          <Slider value={goals.maxDailyDeficit} min={200} max={1000} step={50} onChange={(v) => s.patchSettings('goals', { maxDailyDeficit: v })} format={(v) => `${v} kcal`} />
        </Field>
        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <Field label="Target event">
            <input className={inputCls} placeholder="e.g. Unbound 100" value={goals.eventName ?? ''} onChange={(e) => s.patchSettings('goals', { eventName: e.target.value || undefined })} />
          </Field>
          <Field label="Event date">
            <input type="date" className={inputCls} value={goals.eventDate ?? ''} onChange={(e) => s.patchSettings('goals', { eventDate: e.target.value || undefined })} />
          </Field>
          <Field label="Target fitness (CTL)">
            <NumberInput value={goals.targetCtl} placeholder="e.g. 85" onChange={(v) => s.patchSettings('goals', { targetCtl: v })} />
          </Field>
          <Field label="Target form on the day (TSB)">
            <NumberInput value={goals.targetTsb} placeholder="e.g. 10" onChange={(v) => s.patchSettings('goals', { targetTsb: v })} />
          </Field>
          <Field label="Target FTP">
            <NumberInput value={goals.targetFtp} suffix="W" placeholder="optional" onChange={(v) => s.patchSettings('goals', { targetFtp: v })} />
          </Field>
          <Field label="Max fitness ramp">
            <Slider value={goals.maxRampPerWeek} min={3} max={10} step={0.5} onChange={(v) => s.patchSettings('goals', { maxRampPerWeek: v })} format={(v) => `${v} CTL/wk`} />
          </Field>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">Hours available to train</div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WEEKDAYS.map(([wd, label]) => (
              <label key={wd} className="block">
                <span className="mb-1 block text-xs text-muted">{label}</span>
                <NumberInput value={goals.availabilityHours[wd]} step={0.25} min={0} onChange={(v) => s.patchSettings('goals', { availabilityHours: { ...goals.availabilityHours, [wd]: v ?? 0 } })} />
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section id="nutrition" title="Fuelling" desc="Defaults follow ACSM/IOC guidance. Change them only if you know your numbers.">
        <Field label="Protein">
          <Slider value={nutrition.proteinGPerKg} min={1.2} max={2.6} step={0.1} onChange={(v) => s.patchSettings('nutrition', { proteinGPerKg: v })} format={(v) => `${v.toFixed(1)} g/kg`} />
        </Field>
        <Field label="Fat floor">
          <Slider value={nutrition.fatMinGPerKg} min={0.5} max={1.2} step={0.05} onChange={(v) => s.patchSettings('nutrition', { fatMinGPerKg: v })} format={(v) => `${v.toFixed(2)} g/kg`} />
        </Field>
        <Field label="Baseline carbs on a rest day">
          <Slider value={nutrition.baseCarbGPerKg} min={2} max={5} step={0.25} onChange={(v) => s.patchSettings('nutrition', { baseCarbGPerKg: v })} format={(v) => `${v} g/kg`} />
        </Field>
        <Field label="Max carbs per hour (trained gut)">
          <Slider value={nutrition.maxCarbPerHour} min={40} max={120} step={5} onChange={(v) => s.patchSettings('nutrition', { maxCarbPerHour: v })} format={(v) => `${v} g/h`} />
        </Field>
        <Field label="Sweat rate">
          <Slider value={nutrition.sweatRateLPerH} min={0.4} max={2} step={0.1} onChange={(v) => s.patchSettings('nutrition', { sweatRateLPerH: v })} format={(v) => `${v.toFixed(1)} L/h`} />
        </Field>
        <Field label="Sweat sodium">
          <Slider value={nutrition.sodiumMgPerL} min={300} max={1500} step={50} onChange={(v) => s.patchSettings('nutrition', { sodiumMgPerL: v })} format={(v) => `${v} mg/L`} />
        </Field>
      </Section>

      <Section id="app" title="App & data">
        <Field label="Theme">
          <Segmented<Theme> value={s.theme} onChange={(v) => s.update(() => ({ theme: v }))} options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportData}>
            <Download size={16} /> Export backup
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-raised">
            <Upload size={16} /> Import
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          </label>
          <Button variant="ghost" onClick={() => useTour.getState().start()}>
            Take the tour
          </Button>
          <Button variant="ghost" onClick={() => s.update(() => ({ onboarded: false }))}>
            Re-run setup
          </Button>
          <ConfirmButton message="Reset all Preburner data in this browser? Intervals.icu isn't affected." confirmLabel="Reset" onConfirm={() => s.resetAll()}>
            Reset everything
          </ConfirmButton>
        </div>
      </Section>
    </div>
  );
}
