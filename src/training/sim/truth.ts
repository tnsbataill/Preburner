import type { WorkoutStep } from '../../engine/types';
import type { DomainLoad } from '../types';
import type { Rng } from './rng';

// Ground-truth physiology for synthetic athletes. Deliberately a *different*
// structure from the planning model (src/training/model.ts) so we never grade
// the planner against its own assumptions:
//   - per-domain fitness with its own time constant (high-intensity adaptations
//     come and go faster than aerobic base)
//   - a genetic ceiling: gains shrink exponentially as fitness approaches it
//   - stress-weighted acute fatigue (VO2 work costs more per TSS than Z2)
//   - a strain compartment that only fills when acute load outruns chronic
//     fitness. Strain costs performance quadratically (non-functional
//     overreaching) and raises illness risk
//   - sessions fail when targets exceed what the athlete can actually hold,
//     so a mis-set FTP or deep fatigue blunts the stimulus

export interface TruthParams {
  ftp0: number;
  ceiling: number;
  beta: DomainLoad;
  tauF: DomainLoad;
  kAcute: number;
  tauA: number;
  /** acute stress may exceed chronic fitness by this factor before strain builds */
  tolerance: number;
  kStrain: number;
  tauS: number;
  hrvBase: number;
  hrvSd: number;
  hrvSens: number;
  rhrBase: number;
  illnessBase: number;
  skipRate: number;
  /** daily chance a life-stress episode starts */
  stressRate: number;
  /**
   * Power-duration profile: sustainable multiple of FTP for efforts of
   * ~1 / 3 / 8 / 20+ min. Punchy riders hold more over short efforts,
   * diesels less. The planner never sees this directly.
   */
  profile: [number, number, number, number];
}

export interface TruthState {
  f: DomainLoad;
  a: number;
  /** 7-day stress EWMA: the acute side of the acute:chronic ratio */
  a7: number;
  strain: number;
  illDays: number;
  /** days left in a life-stress episode (work, travel, poor sleep) */
  stressDays: number;
}

const STRESS: DomainLoad = { low: 0.8, mid: 1.0, high: 1.45 };

export function samplePopulation(rng: Rng): TruthParams {
  const resp = rng.lognormal(1, 0.35); // overall responder factor
  return {
    ftp0: rng.uniform(170, 260),
    ceiling: rng.uniform(120, 260),
    beta: {
      low: resp * rng.lognormal(0.85, 0.3),
      mid: resp * rng.lognormal(1.3, 0.3),
      high: resp * rng.lognormal(1.8, 0.35),
    },
    tauF: { low: rng.uniform(42, 60), mid: rng.uniform(32, 48), high: rng.uniform(20, 34) },
    kAcute: rng.lognormal(0.45, 0.3),
    tauA: rng.uniform(5, 10),
    tolerance: rng.uniform(1.3, 1.7),
    kStrain: rng.lognormal(0.35, 0.4),
    tauS: rng.uniform(10, 20),
    hrvBase: rng.uniform(3.6, 4.5),
    hrvSd: rng.uniform(0.07, 0.2),
    hrvSens: rng.lognormal(0.25, 0.4),
    rhrBase: rng.uniform(44, 60),
    illnessBase: rng.uniform(0.002, 0.006),
    skipRate: rng.uniform(0.03, 0.12),
    stressRate: rng.uniform(0.008, 0.03),
    profile: PROFILE_VARIATION ? [rng.uniform(1.3, 1.6), rng.uniform(1.1, 1.32), rng.uniform(1.02, 1.1), rng.uniform(0.99, 1.05)] : [1.45, 1.22, 1.06, 1.02],
  };
}

export const INITIAL: TruthState = { f: { low: 0, mid: 0, high: 0 }, a: 0, a7: 0, strain: 0, illDays: 0, stressDays: 0 };

function fitnessGain(s: TruthState, p: TruthParams): number {
  const g = p.beta.low * s.f.low + p.beta.mid * s.f.mid + p.beta.high * s.f.high;
  return p.ceiling * (1 - Math.exp(-g / p.ceiling));
}

/** True FTP right now (watts). */
export function trueFtp(s: TruthState, p: TruthParams): number {
  const chronic = s.f.low + s.f.mid + s.f.high;
  const acuteExcess = s.a - chronic * 0.85;
  const fatigue = p.kAcute * Math.max(0, acuteExcess) * 0.6 + p.kAcute * 0.4 * s.a * 0.35;
  const ill = s.illDays > 0 ? 0.04 * (p.ftp0 + fitnessGain(s, p)) : 0;
  return p.ftp0 + fitnessGain(s, p) - fatigue - p.kStrain * s.strain * s.strain - ill;
}

/** Fitness-only FTP (no fatigue, no strain): the athlete fully rested. */
export function restedFtp(s: TruthState, p: TruthParams): number {
  return p.ftp0 + fitnessGain(s, p);
}

export function advance(s: TruthState, load: DomainLoad, p: TruthParams, rng: Rng): TruthState {
  const stress = STRESS.low * load.low + STRESS.mid * load.mid + STRESS.high * load.high;
  const f = {
    low: s.f.low + (load.low - s.f.low) / p.tauF.low,
    mid: s.f.mid + (load.mid - s.f.mid) / p.tauF.mid,
    high: s.f.high + (load.high - s.f.high) / p.tauF.high,
  };
  // Life stress lowers how much training load the athlete can absorb.
  const stressed = s.stressDays > 0;
  const a = s.a + (stress * (stressed ? 1.3 : 1) - s.a) / p.tauA;
  const a7 = s.a7 + (stress - s.a7) / 7;
  const chronic = f.low + f.mid + f.high;
  const drive = Math.max(0, a7 - p.tolerance * (stressed ? 0.75 : 1) * Math.max(chronic, 25));
  const strain = s.strain + drive / 25 - s.strain / p.tauS;
  let illDays = Math.max(0, s.illDays - 1);
  if (illDays === 0 && rng.chance(p.illnessBase * (1 + 1.5 * strain) * (stressed ? 2 : 1))) illDays = Math.round(rng.uniform(3, 8));
  let stressDays = Math.max(0, s.stressDays - 1);
  if (stressDays === 0 && rng.chance(p.stressRate)) stressDays = Math.round(rng.uniform(4, 12));
  return { f, a, a7, strain, illDays, stressDays };
}

export function observeHrv(s: TruthState, p: TruthParams, rng: Rng): { lnRmssd: number; rhr: number } {
  const chronic = s.f.low + s.f.mid + s.f.high;
  const acute = Math.max(0, s.a - chronic) / 40;
  const st = s.stressDays > 0 ? 1 : 0;
  const lnRmssd = p.hrvBase - p.hrvSens * acute - 0.15 * s.strain - (s.illDays > 0 ? 0.25 : 0) - 0.15 * st + rng.normal(0, p.hrvSd);
  const rhr = p.rhrBase + 3 * acute + 2 * s.strain + (s.illDays > 0 ? 5 : 0) + 2 * st + rng.normal(0, 1.8);
  return { lnRmssd, rhr };
}

export interface Execution {
  /** loads in true physiological domains */
  trueLoad: DomainLoad;
  /** executed watts per step */
  watts: Array<{ durationS: number; w: number }>;
  failed: boolean;
  /** session RPE the athlete would report (1-10) */
  rpe: number;
  /** Intervals 'feel' (1 strong .. 5 weak) */
  feel: number;
}

/** Toggle for experiments: individual power-duration profiles on/off. */
export let PROFILE_VARIATION = true;
export function setProfileVariation(on: boolean) {
  PROFILE_VARIATION = on;
}

const sustainableMultiple = (d: number, p: TruthParams) => (d >= 1200 ? p.profile[3] : d >= 480 ? p.profile[2] : d >= 180 ? p.profile[1] : d >= 60 ? p.profile[0] : 1.9);

/**
 * Ride a session of %FTP steps with the athlete's configured FTP. "All-out"
 * steps (tests) are ridden at true capacity. Steps above what the athlete can
 * sustain are cut to what they can hold.
 */
export function execute(steps: WorkoutStep[], ftpSet: number, labels: Array<string | undefined>, s: TruthState, p: TruthParams, rng: Rng): Execution {
  const cap = trueFtp(s, p);
  const motivation = rng.normal(1, 0.015);
  const watts: Execution['watts'] = [];
  let failed = false;
  steps.forEach((st, i) => {
    let w = ((st.lo + st.hi) / 2) * ftpSet;
    if (labels[i]?.includes('all-out')) w = cap * 1.05 * motivation;
    else {
      // Sustainable multiple of FTP for this duration (rough power-duration curve).
      const limit = cap * sustainableMultiple(st.durationS, p) * motivation;
      if (w > limit) {
        failed = true;
        w = limit * 0.95;
      }
    }
    watts.push({ durationS: st.durationS, w });
  });
  // True physiological load: IF/TSS against true capacity, split by domain.
  const trueLoad: DomainLoad = { low: 0, mid: 0, high: 0 };
  for (const x of watts) {
    const rel = x.w / cap;
    const tss = (x.durationS / 3600) * rel * rel * 100;
    trueLoad[rel < 0.76 ? 'low' : rel <= 1.05 ? 'mid' : 'high'] += tss;
  }
  // Perceived exertion tracks how close the hardest effort came to the
  // athlete's real limit, plus carried fatigue (Foster-style session RPE).
  let hardness = 0;
  for (const win of [60, 180, 480, 1200]) {
    const best = bestMean(watts, win);
    if (best) hardness = Math.max(hardness, best / (cap * sustainableMultiple(win, p)));
  }
  const chronic = Math.max(20, s.f.low + s.f.mid + s.f.high);
  const fatigue = Math.max(0, (s.a - chronic) / chronic) + 0.5 * s.strain;
  const rpe = Math.max(1, Math.min(10, -6.3 + 14.5 * hardness + fatigue + (failed ? 1 : 0) + (s.stressDays > 0 ? 0.7 : 0) + rng.normal(0, 0.6)));
  const feel = Math.max(1, Math.min(5, Math.round(2.6 + 1.5 * fatigue + (s.illDays > 0 ? 1.5 : 0) + (s.stressDays > 0 ? 0.8 : 0) + rng.normal(0, 0.6))));
  return { trueLoad, watts, failed, rpe: Math.round(rpe * 2) / 2, feel };
}

/** Best mean power over `windowS` from a piecewise-constant power series. */
export function bestMean(watts: Array<{ durationS: number; w: number }>, windowS: number): number | undefined {
  const res = 15;
  const series: number[] = [];
  for (const x of watts) for (let t = 0; t < x.durationS; t += res) series.push(x.w);
  const n = Math.round(windowS / res);
  if (series.length < n) return undefined;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += series[i];
  let best = sum;
  for (let i = n; i < series.length; i += 1) {
    sum += series[i] - series[i - n];
    if (sum > best) best = sum;
  }
  return best / n;
}
