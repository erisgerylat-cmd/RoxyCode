import type { LLMUsage } from '../../core/types/llm.js';
import {
  assistantMessage,
  systemMessage,
  toolResultMessage,
  userMessage,
  type Message,
  type ToolCall,
} from '../../core/types/message.js';
import { buildAgentSystemPrompt, buildPlanPrompt, buildVerificationPrompt } from './prompts.js';
import { loadRuntimeContext, renderRuntimeContext } from './RuntimeContext.js';
import { getAgentModeSpec } from './modes.js';
import type { AgentLoopEvent, AgentLoopOptions, AgentRunInput } from './types.js';
import { MultiAgentRuntime } from '../multi-agent/index.js';

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentLoopEvent> {
    const spec = getAgentModeSpec(input.mode);
    yield { type: 'mode_start', mode: spec.mode, label: spec.label, description: spec.description };

    try {
      const agentStartHook = await this.options.hooks?.run('agent_start', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput: input.userInput,
        metadata: { mode: input.mode },
      });
      if (agentStartHook?.blocked) {
        yield { type: 'error', error: new Error(agentStartHook.reason ?? 'Agent start hook blocked execution.') };
        return;
      }

      const runtimeContext = renderRuntimeContext(await loadRuntimeContext(this.options.cwd, { workflows: this.options.config.workflows }), this.options.language);
      const beforePromptHook = await this.options.hooks?.run('before_prompt', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput: input.userInput,
        metadata: { mode: input.mode, runtimeContext },
      });
      if (beforePromptHook?.blocked) {
        yield { type: 'error', error: new Error(beforePromptHook.reason ?? 'Prompt hook blocked execution.') };
        return;
      }
      const hookContext = [...(agentStartHook?.additionalContexts ?? []), ...(beforePromptHook?.additionalContexts ?? [])].filter(Boolean).join('\n\n');
      let messages = this.buildInitialMessages(input.history, input.userInput, input.mode, runtimeContext, hookContext || null);
      let totalUsage = { ...ZERO_USAGE };

      if (spec.parallelAgents > 1) {
        const runtime = new MultiAgentRuntime({
          llmProvider: this.options.llmProvider,
          cwd: this.options.cwd,
          sessionId: this.options.sessionId,
          language: this.options.language,
          character: this.options.character,
          maxConcurrency: spec.parallelAgents,
          runtimeContext,
          signal: this.options.signal,
        });
        let multiAgentReport: string | null = null;
        let multiAgentUsage = { ...ZERO_USAGE };
        for await (const event of runtime.run({ userInput: input.userInput, runtimeContext })) {
          yield event;
          if (event.type === 'multi_agent_done') {
            multiAgentReport = event.result.mergeReport;
            multiAgentUsage = event.result.usage;
          }
        }
        totalUsage = addUsage(totalUsage, multiAgentUsage);
        if (multiAgentReport) messages.push(userMessage(multiAgentReport));
      }
      if (spec.requiresPlan) {
        const planResult = await this.options.llmProvider.chat({
          messages: [
            systemMessage(buildAgentSystemPrompt({
              mode: input.mode,
              character: this.options.character,
              language: this.options.language,
              cwd: this.options.cwd,
              runtimeContext,
            })),
            userMessage(buildPlanPrompt(input.userInput, this.options.language)),
          ],
          signal: this.options.signal,
        });
        totalUsage = addUsage(totalUsage, planResult.usage);
        yield { type: 'planning', text: planResult.text };
        messages.push(assistantMessage(planResult.text));
      }

      if (spec.allowTools && this.options.llmProvider.supportsTools) {
        const loopResult = yield* this.runToolLoop(messages, spec.maxIterations, input.mode);
        messages = loopResult.messages;
        totalUsage = addUsage(totalUsage, loopResult.usage);
      } else {
        const liteResult = await this.runLite(messages);
        totalUsage = addUsage(totalUsage, liteResult.usage);
        messages.push(assistantMessage(liteResult.text));
        yield { type: 'assistant_message', text: liteResult.text };
      }

      if (spec.requiresVerification) {
        const verification = await this.options.llmProvider.chat({
          messages: [
            ...messages,
            userMessage(buildVerificationPrompt(this.options.language)),
          ],
          signal: this.options.signal,
        });
        totalUsage = addUsage(totalUsage, verification.usage);
        messages.push(assistantMessage(verification.text));
        yield { type: 'verification', text: verification.text };
      }

      const responseText = extractAssistantText(messages);
      const afterResponseHook = await this.options.hooks?.run('after_response', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput: input.userInput,
        responseText,
        metadata: { mode: input.mode },
      });
      if (afterResponseHook?.blocked) {
        yield { type: 'error', error: new Error(afterResponseHook.reason ?? 'Response hook blocked execution.') };
        return;
      }

      const agentDoneHook = await this.options.hooks?.run('agent_done', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput: input.userInput,
        responseText,
        metadata: { mode: input.mode, usage: totalUsage },
      });
      if (agentDoneHook?.blocked) {
        yield { type: 'error', error: new Error(agentDoneHook.reason ?? 'Agent done hook blocked execution.') };
        return;
      }

      yield { type: 'usage', usage: totalUsage };
      yield { type: 'done', messages, usage: totalUsage };
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  private buildInitialMessages(history: Message[], userInput: string, mode: AgentRunInput['mode'], runtimeContext: string | null, hookContext: string | null = null): Message[] {
    return [
      systemMessage(buildAgentSystemPrompt({
        mode,
        character: this.options.character,
        language: this.options.language,
        cwd: this.options.cwd,
        runtimeContext: joinContext(runtimeContext, hookContext),
      })),
      ...history,
      userMessage(userInput),
    ];
  }

  private async runLite(messages: Message[]): Promise<{ text: string; usage: LLMUsage }> {
    const compacted = await this.options.contextManager.ensureWithinLimit(messages);
    return this.options.llmProvider.chat({
      messages: compacted,
      signal: this.options.signal,
    });
  }

  private async *runToolLoop(
    initialMessages: Message[],
    maxIterations: number,
    mode: AgentRunInput['mode'],
  ): AsyncIterable<AgentLoopEvent, { messages: Message[]; usage: LLMUsage }> {
    let messages = initialMessages;
    let totalUsage = { ...ZERO_USAGE };

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const compacted = await this.options.contextManager.ensureWithinLimit(messages);
      let assistantText = '';
      let toolCalls: ToolCall[] = [];

      for await (const chunk of this.options.llmProvider.chatStream({
        messages: compacted,
        tools: this.options.tools,
        signal: this.options.signal,
      })) {
        if (chunk.type === 'text') {
          assistantText += chunk.text;
          yield { type: 'text_delta', text: chunk.text };
        } else if (chunk.type === 'tool_call_start') {
          yield { type: 'tool_call_start', toolCall: chunk.toolCall };
        } else if (chunk.type === 'tool_call_delta') {
          yield { type: 'tool_call_delta', id: chunk.id, argsDelta: chunk.argsDelta };
        } else if (chunk.type === 'done') {
          toolCalls = chunk.toolCalls;
          totalUsage = addUsage(totalUsage, chunk.usage);
        }
      }

      const assistantContent = [
        ...(assistantText ? [{ type: 'text' as const, text: assistantText }] : []),
        ...toolCalls.map(toolCall => ({ type: 'tool_use' as const, toolCall })),
      ];
      if (assistantContent.length > 0) {
        messages = [...compacted, { role: 'assistant', content: assistantContent, timestamp: Date.now(), metadata: { mode } }];
      } else {
        messages = compacted;
      }

      if (toolCalls.length === 0) {
        if (assistantText) yield { type: 'assistant_message', text: assistantText };
        return { messages, usage: totalUsage };
      }

      for (const toolCall of toolCalls) {
        const result = await this.options.toolExecutor.execute({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        }, {
          cwd: this.options.cwd,
          sessionId: this.options.sessionId,
          config: this.options.config,
          language: this.options.language,
          permissionMode: 'strict',
          explain: true,
          signal: this.options.signal,
          characterId: this.options.character.id,
          confirm: this.options.confirm,
          confirmSecond: this.options.confirmSecond,
          hooks: this.options.hooks,
        });
        yield { type: 'tool_result', toolCall, result };
        messages = [...messages, toolResultMessage(toolCall, result)];
      }
    }

    const limitText = this.options.language === 'en-US'
      ? `Stopped after ${maxIterations} tool iterations. Please review the latest tool results before continuing.`
      : `已达到 ${maxIterations} 次工具循环上限。请先查看最新工具结果，再决定是否继续。`;
    messages = [...messages, assistantMessage(limitText)];    yield { type: 'assistant_message', text: limitText };
    return { messages, usage: totalUsage };
  }

}

function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: (a.cost ?? 0) + (b.cost ?? 0) || undefined,
  };
}

function formatParallelFindings(findings: Array<{ name: string; text: string }>, language: 'zh-CN' | 'en-US'): string {
  const title = language === 'en-US' ? 'Parallel agent findings' : '骞惰瀛?Agent 鍙戠幇';
  return [
    title,
    ...findings.map(item => `## ${item.name}\n${item.text}`),
  ].join('\n\n');
}
function joinContext(runtimeContext: string | null, hookContext: string | null): string | null {
  const parts = [runtimeContext, hookContext ? `RoxyCode Hooks additional context:\n${hookContext}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function extractAssistantText(messages: Message[]): string {
  return messages
    .filter(message => message.role === 'assistant')
    .map(message => {
      if (typeof message.content === 'string') return message.content;
      return message.content.map(block => block.type === 'text' ? block.text : '').join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}
