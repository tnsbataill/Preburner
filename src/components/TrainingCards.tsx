import { Activity, HeartPulse, MessageCircleQuestion, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { addDays, formatDate, formatDuration } from '../engine/time';
import { useApp } from '../state/store';
import { historyRides } from '../state/training';
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
                  HRV 7d {Math.round(Math.exp(readiness.hrv7))} ms (normal ≥ {Math.round(Math.exp(readiness.hrvLow))})
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

const KIND_LABEL: Record<string, string> = {
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
  const setFeedback = useApp((s) => s.setFeedback);
  const adaptTraining = useApp((s) => s.adaptTraining);
  const today = useToday();
  const pending = useMemo(
    () =>
      historyRides(training)
        .filter((r) => r.date >= addDays(today, -3) && r.date <= today && r.durationMin >= 20)
        .filter((r) => r.rpe === undefined || r.feel === undefined || training.feedback[r.id])
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
        {pending.map((r) => {
          const fb = training.feedback[r.id] ?? {};
          const rpe = fb.rpe ?? (r.rpe !== undefined ? Math.round(r.rpe) : undefined);
          const feel = fb.feel ?? r.feel;
          return (
            <div key={r.id}>
              <div className="flex items-center gap-2 text-sm">
                <Activity size={14} className="text-muted" />
                <span className="font-medium">{r.kind ? KIND_LABEL[r.kind] ?? r.kind : 'Ride'}</span>
                <span className="text-muted">
                  {formatDate(r.date, { weekday: true })} · {formatDuration(r.durationMin)}
                </span>
              </div>
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
        })}
      </div>
      {!compact && <p className="mt-4 text-xs text-muted">Sessions that feel easier than usual move your progression up; harder ones hold it or step back. Feeling poor two rides running eases the next hard day.</p>}
    </Card>
  );
}
