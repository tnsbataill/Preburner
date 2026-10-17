import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { suggestMeal, type MealSuggestion } from '../src/coach/meal';
import { demoWorkouts } from '../src/demo/demoData';
import { DEFAULT_SETTINGS } from '../src/engine/defaults';
import { addDays } from '../src/engine/time';
import { buildPlan } from '../src/engine/plan';
import type { MealSlot } from '../src/engine/types';

// Is Haiku at low effort the right model for "Calculate meal"? Runs the real
// prompt on real slots from the planner (demo week) with a few model/effort
// configs and reports macro fit, latency, cost, and whether the per-item
// macros are realistic (graded by a stronger model against nutrition tables).
// Real API calls: costs cents. Usage: ANTHROPIC_API_KEY=... npx vite-node scripts/meal-eval.ts

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY');

const CONFIGS = [
  { model: 'claude-haiku-5-5', effort: 'low' as const },
  { model: 'claude-haiku-5-5', effort: 'medium' as const },
  { model: 'claude-sonnet-5-5', effort: 'low' as const },
];
// $ per million tokens (input, output)
const PRICE: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10] };
const JUDGE = 'claude-opus-5-5';

const today = '2026-10-19';
const plan = buildPlan({ settings: DEFAULT_SETTINGS, workouts: demoWorkouts(today, 270), start: today, days: 7, today });
// A spread of slots: every meal kind once (not the on-bike fueling), hard and easy days.
const seen = new Set<string>();
const slots: MealSlot[] = [];
for (const d of plan.days) for (const s of d.slots) if (s.kind !== 'during' && !seen.has(s.kind) && s.macros.carbG + s.macros.proteinG + s.macros.fatG > 20) (seen.add(s.kind), slots.push(s));
console.log(`${slots.length} slots: ${slots.map((s) => `${s.label} (${s.macros.carbG}/${s.macros.proteinG}/${s.macros.fatG}${s.lowResidue ? ', low residue' : ''})`).join('; ')}\n`);

const client = new Anthropic({ apiKey });
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { food: { type: 'string' }, carbG: { type: 'number' }, proteinG: { type: 'number' }, fatG: { type: 'number' } }, required: ['food', 'carbG', 'proteinG', 'fatG'], additionalProperties: false } } },
  required: ['items'],
  additionalProperties: false,
} as const;
/** Reference macros for each item at its stated weight (USDA-style tables). */
async function reference(meal: MealSuggestion) {
  const res = await client.messages.parse({
    model: JUDGE,
    max_tokens: 4000,
    system: 'You are a nutrition database. For each food at the stated gram weight, give carbohydrate, protein and fat in grams from standard tables (USDA FoodData Central or equivalent). Be precise; no rounding to make totals look nice.',
    output_config: { effort: 'medium', format: jsonSchemaOutputFormat(JUDGE_SCHEMA) },
    messages: [{ role: 'user', content: meal.items.map((i) => `${i.grams} g ${i.food}`).join('\n') }],
  });
  return res.parsed_output!.items;
}

const pct = (a: number, b: number) => (b ? Math.abs(a - b) / b : 0);
for (const cfg of CONFIGS) {
  let inTok = 0;
  let outTok = 0;
  const lat: number[] = [];
  const fitErr: number[] = [];
  const realErr: number[] = [];
  let fails = 0;
  console.log(`== ${cfg.model} effort ${cfg.effort}`);
  for (const slot of slots) {
    const fetchWithUsage: typeof fetch = async (input, init) => {
      const r = await fetch(input, init);
      const j = await r.clone().json().catch(() => undefined);
      inTok += j?.usage?.input_tokens ?? 0;
      outTok += j?.usage?.output_tokens ?? 0;
      return r;
    };
    const t0 = Date.now();
    try {
      const meal = await suggestMeal({ apiKey, slot, fetch: fetchWithUsage, ...cfg });
      lat.push(Date.now() - t0);
      // Fit: model's own totals vs target (what the app shows).
      const m = slot.macros;
      const fit = (pct(meal.totals.carbG, m.carbG) + pct(meal.totals.proteinG, m.proteinG) + (m.fatG >= 5 ? pct(meal.totals.fatG, m.fatG) : 0)) / (m.fatG >= 5 ? 3 : 2);
      fitErr.push(fit);
      // Realism: the model's claimed totals vs reference values for the same foods and grams.
      const ref = await reference(meal);
      const refT = ref.reduce((a, i) => ({ c: a.c + i.carbG, p: a.p + i.proteinG, f: a.f + i.fatG }), { c: 0, p: 0, f: 0 });
      const kcal = (c: number, p: number, f: number) => 4 * c + 4 * p + 9 * f;
      const real = pct(meal.totals.kcal, kcal(refT.c, refT.p, refT.f));
      realErr.push(real);
      console.log(`  ${slot.label.padEnd(22)} ${String(Date.now() - t0).padStart(5)} ms  target ${m.carbG}/${m.proteinG}/${m.fatG}  claims ${meal.totals.carbG}/${meal.totals.proteinG}/${meal.totals.fatG}  tables ${Math.round(refT.c)}/${Math.round(refT.p)}/${Math.round(refT.f)}  | ${meal.name}: ${meal.items.map((i) => `${i.grams} g ${i.food}`).join(', ')}`);
    } catch (e) {
      fails += 1;
      console.log(`  ${slot.label}: FAILED ${(e as Error).message}`);
    }
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const [pi, po] = PRICE[cfg.model];
  const cost = (inTok * pi + outTok * po) / 1e6;
  console.log(`  -> fit to target ${(mean(fitErr) * 100).toFixed(1)}% | claimed vs tables (kcal) ${(mean(realErr) * 100).toFixed(1)}% | latency median ${med(lat)} ms, max ${Math.max(...lat)} ms | ${Math.round(outTok / slots.length)} out tok/meal | $${((cost / slots.length) * 1000).toFixed(2)} per 1000 meals | ${fails} failed\n`);
}
