import { addDays } from '../engine/time';
import type { DateKey } from '../engine/types';
import { type Adjustment, DEFAULT_ADAPT, applyRpe, catchUp, isCatchable, isLogistics, isQuality, rebuild } from './adapt';
import type { MissedReason, RideIssue, RideRecord } from './history/types';
import type { HardKind, PlannedSession } from './types';

// "What happened?" Missed and cut-short sessions mean different things
// depending on why: a work meeting says nothing about the body, a cold says a
// lot. The athlete's answer decides whether the work is caught up, eased, or
// counted as a failed session (targets too hard).

type Scales = Partial<Record<HardKind, number>>;
interface Result {
  sessions: PlannedSession[];
  adjustments: Adjustment[];
  scales: Scales;
}

export const MISSED_LABEL: Record<MissedReason, string> = {
  time: 'No time',
  travel: 'Travelling',
  equipment: 'Bike or trainer issue',
  tired: 'Too tired or stressed',
  sick: 'Sick',
  injured: 'Injured',
};

export const ISSUE_LABEL: Record<RideIssue, string> = {
  time: 'Ran out of time',
  equipment: 'Bike, trainer or app issue',
  'too-hard': "Couldn't hold the targets",
  unwell: 'Felt ill or wrecked',
};

/** Quality and long sessions are worth asking about; a skipped recovery spin isn't. */
export const worthAsking = (s: PlannedSession) => s.hard || s.kind === 'long';

/** Put back what a catch-up move replaced, if that day is still ahead. */
export function revertCatchUp(sessions: PlannedSession[], history: Adjustment[], missedId: string, today: DateKey): { sessions: PlannedSession[]; adjustments: Adjustment[] } {
  const move = history.find((a) => a.action === 'move' && a.movedFrom === missedId && (a.replaced || a.created));
  const at = move && sessions.find((s) => s.id === move.sessionId);
  if (!move || !at || at.date < today) return { sessions, adjustments: [] };
  return {
    sessions: move.created ? sessions.filter((s) => s.id !== at.id) : sessions.map((s) => (s.id === at.id ? move.replaced! : s)),
    adjustments: [{ date: at.date, action: 'drop', sessionId: at.id, reason: `Not catching up the missed session on ${at.date}: back to the easy ride planned for that day` }],
  };
}

/** Ease the next quality session(s) within `days` by one level. */
function easeNext(sessions: PlannedSession[], from: DateKey, days: number, scales: Scales, why: string, count = 1): { sessions: PlannedSession[]; adjustments: Adjustment[] } {
  const targets = sessions
    .filter((s) => isQuality(s) && s.date >= from && s.date < addDays(from, days) && s.level > 1)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, count);
  const adjustments: Adjustment[] = [];
  let out = sessions;
  for (const t of targets) {
    const eased = { ...rebuild(t, t.kind, t.durationMin, t.level - 1, scales[t.kind as HardKind] ?? 1), plannedLevel: t.plannedLevel ?? t.level };
    out = out.map((s) => (s.id === t.id ? eased : s));
    adjustments.push({ date: t.date, action: 'reduce', sessionId: t.id, reason: `${why}, so the ${t.kind} on ${t.date} is one level easier` });
  }
  return { sessions: out, adjustments };
}

/** Swap quality sessions in a window for easy spins. */
function swapToEasy(sessions: PlannedSession[], from: DateKey, days: number, why: string): { sessions: PlannedSession[]; adjustments: Adjustment[] } {
  const adjustments: Adjustment[] = [];
  const out = sessions.map((s) => {
    if (!isQuality(s) || s.date < from || s.date >= addDays(from, days)) return s;
    adjustments.push({ date: s.date, action: 'downgrade', sessionId: s.id, reason: `${why}: easy spin instead of the ${s.kind} on ${s.date}` });
    return { ...rebuild(s, 'recovery', Math.min(60, Math.max(30, s.durationMin * 0.6)), 1), plannedLevel: s.plannedLevel ?? s.level };
  });
  return { sessions: out, adjustments };
}

/**
 * Apply the athlete's answer for a missed session.
 * - time / travel / equipment: catch the work up later this week (unless the
 *   daily check already did).
 * - tired: don't stack the missed work on top; ease the next hard day.
 * - sick: no catch-up, easy spins for three days, then one level easier.
 * - injured: no hard work this week; a long gap triggers a rebuild anyway.
 */
export function applyMissedReason(sessionsIn: PlannedSession[], missed: PlannedSession, reason: MissedReason, today: DateKey, history: Adjustment[], scales: Scales = {}): Result {
  let sessions = sessionsIn;
  const adjustments: Adjustment[] = [];
  const caughtUp = history.some((a) => a.action === 'move' && a.movedFrom === missed.id);
  if (isLogistics(reason)) {
    if (!caughtUp && isCatchable(missed)) {
      const res = catchUp(sessions, missed, today, scales);
      sessions = res.sessions;
      if (res.adjustment) adjustments.push(res.adjustment);
    }
    return { sessions, adjustments, scales };
  }
  const undo = revertCatchUp(sessions, history, missed.id, today);
  sessions = undo.sessions;
  adjustments.push(...undo.adjustments);
  const step =
    reason === 'tired'
      ? easeNext(sessions, today, 4, scales, `You skipped the ${missed.kind} on ${missed.date} because you were run down`)
      : reason === 'sick'
        ? (() => {
            const easy = swapToEasy(sessions, today, 3, 'Getting over illness');
            const back = easeNext(easy.sessions, addDays(today, 3), 7, scales, 'First hard day back after illness');
            return { sessions: back.sessions, adjustments: [...easy.adjustments, ...back.adjustments] };
          })()
        : swapToEasy(sessions, today, 7, "Injured: skip these if riding hurts, the plan rebuilds when you're back");
  return { sessions: step.sessions, adjustments: [...adjustments, ...step.adjustments], scales };
}

/**
 * Apply the athlete's answer for a ride that didn't go to plan. `ride` must
 * already carry the issue (and `failed` for too-hard). `rpeApplied` says the
 * ride's RPE already moved the plan, so a failure mustn't step back twice.
 */
export function applyRideIssue(sessions: PlannedSession[], rides: RideRecord[], ride: RideRecord, issue: RideIssue, today: DateKey, rpeApplied: boolean, scales: Scales = {}): Result {
  if (issue === 'too-hard') return applyRpe(sessions, rides, { ...ride, failed: true }, today, DEFAULT_ADAPT, false, scales, { failureOnly: rpeApplied });
  if (issue === 'unwell') return { ...easeNext(sessions, today, 4, scales, `${ride.date}'s ride was cut short feeling unwell`), scales };
  return { sessions, adjustments: [], scales };
}
