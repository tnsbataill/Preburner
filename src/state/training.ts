import { addDays, diffDays, weekdayOf } from '../engine/time';
import type { DateKey, Schedule, Workout } from '../engine/types';
import type { NewEvent } from '../intervals/client';
import { type AdaptConfig, type Adjustment, DEFAULT_ADAPT, type Readiness, adaptDay, applyRpe, readiness } from '../training/adapt';
import { dayLoads } from '../training/fit';
import { generatePlan, planEnd, sessionToWorkout } from '../training/generator';
import type { ImportReport } from '../training/history/strava';
import type { RideRecord, WellnessRecord } from '../training/history/types';
import { mergeRides } from '../training/history/intervals';
import { loadsByDate, pmc } from '../training/model';
import { Rng } from '../training/sim/rng';
import { samplePopulation } from '../training/sim/truth';
import { SimAthlete, liveHistory, sampleHabits } from '../training/sim/world';
import type { PlannedSession, TrainingPlan } from '../training/types';

// Training-plan state that lives in the app store, plus the pure functions
// that move it forward (adaptation, calendar merge, Intervals payloads).

export interface Feedback {
  rpe?: number;
  feel?: number;
}

export interface TrainingState {
  /** imported Strava history (compact) */
  stravaRides: RideRecord[];
  stravaReport?: ImportReport & { importedAt: string };
  /** longer Intervals history used for the model */
  intervalsRides: RideRecord[];
  wellness: WellnessRecord[];
  plan?: TrainingPlan;
  /** working FTP for the plan (zones); suggestions to change it go in the log */
  ftp?: number;
  /** sessions sent to Intervals, and which have changed since */
  appliedAt?: string;
  dirtyIds: string[];
  adjustments: Adjustment[];
  lastAdapt?: DateKey;
  readiness?: Readiness;
  /** "how did it feel?" answers, keyed by ride id */
  feedback: Record<string, Feedback>;
  /** rides whose RPE has already steered the plan */
  reviewedRides: string[];
  /** hide other (e.g. TrainerRoad) planned sessions inside the plan window */
  replaceExternal: boolean;
}

export const INITIAL_TRAINING: TrainingState = {
  stravaRides: [],
  intervalsRides: [],
  wellness: [],
  dirtyIds: [],
  adjustments: [],
  feedback: {},
  reviewedRides: [],
  replaceExternal: true,
};

/** All rides from every source, de-duplicated, with in-app feedback applied. */
export function historyRides(t: TrainingState): RideRecord[] {
  const merged = mergeRides(t.intervalsRides, t.stravaRides);
  const plan = t.plan;
  const byDate = new Map<DateKey, PlannedSession>();
  for (const s of plan?.sessions ?? []) byDate.set(s.date, s);
  return merged.map((r) => {
    const fb = t.feedback[r.id];
    // A ride on a plan day executed that session: tag it so RPE steers the right progression.
    const s = byDate.get(r.date);
    const matches = s && Math.abs(s.durationMin - r.durationMin) <= Math.max(20, 0.5 * s.durationMin);
    return {
      ...r,
      rpe: fb?.rpe ?? r.rpe,
      feel: fb?.feel ?? r.feel,
      ...(matches ? { kind: s.kind, level: s.level, plannedId: s.id } : {}),
    };
  });
}

/**
 * Apply an RPE answer right away (once per ride), without re-running the rest
 * of today's adaptation.
 */
export function applyFeedback(t: TrainingState, rideId: string, today: DateKey): Partial<TrainingState> | undefined {
  if (!t.plan || t.reviewedRides.includes(rideId)) return undefined;
  const rides = historyRides(t);
  const ride = rides.find((r) => r.id === rideId);
  if (!ride?.kind || ride.rpe === undefined) return undefined;
  const { sessions, adjustments } = applyRpe(t.plan.sessions, rides, ride, today);
  const changed = sessions.filter((s, i) => s !== t.plan!.sessions[i]).map((s) => s.id);
  return {
    plan: { ...t.plan, sessions },
    reviewedRides: [...t.reviewedRides, rideId].slice(-200),
    adjustments: [...adjustments, ...t.adjustments].slice(0, 60),
    dirtyIds: t.appliedAt ? [...new Set([...t.dirtyIds, ...changed])] : t.dirtyIds,
  };
}

/** TSB today from ride history (classic 42/7). */
export function currentTsb(rides: RideRecord[], today: DateKey): { ctl: number; atl: number; tsb: number } {
  if (!rides.length) return { ctl: 0, atl: 0, tsb: 0 };
  const start = addDays(today, -180);
  const series = pmc(start, loadsByDate(dayLoads(rides.filter((r) => r.date >= start && r.date < today))), diffDays(start, today));
  const last = series.at(-1) ?? { ctl: 0, atl: 0 };
  return { ctl: last.ctl, atl: last.atl, tsb: last.ctl - last.atl };
}

/**
 * Run the daily adaptation once per day. Returns the patch for the training
 * state, or undefined when there's nothing to do.
 */
export function runAdaptation(t: TrainingState, today: DateKey, ftp: number, cfg: AdaptConfig = DEFAULT_ADAPT): Partial<TrainingState> | undefined {
  const plan = t.plan;
  if (!plan || t.lastAdapt === today) return undefined;
  const rides = historyRides(t);
  const { tsb } = currentTsb(rides, today);
  // Outside the plan window there's nothing to change, but readiness still matters.
  if (today < plan.request.start || today > addDays(planEnd(plan), 1)) return { lastAdapt: today, readiness: readiness(t.wellness, today, tsb, cfg, rides) };
  const since = t.lastAdapt ? addDays(t.lastAdapt, 0) : addDays(today, -1);
  // Rides whose RPE was already applied (answered in-app) don't count twice.
  const out = adaptDay({ plan, today, since, rides, wellness: t.wellness, ftpSet: t.ftp ?? ftp, tsb, reviewed: t.reviewedRides }, cfg);
  let next = out.plan;
  const adjustments = [...out.adjustments];
  if (out.replan) {
    // Long interruption: rebuild the remaining weeks from where fitness is now.
    const end = planEnd(plan);
    const weeks = Math.floor((diffDays(today, end) + 1) / 7);
    if (weeks >= 2) {
      const { ctl, atl } = currentTsb(rides, today);
      const fresh = generatePlan({ ...plan.request, start: addDays(end, -(weeks * 7 - 1)), weeks, ctl: Math.round(ctl), atl: Math.round(atl), ftp: out.ftpSet, baselineTest: false }, plan.genome);
      next = { ...next, sessions: [...next.sessions.filter((s) => s.date < fresh.request.start), ...fresh.sessions] };
      adjustments.push({ date: today, action: 'replan', reason: `Several sessions were missed: rebuilt the last ${weeks} weeks from your current fitness` });
    }
  }
  const before = new Map(plan.sessions.map((s) => [s.id, JSON.stringify(s.steps)]));
  const changed = next.sessions.filter((s) => before.get(s.id) !== JSON.stringify(s.steps)).map((s) => s.id);
  const processed = rides.filter((r) => r.date >= since && r.date < today && r.kind && r.rpe !== undefined).map((r) => r.id);
  return {
    plan: next,
    ftp: out.ftpSet,
    lastAdapt: today,
    reviewedRides: [...new Set([...t.reviewedRides, ...processed])].slice(-200),
    readiness: out.readiness,
    adjustments: [...adjustments, ...t.adjustments].slice(0, 60),
    dirtyIds: t.appliedAt ? [...new Set([...t.dirtyIds, ...changed])] : t.dirtyIds,
  };
}

/**
 * The calendar the rest of the app sees: plan sessions from today on (until
 * they're on Intervals), with other planned sessions in the plan window hidden
 * so fuelling and fitness don't double-count.
 */
export function mergePlanIntoCalendar(workouts: Workout[], t: TrainingState, today: DateKey, mode: 'demo' | 'intervals', ftp: number): Workout[] {
  const plan = t.plan;
  if (!plan) return workouts;
  const start = plan.request.start;
  const end = planEnd(plan);
  const inWindow = (d: DateKey) => d >= start && d <= end;
  const onIntervals = mode === 'intervals' && !!t.appliedAt;
  const kept = workouts.filter((w) => {
    if (w.completed || !inWindow(w.date) || w.date < today) return true;
    if (w.source === 'preburner') return onIntervals ? !t.dirtyIds.some((id) => w.externalId === `preburner-plan-${id}`) : !w.externalId?.startsWith('preburner-plan-');
    return !t.replaceExternal;
  });
  const local = plan.sessions
    .filter((s) => s.date >= today && (!onIntervals || t.dirtyIds.includes(s.id)))
    .map((s) => sessionToWorkout(s, t.ftp ?? ftp));
  return [...kept, ...local];
}

export function sessionEvent(s: PlannedSession, schedule: Schedule): NewEvent {
  const startMin = schedule.defaultTrainingMin[weekdayOf(s.date)];
  const hh = String(Math.floor(startMin / 60)).padStart(2, '0');
  const mm = String(startMin % 60).padStart(2, '0');
  return {
    start_date_local: `${s.date}T${hh}:${mm}:00`,
    category: 'WORKOUT',
    type: s.kind === 'long' ? 'Ride' : 'VirtualRide',
    name: s.title,
    // Purpose first, then the workout-builder steps Intervals turns into structure.
    description: `${s.purpose}\n\n${s.structure}`,
    moving_time: s.durationMin * 60,
    load_target: s.tss,
    external_id: `preburner-plan-${s.id}`,
    tags: ['preburner', 'preburner-plan'],
  };
}

/** Synthetic year of history for demo mode (same simulator as the experiments). */
export function demoTrainingHistory(today: DateKey): { rides: RideRecord[]; wellness: WellnessRecord[] } {
  const rng = new Rng(20261014);
  const p = samplePopulation(rng);
  const h = { ...sampleHabits(rng), weeklyHours: 9, testEvery: 8, style: 'mixed' as const };
  const a = new SimAthlete(p, rng, addDays(today, -365 - 120));
  liveHistory(a, h, 365, 120);
  // Leave the latest rides unrated so the demo shows the "how did it feel?" prompt.
  const rides = a.rides.map((r, i) => (i >= a.rides.length - 2 ? { ...r, rpe: undefined, feel: undefined } : r));
  return { rides, wellness: a.wellness };
}
