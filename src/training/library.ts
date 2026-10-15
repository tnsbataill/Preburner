import type { WorkoutStep } from '../engine/types';
import type { Block, DomainLoad, HardKind, SessionKind } from './types';

// Session library with progression levels. Main sets follow common, well-
// documented formats (sweet spot 3x10 -> 2x30, threshold 4x8 -> 2x20, VO2 5x3 ->
// 5x5, 30/15s). Each level adds roughly 5-10% work over the previous one, the
// same small-step idea as TrainerRoad's progression levels.

type MainSet = { reps: number; on: [number, number, number]; off?: [number, number]; note: string };
// on = [seconds, lo, hi]; off = [seconds, power]

const m = (min: number) => min * 60;

const PROGRESSIONS: Record<HardKind, MainSet[]> = {
  tempo: [
    { reps: 2, on: [m(15), 0.76, 0.85], off: [m(5), 0.55], note: '2x15 tempo' },
    { reps: 2, on: [m(20), 0.76, 0.85], off: [m(5), 0.55], note: '2x20 tempo' },
    { reps: 3, on: [m(15), 0.78, 0.87], off: [m(5), 0.55], note: '3x15 tempo' },
    { reps: 2, on: [m(30), 0.76, 0.85], off: [m(5), 0.55], note: '2x30 tempo' },
    { reps: 3, on: [m(20), 0.78, 0.87], off: [m(5), 0.55], note: '3x20 tempo' },
    { reps: 2, on: [m(40), 0.78, 0.87], off: [m(5), 0.55], note: '2x40 tempo' },
  ],
  sweetspot: [
    { reps: 3, on: [m(10), 0.88, 0.93], off: [m(5), 0.55], note: '3x10 sweet spot' },
    { reps: 3, on: [m(12), 0.88, 0.93], off: [m(5), 0.55], note: '3x12 sweet spot' },
    { reps: 4, on: [m(10), 0.88, 0.93], off: [m(4), 0.55], note: '4x10 sweet spot' },
    { reps: 3, on: [m(15), 0.88, 0.93], off: [m(5), 0.55], note: '3x15 sweet spot' },
    { reps: 2, on: [m(20), 0.88, 0.94], off: [m(5), 0.55], note: '2x20 sweet spot' },
    { reps: 3, on: [m(20), 0.88, 0.94], off: [m(5), 0.55], note: '3x20 sweet spot' },
    { reps: 2, on: [m(30), 0.88, 0.93], off: [m(6), 0.55], note: '2x30 sweet spot' },
    { reps: 3, on: [m(25), 0.88, 0.94], off: [m(5), 0.55], note: '3x25 sweet spot' },
  ],
  threshold: [
    { reps: 4, on: [m(8), 0.95, 1.0], off: [m(4), 0.55], note: '4x8 threshold' },
    { reps: 3, on: [m(10), 0.95, 1.0], off: [m(5), 0.55], note: '3x10 threshold' },
    { reps: 4, on: [m(10), 0.95, 1.0], off: [m(5), 0.55], note: '4x10 threshold' },
    { reps: 3, on: [m(12), 0.95, 1.0], off: [m(5), 0.55], note: '3x12 threshold' },
    { reps: 3, on: [m(15), 0.95, 1.0], off: [m(5), 0.55], note: '3x15 threshold' },
    { reps: 2, on: [m(20), 0.95, 1.0], off: [m(6), 0.55], note: '2x20 threshold' },
    { reps: 3, on: [m(18), 0.95, 1.0], off: [m(6), 0.55], note: '3x18 threshold' },
  ],
  // Over-unders: each rep is n x (2m @ 95% / 1m @ 105%), built as blocks below.
  overunder: [
    { reps: 3, on: [m(6), 0.95, 1.05], off: [m(5), 0.55], note: '3x6 over-unders' },
    { reps: 3, on: [m(9), 0.95, 1.05], off: [m(5), 0.55], note: '3x9 over-unders' },
    { reps: 4, on: [m(9), 0.95, 1.05], off: [m(5), 0.55], note: '4x9 over-unders' },
    { reps: 3, on: [m(12), 0.95, 1.05], off: [m(5), 0.55], note: '3x12 over-unders' },
    { reps: 4, on: [m(12), 0.95, 1.05], off: [m(5), 0.55], note: '4x12 over-unders' },
  ],
  vo2: [
    { reps: 5, on: [m(3), 1.12, 1.2], off: [m(3), 0.5], note: '5x3 VO2max' },
    { reps: 6, on: [m(3), 1.12, 1.2], off: [m(3), 0.5], note: '6x3 VO2max' },
    { reps: 5, on: [m(4), 1.1, 1.18], off: [m(4), 0.5], note: '5x4 VO2max' },
    { reps: 6, on: [m(4), 1.1, 1.18], off: [m(4), 0.5], note: '6x4 VO2max' },
    { reps: 5, on: [m(5), 1.08, 1.15], off: [m(5), 0.5], note: '5x5 VO2max' },
    { reps: 6, on: [m(5), 1.08, 1.15], off: [m(5), 0.5], note: '6x5 VO2max' },
  ],
  // 30/15s: sets of 13 x (30s hard / 15s easy), Rønnestad-style.
  anaerobic: [
    { reps: 2, on: [m(9.75), 1.2, 1.3], off: [m(5), 0.5], note: '2 sets of 13x 30/15s' },
    { reps: 3, on: [m(9.75), 1.2, 1.3], off: [m(5), 0.5], note: '3 sets of 13x 30/15s' },
    { reps: 4, on: [m(9.75), 1.2, 1.3], off: [m(4), 0.5], note: '4 sets of 13x 30/15s' },
  ],
};

export const MAX_LEVEL: Record<HardKind, number> = Object.fromEntries(
  Object.entries(PROGRESSIONS).map(([k, v]) => [k, v.length]),
) as Record<HardKind, number>;

const PURPOSE: Record<SessionKind, string> = {
  recovery: 'Promote recovery while keeping the legs moving.',
  endurance: 'Aerobic volume: mitochondrial and capillary density, fat oxidation, durability.',
  long: 'Long aerobic ride: durability and fatigue resistance.',
  tempo: 'Muscular endurance at tempo, low cost per unit of stimulus.',
  sweetspot: 'Raise threshold power with high time-in-zone at moderate cost.',
  threshold: 'Push threshold power directly with time at FTP.',
  overunder: 'Threshold with surges: lactate clearance and sustained power.',
  vo2: 'Raise VO2max, the ceiling that threshold builds under.',
  anaerobic: 'Short intervals that accumulate a lot of time near VO2max.',
  openers: 'Short efforts to feel sharp for tomorrow.',
  ftptest: 'Measure the new FTP and reset training zones.',
};

const TITLE: Record<SessionKind, string> = {
  recovery: 'Recovery spin',
  endurance: 'Endurance',
  long: 'Long endurance',
  tempo: 'Tempo',
  sweetspot: 'Sweet spot',
  threshold: 'Threshold',
  overunder: 'Over-unders',
  vo2: 'VO2max',
  anaerobic: '30/15s',
  openers: 'Openers',
  ftptest: 'FTP test',
};

export function mainSet(kind: HardKind, level: number): Block[] {
  const lv = Math.max(1, Math.min(MAX_LEVEL[kind], Math.round(level)));
  const s = PROGRESSIONS[kind][lv - 1];
  const [onS, lo, hi] = s.on;
  const off = s.off;
  if (kind === 'overunder') {
    const cycles = Math.round(onS / 180);
    const blocks: Block[] = [];
    for (let r = 0; r < s.reps; r += 1) {
      blocks.push({ reps: cycles, steps: [{ durationS: 120, lo: 0.94, hi: 0.96 }, { durationS: 60, lo: 1.04, hi: 1.06 }] });
      if (off && r < s.reps - 1) blocks.push({ reps: 1, steps: [{ durationS: off[0], lo: off[1], hi: off[1] }] });
    }
    return blocks;
  }
  if (kind === 'anaerobic') {
    const blocks: Block[] = [];
    for (let r = 0; r < s.reps; r += 1) {
      blocks.push({ reps: 13, steps: [{ durationS: 30, lo, hi }, { durationS: 15, lo: 0.5, hi: 0.5 }] });
      if (off && r < s.reps - 1) blocks.push({ reps: 1, steps: [{ durationS: off[0], lo: off[1], hi: off[1] }] });
    }
    return blocks;
  }
  const steps: Block['steps'] = [{ durationS: onS, lo, hi }];
  if (off) steps.push({ durationS: off[0], lo: off[1], hi: off[1] });
  return [{ reps: s.reps, steps }];
}

export function levelNote(kind: HardKind, level: number): string {
  const lv = Math.max(1, Math.min(MAX_LEVEL[kind], Math.round(level)));
  return PROGRESSIONS[kind][lv - 1].note;
}

const WARMUP: Block = {
  reps: 1,
  steps: [
    { durationS: m(10), lo: 0.5, hi: 0.65, label: 'Warmup' },
    { durationS: m(3), lo: 0.75, hi: 0.8 },
    { durationS: m(2), lo: 0.55, hi: 0.55 },
  ],
};
const COOLDOWN: Block = { reps: 1, steps: [{ durationS: m(8), lo: 0.45, hi: 0.55, label: 'Cooldown' }] };
const z2 = (sec: number): Block => ({ reps: 1, steps: [{ durationS: sec, lo: 0.62, hi: 0.72 }] });

export function blocksSeconds(blocks: Block[]): number {
  return blocks.reduce((t, b) => t + b.reps * b.steps.reduce((s, x) => s + x.durationS, 0), 0);
}

/** Minimum minutes for a hard session at a level (warmup + main set + cooldown). */
export function coreMinutes(kind: HardKind, level: number): number {
  return Math.ceil((blocksSeconds([WARMUP, ...mainSet(kind, level), COOLDOWN]) / 60) / 5) * 5;
}

/** Highest level of `kind` that fits in `minutes`. 0 if none fits. */
export function levelThatFits(kind: HardKind, wanted: number, minutes: number): number {
  for (let lv = Math.min(wanted, MAX_LEVEL[kind]); lv >= 1; lv -= 1) if (coreMinutes(kind, lv) <= minutes) return lv;
  return 0;
}

export function expandBlocks(blocks: Block[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const b of blocks) for (let r = 0; r < b.reps; r += 1) for (const s of b.steps) out.push({ durationS: s.durationS, lo: s.lo, hi: s.hi });
  return out;
}

const DOMAIN_LOW = 0.76;
const DOMAIN_HIGH = 1.05;

/** NP-style IF, TSS and per-domain TSS split, from steps. */
export function stepMetrics(steps: WorkoutStep[]): { ifactor: number; tss: number; domain: DomainLoad; seconds: number } {
  const seconds = steps.reduce((t, s) => t + s.durationS, 0);
  if (!seconds) return { ifactor: 0, tss: 0, domain: { low: 0, mid: 0, high: 0 }, seconds: 0 };
  const p4 = steps.reduce((a, s) => a + ((s.lo + s.hi) / 2) ** 4 * s.durationS, 0) / seconds;
  const ifactor = p4 ** 0.25;
  const tss = (seconds / 3600) * ifactor * ifactor * 100;
  // Split TSS by each step's share of the 4th-power work, which is what drives NP.
  const raw: DomainLoad = { low: 0, mid: 0, high: 0 };
  for (const s of steps) {
    const p = (s.lo + s.hi) / 2;
    const w = p ** 4 * s.durationS;
    raw[p < DOMAIN_LOW ? 'low' : p <= DOMAIN_HIGH ? 'mid' : 'high'] += w;
  }
  const sum = raw.low + raw.mid + raw.high;
  const domain: DomainLoad = { low: (tss * raw.low) / sum, mid: (tss * raw.mid) / sum, high: (tss * raw.high) / sum };
  return { ifactor, tss, domain, seconds };
}

const fmtDur = (sec: number) => {
  const mm = Math.floor(sec / 60);
  const ss = Math.round(sec % 60);
  return ss ? (mm ? `${mm}m${ss}s` : `${ss}s`) : `${mm}m`;
};
const fmtPct = (lo: number, hi: number) => (Math.round(lo * 100) === Math.round(hi * 100) ? `${Math.round(lo * 100)}%` : `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`);

/** Intervals.icu workout-builder text (one step per line, `Nx` before repeats). */
export function toIntervalsText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const lines = b.steps.map((s) => `- ${s.label ? `${s.label} ` : ''}${fmtDur(s.durationS)} ${fmtPct(s.lo, s.hi)}`);
    parts.push(b.reps > 1 ? `${b.reps}x\n${lines.join('\n')}` : lines.join('\n'));
  }
  return parts.join('\n\n');
}

export interface BuiltSession {
  kind: SessionKind;
  level: number;
  title: string;
  blocks: Block[];
  purpose: string;
}

/**
 * Build a session that fills `minutes`. Hard sessions get warmup + main set,
 * then aerobic filler before the cooldown when there's spare time.
 */
/**
 * Build a session that fills `minutes`. Hard sessions get warmup + main set,
 * then aerobic filler before the cooldown when there's spare time. `scale`
 * personalises the main-set targets (e.g. 0.94 = VO2 work 6% below the
 * generic %FTP for a rider whose short-interval power is weaker than FTP predicts).
 */
export function buildSession(kind: SessionKind, minutes: number, level = 1, scale = 1): BuiltSession {
  const sec = Math.max(20, minutes) * 60;
  let blocks: Block[];
  let title = TITLE[kind];
  switch (kind) {
    case 'recovery':
      blocks = [{ reps: 1, steps: [{ durationS: sec, lo: 0.45, hi: 0.55 }] }];
      break;
    case 'endurance':
    case 'long': {
      const wu = Math.min(m(10), sec * 0.2);
      blocks = [{ reps: 1, steps: [{ durationS: wu, lo: 0.5, hi: 0.6, label: 'Warmup' }] }, z2(sec - wu)];
      title = `${TITLE[kind]} ${Math.round(minutes / 15) * 15 >= 60 ? `${(Math.round(minutes / 15) * 15) / 60}h` : `${minutes}m`}`;
      break;
    }
    case 'openers': {
      const efforts: Block = { reps: 3, steps: [{ durationS: 60, lo: 1.05, hi: 1.1 }, { durationS: m(2), lo: 0.55, hi: 0.55 }] };
      const sprints: Block = { reps: 3, steps: [{ durationS: 15, lo: 1.5, hi: 1.5 }, { durationS: m(2), lo: 0.5, hi: 0.5 }] };
      const used = blocksSeconds([WARMUP, efforts, sprints, COOLDOWN]);
      blocks = [WARMUP, efforts, sprints, ...(sec - used > 60 ? [z2(sec - used)] : []), COOLDOWN];
      break;
    }
    case 'ftptest': {
      const pre: Block = { reps: 1, steps: [{ durationS: m(5), lo: 1.05, hi: 1.1, label: 'Blowout' }, { durationS: m(10), lo: 0.5, hi: 0.55 }] };
      const test: Block = { reps: 1, steps: [{ durationS: m(20), lo: 1.0, hi: 1.05, label: '20 min all-out' }] };
      blocks = [WARMUP, pre, test, COOLDOWN];
      title = 'FTP test (20 min)';
      break;
    }
    default: {
      const hk = kind as HardKind;
      const main = scale === 1 ? mainSet(hk, level) : mainSet(hk, level).map((b) => ({ ...b, steps: b.steps.map((st) => (st.lo >= 0.76 ? { ...st, lo: st.lo * scale, hi: st.hi * scale } : st)) }));
      const used = blocksSeconds([WARMUP, ...main, COOLDOWN]);
      blocks = [WARMUP, ...main, ...(sec - used >= m(5) ? [z2(sec - used)] : []), COOLDOWN];
      title = `${TITLE[kind]}: ${levelNote(hk, level)}`;
    }
  }
  return { kind, level, title, blocks, purpose: PURPOSE[kind] };
}

export const HARD_KINDS: HardKind[] = ['tempo', 'sweetspot', 'threshold', 'overunder', 'vo2', 'anaerobic'];
export const isHardKind = (k: SessionKind): k is HardKind => (HARD_KINDS as SessionKind[]).includes(k) && k !== 'tempo';

/** Step labels aligned with expandBlocks (e.g. to find "all-out" test steps). */
export function expandLabels(blocks: Block[]): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  for (const b of blocks) for (let r = 0; r < b.reps; r += 1) for (const s of b.steps) out.push(s.label);
  return out;
}

/**
 * Session RPE (1-10) a session *should* feel like when zones are right and the
 * athlete is reasonably fresh. Reported RPE is compared to this to steer
 * progression, the same idea as TrainerRoad's post-workout survey.
 */
export function expectedRpe(kind: SessionKind, level = 1): number {
  const lv = Math.max(0, level - 1);
  switch (kind) {
    case 'recovery':
      return 1.5;
    case 'endurance':
      return 3;
    case 'long':
      return 4;
    case 'tempo':
      return 4.5 + 0.1 * lv;
    case 'sweetspot':
      return 5.5 + 0.1 * lv;
    case 'threshold':
      return 6.5 + 0.1 * lv;
    case 'overunder':
      return 6.8 + 0.1 * lv;
    case 'vo2':
      return 6.8 + 0.1 * lv;
    case 'anaerobic':
      return 7.2 + 0.1 * lv;
    case 'openers':
      return 4;
    case 'ftptest':
      return 9.5;
  }
}
