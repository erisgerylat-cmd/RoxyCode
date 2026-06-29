import type { RuntimeContext } from '../RuntimeContext.js';
import type { AgentEvent, AgentResult } from '../types.js';
import { ExecutionTracker } from '../types.js';
import { assistantMessage, toolResultMessage, userMessage } from '../../core/types/message.js';
import type { ToolExecutionContext } from '../../tool/types.js';

const MAX_ITERATIONS = 20;

export async function* economicLoop(
  input: string,
  ctx: RuntimeContext,
): AsyncGenerator<AgentEvent, AgentResult> {
  const tracker = new ExecutionTracker();
  ctx.messages.push(userMessage(input));

  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      yield {
        type: 'status',
        status: 'thinking',
        message: ctx.i18n.t('agent.thinking'),
        elapsed: tracker.elapsed(),
        tokens: tracker.totalTokens(),
      };

      tracker.startLlmCall();
      const { chatWithTools } = await import('../adapters/LLMAdapter.js');
      const response = await chatWithTools(ctx.llm, ctx.messages, ctx.tools);
      tracker.endLlmCall({
        inputTokens: response.usage?.inputTokens || 0,
        outputTokens: response.usage?.outputTokens || 0,
      });

      if (response.content) {
        yield {
          type: 'text_chunk',
          text: response.content,
          tokens: tracker.totalTokens(),
        };
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
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
      }

      ctx.messages.push({
        role: 'assistant',
        content: [
          ...(response.content ? [{ type: 'text' as const, text: response.content }] : []),
          ...response.toolCalls.map(toolCall => ({ type: 'tool_use' as const, toolCall })),
        ],
        timestamp: Date.now(),
      });

      for (const toolCall of response.toolCalls) {
        yield {
          type: 'tool_start',
          tool: toolCall.name,
          args: toolCall.arguments,
        };

        tracker.startToolCall();
        const result = await ctx.toolExecutor.execute(toolCall, toToolExecutionContext(ctx));
        const duration = tracker.endToolCall();

        yield {
          type: 'tool_end',
          tool: toolCall.name,
          result,
          duration,
        };

        ctx.messages.push(toolResultMessage(toolCall, result));
      }
    }

    const error = new Error(ctx.i18n.t('agent.maxIterationsReached'));
    yield {
      type: 'error',
      error,
      recoverable: false,
    };

    return {
      success: false,
      messages: ctx.messages,
      stats: tracker.snapshot(),
      error,
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

function toToolExecutionContext(ctx: RuntimeContext): ToolExecutionContext {
  return {
    cwd: ctx.cwd,
    sessionId: ctx.sessionId,
    config: ctx.config.snapshot(),
    language: 'zh-CN',
    permissionMode: 'strict',
    explain: true,
  };
}
