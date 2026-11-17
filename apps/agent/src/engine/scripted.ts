// Scripted LLM provider for tests and the local demo (ADR-11, section 12.2).
// A script is a function from the request to the next response, so a test can assert on what the
// engine sent (system prompt, tool list, tool results) and decide what the "model" does next.

import type { LlmBlock, LlmProvider, LlmRequest, LlmResponse } from './llm';

export type ScriptStep = (req: LlmRequest) => LlmBlock[] | Promise<LlmBlock[]>;

let toolSeq = 0;
export const toolCall = (name: string, input: Record<string, unknown>): LlmBlock => ({
  type: 'tool_use',
  id: `toolu_scripted_${++toolSeq}`,
  name,
  input,
});
export const say = (text: string): LlmBlock => ({ type: 'text', text });

export class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly requests: LlmRequest[] = [];
  private readonly steps: ScriptStep[];

  constructor(
    steps: ScriptStep[] = [],
    /** What to answer once the script is used up. */
    private readonly fallbackStep: ScriptStep = () => [
      say('Je regarde ça et je reviens vers vous.'),
    ],
  ) {
    this.steps = [...steps];
  }

  push(...steps: ScriptStep[]) {
    this.steps.push(...steps);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone({ ...req, signal: undefined }));
    const step = this.steps.shift() ?? this.fallbackStep;
    const content = await step(req);
    return {
      content,
      stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      model: 'scripted',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
