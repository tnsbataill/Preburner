import { addDays } from '../engine/time';
import type { DateKey, Intensity, Workout } from '../engine/types';
import type { ReadinessLevel } from './adapt';
import { mergeRides } from './history/intervals';
import type { RideRecord } from './history/types';
import type { PlannedSession, SessionKind } from './types';

// Reviewing a new ride: what came in, and what changed because of it.
//
// What changed is worked out by comparing the upcoming plan as it stood when
// the ride arrived (a snapshot taken before the sync's adaptation ran) with
// the plan now. That catches every path that edits the plan (daily
// adaptation, an RPE answer, a "what happened?" answer) without each of them
// having to report what it did.

export interface SessionSnap {
  id: string;
  date: DateKey;
  title: string;
  kind: SessionKind;
  level: number;
  tss: number;
}

export interface ReviewBaseline {
  sessions: SessionSnap[];
  ftp?: number;
  readiness?: ReadinessLevel;
}

export interface RideReview {
  rideId: string;
  date: DateKey;
  createdAt: string;
  baseline: ReviewBaseline;
  /** other rides that arrived in the same sync (their changes are mixed together) */
  batch?: string[];
  doneAt?: string;
  /** what had changed when the review was marked done (kept as it was then) */
  changes?: PlanChange[];
}

/** What the athlete says about a ride Intervals could only see via Strava. */
export interface RideDetails {
  durationMin?: number;
  /** it was a walk, a hike, a mistake... leave it out of training load */
  notRide?: boolean;
}

export type PlanChange =
  | { type: 'moved'; title: string; from: DateKey; to: DateKey }
  | { type: 'harder' | 'easier'; title: string; date: DateKey; fromLevel: number; toLevel: number; fromTss: number; toTss: number }
  | { type: 'replaced'; date: DateKey; from: string; to: string }
  | { type: 'added'; title: string; date: DateKey }
  | { type: 'removed'; title: string; date: DateKey };

// Unreviewed rides stay in the queue for a week (a ride can sit a few days before the app is opened).
const REVIEW_DAYS = 7;
const KEEP = 30;

/** Rides that count as "new" for review: the last week, with or without data. */
export function reviewCandidates(intervalsRides: RideRecord[], stravaRides: RideRecord[], today: DateKey): RideRecord[] {
  return mergeRides(intervalsRides, stravaRides).filter((r) => r.date >= addDays(today, -REVIEW_DAYS) && r.date <= today && (r.noData || r.durationMin >= 10) && !r.isTest);
}

export function snapshotPlan(sessions: PlannedSession[] | undefined, today: DateKey, ftp?: number, readiness?: ReadinessLevel): ReviewBaseline {
  return {
    sessions: (sessions ?? []).filter((s) => s.date >= today).map((s) => ({ id: s.id, date: s.date, title: s.title, kind: s.kind, level: s.level, tss: s.tss })),
    ftp,
    readiness,
  };
}

/**
 * Add a review for each candidate ride that isn't already known. Rides that
 * arrive together share the same baseline and are marked as one batch.
 */
export function queueReviews(reviews: Record<string, RideReview>, candidates: RideRecord[], known: Set<string>, baseline: ReviewBaseline, now = new Date()): Record<string, RideReview> {
  const fresh = candidates.filter((r) => !known.has(r.id) && !reviews[r.id]);
  if (!fresh.length) return reviews;
  const batch = fresh.length > 1 ? fresh.map((r) => r.id) : undefined;
  const out = { ...reviews };
  for (const r of fresh) out[r.id] = { rideId: r.id, date: r.date, createdAt: now.toISOString(), baseline, ...(batch && { batch }) };
  // Keep the most recent ones.
  const keep = Object.values(out)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, KEEP);
  return Object.fromEntries(keep.map((r) => [r.rideId, r]));
}

/** How the upcoming plan differs from the snapshot. */
export function planChanges(baseline: ReviewBaseline, sessions: PlannedSession[] | undefined, today: DateKey): PlanChange[] {
  const now = (sessions ?? []).filter((s) => s.date >= today);
  const byId = new Map(now.map((s) => [s.id, s]));
  const before = baseline.sessions.filter((s) => s.date >= today);
  const beforeIds = new Set(before.map((s) => s.id));
  const out: PlanChange[] = [];
  for (const b of before) {
    const s = byId.get(b.id);
    if (!s) {
      out.push({ type: 'removed', title: b.title, date: b.date });
      continue;
    }
    if (s.date !== b.date) out.push({ type: 'moved', title: s.title, from: b.date, to: s.date });
    if (s.kind !== b.kind) out.push({ type: 'replaced', date: s.date, from: b.title, to: s.title });
    else if (s.level !== b.level || Math.abs(s.tss - b.tss) >= Math.max(3, 0.05 * b.tss)) {
      const harder = s.level > b.level || (s.level === b.level && s.tss > b.tss);
      out.push({ type: harder ? 'harder' : 'easier', title: s.title, date: s.date, fromLevel: b.level, toLevel: s.level, fromTss: b.tss, toTss: s.tss });
    }
  }
  for (const s of now) if (!beforeIds.has(s.id)) out.push({ type: 'added', title: s.title, date: s.date });
  return out.sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1));
}

const dateOf = (c: PlanChange) => (c.type === 'moved' ? c.to : c.date);

// Effort -> intensity factor for a ride with no power data (session RPE).
const IF_BY_RPE = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.86, 0.92, 0.98, 1.05];

/** Estimated load for a no-data ride from its length and how hard it felt. */
export function estimateLoad(durationMin: number, rpe = 4): { tss: number; ifactor: number; domain: RideRecord['domain'] } {
  const ifactor = IF_BY_RPE[Math.max(0, Math.min(10, Math.round(rpe)))];
  const tss = (durationMin / 60) * ifactor * ifactor * 100;
  const split = ifactor < 0.7 ? [1, 0, 0] : ifactor < 0.8 ? [0.75, 0.25, 0] : ifactor < 0.9 ? [0.45, 0.45, 0.1] : [0.3, 0.45, 0.25];
  return { tss, ifactor, domain: { low: tss * split[0], mid: tss * split[1], high: tss * split[2] } };
}

const intensityFor = (ifactor: number): Intensity => (ifactor < 0.6 ? 'Recovery' : ifactor < 0.76 ? 'Endurance' : ifactor < 0.88 ? 'Tempo' : ifactor < 1 ? 'Threshold' : 'VO2');

/** A Strava-only ride the athlete filled in, as a completed calendar entry. */
export function detailsToWorkout(r: RideRecord, d: RideDetails, rpe: number | undefined, ftp: number): Workout | undefined {
  if (d.notRide || !d.durationMin) return undefined;
  const est = estimateLoad(d.durationMin, rpe);
  return {
    id: r.id,
    source: 'intervals',
    date: r.date,
    startMin: r.startMin ?? null,
    durationMin: d.durationMin,
    title: 'Ride (via Strava)',
    sport: 'Ride',
    intensity: intensityFor(est.ifactor),
    ifactor: est.ifactor,
    load: Math.round(est.tss),
    kj: Math.round((ftp * est.ifactor * 0.95 * d.durationMin * 60) / 1000),
    kjSource: 'intensity',
    completed: true,
  };
}
