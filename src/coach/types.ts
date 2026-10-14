import type { DateKey, Intensity } from '../engine/types';

export interface CoachMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** tool activity shown inline while the agent works */
  steps?: string[];
}

export interface ProposedSession {
  title: string;
  durationMin: number;
  intensity: Intensity;
  ifactor?: number;
  startMin?: number | null;
  /** Intervals.icu workout-builder text, e.g. "- 15m 60%\n3x\n- 8m 95%\n- 4m 55%" */
  structure?: string;
}

export type ChangeAction = 'add' | 'remove' | 'move' | 'replace' | 'note';

export interface ProposalChange {
  id: string;
  action: ChangeAction;
  date: DateKey;
  /** existing workout this acts on (remove / move / replace) */
  targetWorkoutId?: string;
  newDate?: DateKey;
  session?: ProposedSession;
  note?: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
  error?: string;
}

export interface Proposal {
  id: string;
  createdAt: string;
  title: string;
  summary: string;
  changes: ProposalChange[];
  /** projected outcome the agent computed for this proposal */
  projection?: { eventCtl?: number; eventTsb?: number; weeklyLoads?: number[] };
  status: 'open' | 'closed';
}
