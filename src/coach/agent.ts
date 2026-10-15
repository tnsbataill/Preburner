import Anthropic from '@anthropic-ai/sdk';
import { COACH_TOOLS, type CoachWorld, runTool } from './tools';
import type { Proposal, ProposalChange } from './types';

// In-browser coach. The athlete's own Anthropic key is used directly from the
// browser (the app has no backend). The agent can read and simulate freely;
// its only side effect is a proposal the athlete approves change by change.

const SYSTEM = `You are an experienced cycling coach and sports dietitian working inside Preburner, an app that plans training fuel around an athlete's Intervals.icu calendar (often fed by TrainerRoad).

How to work:
- Start with get_athlete_context, then look at the calendar and fuelling plan for the period that matters. If the athlete has a Preburner training plan (get_training_plan), work with it: it was optimised for their FTP goal and adapts daily to HRV, form and RPE, so prefer small, explained tweaks over rewriting it.
- Ground every recommendation in numbers from the tools. Use simulate_changes to compare at least two options when you change the plan, and pick the one that best meets the goals within constraints.
- Constraints: respect daily availability hours; keep the weekly CTL ramp at or below the athlete's limit; at most 2–3 hard sessions (Threshold/VO2/Race) per week with an easy day after each; plan a taper of 7–10 days before an A event (volume down ~40–50%, keep some intensity) aiming for the target TSB; protect key sessions from energy deficits; never schedule changes in the past or modify completed sessions.
- TrainerRoad-owned sessions (source "intervals") may be re-synced by TrainerRoad. Prefer adding sessions or notes; propose removing/moving them only when it clearly matters, and say so in the reason.
- Keep proposals focused: the smallest set of changes that achieves the goal. Use the "note" action for advice that isn't a calendar change (e.g. "do this ride outdoors", "skip if HRV is low").
- Finish by calling propose_plan exactly once (it can have zero changes if the plan is already good), then reply with a short, plain-language explanation of the trade-offs. Use the athlete's units where obvious and keep it under 180 words.`;

export interface CoachRunOptions {
  apiKey: string;
  /** injectable for tests */
  fetch?: typeof fetch;
  model: string;
  world: CoachWorld;
  history: Anthropic.Beta.BetaMessageParam[];
  userText: string;
  onStep?: (label: string) => void;
  signal?: AbortSignal;
}

export interface CoachRunResult {
  text: string;
  proposal?: Proposal;
  history: Anthropic.Beta.BetaMessageParam[];
}

const STEP_LABELS: Record<string, string> = {
  get_athlete_context: 'Reading your profile and goals',
  get_calendar: 'Looking at your calendar',
  get_fueling_plan: 'Checking your fuelling plan',
  get_training_plan: 'Reviewing your training plan',
  simulate_changes: 'Simulating options',
  propose_plan: 'Writing up the proposal',
};

let idSeq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(idSeq += 1)}`;

export async function runCoach(opts: CoachRunOptions): Promise<CoachRunResult> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, fetch: opts.fetch });
  const messages: Anthropic.Beta.BetaMessageParam[] = [...opts.history, { role: 'user', content: opts.userText }];
  let proposal: Proposal | undefined;

  for (let turn = 0; turn < 16; turn += 1) {
    const response = await client.beta.messages.create(
      {
        model: opts.model,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        tools: COACH_TOOLS as unknown as Anthropic.Beta.BetaToolUnion[],
        messages,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming,
      { signal: opts.signal },
    );

    // Keep the full content (thinking blocks included) so the next turn is valid.
    messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (response.stop_reason === 'refusal') {
      return { text: "I can't help with that request.", proposal, history: messages };
    }
    if (response.stop_reason === 'pause_turn') continue;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // A truncated turn can end on a tool_use; answer it so the saved history
      // stays valid for the next request (never edit earlier turns instead).
      if (toolUses.length > 0) {
        messages.push({
          role: 'user',
          content: toolUses.map((tu) => ({ type: 'tool_result' as const, tool_use_id: tu.id, is_error: true, content: 'Not run: the response was cut off.' })),
        });
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (response.stop_reason === 'max_tokens' && !text) return { text: 'That took too long to think through — try a narrower question.', proposal, history: messages };
      return { text, proposal, history: messages };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      opts.onStep?.(STEP_LABELS[tu.name] ?? tu.name);
      try {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        if (tu.name === 'propose_plan') {
          proposal = toProposal(input);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Proposal recorded with ${proposal.changes.length} change(s). The athlete will review it. Now give your short explanation.` });
        } else {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(runTool(opts.world, tu.name, input)) });
        }
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: err instanceof Error ? err.message : String(err) });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'Stopped after too many steps.', proposal, history: messages };
}

function toProposal(input: Record<string, unknown>): Proposal {
  const raw = Array.isArray(input.changes) ? (input.changes as Array<Partial<ProposalChange>>) : [];
  return {
    id: nextId('prop'),
    createdAt: new Date().toISOString(),
    title: String(input.title ?? 'Plan update'),
    summary: String(input.summary ?? ''),
    status: 'open',
    changes: raw
      .filter((c) => c.action && c.date)
      .map((c) => ({
        id: nextId('chg'),
        action: c.action!,
        date: c.date!,
        targetWorkoutId: c.targetWorkoutId,
        newDate: c.newDate,
        session: c.session,
        note: c.note,
        reason: c.reason ?? '',
        status: 'pending' as const,
      })),
  };
}

/** Friendly message for API failures, using the SDK's typed errors. */
export function describeCoachError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Your Anthropic API key was rejected. Check it in Settings → Connections.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic — wait a minute and try again.';
  if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach Anthropic — check your connection.';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  if (err instanceof Error && err.name === 'AbortError') return 'Stopped.';
  return err instanceof Error ? err.message : String(err);
}
