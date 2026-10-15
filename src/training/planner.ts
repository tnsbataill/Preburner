import { addDays, diffDays } from '../engine/time';
import type { DateKey, Weekday } from '../engine/types';
import { type FitMode, type FitResult, dayLoads, fitModel, perfObservations, stateAtEnd } from './fit';
import { DEFAULT_GENOME, generatePlan, startLevelFromCtl, weeksUntil } from './generator';
import type { RideRecord, WellnessRecord } from './history/types';
import { MAX_LEVEL, expectedRpe } from './library';
import { loadsByDate, performance, pmc } from './model';
import { type Member, optimizePlan } from './optimize';
import type { HardKind, Objective, PlanRequest, TrainingPlan } from './types';

// Front door: training history in, one-shot plan out.

export interface AthleteSnapshot {
  rides: RideRecord[];
  wellness: WellnessRecord[];
  /** FTP currently configured */
  ftpSet: number;
  availabilityHours: Record<Weekday, number>;
  maxRampPerWeek: number;
  /** last day of history (plans start the day after by default) */
  today: DateKey;
}

export interface HistoryAnalysis {
  fit: FitResult;
  members: Member[];
  ctl: number;
  atl: number;
  /** model's estimate of FTP today */
  ftpEstimate: number;
  /** days since the last test or near-maximal effort */
  daysSinceMaxEffort?: number;
  startLevels: Partial<Record<HardKind, number>>;
  /** completed rides with RPE in the last 8 weeks, for transparency */
  rpeSamples: number;
}

export function analyzeHistory(snap: AthleteSnapshot, mode: FitMode = 'core', ensemble = 16): HistoryAnalysis {
  const { rides, today } = snap;
  const loads = dayLoads(rides);
  const obs = perfObservations(rides);
  const fit = fitModel(loads, obs, today, mode, { ensemble });
  const members: Member[] = fit.ensemble.map((p) => ({ p, s0: stateAtEnd(loads, today, p) }));
  const first = loads.reduce((a, d) => (d.date < a ? d.date : a), loads[0]?.date ?? today);
  const series = pmc(first, loadsByDate(loads), diffDays(first, today) + 1);
  const last = series.at(-1) ?? { ctl: 0, atl: 0 };
  const ftpEstimate = Math.round(performance(stateAtEnd(loads, today, fit.params), fit.params));
  const lastMax = obs.filter((o) => o.kind !== 'bound').at(-1);

  // Starting level per kind: the highest level recently completed without
  // it feeling much harder than it should.
  const startLevels: Partial<Record<HardKind, number>> = {};
  const recent = rides.filter((r) => r.date > addDays(today, -56) && r.kind && r.level);
  for (const r of recent) {
    const k = r.kind as HardKind;
    if (!(k in MAX_LEVEL)) continue;
    const ok = !r.failed && (r.rpe === undefined || r.rpe <= expectedRpe(k, r.level!) + 1);
    const lv = ok ? r.level! + 1 : r.level!;
    startLevels[k] = Math.min(MAX_LEVEL[k], Math.max(startLevels[k] ?? 1, lv));
  }
  return {
    fit,
    members,
    ctl: last.ctl,
    atl: last.atl,
    ftpEstimate,
    daysSinceMaxEffort: lastMax ? diffDays(lastMax.date, today) : undefined,
    startLevels,
    rpeSamples: recent.filter((r) => r.rpe !== undefined).length,
  };
}

export interface PlanOptions {
  objective: Objective;
  weeks: number;
  start?: DateKey;
  eventDate?: DateKey;
  /** search the genome space (one-shot optimisation) vs the default template */
  optimize?: boolean;
  mode?: FitMode;
  /** FTP to plan with; default = model estimate */
  ftp?: number;
  baselineTest?: boolean;
  longRideDay?: Weekday;
  /** race dates already on the calendar */
  blockedDates?: DateKey[];
}

export function planFromHistory(snap: AthleteSnapshot, opts: PlanOptions, analysis = analyzeHistory(snap, opts.mode ?? 'core')): { plan: TrainingPlan; analysis: HistoryAnalysis; evaluated: number } {
  const start = opts.start ?? addDays(snap.today, 1);
  const weeks = opts.objective === 'event' && opts.eventDate ? weeksUntil(start, opts.eventDate) : opts.weeks;
  const req: PlanRequest = {
    start,
    weeks,
    objective: opts.objective,
    eventDate: opts.eventDate,
    ftp: opts.ftp ?? analysis.ftpEstimate,
    ctl: Math.round(analysis.ctl),
    atl: Math.round(analysis.atl),
    availabilityHours: snap.availabilityHours,
    maxRampPerWeek: snap.maxRampPerWeek,
    longRideDay: opts.longRideDay,
    blockedDates: opts.blockedDates,
    // No recent maximal effort: open with a test so zones start right.
    baselineTest: opts.baselineTest ?? (analysis.daysSinceMaxEffort === undefined || analysis.daysSinceMaxEffort > 42),
    startLevels: Object.keys(analysis.startLevels).length ? analysis.startLevels : undefined,
  };
  if (!opts.optimize) {
    const plan = generatePlan(req, DEFAULT_GENOME);
    return { plan, analysis, evaluated: 1 };
  }
  const res = optimizePlan(req, analysis.members);
  return { plan: res.plan, analysis, evaluated: res.evaluated };
}

export { startLevelFromCtl };
