import { describe, expect, it } from 'vitest';
import { demoWellness, demoWeights, demoWorkouts } from '../../demo/demoData';
import { DEFAULT_SETTINGS } from '../../engine/defaults';
import { runCoach } from '../agent';

// The real Anthropic SDK and agent loop, with scripted HTTP responses at the
// fetch boundary. Verifies the request shape we send and the history we keep.

const today = '2026-10-14';
const world = { settings: DEFAULT_SETTINGS, workouts: demoWorkouts(today, 260), wellness: demoWellness(today), weights: demoWeights(today, 75), today };

const msg = (content: unknown[], stop_reason: string) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});
const thinking = { type: 'thinking', thinking: '', signature: 'sig-abc' };

function scripted(responses: unknown[]) {
  const requests: Array<{ url: string; headers: Headers; body: any }> = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchFn: fetchFn as typeof fetch, requests };
}

describe('coach agent loop', () => {
  it('sends the right request, runs tools, records a proposal and keeps history append-only', async () => {
    const { fetchFn, requests } = scripted([
      msg([thinking, { type: 'tool_use', id: 'tu1', name: 'get_athlete_context', input: {} }], 'tool_use'),
      msg(
        [
          thinking,
          {
            type: 'tool_use',
            id: 'tu2',
            name: 'propose_plan',
            input: {
              title: 'Add a long ride',
              summary: 'One more long ride.',
              changes: [{ action: 'add', date: '2026-10-18', reason: 'volume', session: { title: 'Long Z2', durationMin: 180, intensity: 'Endurance' } }],
            },
          },
        ],
        'tool_use',
      ),
      msg([thinking, { type: 'text', text: 'Added a long ride.' }], 'end_turn'),
    ]);
    const res = await runCoach({ apiKey: 'sk-test', model: 'claude-opus-5-5', world, history: [], userText: 'help', fetch: fetchFn });

    const body = requests[0].body;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'high' });
    expect(body.fallbacks).toBe('default');
    expect(requests[0].headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body.tool_choice).toBeUndefined();
    // Cached twice: the fixed prefix, and the growing conversation (top-level, automatic).
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.cache_control).toEqual({ type: 'ephemeral' });

    // Each request extends the previous one without edits.
    for (let i = 1; i < requests.length; i += 1) {
      const prev = requests[i - 1].body.messages;
      expect(requests[i].body.messages.slice(0, prev.length)).toEqual(prev);
    }
    // Thinking blocks are passed back untouched.
    expect(requests[1].body.messages[1].content[0]).toEqual(thinking);
    // The tool actually ran against the engine.
    expect(JSON.parse(requests[1].body.messages[2].content[0].content).today).toBe(today);

    expect(res.text).toBe('Added a long ride.');
    expect(res.proposal?.changes).toHaveLength(1);
    expect(res.proposal?.changes[0]).toMatchObject({ action: 'add', date: '2026-10-18', status: 'pending' });
  });

  it('a truncated turn ending in tool_use still leaves a valid history', async () => {
    const { fetchFn } = scripted([msg([thinking, { type: 'tool_use', id: 'tu9', name: 'get_calendar', input: { start: '2026-10-14' } }], 'max_tokens')]);
    const res = await runCoach({ apiKey: 'k', model: 'claude-opus-5-5', world, history: [], userText: 'x', fetch: fetchFn });
    const last = res.history.at(-1)!;
    expect(last.role).toBe('user');
    expect((last.content as any[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu9', is_error: true });
  });
});
