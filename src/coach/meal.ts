import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { formatClock } from '../engine/time';
import type { MealSlot } from '../engine/types';

// "Calculate meal": one small, fast model call that turns a slot's macro
// targets into a simple meal with gram amounts. The model proposes foods and
// per-item macros; totals are summed here, never trusted from the model.

export const MEAL_MODEL = 'claude-haiku-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short meal name, e.g. "Rice bowl with chicken"' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          food: { type: 'string', description: 'Food as bought/cooked, e.g. "white rice, cooked"' },
          grams: { type: 'number' },
          carbG: { type: 'number' },
          proteinG: { type: 'number' },
          fatG: { type: 'number' },
        },
        required: ['food', 'grams', 'carbG', 'proteinG', 'fatG'],
        additionalProperties: false,
      },
    },
    tip: { type: 'string', description: 'One short prep or timing tip' },
  },
  required: ['name', 'items', 'tip'],
  additionalProperties: false,
} as const;

export interface MealItem {
  food: string;
  grams: number;
  carbG: number;
  proteinG: number;
  fatG: number;
}

export interface MealSuggestion {
  name: string;
  items: MealItem[];
  tip: string;
  totals: { carbG: number; proteinG: number; fatG: number; kcal: number };
  /** macros it was made for, to spot a stale suggestion when targets change */
  target: { carbG: number; proteinG: number; fatG: number };
  createdAt: string;
}

const SYSTEM = `You write simple meals for an endurance athlete that hit given macro targets. Use common whole foods and 2-5 ingredients, gram amounts rounded to sensible kitchen numbers (5 g steps, or whole units like "1 banana" with its weight). Per-item macros must be realistic for the food and amount (standard nutrition tables). Aim for each total within about 10% of target. Respect any timing guidance (e.g. low fat and low fibre before training).`;

export interface SuggestMealOptions {
  apiKey: string;
  slot: MealSlot;
  /** meal names already suggested, to get something different */
  avoid?: string[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export async function suggestMeal(opts: SuggestMealOptions): Promise<MealSuggestion> {
  const { slot } = opts;
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, fetch: opts.fetch });
  const m = slot.macros;
  const brief = [
    `${slot.label} at ${formatClock(slot.startMin)}.`,
    `Targets: ${m.carbG} g carbs, ${m.proteinG} g protein, ${m.fatG} g fat (${slot.kcal} kcal).`,
    slot.lowResidue ? 'Keep it low fat and low fibre: training follows soon.' : '',
    slot.rationale ? `Why this meal: ${slot.rationale}` : '',
    slot.ideas.length ? `Ideas that fit: ${slot.ideas.join('; ')}.` : '',
    opts.avoid?.length ? `Make it different from: ${opts.avoid.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const res = await client.messages.parse(
    {
      model: MEAL_MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: 'low', format: jsonSchemaOutputFormat(SCHEMA) },
      messages: [{ role: 'user', content: brief }],
    },
    { signal: opts.signal },
  );
  if (res.stop_reason === 'refusal') throw new Error("Couldn't make a meal for this one.");
  const out = res.parsed_output;
  if (!out || !out.items.length) throw new Error('No meal came back; try again.');
  const items = out.items.map((i) => ({ ...i, grams: Math.round(i.grams), carbG: Math.round(i.carbG), proteinG: Math.round(i.proteinG), fatG: Math.round(i.fatG) }));
  const sum = (k: 'carbG' | 'proteinG' | 'fatG') => items.reduce((s, i) => s + i[k], 0);
  const totals = { carbG: sum('carbG'), proteinG: sum('proteinG'), fatG: sum('fatG'), kcal: 0 };
  totals.kcal = Math.round(4 * totals.carbG + 4 * totals.proteinG + 9 * totals.fatG);
  return { name: out.name, items, tip: out.tip, totals, target: { carbG: m.carbG, proteinG: m.proteinG, fatG: m.fatG }, createdAt: new Date().toISOString() };
}
