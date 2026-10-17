import { ChevronDown, CloudUpload, FileArchive, Gauge, Loader2, RefreshCw, Sparkles, Trash2, TrendingUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { navigate } from '../App';
import { AdjustmentRow, DebriefPrompt, FeedbackPrompt, NoDataNotice, ReadinessCard } from '../components/TrainingCards';
import { addDays, diffDays, formatDate, formatDuration, weekStartOf, weekdayOf, weekdayShort } from '../engine/time';
import { useApp } from '../state/store';
import { trainingSnapshot } from '../state/store';
import { historyRides, trainingWellness } from '../state/training';
import { useToday } from '../state/usePlan';
import { analyzeHistory } from '../training/planner';
import { planEnd } from '../training/generator';
import type { Objective, PlanWeek, PlannedSession, SessionKind, TrainingPlan } from '../training/types';
import { Button, Card, Chip, ConfirmButton, cx, inputCls, SectionTitle, Segmented, Stat } from '../ui/primitives';

const KIND_COLOR: Record<SessionKind, string> = {
  recovery: 'rgb(var(--i-recovery))',
  endurance: 'rgb(var(--i-endurance))',
  long: 'rgb(var(--i-endurance))',
  tempo: 'rgb(var(--i-tempo))',
  sweetspot: 'rgb(var(--i-threshold))',
  threshold: 'rgb(var(--i-threshold))',
  overunder: 'rgb(var(--i-threshold))',
  vo2: 'rgb(var(--i-vo2))',
  anaerobic: 'rgb(var(--i-vo2))',
  openers: 'rgb(var(--i-tempo))',
  ftptest: 'rgb(var(--i-race))',
};

const PHASE_LABEL: Record<PlanWeek['phase'], string> = { base: 'Base', build: 'Build', recovery: 'Recovery', taper: 'Taper', test: 'Test' };
const OBJECTIVES: Array<{ value: Objective; label: string }> = [
  { value: 'ftp', label: 'Raise FTP' },
  { value: 'event', label: 'Peak for event' },
  { value: 'ctl', label: 'Build fitness' },
];
const DURATIONS = [4, 6, 8, 10, 12, 16, 20, 24];

function nextMonday(today: string): string {
  const wd = weekdayOf(today);
  return wd === 1 ? today : addDays(weekStartOf(today), 7);
}

function DataCard() {
  const training = useApp((s) => s.training);
  const mode = useApp((s) => s.connection.mode);
  const importStrava = useApp((s) => s.importStrava);
  const importHistoryJson = useApp((s) => s.importHistoryJson);
  const [progress, setProgress] = useState<number | undefined>();
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const rides = useMemo(() => historyRides(training), [training]);
  const withPower = rides.filter((r) => r.best20).length;
  const withRpe = rides.filter((r) => r.rpe !== undefined).length;
  const hrvDays = useMemo(() => trainingWellness(training).filter((w) => w.lnRmssd !== undefined || w.lnSdnn !== undefined).length, [training]);
  const onFile = async (f: File) => {
    setError(undefined);
    setProgress(0);
    try {
      if (f.name.toLowerCase().endsWith('.json')) await importHistoryJson(f);
      else await importStrava(f, setProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(undefined);
    }
  };
  return (
    <Card className="p-5">
      <SectionTitle>Your training history</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Rides" value={rides.length} sub={rides.length ? `${formatDate(rides[0].date)} – ${formatDate(rides.at(-1)!.date)}` : 'none yet'} />
        <Stat label="With power" value={withPower} />
        <Stat label="With RPE" value={withRpe} />
        <Stat label="HRV days" value={hrvDays} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".zip,.json,application/zip,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} data-testid="strava-file" />
        <Button onClick={() => fileRef.current?.click()} disabled={progress !== undefined}>
          {progress !== undefined ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />}
          {progress !== undefined ? `Reading… ${Math.round(progress * 100)}%` : training.stravaReport ? 'Re-import history' : 'Import Strava archive or history file'}
        </Button>
        {training.stravaReport && (
          <span className="text-xs text-muted">
            {training.stravaReport.rides} Strava rides imported {formatDate(training.stravaReport.importedAt.slice(0, 10))}
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <p className="mt-3 text-xs text-muted">
        {mode === 'demo' ? 'Demo mode uses a simulated year of riding. ' : 'Intervals.icu supplies recent rides, RPE, feel and HRV. '}
        Strava-sourced rides can't come through the Intervals API, so for your full history use Strava → Settings → My Account → Download your archive, then import the zip here. It's read in your browser; only per-ride summaries are kept.
      </p>
    </Card>
  );
}

/** Model fit + best-build analysis of the current history (memoised). */
function useHistoryAnalysis() {
  const training = useApp((s) => s.training);
  const settings = useApp((s) => s.settings);
  const today = useToday();
  return useMemo(() => {
    const snap = trainingSnapshot({ training, settings }, today);
    if (snap.rides.length < 20) return undefined;
    try {
      return analyzeHistory(snap, 'core', 1);
    } catch {
      return undefined;
    }
  }, [training.stravaRides, training.intervalsRides, settings.profile.ftp, today]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ModelCard() {
  const settings = useApp((s) => s.settings);
  const analysis = useHistoryAnalysis();
  if (!analysis) return null;
  const k1 = analysis.fit.params.k1;
  const resp = k1 > 1.9 ? 'above typical' : k1 < 1.3 ? 'below typical' : 'typical';
  return (
    <Card className="p-5" data-testid="model-card">
      <SectionTitle>What your history says</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Estimated FTP" value={analysis.ftpEstimate} unit="W" sub={`set: ${settings.profile.ftp} W`} />
        <Stat label="Fitness (CTL)" value={Math.round(analysis.ctl)} sub={`form ${Math.round(analysis.ctl - analysis.atl)}`} />
        <Stat label="Response to load" value={resp} sub={`fitness τ ${Math.round(analysis.fit.params.tau1)} d`} />
        <Stat label="Max efforts" value={analysis.fit.nObs.test + analysis.fit.nObs.max} sub={analysis.daysSinceMaxEffort === undefined ? 'none recently' : analysis.daysSinceMaxEffort === 0 ? 'last: today' : `last ${analysis.daysSinceMaxEffort} d ago`} />
      </div>
    </Card>
  );
}

function SetupCard({ onDone }: { onDone?: () => void }) {
  const today = useToday();
  const goals = useApp((s) => s.settings.goals);
  const generate = useApp((s) => s.generateTrainingPlan);
  const training = useApp((s) => s.training);
  const [objective, setObjective] = useState<Objective>('ftp');
  const [weeks, setWeeks] = useState(12);
  const [start, setStart] = useState(nextMonday(today));
  const [eventDate, setEventDate] = useState(goals.eventDate ?? addDays(today, 70));
  const [optimize, setOptimize] = useState(true);
  const analysis = useHistoryAnalysis();
  const best = analysis?.bestBuilds;
  const [useBest, setUseBest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const rides = historyRides(training).length;
  const hours = Object.values(goals.availabilityHours).reduce((a, b) => a + b, 0);
  const run = () => {
    setBusy(true);
    setError(undefined);
    // Let the spinner paint before the (synchronous) optimiser runs.
    setTimeout(() => {
      try {
        generate({ objective, weeks, start, eventDate: objective === 'event' ? eventDate : undefined, optimize, useBestBuilds: optimize && useBest && !!best });
        onDone?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }, 30);
  };
  return (
    <Card className="p-5">
      <SectionTitle>New plan</SectionTitle>
      <div className="space-y-4">
        <div>
          <div className="label mb-1.5">Goal</div>
          <Segmented value={objective} options={OBJECTIVES} onChange={setObjective} />
        </div>
        <div className="flex flex-wrap gap-4">
          {objective === 'event' ? (
            <label className="block">
              <span className="label mb-1.5 block">Event date</span>
              <input type="date" className={cx(inputCls, 'num min-h-[2.5rem]')} value={eventDate} min={addDays(start, 21)} onChange={(e) => setEventDate(e.target.value)} />
            </label>
          ) : (
            <label className="block">
              <span className="label mb-1.5 block">Length</span>
              <select className={cx(inputCls, 'num min-h-[2.5rem]')} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Plan length in weeks">
                {DURATIONS.map((w) => (
                  <option key={w} value={w}>
                    {w} weeks
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="label mb-1.5 block">Start</span>
            <input type="date" className={cx(inputCls, 'num min-h-[2.5rem]')} value={start} min={today} onChange={(e) => setStart(e.target.value)} />
          </label>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
          <input type="checkbox" className="mt-1" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
          <span>
            <span className="font-medium">Optimise for me</span>
            <span className="block text-sm text-muted">
              Search ~150 plan shapes (ramp, recovery rhythm, intensity mix, hard days per week) against a model fitted to your own history and pick the one projected to raise{' '}
              {objective === 'ftp' ? 'your FTP most' : objective === 'event' ? 'performance most on event day' : 'fitness most'}. Off: a standard progression.
            </span>
          </span>
        </label>
        {optimize && best && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ember/40 bg-ember/5 p-3" data-testid="best-builds">
            <input type="checkbox" className="mt-1" checked={useBest} onChange={(e) => setUseBest(e.target.checked)} />
            <span>
              <span className="font-medium">Shape it like your best builds</span>
              <span className="block text-sm text-muted">{best.summary} Keep that intensity mix instead of the generic one.</span>
            </span>
          </label>
        )}
        <p className="text-xs text-muted">
          Uses your availability ({hours.toFixed(1)} h/week,{' '}
          <button className="underline" onClick={() => navigate('settings', 'section=goals')}>
            edit
          </button>
          ) and {rides} rides of history. Hard sessions are never back to back, and the weekly ramp stays within your {goals.maxRampPerWeek} CTL/week limit.
        </p>
        {error && <p className="text-sm text-bad">{error}</p>}
        <Button variant="primary" onClick={run} disabled={busy} data-testid="generate-plan">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {busy ? 'Building your plan…' : 'Generate plan'}
        </Button>
      </div>
    </Card>
  );
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;

function ProjectionChart({ plan }: { plan: TrainingPlan }) {
  const noEvidence = !!plan.projection?.noFtpEvidence;
  const daily = plan.projection?.daily ?? [];
  if (daily.length < 2) return null;
  const W = 600;
  const H = 150;
  const pad = 28;
  // Daily model output wobbles with each session's fatigue; show the trend.
  const perfs = daily.map((_, i) => {
    const win = daily.slice(Math.max(0, i - 3), i + 4);
    return i === daily.length - 1 ? daily[i].perf : win.reduce((a, d) => a + d.perf, 0) / win.length;
  });
  const ctls = daily.map((d) => d.ctl);
  const pMin = Math.min(...perfs) - 3;
  const pMax = Math.max(...perfs, plan.projection!.finalFtp.p90) + 3;
  const cMax = Math.max(...ctls) * 1.1;
  const x = (i: number) => pad + (i / (daily.length - 1)) * (W - pad * 2);
  const yp = (v: number) => H - pad - ((v - pMin) / (pMax - pMin)) * (H - pad * 2);
  const yc = (v: number) => H - pad - (v / cMax) * (H - pad * 2);
  const line = (vals: number[], y: (v: number) => number) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label="Projected FTP and fitness over the plan">
      <path d={line(ctls, yc)} fill="none" stroke="rgb(var(--i-endurance))" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={line(perfs, yp)} fill="none" stroke="rgb(var(--ember))" strokeWidth={2.2} />
      <text x={pad} y={14} className="fill-[rgb(var(--ember))] text-[11px]">
        {noEvidence ? 'Projected FTP (relative)' : 'Projected FTP (W)'}
      </text>
      <text x={W - pad} y={14} textAnchor="end" className="fill-[rgb(var(--i-endurance))] text-[11px]">
        Fitness (CTL)
      </text>
      <text x={pad - 4} y={yp(perfs[0])} textAnchor="end" dominantBaseline="middle" className="fill-[rgb(var(--muted))] text-[10px]">
        {noEvidence ? '' : Math.round(perfs[0])}
      </text>
      <text x={W - pad + 4} y={yp(perfs.at(-1)!)} dominantBaseline="middle" className="fill-[rgb(var(--ember))] text-[10px] font-semibold">
        {noEvidence ? pct(plan.projection!.finalFtp.p50 / plan.projection!.startFtp - 1) : Math.round(perfs.at(-1)!)}
      </text>
    </svg>
  );
}

/** Time in each intensity band, from the sessions' steps (same cut-offs as the bars). */
function weekBreakdown(ss: PlannedSession[]) {
  const t = { low: 0, mid: 0, high: 0 };
  for (const s of ss)
    for (const st of s.steps) {
      const x = (st.lo + st.hi) / 2;
      t[x < 0.76 ? 'low' : x <= 1.05 ? 'mid' : 'high'] += st.durationS / 60;
    }
  return t;
}

const BANDS = [
  { key: 'low', label: 'Endurance', color: 'rgb(var(--i-endurance))' },
  { key: 'mid', label: 'Tempo–threshold', color: 'rgb(var(--i-threshold))' },
  { key: 'high', label: 'VO2 and above', color: 'rgb(var(--i-vo2))' },
] as const;

function WeekBars({ plan }: { plan: TrainingPlan }) {
  const max = Math.max(...plan.weeks.map((w) => Math.max(w.plannedTss, w.targetTss)), 1);
  const [active, setActive] = useState<number>();
  const n = plan.weeks.length;
  return (
    <div className="relative flex h-32 items-end gap-1.5" role="list" aria-label="Weekly load by intensity" onMouseLeave={() => setActive(undefined)}>
      {plan.weeks.map((w, i) => {
        const ss = plan.sessions.filter((s) => s.date >= w.start && s.date < addDays(w.start, 7));
        const d = ss.reduce((a, s) => ({ low: a.low + s.domain.low, mid: a.mid + s.domain.mid, high: a.high + s.domain.high }), { low: 0, mid: 0, high: 0 });
        const h = (v: number) => `${(v / max) * 100}%`;
        const open = active === i;
        const time = open ? weekBreakdown(ss) : undefined;
        const total = time ? time.low + time.mid + time.high : 0;
        const hard = ss.filter((s) => s.hard);
        // Keep the card inside the chart at the edges.
        const place = i < 2 ? 'left-0' : i > n - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2';
        return (
          <div
            key={w.index}
            role="listitem"
            tabIndex={0}
            aria-label={`Week ${w.index + 1}, ${PHASE_LABEL[w.phase]}: ${w.hours} hours, ${w.plannedTss} TSS`}
            className="relative flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end gap-1 outline-none"
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(undefined)}
            // A tap fires hover, focus and click together: open, never toggle shut.
            // Tapping elsewhere blurs it closed.
            onClick={() => setActive(i)}
            data-testid="week-bar"
          >
            <div className={cx('flex w-full flex-1 flex-col justify-end overflow-hidden rounded-md transition', active !== undefined && !open && 'opacity-50')}>
              <div style={{ height: h(d.high), background: 'rgb(var(--i-vo2))' }} />
              <div style={{ height: h(d.mid), background: 'rgb(var(--i-threshold))' }} />
              <div style={{ height: h(d.low), background: 'rgb(var(--i-endurance) / 0.7)' }} />
            </div>
            <div className={cx('text-[9px] font-semibold uppercase max-sm:text-[7px]', w.phase === 'recovery' || w.phase === 'taper' || w.phase === 'test' ? 'text-good' : 'text-muted')}>{PHASE_LABEL[w.phase].slice(0, 3)}</div>
            {open && time && (
              <div role="tooltip" className={cx('pointer-events-none absolute bottom-full z-20 mb-2 w-56 rounded-xl border border-line bg-surface p-3 text-left shadow-lg', place)} data-testid="week-tooltip">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">
                    Week {w.index + 1} · {PHASE_LABEL[w.phase]}
                  </span>
                  <span className="text-[11px] text-muted">{formatDate(w.start)}</span>
                </div>
                <div className="num mt-1 text-sm">
                  <b className="font-semibold">{formatDuration(Math.round(total))}</b>
                  <span className="text-muted"> · {w.plannedTss} TSS</span>
                </div>
                <ul className="num mt-2 space-y-1 text-xs">
                  {BANDS.map((b) => (
                    <li key={b.key} className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: b.color }} />
                      <span className="flex-1 text-muted">{b.label}</span>
                      <span>{formatDuration(Math.round(time[b.key]))}</span>
                      <span className="w-8 text-right text-faint">{total ? Math.round((time[b.key] / total) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
                {hard.length > 0 && (
                  <div className="mt-2 border-t border-line/70 pt-2 text-[11px] text-muted">
                    {hard.map((s) => (
                      <div key={s.id} className="truncate">
                        {weekdayShort(s.date)} · {s.title}
                      </div>
                    ))}
                  </div>
                )}
                {w.availabilityLimited && <div className="mt-1.5 text-[11px] text-warn">Capped by your available hours</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SessionRow({ s, today }: { s: PlannedSession; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cx('rounded-xl border border-line/70', s.date < today && 'opacity-60', s.date === today && 'border-ember/50')}>
      <button className="flex w-full items-center gap-3 p-2.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="w-9 shrink-0 text-center">
          <span className="block text-[10px] font-semibold uppercase text-muted">{weekdayShort(s.date)}</span>
          <span className="num block text-sm font-semibold">{Number(s.date.slice(8))}</span>
        </span>
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: KIND_COLOR[s.kind] }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{s.title}</span>
          <span className="num block text-[11px] text-muted">
            {formatDuration(s.durationMin)} · {s.tss} TSS · IF {s.ifactor.toFixed(2)}
            {s.plannedLevel !== undefined && s.plannedLevel !== s.level && <span className="text-ember"> · adjusted</span>}
          </span>
        </span>
        <ChevronDown size={16} className={cx('shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line/70 p-3 text-sm">
          <p className="text-muted">{s.purpose}</p>
          <pre className="num mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-raised/70 p-2 text-[11px] leading-relaxed">{s.structure}</pre>
        </div>
      )}
    </li>
  );
}

function FtpSuggestion() {
  const sug = useApp((s) => s.training.ftpSuggestion)!;
  const update = useApp((s) => s.update);
  return (
    <div className="mt-3 rounded-xl border border-ember/40 bg-ember/10 p-3 text-sm" data-testid="ftp-suggestion">
      <div className="font-semibold">Suggested FTP: {sug.ftp} W</div>
      <p className="mt-0.5 text-muted">
        {sug.reason}. Your workouts' targets are worked out from the FTP in Intervals.icu, so change it there (Settings → Cycling → FTP), and in TrainerRoad if you ride its workouts. Preburner picks it up on the next sync.
      </p>
      <Button variant="ghost" className="mt-1 px-2 py-1 text-xs" onClick={() => update((s) => ({ training: { ...s.training, ftpSuggestion: undefined } }))}>
        Dismiss
      </Button>
    </div>
  );
}

function PlanView({ plan }: { plan: TrainingPlan }) {
  const today = useToday();
  const training = useApp((s) => s.training);
  const mode = useApp((s) => s.connection.mode);
  const apply = useApp((s) => s.applyTrainingPlan);
  const discard = useApp((s) => s.discardTrainingPlan);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [openWeek, setOpenWeek] = useState(() => Math.max(0, Math.min(plan.weeks.length - 1, Math.floor(diffDays(plan.request.start, today) / 7))));
  const proj = plan.projection;
  const end = planEnd(plan);
  const pending = training.appliedAt ? training.dirtyIds.length : plan.sessions.filter((s) => s.date >= today).length;
  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };
  const objectiveLabel = OBJECTIVES.find((o) => o.value === plan.request.objective)?.label;
  return (
    <div className="space-y-4">
      <Card className="p-5" data-testid="plan-summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="label mb-1">
              {objectiveLabel} · {plan.request.weeks} weeks
            </div>
            <div className="text-lg font-semibold">
              {formatDate(plan.request.start)} – {formatDate(end)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(!training.appliedAt || training.dirtyIds.length > 0) && (
              <Button variant="primary" disabled={!!busy} onClick={() => void act('apply', apply)} data-testid="apply-plan">
                {busy === 'apply' ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />}
                {mode === 'intervals' ? (training.appliedAt ? `Sync ${pending} changes to Intervals` : `Send ${pending} sessions to Intervals`) : training.appliedAt ? 'Save changes' : 'Use this plan'}
              </Button>
            )}
            <ConfirmButton disabled={!!busy} message="Remove future plan sessions from your calendar?" confirmLabel="Discard plan" onConfirm={() => void act('discard', discard)}>
              {busy === 'discard' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Discard
            </ConfirmButton>
          </div>
        </div>
        {training.appliedAt && training.dirtyIds.length === 0 && <Chip className="mt-2 border-good/40 text-good">{mode === 'intervals' ? 'On your Intervals calendar' : 'Active'}</Chip>}
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        {training.ftpSuggestion && mode === 'intervals' && <FtpSuggestion />}
        {proj && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {proj.noFtpEvidence ? (
              <>
                <Stat label="FTP now" value="?" sub={`no tests or max efforts in your history; the first test sets zones (now ${training.ftp ?? plan.request.ftp} W)`} />
                <Stat
                  label={plan.request.objective === 'event' ? 'Event day' : 'Projected change'}
                  value={<span className="text-ember">{pct(proj.finalFtp.p50 / proj.startFtp - 1)}</span>}
                  sub={`80% range ${pct(proj.finalFtp.p10 / proj.startFtp - 1)} to ${pct(proj.finalFtp.p90 / proj.startFtp - 1)}, if the plan is ridden`}
                />
              </>
            ) : (
              <>
                <Stat label="FTP now" value={Math.round(proj.startFtp)} unit="W" sub={`zones set at ${training.ftp ?? plan.request.ftp} W`} />
                <Stat
                  label={plan.request.objective === 'event' ? 'Event day' : 'Projected FTP'}
                  value={<span className="text-ember">{Math.round(proj.finalFtp.p50)}</span>}
                  unit="W"
                  sub={`80% range ${Math.round(proj.finalFtp.p10)}–${Math.round(proj.finalFtp.p90)} W, if the plan is ridden`}
                />
              </>
            )}
            <Stat label="Avg week" value={(plan.weeks.reduce((a, w) => a + w.hours, 0) / plan.weeks.length).toFixed(1)} unit="h" sub={`${Math.round(plan.weeks.reduce((a, w) => a + w.plannedTss, 0) / plan.weeks.length)} TSS`} />
            <Stat label="Hard days / week" value={plan.genome.hardPerWeek} sub={`${plan.genome.cadence}:1 load:recovery`} />
          </div>
        )}
        <div className="mt-4">
          <ProjectionChart plan={plan} />
        </div>
        <div className="mt-2">
          <WeekBars plan={plan} />
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--i-endurance))' }} /> Endurance
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--i-threshold))' }} /> Tempo–threshold
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'rgb(var(--i-vo2))' }} /> VO2 and above
            </span>
          </div>
        </div>
        {plan.weeks.some((w) => w.availabilityLimited) && <p className="mt-3 text-xs text-muted">Some weeks are capped by your available hours, so the plan leans on intensity rather than volume there.</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReadinessCard />
        <NoDataNotice />
        <DebriefPrompt />
        <FeedbackPrompt />
      </div>

      {training.adjustments.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Recent adjustments</SectionTitle>
          <ul className="space-y-2">
            {training.adjustments.slice(0, 8).map((a, i) => (
              <AdjustmentRow key={i} a={{ ...a, reason: `${formatDate(a.date)}: ${a.reason}` }} />
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle>Sessions</SectionTitle>
        <div className="space-y-2">
          {plan.weeks.map((w) => {
            const ss = plan.sessions.filter((s) => s.date >= w.start && s.date < addDays(w.start, 7)).sort((a, b) => (a.date < b.date ? -1 : 1));
            const open = openWeek === w.index;
            return (
              <div key={w.index} className="rounded-2xl border border-line/70">
                <button className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setOpenWeek(open ? -1 : w.index)} aria-expanded={open}>
                  <span>
                    <span className="font-semibold">Week {w.index + 1}</span>
                    <span className="ml-2 text-sm text-muted">
                      {PHASE_LABEL[w.phase]} · {formatDate(w.start)}
                    </span>
                  </span>
                  <span className="num flex items-center gap-2 text-xs text-muted">
                    {w.hours} h · {w.plannedTss} TSS
                    <ChevronDown size={16} className={cx('transition', open && 'rotate-180')} />
                  </span>
                </button>
                {open && (
                  <ul className="space-y-1.5 px-3 pb-3">
                    {ss.map((s) => (
                      <SessionRow key={s.id} s={s} today={today} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

export function PlanPage() {
  const plan = useApp((s) => s.training.plan);
  const [regen, setRegen] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="label mb-1">Training</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Plan</h1>
        </div>
        {plan && (
          <Button variant="ghost" onClick={() => setRegen(!regen)}>
            <RefreshCw size={15} /> {regen ? 'Back to plan' : 'New plan'}
          </Button>
        )}
      </div>
      {plan && !regen ? (
        <PlanView plan={plan} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <SetupCard onDone={() => setRegen(false)} />
          </div>
          <div className="space-y-4">
            <ModelCard />
            <DataCard />
            <Card className="p-5 text-sm text-muted">
              <SectionTitle>
                <span className="inline-flex items-center gap-1.5">
                  <TrendingUp size={14} /> How plans are built
                </span>
              </SectionTitle>
              <ul className="list-disc space-y-1 pl-4">
                <li>Base → build → test, with a recovery week every 2–4 weeks.</li>
                <li>Sweet spot and threshold in base; VO2max and over-unders in build. The mix is tuned to how you respond.</li>
                <li>Every session has progression levels. Your RPE moves them up or holds them.</li>
                <li>Each day, HRV, resting HR, form and how you felt can ease or move a hard session.</li>
              </ul>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs">
                <Gauge size={13} /> Projections come from a model and carry real uncertainty.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
