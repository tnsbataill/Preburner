import type Anthropic from '@anthropic-ai/sdk';
import { ArrowUp, Bot, Check, KeyRound, Loader2, NotebookPen, Plus, RotateCcw, Shuffle, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../App';
import { applyChange } from '../coach/apply';
import { clearCoachHistory, loadCoachHistory, saveCoachHistory } from '../coach/history';
import { applyChanges, runTool } from '../coach/tools';
import type { Proposal, ProposalChange } from '../coach/types';
import { formatDate, formatDuration } from '../engine/time';
import { IntervalsClient } from '../intervals/client';
import { useApp } from '../state/store';
import { useEffectiveWorkouts, useToday } from '../state/usePlan';
import { INTENSITY_COLOR } from '../ui/format';
import { Button, Card, Chip, cx } from '../ui/primitives';

const PROMPTS = [
  { label: 'Plan my build to the event', text: 'Plan my training from now to my target event: build toward my target fitness and taper so I arrive fresh. Respect my availability.' },
  { label: 'Am I on track?', text: 'Am I on track for my weight and fitness goals? What, if anything, should change in the next two weeks?' },
  { label: "I'm cooked this week", text: "I'm feeling run down this week — poor sleep and heavy legs. Adjust the next 7 days to absorb the training without losing fitness." },
  { label: 'Fit in a long ride', text: 'I want one long outdoor endurance ride each weekend. Rework the next two weeks so that fits without overreaching.' },
];

const ACTION_ICON = { add: Plus, remove: Trash2, move: Shuffle, replace: RotateCcw, note: NotebookPen };

function ChangeRow({ change, proposal, workoutsById }: { change: ProposalChange; proposal: Proposal; workoutsById: Map<string, { title: string }> }) {
  const update = useApp((s) => s.update);
  const Icon = ACTION_ICON[change.action];
  const target = change.targetWorkoutId ? workoutsById.get(change.targetWorkoutId) : undefined;
  const set = (status: ProposalChange['status']) =>
    update((s) => ({
      coach: { ...s.coach, proposals: s.coach.proposals.map((p) => (p.id === proposal.id ? { ...p, changes: p.changes.map((c) => (c.id === change.id ? { ...c, status } : c)) } : p)) },
    }));
  const done = change.status === 'applied' || change.status === 'failed';
  const what =
    change.action === 'add'
      ? `Add ${change.session?.title}`
      : change.action === 'remove'
        ? `Remove ${target?.title ?? 'session'}`
        : change.action === 'move'
          ? `Move ${target?.title ?? 'session'} → ${change.newDate ? formatDate(change.newDate, { weekday: true }) : ''}`
          : change.action === 'replace'
            ? `Swap ${target?.title ?? 'session'} for ${change.session?.title}`
            : change.note ?? 'Note';
  return (
    <div className={cx('flex gap-3 rounded-xl border p-3', change.status === 'accepted' ? 'border-good/40 bg-good/5' : change.status === 'rejected' ? 'border-line opacity-50' : 'border-line')}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-raised text-muted">
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">{formatDate(change.date, { weekday: true })}</span>
          {change.session && (
            <Chip color={INTENSITY_COLOR[change.session.intensity]}>
              {change.session.intensity} · {formatDuration(change.session.durationMin)}
            </Chip>
          )}
        </div>
        <div className="mt-0.5 font-medium">{what}</div>
        <div className="mt-0.5 text-sm text-muted">{change.reason}</div>
        {change.session?.structure && <pre className="mt-2 overflow-x-auto rounded-lg bg-bg/70 p-2 font-mono text-[11px] text-muted">{change.session.structure}</pre>}
        {change.error && <div className="mt-1 text-xs text-bad">{change.error}</div>}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {done ? (
          <Chip color={change.status === 'applied' ? 'rgb(var(--good))' : 'rgb(var(--bad))'}>{change.status}</Chip>
        ) : (
          <>
            <button onClick={() => set(change.status === 'accepted' ? 'pending' : 'accepted')} aria-label="Accept" className={cx('grid h-8 w-8 place-items-center rounded-lg border', change.status === 'accepted' ? 'border-good bg-good text-white' : 'border-line text-muted hover:text-good')}>
              <Check size={15} />
            </button>
            <button onClick={() => set(change.status === 'rejected' ? 'pending' : 'rejected')} aria-label="Reject" className={cx('grid h-8 w-8 place-items-center rounded-lg border', change.status === 'rejected' ? 'border-bad bg-bad text-white' : 'border-line text-muted hover:text-bad')}>
              <X size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const s = useApp();
  const workouts = useEffectiveWorkouts();
  const today = useToday();
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts]);
  const accepted = proposal.changes.filter((c) => c.status === 'accepted');
  const world = { settings: s.settings, workouts, wellness: s.wellness, weights: s.weights, today, training: s.training };
  const impact = useMemo(() => {
    if (!accepted.length) return undefined;
    const sim = runTool({ ...world }, 'simulate_changes', { changes: accepted }) as { baseline: { event: { ctl: number; tsb: number } | null; ctlIn4Weeks: number }; withChanges: { event: { ctl: number; tsb: number } | null; ctlIn4Weeks: number } };
    return sim;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted.length, workouts]);

  const apply = async () => {
    setBusy(true);
    const client = s.connection.mode === 'intervals' && s.connection.intervalsKey ? new IntervalsClient(s.connection.intervalsKey, s.connection.athleteId) : undefined;
    for (const change of accepted) {
      try {
        const eff = await applyChange(change, { mode: s.connection.mode, client, ftp: s.settings.profile.ftp, workouts });
        s.update((st) => ({
          localWorkouts: [...st.localWorkouts.filter((w) => !eff.addLocal?.some((a) => a.id === w.id)), ...(eff.addLocal ?? [])],
          hiddenWorkoutIds: [...new Set([...st.hiddenWorkoutIds, ...(eff.hideIds ?? [])])],
          coach: { ...st.coach, proposals: st.coach.proposals.map((p) => (p.id === proposal.id ? { ...p, changes: p.changes.map((c) => (c.id === change.id ? { ...c, status: 'applied' } : c)) } : p)) },
        }));
      } catch (err) {
        s.update((st) => ({
          coach: { ...st.coach, proposals: st.coach.proposals.map((p) => (p.id === proposal.id ? { ...p, changes: p.changes.map((c) => (c.id === change.id ? { ...c, status: 'failed', error: err instanceof Error ? err.message : String(err) } : c)) } : p)) },
        }));
      }
    }
    if (client) await s.sync();
    setBusy(false);
  };

  // sanity: changes that reference sessions which no longer exist
  const stale = applyChanges(workouts, proposal.changes.filter((c) => c.status === 'pending' || c.status === 'accepted'), s.settings.profile.ftp).errors;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-raised/40 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ember">
          <Sparkles size={13} /> Proposal
        </div>
        <h3 className="mt-1 text-lg font-semibold">{proposal.title}</h3>
        <p className="mt-1 text-sm text-muted">{proposal.summary}</p>
      </div>
      <div className="space-y-2 p-4">
        {proposal.changes.length === 0 && <p className="text-sm text-muted">No changes needed — your plan already fits your goals.</p>}
        {proposal.changes.map((c) => (
          <ChangeRow key={c.id} change={c} proposal={proposal} workoutsById={byId} />
        ))}
        {stale.length > 0 && <p className="text-xs text-warn">Some changes no longer match your calendar: {stale.join('; ')}</p>}
      </div>
      {proposal.changes.some((c) => c.status !== 'applied') && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
          <div className="num text-xs text-muted">
            {impact?.withChanges.event && impact.baseline.event
              ? `Event day: CTL ${impact.baseline.event.ctl} → ${impact.withChanges.event.ctl}, TSB ${impact.baseline.event.tsb} → ${impact.withChanges.event.tsb}`
              : impact
                ? `CTL in 4 weeks: ${impact.baseline.ctlIn4Weeks} → ${impact.withChanges.ctlIn4Weeks}`
                : 'Accept the changes you want, then apply.'}
          </div>
          <Button variant="primary" disabled={!accepted.length || busy} onClick={() => void apply()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Apply {accepted.length || ''} {s.connection.mode === 'intervals' ? 'to Intervals' : 'to plan'}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function CoachPage() {
  const s = useApp();
  const workouts = useEffectiveWorkouts();
  const today = useToday();
  const [input, setInput] = useState(() => (new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('ask') === 'event' ? PROMPTS[0].text : ''));
  const [steps, setSteps] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const abort = useRef<AbortController>();
  const bottom = useRef<HTMLDivElement>(null);
  const { messages, proposals } = s.coach;

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages.length, steps.length]);

  const send = async (text: string) => {
    if (!text.trim() || running || !s.connection.anthropicKey) return;
    setError(undefined);
    setSteps([]);
    setRunning(true);
    setInput('');
    const userMsg = { id: `m-${Date.now()}`, role: 'user' as const, text, at: new Date().toISOString() };
    s.update((st) => ({ coach: { ...st.coach, messages: [...st.coach.messages, userMsg] } }));
    abort.current = new AbortController();
    const collected: string[] = [];
    // The SDK is only downloaded once the coach is actually used.
    const { runCoach, describeCoachError } = await import('../coach/agent');
    try {
      const res = await runCoach({
        apiKey: s.connection.anthropicKey,
        model: s.connection.coachModel,
        world: { settings: s.settings, workouts, wellness: s.wellness, weights: s.weights, today, training: s.training },
        history: loadCoachHistory() as Anthropic.Beta.BetaMessageParam[],
        userText: text,
        signal: abort.current.signal,
        onStep: (label) => {
          collected.push(label);
          setSteps([...collected]);
        },
      });
      const kept = saveCoachHistory(res.history);
      const note = kept ? '' : '\n\n(This conversation got long, so the next message starts a fresh one.)';
      s.update((st) => ({
        coach: {
          messages: [...st.coach.messages, { id: `m-${Date.now()}`, role: 'assistant', text: res.text + note, at: new Date().toISOString(), steps: [...new Set(collected)] }],
          proposals: res.proposal ? [...st.coach.proposals.map((p) => ({ ...p, status: 'closed' as const })), res.proposal] : st.coach.proposals,
        },
      }));
    } catch (err) {
      setError(describeCoachError(err));
    } finally {
      setRunning(false);
      setSteps([]);
    }
  };

  const openProposal = proposals.find((p) => p.status === 'open');

  if (!s.connection.anthropicKey) {
    return (
      <div className="mx-auto max-w-xl space-y-6 py-6">
        <div>
          <div className="label mb-1">AI coach</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Coach</h1>
        </div>
        <Card className="space-y-4 p-6">
          <div className="ember-bg grid h-12 w-12 place-items-center rounded-2xl text-white shadow-glow">
            <Bot size={24} />
          </div>
          <h2 className="text-xl font-semibold">A coach that runs the numbers</h2>
          <p className="text-muted">
            The coach reads your calendar, fitness and fuelling plan, simulates options against your goals, and proposes specific changes. You approve each one before anything touches Intervals.icu.
          </p>
          <p className="text-sm text-muted">It runs on Claude using your own Anthropic API key, stored only in this browser.</p>
          <Button variant="primary" onClick={() => navigate('settings', 'section=connections')}>
            <KeyRound size={16} /> Add an Anthropic key
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="label mb-1">AI coach · {s.connection.coachModel.replace('claude-', '').replace(/-(\d)-(\d)$/, ' $1.$2')}</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Coach</h1>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" className="text-xs" onClick={() => { clearCoachHistory(); s.update((st) => ({ coach: { messages: [], proposals: st.coach.proposals.map((p) => ({ ...p, status: 'closed' as const })) } })); }}>
            New conversation
          </Button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {PROMPTS.map((p) => (
            <button key={p.label} onClick={() => void send(p.text)} className="card p-4 text-left transition hover:border-ember/50">
              <div className="font-medium">{p.label}</div>
              <div className="mt-1 line-clamp-2 text-xs text-muted">{p.text}</div>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {messages.map((m) => (
          <div key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed', m.role === 'user' ? 'ember-bg text-white' : 'card')}>
              {m.steps && m.steps.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{m.steps.map((st) => <Chip key={st}>{st}</Chip>)}</div>}
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          </div>
        ))}
        {running && (
          <div className="card max-w-[88%] space-y-1.5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-muted">
              <Loader2 size={15} className="animate-spin text-ember" /> Thinking it through…
            </div>
            {steps.map((st, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted animate-fade-up">
                <Check size={12} className="text-good" /> {st}
              </div>
            ))}
          </div>
        )}
        {error && <div className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{error}</div>}
        {openProposal && <ProposalCard proposal={openProposal} />}
        <div ref={bottom} />
      </div>

      <form
        className="safe-bottom sticky bottom-20 z-20 lg:bottom-6"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="card flex items-end gap-2 p-2 shadow-2xl">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask about your plan, goals, or how you feel…"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-faint"
          />
          {running ? (
            <button type="button" onClick={() => abort.current?.abort()} className="grid h-10 w-10 place-items-center rounded-xl bg-raised" aria-label="Stop">
              <Square size={15} />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="ember-bg grid h-10 w-10 place-items-center rounded-xl text-white disabled:opacity-40" aria-label="Send">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
