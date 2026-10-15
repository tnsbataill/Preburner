import { addDays, diffDays } from '../engine/time';
import type { DateKey } from '../engine/types';
import type { RideRecord, WellnessRecord } from './history/types';
import { MAX_LEVEL, buildSession, expandBlocks, expectedRpe, levelThatFits, stepMetrics, toIntervalsText } from './library';
import type { HardKind, PlannedSession, SessionKind, TrainingPlan } from './types';

// Closed-loop adjustments, run every day against what actually happened.
// Readiness follows the HRV-guided training literature (Vesterinen, Javaloyes,
// Plews): compare the 7-day rolling mean of lnRMSSD to the athlete's 60-day
// normal range (mean ± 0.5 SD, the "smallest worthwhile change"). Hard work
// goes ahead inside the range and is swapped for easy riding below it.

export type ReadinessLevel = 'green' | 'amber' | 'red';

export interface Readiness {
  date: DateKey;
  level: ReadinessLevel;
  hrv7?: number;
  hrvLow?: number;
  hrvHigh?: number;
  rhrDelta?: number;
  tsb: number;
  reasons: string[];
}

export interface AdaptConfig {
  /** SWC multiplier on the 60-day SD of daily lnRMSSD */
  swc: number;
  /** RHR rise over baseline (bpm) that counts as a warning */
  rhrDelta: number;
  /** TSB below which hard sessions are downgraded regardless of HRV */
  tsbFloor: number;
  /** raise FTP when a maximal effort beats the set FTP by this fraction */
  breakthrough: number;
  /** RPE above expected by this much holds progression; by twice this steps back */
  rpeHarder: number;
  /** RPE below expected by this much adds an extra level */
  rpeEasier: number;
  /** use reported RPE/feel at all */
  useRpe: boolean;
  /** RPE steers progression levels */
  rpeLevels: boolean;
  /** RPE nudges FTP */
  rpeFtp: boolean;
  /** 'feel' counts as a readiness marker */
  feelReadiness: boolean;
}

export const DEFAULT_ADAPT: AdaptConfig = { swc: 1.0, rhrDelta: 3, tsbFloor: -35, breakthrough: 0.03, rpeHarder: 1, rpeEasier: 1.5, useRpe: true, rpeLevels: true, rpeFtp: true, feelReadiness: true };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

export function readiness(wellness: WellnessRecord[], date: DateKey, tsb: number, cfg: AdaptConfig = DEFAULT_ADAPT, rides: RideRecord[] = []): Readiness {
  const reasons: string[] = [];
  const window = (from: number, to: number) => wellness.filter((w) => w.date >= addDays(date, from) && w.date <= addDays(date, to));
  const base = window(-60, -1);
  const last7 = window(-6, 0);
  let hrvFlag = false;
  let rhrFlag = false;
  const out: Readiness = { date, level: 'green', tsb, reasons };
  const baseHrv = base.map((w) => w.lnRmssd).filter((x): x is number => x !== undefined);
  const hrv7 = last7.map((w) => w.lnRmssd).filter((x): x is number => x !== undefined);
  if (baseHrv.length >= 20 && hrv7.length >= 3) {
    const m = mean(baseHrv);
    const s = sd(baseHrv);
    out.hrv7 = mean(hrv7);
    out.hrvLow = m - cfg.swc * s;
    out.hrvHigh = m + cfg.swc * s;
    if (out.hrv7 < out.hrvLow) {
      hrvFlag = true;
      reasons.push('7-day HRV is below your normal range');
    }
  }
  const baseRhr = base.map((w) => w.rhr).filter((x): x is number => x !== undefined);
  const rhr7 = last7.map((w) => w.rhr).filter((x): x is number => x !== undefined);
  if (baseRhr.length >= 20 && rhr7.length >= 3) {
    out.rhrDelta = mean(rhr7) - mean(baseRhr);
    if (out.rhrDelta > cfg.rhrDelta) {
      rhrFlag = true;
      reasons.push(`Resting HR is up ${out.rhrDelta.toFixed(1)} bpm`);
    }
  }
  const deepFatigue = tsb < cfg.tsbFloor;
  if (deepFatigue) reasons.push(`Form (TSB) is ${Math.round(tsb)}`);
  // Two most recent rides (last 4 days) both felt poor or weak.
  const lastFeel = rides
    .filter((r) => r.feel !== undefined && r.date < date && r.date >= addDays(date, -4))
    .slice(-2)
    .map((r) => r.feel!);
  const feelFlag = cfg.useRpe && cfg.feelReadiness && lastFeel.length === 2 && lastFeel.every((f) => f >= 4);
  if (feelFlag) reasons.push('Your last two rides felt poor');
  // Physiological markers decide red; how the athlete feels can only make
  // the day amber (one level easier), never cancel a session on its own.
  const flags = [hrvFlag, rhrFlag, deepFatigue].filter(Boolean).length;
  out.level = flags >= 2 || (hrvFlag && tsb < -20) ? 'red' : flags === 1 || feelFlag ? 'amber' : 'green';
  return out;
}

export type AdjustmentAction = 'downgrade' | 'reduce' | 'progress' | 'move' | 'drop' | 'ftp' | 'replan';

export interface Adjustment {
  date: DateKey;
  action: AdjustmentAction;
  sessionId?: string;
  /** new date for moves */
  newDate?: DateKey;
  newFtp?: number;
  reason: string;
}

export interface AdaptInput {
  plan: TrainingPlan;
  today: DateKey;
  /** rides on or after this date haven't been reviewed yet (default: yesterday) */
  since?: DateKey;
  rides: RideRecord[];
  wellness: WellnessRecord[];
  ftpSet: number;
  tsb: number;
}

export interface AdaptOutput {
  plan: TrainingPlan;
  ftpSet: number;
  readiness: Readiness;
  adjustments: Adjustment[];
  /** true when the remaining plan should be regenerated (long interruption) */
  replan: boolean;
}

export function rebuild(s: PlannedSession, kind: SessionKind, minutes: number, level: number): PlannedSession {
  const b = buildSession(kind, minutes, level);
  const steps = expandBlocks(b.blocks);
  const m = stepMetrics(steps);
  return {
    ...s,
    kind,
    level,
    title: b.title,
    blocks: b.blocks,
    steps,
    durationMin: Math.round(m.seconds / 60),
    ifactor: Math.round(m.ifactor * 1000) / 1000,
    tss: Math.round(m.tss),
    domain: { low: Math.round(m.domain.low), mid: Math.round(m.domain.mid), high: Math.round(m.domain.high) },
    hard: kind !== 'endurance' && kind !== 'recovery' && kind !== 'long' && kind !== 'tempo' && kind !== 'openers',
    structure: toIntervalsText(b.blocks),
    purpose: b.purpose,
  };
}

const isQuality = (s: PlannedSession) => s.hard && s.kind !== 'ftptest';

/**
 * What a session of this kind normally feels like *to this athlete*. People
 * use the RPE scale differently, so once there are 3+ reports for a kind the
 * athlete's own median replaces the generic table. Only rides that went to
 * plan (not failed) at the then-current FTP count toward the norm.
 */
export function personalRpe(rides: RideRecord[], kind: SessionKind, level: number, before: DateKey): number {
  const own = rides
    .filter((r) => r.kind === kind && r.rpe !== undefined && !r.failed && r.date < before && r.date >= addDays(before, -180))
    .map((r) => r.rpe! - expectedRpe(kind, r.level ?? 1));
  if (own.length < 3) return expectedRpe(kind, level);
  const sorted = [...own].sort((a, b) => a - b);
  return expectedRpe(kind, level) + sorted[Math.floor(sorted.length / 2)];
}

export function adaptDay(input: AdaptInput, cfg: AdaptConfig = DEFAULT_ADAPT): AdaptOutput {
  const { today } = input;
  let sessions = [...input.plan.sessions];
  const adjustments: Adjustment[] = [];
  let ftpSet = input.ftpSet;
  const ridesByDate = new Map<DateKey, RideRecord[]>();
  for (const r of input.rides) ridesByDate.set(r.date, [...(ridesByDate.get(r.date) ?? []), r]);
  const rd = readiness(input.wellness, today, input.tsb, cfg, input.rides);

  // 1. Breakthrough: a test or maximal effort above the set FTP raises zones.
  const recent = input.rides.filter((r) => r.date >= addDays(today, -3) && r.date < today && r.best20);
  for (const r of recent) {
    const est = 0.95 * r.best20!;
    if (est > ftpSet * (1 + cfg.breakthrough) || (r.isTest && Math.abs(est - ftpSet) > 3)) {
      ftpSet = Math.round(est);
      adjustments.push({ date: today, action: 'ftp', newFtp: ftpSet, reason: `${r.isTest ? 'Test' : 'Best 20-min effort'} puts FTP at ${ftpSet} W` });
    }
  }
  // 2. Repeated failures on hard sessions: zones are probably set too high.
  const fails = input.rides.filter((r) => r.date >= addDays(today, -14) && r.failed).length;
  if (fails >= 2 && rd.level === 'green' && !adjustments.some((a) => a.action === 'ftp')) {
    const lastFail = input.rides.filter((r) => r.failed).at(-1);
    if (lastFail && lastFail.date >= addDays(today, -2)) {
      ftpSet = Math.round(ftpSet * 0.97);
      adjustments.push({ date: today, action: 'ftp', newFtp: ftpSet, reason: 'Two hard sessions failed in two weeks while fresh: FTP lowered 3%' });
    }
  }

  // 2b. Zones vs perception: if quality sessions ridden at the current FTP
  //     keep feeling clearly easier (or harder) than they should, nudge FTP.
  if (cfg.useRpe && cfg.rpeFtp && !adjustments.some((a) => a.action === 'ftp')) {
    const atThisFtp = input.rides.filter(
      (r) => r.date >= addDays(today, -28) && r.ftpSet === ftpSet && r.rpe !== undefined && r.kind && ['sweetspot', 'threshold', 'overunder', 'vo2'].includes(r.kind),
    );
    if (atThisFtp.length >= 4) {
      const diffs = atThisFtp.slice(-4).map((r) => r.rpe! - personalRpe(input.rides, r.kind as SessionKind, r.level ?? 1, r.date));
      const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      if (avg <= -2 && !atThisFtp.some((r) => r.failed)) {
        ftpSet = Math.round(ftpSet * 1.02);
        adjustments.push({ date: today, action: 'ftp', newFtp: ftpSet, reason: `Your last ${diffs.length} interval sessions all felt easy: FTP raised 2% to ${ftpSet} W` });
      } else if (avg >= 2 && rd.level === 'green') {
        ftpSet = Math.round(ftpSet * 0.98);
        adjustments.push({ date: today, action: 'ftp', newFtp: ftpSet, reason: `Your last ${diffs.length} interval sessions felt harder than they should while recovery looks fine: FTP lowered 2% to ${ftpSet} W` });
      }
    }
  }

  // 3. How did it feel? Reported RPE vs what the session should feel like
  //    steers the level of upcoming sessions of the same kind.
  const since = input.since ?? addDays(today, -1);
  if (cfg.useRpe && cfg.rpeLevels) {
    for (const r of input.rides.filter((x) => x.date >= since && x.date < today && x.kind && (x.rpe !== undefined || x.failed))) {
      const kind = r.kind as SessionKind;
      if (!(kind in MAX_LEVEL)) continue;
      const diff = (r.rpe ?? 10) - personalRpe(input.rides, kind, r.level ?? 1, r.date);
      const feltPoor = (r.feel ?? 0) >= 4;
      const hk = kind as HardKind;
      const upcoming = sessions.filter((x) => x.kind === kind && x.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
      if (!upcoming.length) continue;
      const clampTo = (u: PlannedSession, lv: number) => {
        const planned = u.plannedLevel ?? u.level;
        return Math.max(1, planned - 2, Math.min(MAX_LEVEL[hk], planned + 2, lv));
      };
      const setLevel = (u: PlannedSession, lv: number) => {
        const fit = levelThatFits(hk, clampTo(u, lv), u.durationMin + 15);
        if (fit && fit !== u.level) sessions = sessions.map((x) => (x === u ? { ...rebuild(u, hk, u.durationMin, fit), plannedLevel: u.plannedLevel ?? u.level } : x));
      };
      const done = r.level ?? upcoming[0].level;
      if (r.failed || (diff >= 2 * cfg.rpeHarder && !feltPoor)) {
        // Step back: next session one level below what was ridden, the rest -1.
        setLevel(upcoming[0], done - 1);
        for (const u of upcoming.slice(1)) setLevel(u, u.level - 1);
        adjustments.push({ date: today, action: 'reduce', sessionId: upcoming[0].id, reason: `${r.kind} on ${r.date} ${r.failed ? "couldn't hold the targets" : `felt much harder than expected (RPE ${r.rpe})`}: stepping back a level` });
      } else if (diff >= cfg.rpeHarder) {
        // Hold: repeat the level instead of progressing.
        if (upcoming[0].level > done) {
          setLevel(upcoming[0], done);
          adjustments.push({ date: today, action: 'reduce', sessionId: upcoming[0].id, reason: `${r.kind} on ${r.date} felt harder than expected (RPE ${r.rpe})${feltPoor ? ' on a poor day' : ''}: repeating the level` });
        }
      } else if (diff <= -cfg.rpeEasier && !r.failed && !adjustments.some((a) => a.action === 'ftp')) {
        // (An FTP raise already makes every session harder; don't double up.)
        for (const u of upcoming) setLevel(u, u.level + 1);
        adjustments.push({ date: today, action: 'progress', sessionId: upcoming[0].id, reason: `${r.kind} on ${r.date} felt easy (RPE ${r.rpe}): moving your progression up a level` });
      }
    }
  }

  // 4. Missed sessions. A long gap (illness, travel) triggers a replan.
  const planned7 = sessions.filter((s) => s.date >= addDays(today, -7) && s.date < today);
  const missed = planned7.filter((s) => !(ridesByDate.get(s.date)?.length));
  const replan = planned7.length >= 3 && missed.length >= Math.max(3, Math.ceil(planned7.length * 0.6));
  const isHardOn = (d: DateKey) => sessions.some((s) => s.date === d && isQuality(s));
  const yesterday = addDays(today, -1);
  const missedHard = sessions.find((s) => s.date === yesterday && isQuality(s) && !ridesByDate.get(yesterday)?.length);
  if (missedHard && !replan) {
    // Move it to the first easy day in the next 3 that keeps hard days apart.
    const target = [0, 1, 2]
      .map((o) => addDays(today, o))
      .find((d) => !isHardOn(d) && !isHardOn(addDays(d, -1)) && !isHardOn(addDays(d, 1)) && !sessions.some((s) => s.date === d && (s.kind === 'ftptest' || s.kind === 'openers')));
    const easy = target && sessions.find((s) => s.date === target && !s.hard);
    if (easy) {
      sessions = sessions.map((s) => (s === easy ? { ...rebuild(easy, missedHard.kind, Math.max(easy.durationMin, missedHard.durationMin), missedHard.level), id: easy.id } : s));
      adjustments.push({ date: target!, action: 'move', sessionId: easy.id, reason: `Moved missed ${missedHard.title} from yesterday` });
    }
  }

  // 5. Today's hard session vs readiness.
  const todays = sessions.filter((s) => s.date === today && isQuality(s));
  for (const s of todays) {
    if (rd.level === 'red') {
      const replacement = rebuild(s, 'recovery', Math.min(60, Math.max(30, s.durationMin * 0.6)), 1);
      sessions = sessions.map((x) => (x === s ? replacement : x));
      adjustments.push({ date: today, action: 'downgrade', sessionId: s.id, reason: `Readiness is low (${rd.reasons.join('; ')}): easy spin instead of ${s.title}` });
      // Try to fit the work back in later this week.
      const later = [1, 2, 3]
        .map((o) => addDays(today, o))
        .find((d) => !isHardOn(d) && !isHardOn(addDays(d, -1)) && !isHardOn(addDays(d, 1)) && sessions.some((x) => x.date === d && x.kind === 'endurance'));
      if (later) {
        const easy = sessions.find((x) => x.date === later && x.kind === 'endurance')!;
        sessions = sessions.map((x) => (x === easy ? { ...rebuild(easy, s.kind, Math.max(easy.durationMin, s.durationMin), Math.max(1, s.level - 1)), id: easy.id } : x));
        adjustments.push({ date: later, action: 'move', sessionId: easy.id, reason: `${s.title} moved here from ${today}` });
      }
    } else if (rd.level === 'amber' && s.level > 1) {
      const reduced = rebuild(s, s.kind as HardKind, s.durationMin, s.level - 1);
      sessions = sessions.map((x) => (x === s ? reduced : x));
      adjustments.push({ date: today, action: 'reduce', sessionId: s.id, reason: `${rd.reasons.join('; ')}: one level easier today` });
    }
  }

  return { plan: { ...input.plan, sessions }, ftpSet, readiness: rd, adjustments, replan };
}

/** Days since the plan started. */
export function planDay(plan: TrainingPlan, date: DateKey): number {
  return diffDays(plan.request.start, date);
}
