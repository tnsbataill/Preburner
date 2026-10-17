import { describe, expect, it } from 'vitest';
import type { MealSlot } from '../../engine/types';
import { MEAL_MODEL, suggestMeal } from '../meal';

// The real Anthropic SDK with a scripted HTTP response at the fetch boundary:
// checks the request we send and that totals are summed locally.

const slot: MealSlot = {
  id: 's1',
  kind: 'pre-meal',
  label: 'Pre-ride meal',
  startMin: 7 * 60,
  macros: { carbG: 90, proteinG: 20, fatG: 10 },
  kcal: 530,
  rationale: 'Top up glycogen before intervals.',
  ideas: ['Oats with banana'],
  lowResidue: true,
};

function scripted(body: unknown) {
  const requests: Array<{ url: string; body: any }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchFn: fetchFn as typeof fetch, requests };
}

const reply = (json: unknown, stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: MEAL_MODEL,
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: JSON.stringify(json) }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

describe('calculate meal', () => {
  it('asks the light model for a structured meal and sums the totals itself', async () => {
    const { fetchFn, requests } = scripted(
      reply({
        name: 'Oats with banana and honey',
        items: [
          { food: 'rolled oats', grams: 80.4, carbG: 48, proteinG: 10, fatG: 5 },
          { food: 'banana', grams: 120, carbG: 27, proteinG: 1, fatG: 0 },
          { food: 'Greek yogurt, 0%', grams: 150, carbG: 6, proteinG: 15, fatG: 0 },
          { food: 'honey', grams: 15, carbG: 12, proteinG: 0, fatG: 0 },
        ],
        tip: 'Eat 2–3 h before the ride.',
      }),
    );
    const meal = await suggestMeal({ apiKey: 'sk-test', slot, avoid: ['Rice bowl'], fetch: fetchFn });

    const req = requests[0];
    expect(req.url).toMatch(/\/v1\/messages$/);
    expect(req.body.model).toBe('claude-haiku-5-5');
    expect(req.body.output_config.effort).toBe('low');
    expect(req.body.output_config.format.type).toBe('json_schema');
    const prompt = req.body.messages[0].content as string;
    expect(prompt).toContain('90 g carbs, 20 g protein, 10 g fat');
    expect(prompt).toContain('low fat and low fibre');
    expect(prompt).toContain('different from: Rice bowl');

    expect(meal.items[0].grams).toBe(80);
    expect(meal.totals).toEqual({ carbG: 93, proteinG: 26, fatG: 5, kcal: 4 * 93 + 4 * 26 + 9 * 5 });
    expect(meal.target).toEqual({ carbG: 90, proteinG: 20, fatG: 10 });
  });

  it('a refusal is an error, not an empty meal', async () => {
    const { fetchFn } = scripted({ ...reply({}), content: [], stop_reason: 'refusal' });
    await expect(suggestMeal({ apiKey: 'k', slot, fetch: fetchFn })).rejects.toThrow(/Couldn't make a meal/);
  });
});
