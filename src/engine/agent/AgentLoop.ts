import type { LLMToolResultPairingRepair, LLMUsage } from '../../core/types/llm.js';
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
import { checkTokenBudget, createBudgetTracker, parseTokenBudget, stripTokenBudgetDirective, type BudgetTracker } from './TokenBudget.js';
import { QueryProfiler, type QueryProfileSummary } from '../../runtime/index.js';
import { StreamingToolExecutor } from './StreamingToolExecutor.js';
import { createFileReadState } from '../../tool/security/FileReadState.js';

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentLoopEvent> {
    const spec = getAgentModeSpec(input.mode);
    const tokenBudget = parseTokenBudget(input.userInput);
    const userInput = stripTokenBudgetDirective(input.userInput) || input.userInput;
    const budgetTracker = createBudgetTracker();
    const pairingRepairs: LLMToolResultPairingRepair[] = [];
    const onToolResultPairingRepair = (report: LLMToolResultPairingRepair): void => { pairingRepairs.push(report); };
    const profiler = new QueryProfiler(input.mode);
    yield { type: 'mode_start', mode: spec.mode, label: spec.label, description: spec.description };

    try {
      profiler.mark('query_hook_start', 'agent_start');
      const agentStartHook = await this.options.hooks?.run('agent_start', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput,
        metadata: { mode: input.mode, originalUserInput: input.userInput, tokenBudget },
      });
      profiler.mark('query_hook_end', 'agent_start');
      if (agentStartHook?.blocked) {
        profiler.mark('query_error', 'agent_start blocked');
        yield { type: 'error', error: new Error(agentStartHook.reason ?? 'Agent start hook blocked execution.'), profile: profiler.snapshot() };
        return;
      }

      profiler.mark('query_context_loading_start');
      const runtimeContext = renderRuntimeContext(await loadRuntimeContext(this.options.cwd, { query: userInput, workflows: this.options.config.workflows }), this.options.language);
      profiler.mark('query_context_loading_end');

      profiler.mark('query_hook_start', 'before_prompt');
      const beforePromptHook = await this.options.hooks?.run('before_prompt', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput,
        metadata: { mode: input.mode, runtimeContext, originalUserInput: input.userInput, tokenBudget },
      });
      profiler.mark('query_hook_end', 'before_prompt');
      if (beforePromptHook?.blocked) {
        profiler.mark('query_error', 'before_prompt blocked');
        yield { type: 'error', error: new Error(beforePromptHook.reason ?? 'Prompt hook blocked execution.'), profile: profiler.snapshot() };
        return;
      }

      const hookContext = [...(agentStartHook?.additionalContexts ?? []), ...(beforePromptHook?.additionalContexts ?? [])].filter(Boolean).join('\n\n');
      profiler.mark('query_setup_start');
      let messages = this.buildInitialMessages(input.history, userInput, input.mode, runtimeContext, hookContext || null);
      profiler.mark('query_setup_end');
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
        for await (const event of runtime.run({ userInput, runtimeContext })) {
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
        profiler.mark('query_model_request_start', 'planning');
        yield { type: 'model_request_start', phase: 'planning' };
        const planResult = await this.options.llmProvider.chat({
          messages: [
            systemMessage(buildAgentSystemPrompt({
              mode: input.mode,
              character: this.options.character,
              language: this.options.language,
              cwd: this.options.cwd,
              runtimeContext,
            })),
            userMessage(buildPlanPrompt(userInput, this.options.language)),
          ],
          signal: this.options.signal,
          onToolResultPairingRepair,
        });
        yield* drainPairingRepairs(pairingRepairs);
        profiler.mark('query_first_chunk_received', 'planning');
        profiler.mark('query_model_request_end', 'planning');
        totalUsage = addUsage(totalUsage, planResult.usage);
        yield { type: 'planning', text: planResult.text };
        messages.push(assistantMessage(planResult.text));
      }

      if (spec.allowTools && this.options.llmProvider.supportsTools) {
        const loopResult = yield* this.runToolLoop(messages, spec.maxIterations, input.mode, tokenBudget, budgetTracker, totalUsage, profiler, pairingRepairs, onToolResultPairingRepair);
        messages = loopResult.messages;
        totalUsage = addUsage(totalUsage, loopResult.usage);
      } else {
        const liteResult = yield* this.runLiteLoop(messages, tokenBudget, budgetTracker, totalUsage, profiler, pairingRepairs, onToolResultPairingRepair);
        messages = liteResult.messages;
        totalUsage = addUsage(totalUsage, liteResult.usage);
      }

      if (spec.requiresVerification) {
        const prepared = await this.prepareContext([...messages, userMessage(buildVerificationPrompt(this.options.language))], profiler);
        if (prepared.compactionEvent) yield prepared.compactionEvent;
        profiler.mark('query_model_request_start', 'verification');
        yield { type: 'model_request_start', phase: 'verification' };
        const verification = await this.options.llmProvider.chat({
          messages: prepared.messages,
          signal: this.options.signal,
          onToolResultPairingRepair,
        });
        yield* drainPairingRepairs(pairingRepairs);
        profiler.mark('query_first_chunk_received', 'verification');
        profiler.mark('query_model_request_end', 'verification');
        totalUsage = addUsage(totalUsage, verification.usage);
        messages = [...messages, assistantMessage(verification.text)];
        yield { type: 'verification', text: verification.text };
      }

      const responseText = extractAssistantText(messages);
      profiler.mark('query_hook_start', 'after_response');
      const afterResponseHook = await this.options.hooks?.run('after_response', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput,
        responseText,
        metadata: { mode: input.mode, originalUserInput: input.userInput, tokenBudget },
      });
      profiler.mark('query_hook_end', 'after_response');
      if (afterResponseHook?.blocked) {
        profiler.mark('query_error', 'after_response blocked');
        yield { type: 'error', error: new Error(afterResponseHook.reason ?? 'Response hook blocked execution.'), profile: profiler.snapshot() };
        return;
      }

      profiler.mark('query_hook_start', 'agent_done');
      const agentDoneHook = await this.options.hooks?.run('agent_done', {
        cwd: this.options.cwd,
        sessionId: this.options.sessionId,
        language: this.options.language,
        characterId: this.options.character.id,
        userInput,
        responseText,
        metadata: { mode: input.mode, usage: totalUsage, originalUserInput: input.userInput, tokenBudget },
      });
      profiler.mark('query_hook_end', 'agent_done');
      if (agentDoneHook?.blocked) {
        profiler.mark('query_error', 'agent_done blocked');
        yield { type: 'error', error: new Error(agentDoneHook.reason ?? 'Agent done hook blocked execution.'), profile: profiler.snapshot() };
        return;
      }

      profiler.mark('query_end');
      const profile = profiler.snapshot();
      this.options.telemetry?.log({ name: 'query.profile', category: 'agent', durationMs: profile.totalMs, success: true, attributes: profileTelemetryAttributes(profile) }).catch(() => undefined);
      yield { type: 'usage', usage: totalUsage };
      yield { type: 'done', messages, usage: totalUsage, profile };
    } catch (error) {
      profiler.mark('query_error');
      const profile = profiler.snapshot();
      this.options.telemetry?.log({ name: 'query.profile', category: 'agent', durationMs: profile.totalMs, success: false, attributes: profileTelemetryAttributes(profile) }).catch(() => undefined);
      yield* drainPairingRepairs(pairingRepairs);
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)), profile };
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

  private async *runLiteLoop(
    initialMessages: Message[],
    budget: number | null,
    budgetTracker: BudgetTracker,
    baseUsage: LLMUsage,
    profiler: QueryProfiler,
    pairingRepairs: LLMToolResultPairingRepair[],
    onToolResultPairingRepair: (report: LLMToolResultPairingRepair) => void,
  ): AsyncIterable<AgentLoopEvent, { messages: Message[]; usage: LLMUsage }> {
    let messages = initialMessages;
    let totalUsage = { ...ZERO_USAGE };
    const maxCalls = budget ? 4 : 1;

    for (let call = 0; call < maxCalls; call++) {
      const prepared = await this.prepareContext(messages, profiler);
      if (prepared.compactionEvent) yield prepared.compactionEvent;
      const label = `response #${call + 1}`;
      profiler.mark('query_model_request_start', label);
      yield { type: 'model_request_start', phase: 'response', iteration: call + 1 };
      const result = await this.options.llmProvider.chat({
        messages: prepared.messages,
        signal: this.options.signal,
        onToolResultPairingRepair,
      });
      yield* drainPairingRepairs(pairingRepairs);
      profiler.mark('query_first_chunk_received', label);
      profiler.mark('query_model_request_end', label);
      totalUsage = addUsage(totalUsage, result.usage);
      messages = [...prepared.messages, assistantMessage(result.text)];
      if (result.text) {
        yield { type: 'text_delta', text: result.text };
        yield { type: 'assistant_message', text: result.text };
      }

      const globalUsage = addUsage(baseUsage, totalUsage);
      const decision = checkTokenBudget(budgetTracker, budget, globalUsage.outputTokens, this.options.language);
      if (decision.action === 'continue') {
        yield {
          type: 'token_budget_continue',
          continuationCount: decision.continuationCount,
          pct: decision.pct,
          turnTokens: decision.turnTokens,
          budget: decision.budget,
        };
        messages = [...messages, userMessage(decision.nudgeMessage)];
        continue;
      }

      if (decision.completionEvent) yield { type: 'token_budget_done', ...decision.completionEvent };
      return { messages, usage: totalUsage };
    }

    return { messages, usage: totalUsage };
  }

  private async *runToolLoop(
    initialMessages: Message[],
    maxIterations: number,
    mode: AgentRunInput['mode'],
    budget: number | null,
    budgetTracker: BudgetTracker,
    baseUsage: LLMUsage,
    profiler: QueryProfiler,
    pairingRepairs: LLMToolResultPairingRepair[],
    onToolResultPairingRepair: (report: LLMToolResultPairingRepair) => void,
  ): AsyncIterable<AgentLoopEvent, { messages: Message[]; usage: LLMUsage }> {
    let messages = initialMessages;
    let totalUsage = { ...ZERO_USAGE };
    let toolIterations = 0;
    const fileReadState = createFileReadState();
    const maxModelCalls = maxIterations + (budget ? 3 : 0);

    for (let modelCall = 0; modelCall < maxModelCalls; modelCall++) {
      const prepared = await this.prepareContext(messages, profiler);
      if (prepared.compactionEvent) yield prepared.compactionEvent;
      const compacted = prepared.messages;
      let assistantText = '';
      let toolCalls: ToolCall[] = [];
      let firstChunkSeen = false;
      const label = `tool_loop #${modelCall + 1}`;

      profiler.mark('query_model_request_start', label);
      yield { type: 'model_request_start', phase: 'tool_loop', iteration: modelCall + 1 };
      for await (const chunk of this.options.llmProvider.chatStream({
        messages: compacted,
        tools: this.options.tools,
        signal: this.options.signal,
        onToolResultPairingRepair,
      })) {
        if (chunk.type === 'text') {
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            profiler.mark('query_first_chunk_received', label);
          }
          assistantText += chunk.text;
          yield { type: 'text_delta', text: chunk.text };
        } else if (chunk.type === 'tool_call_start') {
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            profiler.mark('query_first_chunk_received', `${label} tool_call`);
          }
          yield { type: 'tool_call_start', toolCall: chunk.toolCall };
        } else if (chunk.type === 'tool_call_delta') {
          yield { type: 'tool_call_delta', id: chunk.id, argsDelta: chunk.argsDelta };
        } else if (chunk.type === 'done') {
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            profiler.mark('query_first_chunk_received', `${label} done`);
          }
          profiler.mark('query_model_request_end', label);
          toolCalls = chunk.toolCalls;
          totalUsage = addUsage(totalUsage, chunk.usage);
        }
      }

      yield* drainPairingRepairs(pairingRepairs);

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
        const globalUsage = addUsage(baseUsage, totalUsage);
        const decision = checkTokenBudget(budgetTracker, budget, globalUsage.outputTokens, this.options.language);
        if (decision.action === 'continue') {
          yield {
            type: 'token_budget_continue',
            continuationCount: decision.continuationCount,
            pct: decision.pct,
            turnTokens: decision.turnTokens,
            budget: decision.budget,
          };
          messages = [...messages, userMessage(decision.nudgeMessage)];
          continue;
        }

        if (decision.completionEvent) yield { type: 'token_budget_done', ...decision.completionEvent };
        return { messages, usage: totalUsage };
      }

      if (toolIterations >= maxIterations) {
        messages = compacted;
        break;
      }
      toolIterations++;

      const streamingExecutor = new StreamingToolExecutor({
        toolExecutor: this.options.toolExecutor,
        tools: this.options.toolRuntimeTools ?? [],
        context: {
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
          telemetry: this.options.telemetry,
          fileReadState,
        },
      });
      for (const toolCall of toolCalls) streamingExecutor.addTool(toolCall);

      for await (const event of streamingExecutor.run()) {
        if (event.type === 'tool_execution_start') {
          profiler.mark('query_tool_execution_start', event.toolCall.name);
          yield event;
          continue;
        }

        if (event.type === 'tool_progress') {
          yield event;
          continue;
        }

        profiler.mark('query_tool_execution_end', event.toolCall.name);
        yield event;
        messages = [...messages, toolResultMessage(event.toolCall, event.result)];
      }
    }

    const limitText = this.options.language === 'en-US'
      ? `Stopped after ${maxIterations} tool iterations. Please review the latest tool results before continuing.`
      : `\u5df2\u8fbe\u5230 ${maxIterations} \u6b21\u5de5\u5177\u5faa\u73af\u4e0a\u9650\u3002\u8bf7\u5148\u67e5\u770b\u6700\u65b0\u5de5\u5177\u7ed3\u679c\uff0c\u518d\u51b3\u5b9a\u662f\u5426\u7ee7\u7eed\u3002`;
    messages = [...messages, assistantMessage(limitText)];
    yield { type: 'assistant_message', text: limitText };
    return { messages, usage: totalUsage };
  }

  private async prepareContext(messages: Message[], profiler?: QueryProfiler): Promise<{ messages: Message[]; compactionEvent?: AgentLoopEvent }> {
    profiler?.mark('query_context_compaction_start', 'check');
    const before = await this.options.contextManager.getStatus(messages);
    const prepared = await this.options.contextManager.ensureWithinLimit(messages);
    if (prepared === messages) {
      profiler?.mark('query_context_compaction_end', 'skipped');
      return { messages: prepared };
    }

    const after = await this.options.contextManager.getStatus(prepared);
    if (after.currentTokens >= before.currentTokens) {
      profiler?.mark('query_context_compaction_end', 'skipped');
      return { messages: prepared };
    }

    profiler?.mark('query_context_compaction_end', 'actual');
    return {
      messages: prepared,
      compactionEvent: {
        type: 'context_compacted',
        layer: after.needsCompression ? 'auto-partial' : 'auto',
        beforeTokens: before.currentTokens,
        afterTokens: after.currentTokens,
      },
    };
  }
}

function drainPairingRepairs(reports: LLMToolResultPairingRepair[]): AgentLoopEvent[] {
  return reports.splice(0).map(report => ({ type: 'tool_result_pairing_repaired', report }));
}

function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: (a.cost ?? 0) + (b.cost ?? 0) || undefined,
  };
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

function profileTelemetryAttributes(profile: QueryProfileSummary): Record<string, unknown> {
  return {
    profileId: profile.id,
    mode: profile.mode,
    totalMs: profile.totalMs,
    firstTokenMs: profile.firstTokenMs,
    modelRequestCount: profile.modelRequestCount,
    toolExecutionCount: profile.toolExecutionCount,
    contextCompactionCount: profile.contextCompactionCount,
    slowestPhase: profile.slowestPhase?.name,
    slowestPhaseMs: profile.slowestPhase?.durationMs,
  };
}




