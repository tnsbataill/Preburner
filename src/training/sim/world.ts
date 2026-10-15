import { addDays } from '../../engine/time';
import type { DateKey, WorkoutStep } from '../../engine/types';
import type { RideRecord, WellnessRecord } from '../history/types';
import { buildSession, expandBlocks, expandLabels, stepMetrics } from '../library';
import type { HardKind, SessionKind } from '../types';
import { Rng } from './rng';
import { INITIAL, type TruthParams, type TruthState, advance, bestMean, execute, observeHrv, restedFtp, trueFtp } from './truth';

// A simulated athlete living day by day. The planner only ever sees what a
// real athlete's data would show: rides (TSS against their set FTP, best
// efforts), HRV/RHR, and tests. The hidden truth is logged separately for
// grading.

export interface SimSession {
  id: string;
  kind: SessionKind;
  level?: number;
  steps: WorkoutStep[];
  labels: Array<string | undefined>;
}

export interface TruthLog {
  date: DateKey;
  ftp: number;
  rested: number;
  strain: number;
  ill: boolean;
  stressed: boolean;
}

export class SimAthlete {
  s: TruthState = INITIAL;
  rides: RideRecord[] = [];
  wellness: WellnessRecord[] = [];
  truth: TruthLog[] = [];
  /** FTP the athlete has configured (zones are set from this) */
  ftpSet: number;

  private seed: number;

  constructor(
    public p: TruthParams,
    public rng: Rng,
    public day: DateKey,
  ) {
    this.ftpSet = Math.round(p.ftp0);
    this.seed = Math.floor(rng.next() * 2 ** 31);
  }

  /**
   * Common random numbers: each day's noise (illness, life stress, HRV,
   * skips, execution) comes from a stream keyed by athlete and date, so two
   * strategies run on the same athlete face the same life events and only
   * differ where their decisions differ.
   */
  private dayRng(tag: number): Rng {
    let h = this.seed ^ (tag * 0x9e3779b1);
    for (const c of this.day) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    return new Rng(h >>> 0);
  }

  /** Live one day. Returns the ride record if they rode. */
  live(session?: SimSession, observe = true): RideRecord | undefined {
    const date = this.day;
    this.truth.push({ date, ftp: trueFtp(this.s, this.p), rested: restedFtp(this.s, this.p), strain: this.s.strain, ill: this.s.illDays > 0, stressed: this.s.stressDays > 0 });
    if (observe) {
      const h = observeHrv(this.s, this.p, this.dayRng(1));
      this.wellness.push({ date, lnRmssd: h.lnRmssd, rhr: h.rhr });
    }
    let ride: RideRecord | undefined;
    let load = { low: 0, mid: 0, high: 0 };
    const skip = !session || this.s.illDays > 0 || this.dayRng(2).chance(this.p.skipRate + 0.05 * this.s.strain);
    if (session && !skip) {
      const ex = execute(session.steps, this.ftpSet, session.labels, this.s, this.p, this.dayRng(3));
      load = ex.trueLoad;
      // What the athlete's head unit reports: IF/TSS against the *set* FTP.
      const relSteps = ex.watts.map((x) => ({ durationS: x.durationS, lo: x.w / this.ftpSet, hi: x.w / this.ftpSet }));
      const m = stepMetrics(relSteps);
      const isTest = session.kind === 'ftptest';
      ride = {
        id: session.id,
        date,
        durationMin: Math.round(m.seconds / 60),
        tss: Math.round(m.tss),
        domain: { low: m.domain.low, mid: m.domain.mid, high: m.domain.high },
        ftpSet: this.ftpSet,
        best5: bestMean(ex.watts, 300),
        best20: bestMean(ex.watts, 1200),
        best60: bestMean(ex.watts, 3600),
        isTest,
        failed: ex.failed,
        rpe: ex.rpe,
        feel: ex.feel,
        kind: session.kind,
        level: session.level,
        plannedId: session.id,
        source: 'sim',
      };
      if (observe) this.rides.push(ride);
    }
    this.s = advance(this.s, load, this.p, this.dayRng(4));
    this.day = addDays(this.day, 1);
    return ride;
  }
}

export interface Habits {
  weeklyHours: number;
  /** probability a weekday ride is structured intervals vs Z2 */
  structured: number;
  style: 'sweetspot' | 'mixed' | 'polarized' | 'group';
  /** weeks between FTP tests; 0 = never tests */
  testEvery: number;
  /** athlete updates FTP from breakthroughs in training */
  autoFtp: boolean;
}

export function sampleHabits(rng: Rng): Habits {
  return {
    weeklyHours: rng.uniform(4, 12),
    structured: rng.uniform(0.2, 0.8),
    style: rng.pick(['sweetspot', 'mixed', 'polarized', 'group'] as const),
    testEvery: rng.chance(0.3) ? 0 : Math.round(rng.uniform(6, 16)),
    autoFtp: rng.chance(0.5),
  };
}

const STYLE_KINDS: Record<Habits['style'], HardKind[]> = {
  sweetspot: ['sweetspot', 'sweetspot', 'threshold', 'tempo'],
  mixed: ['sweetspot', 'threshold', 'vo2', 'overunder'],
  polarized: ['vo2', 'vo2', 'anaerobic', 'threshold'],
  group: ['tempo', 'sweetspot', 'vo2'],
};

export function toSimSession(id: string, kind: SessionKind, minutes: number, level: number): SimSession {
  const b = buildSession(kind, minutes, level);
  return { id, kind, level, steps: expandBlocks(b.blocks), labels: expandLabels(b.blocks) };
}

/** A group ride: Z2 with surges and one sustained hard effort (near-maximal). */
function groupRide(id: string, minutes: number, rng: Rng): SimSession {
  const steps: WorkoutStep[] = [];
  const labels: Array<string | undefined> = [];
  const push = (d: number, x: number, l?: string) => {
    steps.push({ durationS: d, lo: x, hi: x });
    labels.push(l);
  };
  push(20 * 60, 0.6);
  const surges = Math.round(rng.uniform(3, 8));
  for (let i = 0; i < surges; i += 1) {
    push(Math.round(rng.uniform(60, 300)), rng.uniform(1.0, 1.25));
    push(Math.round(rng.uniform(300, 900)), 0.68);
  }
  if (rng.chance(0.35)) push(20 * 60, 1.05, 'all-out climb');
  const used = steps.reduce((t, s) => t + s.durationS, 0);
  if (minutes * 60 > used) push(minutes * 60 - used, 0.66);
  return { id, kind: 'long', steps, labels };
}

/**
 * Live `days` of self-directed training (the athlete's history before using
 * the planner). The first `warmupDays` are lived but not recorded, like
 * training that predates the data export.
 */
export function liveHistory(a: SimAthlete, h: Habits, days: number, warmupDays: number): void {
  const levels: Record<string, number> = {};
  let sinceTest = 0;
  for (let d = 0; d < warmupDays + days; d += 1) {
    const observe = d >= warmupDays;
    const wd = d % 7;
    // Weekly rhythm: rest Mon/Fri, intervals Tue/Thu, long Sat/Sun.
    const weekMin = h.weeklyHours * 60;
    let session: SimSession | undefined;
    const id = `hist-${a.day}`;
    if (wd === 1 || wd === 3) {
      if (a.rng.chance(h.structured)) {
        const kind = a.rng.pick(STYLE_KINDS[h.style]);
        const lv = (levels[kind] = Math.min(6, (levels[kind] ?? 1) + (a.rng.chance(0.4) ? 1 : 0)));
        session = toSimSession(id, kind, Math.max(60, weekMin * 0.13), lv);
      } else session = toSimSession(id, 'endurance', weekMin * 0.12, 1);
    } else if (wd === 2) session = a.rng.chance(0.7) ? toSimSession(id, 'endurance', weekMin * 0.12, 1) : undefined;
    else if (wd === 5) session = h.style === 'group' || a.rng.chance(0.3) ? groupRide(id, weekMin * 0.3, a.rng) : toSimSession(id, 'long', weekMin * 0.3, 1);
    else if (wd === 6) session = toSimSession(id, 'long', weekMin * 0.25, 1);
    else if (wd === 4 && a.rng.chance(0.4)) session = toSimSession(id, 'recovery', 45, 1);
    // Periodic tests replace the Tuesday session.
    if (h.testEvery && wd === 1 && sinceTest >= h.testEvery * 7) {
      session = toSimSession(id, 'ftptest', 60, 1);
      sinceTest = 0;
    }
    sinceTest += 1;
    const ride = a.live(session, observe);
    if (ride?.isTest && ride.best20) a.ftpSet = Math.round(ride.best20 * 0.95);
    else if (h.autoFtp && ride?.best20 && ride.best20 * 0.95 > a.ftpSet * 1.02) a.ftpSet = Math.round(ride.best20 * 0.95);
  }
}
