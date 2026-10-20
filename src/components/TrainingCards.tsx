import { Activity, CircleHelp, HeartPulse, MessageCircleQuestion, PlugZap, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, formatDate, formatDuration } from '../engine/time';
import { useApp } from '../state/store';
import { debriefQueue, historyRides, recentNoDataRides } from '../state/training';
import { ISSUE_LABEL, MISSED_LABEL } from '../training/debrief';
import type { MissedReason, RideIssue, RideRecord } from '../training/history/types';
import { useToday } from '../state/usePlan';
import type { Adjustment } from '../training/adapt';
import { Card, Chip, SectionTitle, cx } from '../ui/primitives';

const LEVEL_STYLE = {
  green: { color: 'rgb(var(--good))', label: 'Ready to train' },
  amber: { color: 'rgb(var(--warn))', label: 'Take it a bit easier' },
  red: { color: 'rgb(var(--bad))', label: 'Recovery first' },
} as const;

export function ReadinessCard() {
  const readiness = useApp((s) => s.training.readiness);
  const plan = useApp((s) => s.training.plan);
  const today = useToday();
  const adjustments = useApp((s) => s.training.adjustments);
  if (!plan) return null;
  const todays = adjustments.filter((a) => a.date === today);
  const style = readiness ? LEVEL_STYLE[readiness.level] : undefined;
  return (
    <Card className="p-5" data-testid="readiness-card">
      <SectionTitle>Readiness</SectionTitle>
      {readiness && style ? (
        <div className="flex items-start gap-3">
          <HeartPulse size={20} style={{ color: style.color }} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold" style={{ color: style.color }}>
              {style.label}
            </div>
            <div className="mt-0.5 text-sm text-muted">
              {readiness.reasons.length ? readiness.reasons.join(' · ') : 'HRV, resting HR and form are within your normal range.'}
            </div>
            <div className="num mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {readiness.hrv7 !== undefined && readiness.hrvLow !== undefined && (
                <Chip>
                  HRV{readiness.hrvKind === 'sdnn' ? ' (SDNN)' : ''} 7d {Math.round(Math.exp(readiness.hrv7))} ms (normal ≥ {Math.round(Math.exp(readiness.hrvLow))})
                </Chip>
              )}
              {readiness.rhrDelta !== undefined && <Chip>RHR {readiness.rhrDelta >= 0 ? '+' : ''}{readiness.rhrDelta.toFixed(1)} bpm</Chip>}
              <Chip>TSB {Math.round(readiness.tsb)}</Chip>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Checked once a day against your HRV, resting HR, form and how recent rides felt.</p>
      )}
      {todays.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line/70 pt-3">
          {todays.map((a, i) => (
            <AdjustmentRow key={i} a={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}

const ACTION_LABEL: Record<Adjustment['action'], string> = {
  downgrade: 'Swapped',
  reduce: 'Eased',
  progress: 'Stepped up',
  move: 'Moved',
  drop: 'Dropped',
  ftp: 'FTP',
  replan: 'Rebuilt',
};

export function AdjustmentRow({ a }: { a: Adjustment }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Sparkles size={14} className="mt-0.5 shrink-0 text-ember" />
      <span>
        <span className="font-medium">{ACTION_LABEL[a.action]}</span>
        <span className="text-muted"> · {a.reason}</span>
      </span>
    </li>
  );
}

export const KIND_LABEL: Record<string, string> = {
  recovery: 'Recovery spin',
  endurance: 'Endurance',
  long: 'Long ride',
  tempo: 'Tempo',
  sweetspot: 'Sweet spot',
  threshold: 'Threshold',
  overunder: 'Over-unders',
  vo2: 'VO2max',
  anaerobic: '30/15s',
  openers: 'Openers',
  ftptest: 'FTP test',
};

const HARD_KINDS = new Set(['sweetspot', 'threshold', 'overunder', 'vo2', 'anaerobic']);

const RPE_HINT: Record<number, string> = { 1: 'Nothing', 3: 'Easy', 5: 'Steady', 7: 'Hard', 9: 'Very hard', 10: 'Max' };
const FEEL = [
  { v: 1, label: 'Strong' },
  { v: 2, label: 'Good' },
  { v: 3, label: 'Normal' },
  { v: 4, label: 'Poor' },
  { v: 5, label: 'Weak' },
];

/** "How did it feel?" for the last few days' rides that have no RPE yet. */
export function FeedbackPrompt({ compact }: { compact?: boolean }) {
  const training = useApp((s) => s.training);
  const today = useToday();
  const pending = useMemo(
    () =>
      historyRides(training)
        .filter((r) => r.date >= addDays(today, -3) && r.date <= today && r.durationMin >= 20)
        .filter((r) => r.rpe === undefined || r.feel === undefined || training.feedback[r.id] || (r.plannedId && r.kind && HARD_KINDS.has(r.kind) && !training.rideIssues?.[r.id]))
        .slice(-2),
    [training, today],
  );
  if (!pending.length) return null;
  return (
    <Card className={cx('p-5', compact && 'p-4')} data-testid="feedback-prompt">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <MessageCircleQuestion size={14} /> How did it feel?
        </span>
      </SectionTitle>
      <div className="space-y-5">
        {pending.map((r) => (
          <RideFeedback key={r.id} ride={r} />
        ))}
      </div>
      {!compact && <p className="mt-4 text-xs text-muted">Sessions that feel easier than usual move your progression up; harder ones hold it or step back. Feeling poor two rides running eases the next hard day.</p>}
    </Card>
  );
}

/** Effort, feel and "didn't go to plan?" for one ride. */
export function RideFeedback({ ride: r, showTitle = true }: { ride: RideRecord; showTitle?: boolean }) {
  const training = useApp((s) => s.training);
  const setFeedback = useApp((s) => s.setFeedback);
  const adaptTraining = useApp((s) => s.adaptTraining);
  const fb = training.feedback[r.id] ?? {};
  const rpe = fb.rpe ?? (r.rpe !== undefined ? Math.round(r.rpe) : undefined);
  const feel = fb.feel ?? r.feel;
  return (
    <div>
      {showTitle && (
        <div className="flex items-center gap-2 text-sm">
          <Activity size={14} className="text-muted" />
          <span className="font-medium">{r.kind ? KIND_LABEL[r.kind] ?? r.kind : 'Ride'}</span>
          <span className="text-muted">
            {formatDate(r.date, { weekday: true })} · {r.assumed ? 'no data, assumed as planned' : formatDuration(r.durationMin)}
          </span>
        </div>
      )}
      <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted">Effort (RPE)</div>
      <div className="mt-1 grid grid-cols-10 gap-1" role="group" aria-label={`Effort for ride on ${r.date}`}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            aria-pressed={rpe === v}
            title={RPE_HINT[v]}
            onClick={() => void setFeedback(r.id, { rpe: v }).then(adaptTraining)}
            className={cx('num rounded-lg border py-1.5 text-sm font-semibold transition', rpe === v ? 'border-ember bg-ember/15 text-ember' : 'border-line hover:bg-raised')}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>easy</span>
        <span>max</span>
      </div>
      {r.plannedId && r.kind && HARD_KINDS.has(r.kind) && <OffPlan rideId={r.id} sessionId={r.plannedId} answered={training.rideIssues?.[r.id]?.issue} />}
      <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted">How you felt</div>
      <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={`Feel for ride on ${r.date}`}>
        {FEEL.map((f) => (
          <button
            key={f.v}
            aria-pressed={feel === f.v}
            onClick={() => void setFeedback(r.id, { feel: f.v }).then(adaptTraining)}
            className={cx('rounded-full border px-3 py-1 text-xs font-medium transition', feel === f.v ? 'border-ember bg-ember/15 text-ember' : 'border-line hover:bg-raised')}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const MISSED_ORDER: MissedReason[] = ['time', 'travel', 'equipment', 'tired', 'sick', 'injured'];
const ISSUE_ORDER: RideIssue[] = ['time', 'equipment', 'too-hard', 'unwell'];

function Choices<T extends string>({ options, labels, value, onPick, label }: { options: T[]; labels: Record<T, string>; value?: T; onPick: (v: T) => void; label: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          aria-pressed={value === o}
          onClick={() => onPick(o)}
          className={cx('rounded-full border px-3 py-1 text-xs font-medium transition', value === o ? 'border-ember bg-ember/15 text-ember' : 'border-line hover:bg-raised')}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/** "Didn't go to plan?" under a rated ride: the same question a cut-short ride gets. */
function OffPlan({ rideId, sessionId, answered }: { rideId: string; sessionId: string; answered?: RideIssue }) {
  const answer = useApp((s) => s.answerRideIssue);
  const [open, setOpen] = useState(false);
  if (answered) return <div className="mt-2 text-xs text-muted">Didn't go to plan · {ISSUE_LABEL[answered]}</div>;
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
        Didn't go to plan?
      </button>
    );
  return <Choices options={ISSUE_ORDER} labels={ISSUE_LABEL} onPick={(v) => answer(rideId, v, sessionId)} label={`What happened on ride ${rideId}`} />;
}

const MISSED_HELP: Record<MissedReason, string> = {
  time: 'The session moves to a free day this week.',
  travel: 'The session moves to a free day this week.',
  equipment: 'The session moves to a free day this week.',
  tired: "The work isn't stacked on later; your next hard day is eased.",
  sick: 'Easy spins for three days, then you ease back in.',
  injured: 'Hard sessions this week become easy spins.',
};

/**
 * "What happened?" for skipped or cut-short sessions. Why matters: a busy day
 * moves the work, being run down eases what's next, and only "couldn't hold
 * the targets" counts against the intensity.
 */
export function DebriefPrompt() {
  const training = useApp((s) => s.training);
  const answerMissed = useApp((s) => s.answerMissed);
  const answerIssue = useApp((s) => s.answerRideIssue);
  const today = useToday();
  const items = useMemo(() => debriefQueue(training, today), [training, today]);
  const [last, setLast] = useState<string>();
  if (!items.length && !last) return null;
  return (
    <Card className="p-5" data-testid="debrief-prompt">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <CircleHelp size={14} /> What happened?
        </span>
      </SectionTitle>
      <div className="space-y-5">
        {items.map((it) => (
          <div key={it.session.id}>
            <div className="text-sm">
              <span className="font-medium">{it.session.title}</span>
              <span className="text-muted">
                {' '}
                · {formatDate(it.session.date, { weekday: true })} · {it.type === 'missed' ? 'skipped' : it.why === 'time' ? `${formatDuration(it.ride.durationMin)} of ${formatDuration(it.session.durationMin)}` : `TSS ${it.tss} of ${it.session.tss}`}
              </span>
            </div>
            {it.type === 'missed' ? (
              <Choices
                options={MISSED_ORDER}
                labels={MISSED_LABEL}
                label={`Why ${it.session.title} was skipped`}
                onPick={(v) => {
                  answerMissed(it.session.id, v);
                  setLast(MISSED_HELP[v]);
                }}
              />
            ) : (
              <Choices
                options={ISSUE_ORDER}
                labels={ISSUE_LABEL}
                label={`Why ${it.session.title} ${it.why === 'time' ? 'was cut short' : 'came in under target'}`}
                onPick={(v) => {
                  answerIssue(it.ride.id, v, it.session.id);
                  setLast(v === 'too-hard' ? 'Counted as a missed target: the next one steps back.' : v === 'unwell' ? 'Your next hard day is eased.' : 'No change to your plan.');
                }}
              />
            )}
          </div>
        ))}
      </div>
      {last && (
        <p className="mt-3 text-xs text-muted" role="status">
          {last}
        </p>
      )}
    </Card>
  );
}

/**
 * Rides that reached Intervals only through Strava come with no data (the
 * Intervals API can't pass Strava data on). The plan assumes planned sessions
 * on those days were ridden as planned; this says so and how to fix it.
 */
export function NoDataNotice() {
  const training = useApp((s) => s.training);
  const mode = useApp((s) => s.connection.mode);
  const today = useToday();
  const n = useMemo(() => recentNoDataRides(training, today).length, [training, today]);
  if (mode !== 'intervals' || !n) return null;
  return (
    <Card className="border-warn/40 p-4" data-testid="no-data-notice">
      <div className="flex items-start gap-3 text-sm">
        <PlugZap size={18} className="mt-0.5 shrink-0 text-warn" />
        <div>
          <div className="font-medium">
            {n} {n === 1 ? 'activity' : 'activities'} in the last two weeks came through Strava without data
          </div>
          <p className="mt-1 text-muted">
            Intervals.icu can't share Strava's ride data, so on planned days Preburner assumes you rode the session as planned and can't see how it went. Connect your bike computer and Zwift to
            Intervals directly (Intervals → Settings → Connections) and new rides arrive with power and duration.
          </p>
        </div>
      </div>
    </Card>
  );
}
