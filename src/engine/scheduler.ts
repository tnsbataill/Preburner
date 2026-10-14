import { isHard } from './energy';
import { duringCarbPerHour, duringFluid, splitSugars } from './fueling';
import { formatClock, formatDuration, weekdayOf } from './time';
import type { DateKey, Macros, MealSlot, NutritionPrefs, Schedule, SlotKind, Workout } from './types';

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export type ResolvedWorkout = Workout & { resolvedStartMin: number; timeAssumed: boolean };

/**
 * Give every workout a concrete start. TrainerRoad → Intervals syncs are
 * date-only, so unknown times fall back to the athlete's usual slot for that
 * weekday; a second unknown session the same day goes 5 h after the first.
 */
export function resolveWorkoutTimes(date: DateKey, workouts: Workout[], schedule: Schedule): ResolvedWorkout[] {
  const known = workouts.filter((w) => w.startMin !== null).sort((a, b) => a.startMin! - b.startMin!);
  const unknown = workouts.filter((w) => w.startMin === null);
  const out: ResolvedWorkout[] = known.map((w) => ({ ...w, resolvedStartMin: w.startMin!, timeAssumed: false }));
  let cursor = schedule.defaultTrainingMin[weekdayOf(date)];
  for (const w of unknown) {
    // Don't stack an assumed session on top of a known one.
    for (const k of out) {
      const kEnd = k.resolvedStartMin + k.durationMin;
      if (cursor < kEnd + 60 && cursor + w.durationMin > k.resolvedStartMin - 60) cursor = kEnd + 240;
    }
    const latest = schedule.sleepMin - w.durationMin - 90;
    out.push({ ...w, resolvedStartMin: Math.max(schedule.wakeMin + 20, Math.min(cursor, latest)), timeAssumed: true });
    cursor += w.durationMin + 300;
  }
  return out.sort((a, b) => a.resolvedStartMin - b.resolvedStartMin);
}

interface Draft {
  kind: SlotKind;
  min: number;
  endMin?: number;
  workout?: ResolvedWorkout;
  /** the main meal this slot started as, if it was re-purposed */
  baseMeal?: 'breakfast' | 'lunch' | 'dinner';
  optional?: boolean;
  /** race mornings: deliberately before the usual wake time */
  beforeWake?: boolean;
  /** small carb-only pre-ride breakfast (early start) */
  light?: boolean;
}

const MAIN: SlotKind[] = ['breakfast', 'lunch', 'dinner'];
const isMain = (d: Draft) => MAIN.includes(d.kind) || d.baseMeal !== undefined;

const PRIORITY: Record<SlotKind, number> = {
  during: 9,
  recovery: 8,
  'pre-meal': 7,
  'pre-snack': 6,
  dinner: 5,
  lunch: 4,
  breakfast: 4,
  'pre-sleep': 3,
  snack: 1,
};

export interface DaySlotInput {
  date: DateKey;
  workouts: ResolvedWorkout[];
  schedule: Schedule;
  prefs: NutritionPrefs;
  macros: Macros;
  weightKg: number;
  /** carbs earmarked for tomorrow's demand; lands in the evening */
  topUpG: number;
  tomorrowFirstSessionMin?: number;
  tomorrowHard: boolean;
}

export function planDaySlots(input: DaySlotInput): MealSlot[] {
  const { schedule, workouts } = input;
  // A session before the usual wake time means the athlete is up earlier today.
  const firstStart = workouts[0]?.resolvedStartMin ?? Infinity;
  const wake = Math.min(schedule.wakeMin, firstStart - 45);
  const sleep = schedule.sleepMin;

  let drafts: Draft[] = [
    { kind: 'breakfast', min: schedule.breakfastMin },
    { kind: 'lunch', min: schedule.lunchMin },
    { kind: 'dinner', min: schedule.dinnerMin },
  ];

  for (const w of workouts) {
    const S = w.resolvedStartMin;
    const E = S + w.durationMin;
    const longOrHard = isHard(w.intensity) || w.durationMin >= 75;
    const race = w.intensity === 'Race' || /^RACE_/.test(w.category ?? '');
    const sinceWake = S - wake;
    const firstOfDay = !drafts.some((d) => d.kind === 'during');

    // 1. Pre-session fuel. Early starts get special handling because there's
    //    no room for a full meal 2–4 h out.
    if (firstOfDay && race && sinceWake < 180) {
      // Races justify an early alarm: 2–3 g/kg about 3 h before the gun.
      const breakfast = drafts.find((d) => d.kind === 'breakfast' && !d.workout);
      const pre: Draft = breakfast ?? { kind: 'pre-meal', min: 0 };
      pre.baseMeal = 'breakfast';
      pre.kind = 'pre-meal';
      pre.min = S - 180;
      pre.workout = w;
      pre.beforeWake = true;
      if (!breakfast) drafts.push(pre);
      drafts.push({ kind: 'pre-snack', min: S - 30, workout: w });
    } else if (firstOfDay && sinceWake < 90) {
      drafts.push({ kind: 'pre-snack', min: Math.max(wake + 5, S - 30), workout: w, optional: !longOrHard });
    } else if (firstOfDay && sinceWake < 180) {
      // Light, carb-only breakfast as early as possible.
      const breakfast = drafts.find((d) => d.kind === 'breakfast' && !d.workout);
      if (breakfast) {
        breakfast.baseMeal = 'breakfast';
        breakfast.kind = 'pre-meal';
        breakfast.min = Math.max(wake + 10, Math.min(breakfast.min, S - 90));
        breakfast.workout = w;
        breakfast.light = true;
      }
      if (longOrHard) drafts.push({ kind: 'pre-snack', min: S - 20, workout: w, optional: true });
    }

    // 2. Move remaining main meals out of the 2 h before and during the session.
    for (const d of drafts) {
      if (!isMain(d) || d.workout) continue;
      if (d.min > S - 120 && d.min < E) {
        const earlier = S - 180;
        const prev = drafts.filter((x) => x !== d && x.min < d.min && x.kind !== 'during').map((x) => x.min);
        const roomEarlier = earlier >= wake + 15 && prev.every((m) => earlier - m >= 120);
        d.min = d.min < S && roomEarlier ? earlier : E + 30;
      }
    }

    if (!drafts.some((d) => d.workout === w && (d.kind === 'pre-meal' || d.kind === 'pre-snack'))) {
      const preMeal = drafts
        .filter((d) => isMain(d) && !d.workout && d.min >= S - 300 && d.min <= S - 120)
        .sort((a, b) => b.min - a.min)[0];
      if (preMeal) {
        preMeal.baseMeal = preMeal.baseMeal ?? (preMeal.kind as Draft['baseMeal']);
        preMeal.kind = 'pre-meal';
        preMeal.workout = w;
      }
      const lastEat = drafts.filter((d) => d.min < S && d.kind !== 'during').map((d) => d.min);
      const gap = lastEat.length ? S - Math.max(...lastEat) : S - wake;
      if (gap > 150 && (longOrHard || w.durationMin >= 60)) {
        drafts.push({ kind: 'pre-snack', min: S - 60, workout: w });
      }
    }

    // 3. During.
    drafts.push({ kind: 'during', min: S, endMin: E, workout: w });

    // 4. Recovery: re-purpose a main meal inside 2 h, or add a recovery snack.
    const after = drafts
      .filter((d) => isMain(d) && !d.workout && d.min >= E && d.min <= E + 120)
      .sort((a, b) => a.min - b.min)[0];
    if (after) {
      after.baseMeal = after.baseMeal ?? (after.kind as Draft['baseMeal']);
      after.kind = 'recovery';
      after.workout = w;
      after.min = Math.max(E + 20, Math.min(after.min, E + 45));
    } else if (w.durationMin >= 45 || isHard(w.intensity)) {
      drafts.push({ kind: 'recovery', min: E + 20, workout: w });
    }
  }

  // Bridge long gaps between main meals.
  drafts.sort((a, b) => a.min - b.min);
  const eating = drafts.filter((d) => d.kind !== 'during');
  for (let i = 1; i < eating.length; i += 1) {
    const gap = eating[i].min - eating[i - 1].min;
    const inSession = workouts.some(
      (w) => eating[i - 1].min + gap / 2 > w.resolvedStartMin - 60 && eating[i - 1].min + gap / 2 < w.resolvedStartMin + w.durationMin,
    );
    if (gap > 330 && !inSession) drafts.push({ kind: 'snack', min: eating[i - 1].min + Math.round(gap / 2) });
  }

  // Pre-sleep protein.
  if (schedule.preSleepProtein) {
    const late = drafts.some((d) => d.kind !== 'during' && d.min >= sleep - 75);
    if (!late) drafts.push({ kind: 'pre-sleep', min: sleep - 45 });
  }

  // Clamp, then merge eating slots closer than 60 min (higher priority wins).
  drafts = drafts.map((d) => ({ ...d, min: roundTo(Math.max(d.beforeWake ? 0 : wake, Math.min(sleep - 15, d.min)), d.kind === 'during' ? 1 : 15) }));
  drafts.sort((a, b) => a.min - b.min || PRIORITY[b.kind] - PRIORITY[a.kind]);
  const merged: Draft[] = [];
  for (const d of drafts) {
    const clash = d.kind !== 'during' ? merged.find((m) => m.kind !== 'during' && Math.abs(m.min - d.min) < 60) : undefined;
    if (!clash) {
      merged.push({ ...d });
      continue;
    }
    if (PRIORITY[d.kind] > PRIORITY[clash.kind]) {
      clash.kind = d.kind;
      clash.workout = d.workout ?? clash.workout;
      clash.min = d.min;
    }
    clash.baseMeal = clash.baseMeal ?? d.baseMeal ?? (MAIN.includes(d.kind) ? (d.kind as Draft['baseMeal']) : undefined);
    clash.optional = clash.optional && d.optional;
    clash.beforeWake = clash.beforeWake || d.beforeWake;
    clash.light = clash.light || d.light;
  }
  merged.sort((a, b) => a.min - b.min);

  return distributeMacros(merged, input);
}

// ---------------------------------------------------------------------------

function distributeMacros(drafts: Draft[], input: DaySlotInput): MealSlot[] {
  const { weightKg, prefs, macros, topUpG } = input;
  const carbFixed = new Map<Draft, number>();

  // During-session carbs are non-negotiable — fuel the work.
  let duringTotal = 0;
  for (const d of drafts) {
    if (d.kind === 'during' && d.workout) {
      const g = (duringCarbPerHour(d.workout, prefs) * d.workout.durationMin) / 60;
      carbFixed.set(d, g);
      duringTotal += g;
    }
  }
  let remaining = Math.max(0, macros.carbG - duringTotal);

  // Peri-workout targets next, scaled down if the day is tight.
  const periTarget = new Map<Draft, number>();
  for (const d of drafts) {
    const w = d.workout;
    if (!w) continue;
    const demanding = isHard(w.intensity) || w.durationMin >= 90;
    if (d.kind === 'pre-snack') periTarget.set(d, (d.optional ? 0.25 : demanding ? 0.5 : 0.35) * weightKg);
    if (d.kind === 'pre-meal') {
      const race = w.intensity === 'Race' || /^RACE_/.test(w.category ?? '');
      periTarget.set(d, (race ? 2.5 : d.light ? 0.6 : demanding ? 1.5 : 1.0) * weightKg);
    }
    if (d.kind === 'recovery') {
      const nextSoon =
        input.workouts.some((x) => x.resolvedStartMin > w.resolvedStartMin && x.resolvedStartMin - (w.resolvedStartMin + w.durationMin) < 480) ||
        input.tomorrowHard;
      const perKg = nextSoon ? 1.2 : demanding ? 1.0 : 0.6;
      periTarget.set(d, perKg * weightKg * (d.baseMeal ? 1 : 0.7));
    }
  }
  const periSum = [...periTarget.values()].reduce((a, b) => a + b, 0);
  const periScale = periSum > remaining * 0.75 ? (remaining * 0.75) / periSum : 1;
  for (const [d, g] of periTarget) {
    carbFixed.set(d, g * periScale);
    remaining -= g * periScale;
  }

  // Evening top-up for tomorrow goes into the last main meal of the day.
  const lastMain = [...drafts].reverse().find((d) => isMain(d) && d.kind !== 'pre-meal');
  const topUp = lastMain ? Math.min(topUpG, remaining * 0.5) : 0;
  if (lastMain && topUp > 0) remaining -= topUp;

  // Peri-workout targets are floors: re-purposed main meals still share the
  // rest of the day's carbs (less than a normal meal), stand-alone snacks don't.
  const carbWeight = (d: Draft) => {
    if (d.kind === 'during' || d.kind === 'pre-snack') return 0;
    if (d.light) return 0;
    if (carbFixed.has(d)) return d.baseMeal ? (d.kind === 'pre-meal' ? 0.4 : 0.6) : 0;
    return d.kind === 'snack' ? 0.45 : d.kind === 'pre-sleep' ? 0.15 : isMain(d) ? 1 : 0.4;
  };
  const totalCarbW = drafts.reduce((s, d) => s + carbWeight(d), 0);
  if (totalCarbW === 0 && remaining > 0) {
    // Every slot is peri-workout — hand the rest to the last solid slot.
    const sink = [...drafts].reverse().find((d) => d.kind !== 'during');
    if (sink) carbFixed.set(sink, (carbFixed.get(sink) ?? 0) + remaining);
    remaining = 0;
  }

  const proteinWeight = (d: Draft): number => {
    switch (d.kind) {
      case 'during':
      case 'pre-snack':
        return 0;
      case 'pre-meal':
        return d.light ? 0.3 : 0.8;
      case 'recovery':
        return d.baseMeal ? 1 : 0.8;
      case 'pre-sleep':
        return 0.9;
      case 'snack':
        return 0.45;
      default:
        return 1;
    }
  };
  const fatWeight = (d: Draft): number => {
    switch (d.kind) {
      case 'during':
      case 'pre-snack':
        return 0;
      case 'pre-meal':
        return d.light ? 0.05 : 0.35;
      case 'recovery':
        return d.baseMeal ? 0.6 : 0.15;
      case 'snack':
      case 'pre-sleep':
        return 0.4;
      default:
        return 1;
    }
  };
  const totalPW = drafts.reduce((s, d) => s + proteinWeight(d), 0) || 1;
  const totalFW = drafts.reduce((s, d) => s + fatWeight(d), 0) || 1;

  return drafts.map((d, i) => {
    let carbG = (carbFixed.get(d) ?? 0) + (totalCarbW > 0 ? (remaining * carbWeight(d)) / totalCarbW : 0);
    if (d === lastMain) carbG += topUp;
    const proteinG = (macros.proteinG * proteinWeight(d)) / totalPW;
    const fatG = (macros.fatG * fatWeight(d)) / totalFW;
    const m: Macros = { carbG: Math.round(carbG), proteinG: Math.round(proteinG), fatG: Math.round(fatG) };
    const slot: MealSlot = {
      id: `${input.date}-${i}-${d.kind}`,
      kind: d.kind,
      label: labelFor(d),
      startMin: Math.round(d.min),
      endMin: d.endMin,
      macros: m,
      kcal: Math.round(m.carbG * 4 + m.proteinG * 4 + m.fatG * 9),
      workoutId: d.workout?.id,
      rationale: rationaleFor(d, m, input),
      ideas: ideasFor(d, m),
      lowResidue: d.kind === 'pre-meal' || d.kind === 'pre-snack' || d.kind === 'during',
    };
    if (d.kind === 'during' && d.workout) {
      const cph = duringCarbPerHour(d.workout, prefs);
      const { fluidMlPerHour, sodiumMgPerHour } = duringFluid(d.workout, prefs);
      const sugars = splitSugars(m.carbG, cph, prefs.fructoseRatio);
      slot.fueling = {
        carbPerHour: cph,
        fluidMlPerHour,
        sodiumMgPerHour,
        glucoseG: Math.round(sugars.glucoseG),
        fructoseG: Math.round(sugars.fructoseG),
      };
    }
    return slot;
  });
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelFor(d: Draft): string {
  const base = d.baseMeal ? cap(d.baseMeal) : undefined;
  switch (d.kind) {
    case 'pre-meal':
      return base ? `${base} · pre-ride` : 'Pre-ride meal';
    case 'pre-snack':
      return d.optional ? 'Pre-ride bite (optional)' : 'Pre-ride snack';
    case 'during':
      return d.workout?.title ?? 'Session';
    case 'recovery':
      return base ? `${base} · recovery` : 'Recovery';
    case 'pre-sleep':
      return 'Before bed';
    case 'snack':
      return 'Snack';
    default:
      return cap(d.kind);
  }
}

function rationaleFor(d: Draft, m: Macros, input: DaySlotInput): string {
  const w = d.workout;
  switch (d.kind) {
    case 'pre-meal':
      return w
        ? `${formatDuration(w.resolvedStartMin - d.min)} before ${w.title}. Carb-forward, low fat and fibre so it's digested by the start.`
        : 'Carb-forward meal ahead of training.';
    case 'pre-snack':
      return w && w.resolvedStartMin - d.min <= 35
        ? 'Early start — quick carbs top up liver glycogen after the overnight fast without sitting heavy.'
        : 'Bridges the gap since your last meal so you start the session fuelled.';
    case 'during': {
      if (!w) return '';
      if (m.carbG === 0) return 'Short/easy — water is enough. Carb mouth-rinse optional.';
      return `${formatDuration(w.durationMin)} at IF ${w.ifactor.toFixed(2)} — steady intake from the first 15 min protects glycogen and session quality.`;
    }
    case 'recovery':
      return input.tomorrowHard || input.workouts.length > 1
        ? 'Another key session is coming — prioritise carbs now while glycogen synthesis is fastest.'
        : 'Carbs + ~0.3 g/kg protein within an hour kick-starts repair and refuelling.';
    case 'pre-sleep':
      return 'Slow-digesting protein (casein, Greek yoghurt) supports overnight muscle repair.';
    case 'snack':
      return 'Keeps protein spread every 3–4 h and avoids arriving at the next meal starving.';
    case 'dinner':
      return input.topUpG > 0 ? 'Extra carbs tonight top up glycogen for tomorrow’s demanding day.' : 'Balanced plate — this is where most of any deficit lives.';
    default:
      return 'Balanced plate away from training — the best place for fat, fibre and veg.';
  }
}

function ideasFor(d: Draft, m: Macros): string[] {
  const big = m.carbG >= 90;
  switch (d.kind) {
    case 'pre-meal':
      return big
        ? ['Bagel + jam + honey, small yoghurt', 'White rice + eggs + soy', 'Oats with banana, maple & whey']
        : ['Toast + jam + a banana', 'Oats with berries & honey', 'Rice cakes + PB + honey'];
    case 'pre-snack':
      return m.carbG >= 35 ? ['Banana + a gel', 'Rice cake + honey', 'Sports drink + a few dates'] : ['Banana or 2 dates', 'Half a gel + coffee'];
    case 'during':
      return m.carbG === 0 ? ['Water / electrolytes'] : ['Drink mix in bottles', 'Gels every 20–30 min', 'Rice bars / chews'];
    case 'recovery':
      return big
        ? ['Rice bowl with chicken + fruit juice', 'Pasta + tuna + tomato sauce', 'Chocolate milk + bagel']
        : ['Chocolate milk', 'Greek yoghurt + granola + fruit', 'Whey shake + banana'];
    case 'pre-sleep':
      return ['Greek yoghurt or skyr', 'Cottage cheese + berries', 'Casein shake'];
    case 'snack':
      return ['Skyr + fruit', 'Turkey wrap', 'Handful of nuts + an apple'];
    case 'breakfast':
      return big ? ['Oats + whey + fruit + toast', 'Eggs, sourdough & fruit'] : ['Eggs + toast + fruit', 'Greek yoghurt + muesli'];
    case 'lunch':
      return big ? ['Burrito bowl, extra rice', 'Pasta salad with chicken'] : ['Big salad + salmon + quinoa', 'Chicken wrap + soup'];
    case 'dinner':
      return big
        ? ['Salmon, rice & greens (extra rice)', 'Pasta bolognese + side salad']
        : ['Lean protein, potatoes & lots of veg', 'Stir-fry with tofu/chicken'];
  }
}

export function describeSlotTime(slot: MealSlot): string {
  return slot.endMin ? `${formatClock(slot.startMin)}–${formatClock(slot.endMin)}` : formatClock(slot.startMin);
}
