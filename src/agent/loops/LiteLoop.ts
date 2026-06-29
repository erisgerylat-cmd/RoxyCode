import type { RuntimeContext } from '../RuntimeContext.js';
import type { AgentEvent, AgentResult } from '../types.js';
import { ExecutionTracker } from '../types.js';
import { assistantMessage, userMessage } from '../../core/types/message.js';

export async function* liteLoop(
  input: string,
  ctx: RuntimeContext,
): AsyncGenerator<AgentEvent, AgentResult> {
  const tracker = new ExecutionTracker();
  ctx.messages.push(userMessage(input));

  yield {
    type: 'status',
    status: 'thinking',
    message: ctx.i18n.t('agent.thinking'),
    elapsed: tracker.elapsed(),
    tokens: tracker.totalTokens(),
  };

  try {
    tracker.startLlmCall();
    const { chat } = await import('../adapters/LLMAdapter.js');
    const response = await chat(ctx.llm, ctx.messages);
    tracker.endLlmCall({
      inputTokens: response.usage?.inputTokens || 0,
      outputTokens: response.usage?.outputTokens || 0,
    });

    yield {
      type: 'text_chunk',
      text: response.content,
      tokens: tracker.totalTokens(),
    };

    ctx.messages.push(assistantMessage(response.content));

    yield {
      type: 'stats',
      stats: tracker.snapshot(),
    };

    return {
      success: true,
      messages: ctx.messages,
      stats: tracker.snapshot(),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    yield {
      type: 'error',
      error: err,
      recoverable: false,
    };

    return {
      success: false,
      messages: ctx.messages,
      stats: tracker.snapshot(),
      error: err,
    };
  }
}
