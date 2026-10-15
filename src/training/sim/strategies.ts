import { addDays, diffDays, weekdayOf } from '../../engine/time';
import type { RideRecord } from '../history/types';
import type { Weekday } from '../../engine/types';
import { type AdaptConfig, type Adjustment, DEFAULT_ADAPT, adaptDay } from '../adapt';
import { applyMissedReason, applyRideIssue, worthAsking } from '../debrief';
import type { MissedReason } from '../history/types';
import type { FitMode } from '../fit';
import { DEFAULT_GENOME, generatePlan } from '../generator';
import { dayLoads } from '../fit';
import { expandLabels } from '../library';
import { loadsByDate, pmc } from '../model';
import { targetDate } from '../optimize';
import { type AthleteSnapshot, analyzeHistory, planFromHistory } from '../planner';
import type { Objective, TrainingPlan } from '../types';
import { HISTORY_START, makeAthlete } from './experiments';
import { trueFtp } from './truth';
import type { SimAthlete } from './world';

// Closed-loop comparison of planning strategies on synthetic athletes. Each
// strategy gets an identical athlete (same seed, same history) and is graded
// by the *truth* model, never by the planner's own predictions.

export interface Strategy {
  name: string;
  /** how the plan is built */
  build: 'static' | 'optimize';
  mode: FitMode;
  adapt?: Partial<AdaptConfig> | false;
  /** athlete answers "what happened?"; misreport = share of tired skips reported as no time */
  debrief?: { misreport: number };
}

export const STRATEGIES: Record<string, Strategy> = {
  static: { name: 'static', build: 'static', mode: 'prior', adapt: false },
  'static+adapt': { name: 'static+adapt', build: 'static', mode: 'prior', adapt: {} },
  'opt-prior': { name: 'opt-prior', build: 'optimize', mode: 'prior', adapt: false },
  'opt-core': { name: 'opt-core', build: 'optimize', mode: 'core', adapt: false },
  'opt-core+adapt': { name: 'opt-core+adapt', build: 'optimize', mode: 'core', adapt: {} },
  'opt-core+adapt+debrief': { name: 'opt-core+adapt+debrief', build: 'optimize', mode: 'core', adapt: {}, debrief: { misreport: 0 } },
  'opt-core+adapt-norpe': { name: 'opt-core+adapt-norpe', build: 'optimize', mode: 'core', adapt: { useRpe: false } },
};

export interface RunResult {
  seed: number;
  strategy: string;
  startFtp: number;
  endFtp: number;
  gain: number;
  restedGain: number;
  illDays: number;
  maxStrain: number;
  failed: number;
  hours: number;
  adjustments: number;
}

export interface RunConfig {
  weeks: number;
  objective: Objective;
  availability?: Record<Weekday, number>;
  maxRamp?: number;
  historyDays?: number;
}

export function runStrategy(seed: number, strat: Strategy, cfg: RunConfig): RunResult {
  const historyDays = cfg.historyDays ?? 365;
  const { a, h } = makeAthlete(seed, historyDays);
  const today = addDays(HISTORY_START, historyDays - 1);
  void h;
  const availability = cfg.availability ?? habitAvailability(a.rides, today);
  const snap: AthleteSnapshot = { rides: a.rides, wellness: a.wellness, ftpSet: a.ftpSet, availabilityHours: availability, maxRampPerWeek: cfg.maxRamp ?? 6, today };

  let plan: TrainingPlan;
  if (strat.build === 'static') {
    // TrainerRoad-style: default template, FTP from a week-1 test.
    const analysis = analyzeHistory(snap, 'prior', 1);
    plan = planFromHistory(snap, { objective: cfg.objective, weeks: cfg.weeks, optimize: false, ftp: a.ftpSet, baselineTest: true }, analysis).plan;
  } else {
    plan = planFromHistory(snap, { objective: cfg.objective, weeks: cfg.weeks, optimize: true, mode: strat.mode }).plan;
    // The planner sets zones from its FTP estimate.
    a.ftpSet = plan.request.ftp;
  }
  return livePlan(a, plan, strat, seed);
}

/**
 * What an athlete would enter as availability: a bit more than they currently
 * ride on each weekday (max of the last 8 weeks x 1.25), at least 1 h on days
 * they ride, rounded to 15 min.
 */
export function habitAvailability(rides: RideRecord[], today: string): Record<Weekday, number> {
  const out = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<Weekday, number>;
  for (const r of rides.filter((x) => x.date > addDays(today, -56))) {
    const wd = weekdayOf(r.date);
    out[wd] = Math.max(out[wd], r.durationMin / 60);
  }
  for (const k of Object.keys(out)) {
    const wd = Number(k) as Weekday;
    out[wd] = out[wd] > 0 ? Math.max(1, Math.round(out[wd] * 1.25 * 4) / 4) : 0;
  }
  return out;
}

/** Optional trace hook for debugging single runs. */
export let simLog: ((line: string) => void) | undefined;
export function setSimLog(fn?: (line: string) => void) {
  simLog = fn;
}

export function livePlan(a: SimAthlete, plan0: TrainingPlan, strat: Strategy, seed: number): RunResult {
  let plan = plan0;
  const start = plan.request.start;
  const end = targetDate(plan);
  const startFtp = trueFtp(a.s, a.p);
  const startRested = a.truth.at(-1)?.rested ?? startFtp;
  const truthStartIdx = a.truth.length;
  const cfg = strat.adapt === false || strat.adapt === undefined ? undefined : { ...DEFAULT_ADAPT, ...strat.adapt };
  let adjustments = 0;
  let lastReplan = '';
  const downgrades: string[] = [];
  const missedReasons: Record<string, MissedReason> = {};
  const history: Adjustment[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (cfg) {
      const loads = loadsByDate(dayLoads(a.rides.filter((r) => r.date >= addDays(day, -120))));
      const series = pmc(addDays(day, -120), loads, 120);
      const last = series.at(-1)!;
      const out = adaptDay({ plan, today: day, rides: a.rides, wellness: a.wellness, ftpSet: a.ftpSet, tsb: last.ctl - last.atl, recentDowngrades: downgrades, missedReasons }, cfg);
      for (const adj of out.adjustments) if (adj.action === 'downgrade') downgrades.push(day);
      history.unshift(...out.adjustments);
      plan = out.plan;
      a.ftpSet = out.ftpSet;
      adjustments += out.adjustments.length;
      for (const adj of out.adjustments) simLog?.(`${day} ${out.readiness.level} ${adj.action}: ${adj.reason}`);
      if (out.replan && (!lastReplan || diffDays(lastReplan, day) >= 10) && diffDays(day, end) >= 14) {
        // Long interruption: rebuild the rest of the plan from today's state.
        const weeks = Math.max(1, Math.floor((diffDays(day, end) + 1) / 7));
        const fresh = generatePlan({ ...plan.request, start: addDays(end, -(weeks * 7 - 1)), weeks, ctl: Math.round(last.ctl), atl: Math.round(last.atl), ftp: a.ftpSet, baselineTest: false }, plan.genome ?? DEFAULT_GENOME);
        plan = { ...plan, sessions: [...plan.sessions.filter((s) => s.date < fresh.request.start), ...fresh.sessions] };
        lastReplan = day;
        adjustments += 1;
      }
    }
    const s = plan.sessions.find((x) => x.date === day);
    const ride = a.live(s ? { id: s.id, kind: s.kind, level: s.level, steps: s.steps, labels: expandLabels(s.blocks) } : undefined);
    if (simLog) {
      const t = a.truth.at(-1)!;
      simLog(`  ${day} ${s ? `${s.kind} L${s.level} ${s.tss}tss` : 'rest'} ${ride ? `rode rpe ${ride.rpe} feel ${ride.feel}${ride.failed ? ' FAILED' : ''}` : s ? 'SKIPPED' : ''} | true ${t.ftp.toFixed(0)} rested ${t.rested.toFixed(0)} strain ${t.strain.toFixed(2)}${t.ill ? ' ILL' : ''}${t.stressed ? ' STRESS' : ''} ftpSet ${a.ftpSet}`);
    }
    // That evening the athlete answers "what happened?".
    if (cfg && strat.debrief && s && worthAsking(s)) {
      const tomorrow = addDays(day, 1);
      let res: { sessions: TrainingPlan['sessions']; adjustments: Adjustment[] } | undefined;
      if (!ride && a.lastSkip) {
        const reason: MissedReason = a.lastSkip === 'tired' && a.answerDraw < strat.debrief.misreport ? 'time' : a.lastSkip;
        missedReasons[s.id] = reason;
        simLog?.(`${day} answered: skipped ${s.kind} (${reason})`);
        res = applyMissedReason(plan.sessions, s, reason, tomorrow, history, plan.intensityScale);
      } else if (ride?.failed && a.lastUnwell) {
        // Failed while stressed or getting ill: not a sign the targets are wrong.
        ride.failed = false;
        ride.issue = 'unwell';
        simLog?.(`${day} answered: ${s.kind} failed while unwell`);
        res = applyRideIssue(plan.sessions, a.rides, ride, 'unwell', tomorrow, false, plan.intensityScale);
      } else if (ride?.failed) ride.issue = 'too-hard';
      if (res) {
        plan = { ...plan, sessions: res.sessions };
        history.unshift(...res.adjustments);
        adjustments += res.adjustments.length;
      }
    }
    // Athletes update their FTP after a test whatever the strategy.
    if (ride?.isTest && ride.best20) a.ftpSet = Math.round(ride.best20 * 0.95);
  }
  const truth = a.truth.slice(truthStartIdx);
  const atEnd = truth.find((t) => t.date === end) ?? truth.at(-1)!;
  const rides = a.rides.filter((r) => r.date >= start && r.date <= end);
  return {
    seed,
    strategy: strat.name,
    startFtp,
    endFtp: atEnd.ftp,
    gain: atEnd.ftp / startFtp - 1,
    restedGain: atEnd.rested / startRested - 1,
    illDays: truth.filter((t) => t.ill).length,
    maxStrain: Math.max(...truth.map((t) => t.strain)),
    failed: rides.filter((r) => r.failed).length,
    hours: rides.reduce((s, r) => s + r.durationMin, 0) / 60 / Math.max(1, diffDays(start, end) / 7),
    adjustments,
  };
}
