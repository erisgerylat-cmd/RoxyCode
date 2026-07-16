import type { LLMToolResultPairingRepair, LLMUsage } from '../../core/types/llm.js';
import {
  assistantMessage,
  systemMessage,
  toolResultMessage,
  userMessage,
  type Message,
  type ToolCall,
  type ToolResult,
} from '../../core/types/message.js';
import { buildAgentSystemPrompt, buildPlanContinuationPrompt, buildPlanPrompt, buildVerificationPrompt } from './prompts.js';
import { loadRuntimeContext, renderRuntimeContext } from './RuntimeContext.js';
import { getAgentModeSpec } from './modes.js';
import type { AgentLoopEvent, AgentLoopOptions, AgentRunInput } from './types.js';
import { MultiAgentRuntime } from '../multi-agent/index.js';
import { checkTokenBudget, createBudgetTracker, parseTokenBudget, stripTokenBudgetDirective, type BudgetTracker } from './TokenBudget.js';
import { QueryProfiler, type QueryProfileSummary } from '../../runtime/index.js';
import { StreamingToolExecutor } from './StreamingToolExecutor.js';
import { createFileReadState } from '../../tool/security/FileReadState.js';
import { TodoStore } from '../../tool/builtin/todoWrite.js';
import {
  isTypeScriptDiagnosticPath,
  renderCodeDiagnosticsForPrompt,
  renderCodeDiagnosticsSummary,
  type CodeDiagnosticsReport,
} from '../../lsp/index.js';
import type { Tool, ToolDefinition, ToolPermissionMode } from '../../tool/index.js';
import { loadCharacterPromptContext } from '../../aesthetic/character/CharacterPromptLoader.js';
import { ProfileManager } from '../../session/profile/ProfileManager.js';
import type { UserProfile } from '../../profile/types.js';
import {
  describeAgentPhase,
  describeToolIntent,
  presentToolResult,
  type AgentPhase,
} from './ToolResultSummarizer.js';

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
interface ToolLoopResult {
  messages: Message[];
  usage: LLMUsage;
  workspaceChanges: WorkspaceChange[];
}

interface DiagnosticsRepairResult extends ToolLoopResult {
  report: CodeDiagnosticsReport | null;
}

interface WorkspaceChange {
  toolName: 'write_file' | 'edit_file';
  path: string;
  operation?: string;
  replaceAll?: boolean;
  diff?: {
    addedLines?: number;
    removedLines?: number;
    truncated?: boolean;
  };
  backups: string[];
}

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
    yield this.phaseEvent('analyze');

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
      const profileManager = new ProfileManager(this.options.cwd);
      const userProfile = await profileManager.load();
      const baseRuntimeContext = renderRuntimeContext(await loadRuntimeContext(this.options.cwd, {
        query: userInput,
        workflows: this.options.config.workflows,
        workflowFiles: this.options.character.extensions?.workflows,
        character: this.options.character,
        language: this.options.language,
      }), this.options.language);
      const characterPromptContext = await loadCharacterPromptContext(this.options.character, this.options.language).catch(() => null);
      const runtimeContext = [baseRuntimeContext, characterPromptContext].filter(Boolean).join('\n\n') || null;
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
      let messages = this.buildInitialMessages(input.history, userInput, input.mode, runtimeContext, hookContext || null, userProfile);
      profiler.mark('query_setup_end');
      let totalUsage = { ...ZERO_USAGE };
      let workspaceChanges: WorkspaceChange[] = [];
      let lastDiagnosticsReport: CodeDiagnosticsReport | null = null;

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
        yield this.phaseEvent('plan');
        yield { type: 'model_request_start', phase: 'planning' };
        const planResult = await this.options.llmProvider.chat({
          messages: [
            systemMessage(buildAgentSystemPrompt({
              mode: input.mode,
              character: this.options.character,
              language: this.options.language,
              cwd: this.options.cwd,
              runtimeContext,
              profile: userProfile,
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
        messages.push(
          assistantMessage(planResult.text),
          userMessage(buildPlanContinuationPrompt(input.mode, this.options.language)),
        );
      }

      if (spec.allowTools && this.options.llmProvider.supportsTools) {
        yield this.phaseEvent('execute');
        const loopResult = yield* this.runToolLoop(messages, spec.maxIterations, input.mode, spec.toolPermissionMode ?? 'strict', tokenBudget, budgetTracker, totalUsage, profiler, pairingRepairs, onToolResultPairingRepair);
        messages = loopResult.messages;
        totalUsage = addUsage(totalUsage, loopResult.usage);
        workspaceChanges = loopResult.workspaceChanges;
        const diagnosticsResult = yield* this.runDiagnosticsRepairPass(messages, workspaceChanges, input.mode, spec.toolPermissionMode ?? 'strict', totalUsage, profiler, pairingRepairs, onToolResultPairingRepair);
        messages = diagnosticsResult.messages;
        totalUsage = addUsage(totalUsage, diagnosticsResult.usage);
        workspaceChanges = diagnosticsResult.workspaceChanges;
        lastDiagnosticsReport = diagnosticsResult.report;
      } else {
        yield this.phaseEvent('summarize');
        const liteResult = yield* this.runLiteLoop(messages, tokenBudget, budgetTracker, totalUsage, profiler, pairingRepairs, onToolResultPairingRepair);
        messages = liteResult.messages;
        totalUsage = addUsage(totalUsage, liteResult.usage);
      }

      if (spec.requiresVerification) {
        const prepared = await this.prepareContext([...messages, userMessage(buildVerificationPrompt(this.options.language))], profiler);
        if (prepared.compactionEvent) yield prepared.compactionEvent;
        profiler.mark('query_model_request_start', 'verification');
        yield this.phaseEvent('verify');
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

      if (lastDiagnosticsReport) {
        const diagnosticsSummary = renderAgentDiagnosticsFinalSummary(lastDiagnosticsReport, this.options.language);
        messages = [...messages, assistantMessage(diagnosticsSummary)];
        yield { type: 'text_delta', text: `\n${diagnosticsSummary}\n` };
        yield { type: 'assistant_message', text: diagnosticsSummary };
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
      const queryProfile = profiler.snapshot();
      this.options.telemetry?.log({ name: 'query.profile', category: 'agent', durationMs: queryProfile.totalMs, success: true, attributes: profileTelemetryAttributes(queryProfile) }).catch(() => undefined);
      yield this.phaseEvent('summarize');
      yield { type: 'usage', usage: totalUsage };
      yield { type: 'done', messages, usage: totalUsage, profile: queryProfile };
    } catch (error) {
      profiler.mark('query_error');
      const profile = profiler.snapshot();
      this.options.telemetry?.log({ name: 'query.profile', category: 'agent', durationMs: profile.totalMs, success: false, attributes: profileTelemetryAttributes(profile) }).catch(() => undefined);
      yield* drainPairingRepairs(pairingRepairs);
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)), profile };
    }
  }

  private buildInitialMessages(
    history: Message[],
    userInput: string,
    mode: AgentRunInput['mode'],
    runtimeContext: string | null,
    hookContext: string | null = null,
    userProfile: UserProfile | null = null,
  ): Message[] {
    return [
      systemMessage(buildAgentSystemPrompt({
        mode,
        character: this.options.character,
        language: this.options.language,
        cwd: this.options.cwd,
        runtimeContext: joinContext(runtimeContext, hookContext),
        profile: userProfile,
      })),
      ...history,
      userMessage(userInput),
    ];
  }

  private phaseEvent(phase: AgentPhase): AgentLoopEvent {
    const characterName = this.options.language === 'en-US' ? this.options.character.nameEn : this.options.character.name;
    return { type: 'agent_phase', phase, message: describeAgentPhase(phase, this.options.language, characterName) };
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
    permissionMode: ToolPermissionMode,
    budget: number | null,
    budgetTracker: BudgetTracker,
    baseUsage: LLMUsage,
    profiler: QueryProfiler,
    pairingRepairs: LLMToolResultPairingRepair[],
    onToolResultPairingRepair: (report: LLMToolResultPairingRepair) => void,
  ): AsyncIterable<AgentLoopEvent, ToolLoopResult> {
    let messages = initialMessages;
    let totalUsage = { ...ZERO_USAGE };
    let toolIterations = 0;
    const fileReadState = createFileReadState();
    const todoStore = this.options.todoStore ?? new TodoStore();
    const runtimeTools = filterToolsForPermissionMode(this.options.toolRuntimeTools ?? [], permissionMode);
    const toolDefinitions = filterToolDefinitionsForPermissionMode(this.options.tools, runtimeTools, permissionMode);
    const maxModelCalls = maxIterations + (budget ? 3 : 0);
    const workspaceChanges: WorkspaceChange[] = [];

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
        tools: toolDefinitions,
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
        const finalAssistantText = appendWorkspaceChangeSummary(assistantText, workspaceChanges, this.options.language);
        if (finalAssistantText !== assistantText) {
          yield { type: 'text_delta', text: finalAssistantText.slice(assistantText.length) };
        }
        if (finalAssistantText) {
          messages = [...compacted, assistantMessage(finalAssistantText)];
          yield { type: 'assistant_message', text: finalAssistantText };
        } else {
          messages = compacted;
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
        return { messages, usage: totalUsage, workspaceChanges };
      }

      if (toolIterations >= maxIterations) {
        messages = compacted;
        break;
      }
      toolIterations++;

      const streamingExecutor = new StreamingToolExecutor({
        toolExecutor: this.options.toolExecutor,
        tools: runtimeTools,
        context: {
          cwd: this.options.cwd,
          sessionId: this.options.sessionId,
          config: this.options.config,
          language: this.options.language,
          permissionMode,
          explain: true,
          signal: this.options.signal,
          characterId: this.options.character.id,
          confirm: this.options.confirm,
          confirmSecond: this.options.confirmSecond,
          hooks: this.options.hooks,
          telemetry: this.options.telemetry,
          fileReadState,
          todoStore,
        },
      });
      for (const toolCall of toolCalls) streamingExecutor.addTool(toolCall);

      for await (const event of streamingExecutor.run()) {
        if (event.type === 'tool_execution_start') {
          profiler.mark('query_tool_execution_start', event.toolCall.name);
          yield {
            type: 'tool_intent',
            toolCall: event.toolCall,
            intent: describeToolIntent(event.toolCall, this.options.language),
          };
          yield event;
          continue;
        }

        if (event.type === 'tool_progress') {
          yield event;
          continue;
        }

        profiler.mark('query_tool_execution_end', event.toolCall.name);
        yield event;
        const presentation = presentToolResult(event.toolCall, event.result, this.options.language);
        yield {
          type: 'tool_result_summary',
          toolCall: event.toolCall,
          summary: presentation.summary,
          success: event.result.success,
          recoverySuggestion: presentation.recoverySuggestion,
        };
        const workspaceChange = collectWorkspaceChange(event.toolCall, event.result);
        if (workspaceChange) workspaceChanges.push(workspaceChange);
        messages = [...messages, toolResultMessage(event.toolCall, presentation.modelResult)];
      }
    }

    const limitText = this.options.language === 'en-US'
      ? `Stopped after ${maxIterations} tool iterations. Please review the latest tool results before continuing.`
      : `\u5df2\u8fbe\u5230 ${maxIterations} \u6b21\u5de5\u5177\u5faa\u73af\u4e0a\u9650\u3002\u8bf7\u5148\u67e5\u770b\u6700\u65b0\u5de5\u5177\u7ed3\u679c\uff0c\u518d\u51b3\u5b9a\u662f\u5426\u7ee7\u7eed\u3002`;
    const finalLimitText = appendWorkspaceChangeSummary(limitText, workspaceChanges, this.options.language);
    messages = [...messages, assistantMessage(finalLimitText)];
    yield { type: 'assistant_message', text: finalLimitText };
    return { messages, usage: totalUsage, workspaceChanges };
  }

  private async *runDiagnosticsRepairPass(
    messages: Message[],
    workspaceChanges: WorkspaceChange[],
    mode: AgentRunInput['mode'],
    permissionMode: ToolPermissionMode,
    baseUsage: LLMUsage,
    profiler: QueryProfiler,
    pairingRepairs: LLMToolResultPairingRepair[],
    onToolResultPairingRepair: (report: LLMToolResultPairingRepair) => void,
  ): AsyncIterable<AgentLoopEvent, DiagnosticsRepairResult> {
    const runner = this.options.runCodeDiagnostics;
    const changedFiles = collectDiagnosticFiles(workspaceChanges);
    if (!runner || changedFiles.length === 0) {
      return { messages, usage: { ...ZERO_USAGE }, workspaceChanges, report: null };
    }

    yield this.phaseEvent('verify');
    const firstReport = await runner({ cwd: this.options.cwd, changedFiles, maxDiagnostics: 50 });
    const firstSummary = renderCodeDiagnosticsSummary(firstReport, this.options.language);
    const firstRepairPrompt = shouldRepairFromDiagnostics(firstReport)
      ? renderCodeDiagnosticsForPrompt(firstReport, this.options.language, 8)
      : undefined;
    yield { type: 'diagnostics_result', report: firstReport, summary: firstSummary, repairPrompt: firstRepairPrompt };

    if (!firstRepairPrompt || permissionMode === 'read-only') {
      return { messages, usage: { ...ZERO_USAGE }, workspaceChanges, report: firstReport };
    }

    const repairInstruction = this.options.language === 'en-US'
      ? firstRepairPrompt + '\n\nRun only the tools needed to fix these diagnostics, then stop for verification.'
      : firstRepairPrompt + '\n\n\u8bf7\u53ea\u8c03\u7528\u4fee\u590d\u8fd9\u4e9b\u8bca\u65ad\u6240\u9700\u7684\u5de5\u5177\uff1b\u4fee\u590d\u540e\u505c\u6b62\uff0c\u7b49\u5f85 RoxyCode \u518d\u6b21\u9a8c\u8bc1\u3002';
    const repairResult = yield* this.runToolLoop(
      [...messages, userMessage(repairInstruction)],
      2,
      mode,
      permissionMode,
      null,
      createBudgetTracker(),
      baseUsage,
      profiler,
      pairingRepairs,
      onToolResultPairingRepair,
    );
    const repairedChanges = [...workspaceChanges, ...repairResult.workspaceChanges];
    const repairedFiles = collectDiagnosticFiles(repairedChanges);
    const secondReport = repairedFiles.length > 0
      ? await runner({ cwd: this.options.cwd, changedFiles: repairedFiles, maxDiagnostics: 50 })
      : firstReport;
    yield {
      type: 'diagnostics_result',
      report: secondReport,
      summary: renderCodeDiagnosticsSummary(secondReport, this.options.language),
    };
    return {
      messages: repairResult.messages,
      usage: repairResult.usage,
      workspaceChanges: repairedChanges,
      report: secondReport,
    };
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

function collectDiagnosticFiles(changes: WorkspaceChange[]): string[] {
  return [...new Set(changes.map(change => change.path).filter(isTypeScriptDiagnosticPath))];
}

function shouldRepairFromDiagnostics(report: CodeDiagnosticsReport): boolean {
  return report.status === 'failed' && report.counts.error > 0;
}

function renderAgentDiagnosticsFinalSummary(report: CodeDiagnosticsReport, language: 'zh-CN' | 'en-US'): string {
  const summary = renderCodeDiagnosticsSummary(report, language);
  if (language === 'en-US') {
    const status = report.status === 'passed' ? 'Validation passed' : report.status === 'failed' ? 'Diagnostics remain' : 'Diagnostics unavailable';
    return ['## Code Diagnostics', '- ' + status + ': ' + summary].join('\n');
  }
  const status = report.status === 'passed' ? '\u9a8c\u8bc1\u901a\u8fc7' : report.status === 'failed' ? '\u4ecd\u6709\u8bca\u65ad' : '\u8bca\u65ad\u4e0d\u53ef\u7528';
  return ['## \u4ee3\u7801\u8bca\u65ad', '- ' + status + '\uff1a' + summary].join('\n');
}
function collectWorkspaceChange(toolCall: ToolCall, result: ToolResult): WorkspaceChange | null {
  if (!result.success || (toolCall.name !== 'write_file' && toolCall.name !== 'edit_file')) return null;
  const meta = result.metadata ?? {};
  const path = typeof meta.path === 'string' ? meta.path : stringArgFromTool(toolCall, 'path');
  if (!path) return null;
  const diff = readDiff(meta.diff);
  return {
    toolName: toolCall.name,
    path,
    operation: typeof meta.operation === 'string' ? meta.operation : undefined,
    replaceAll: typeof meta.replaceAll === 'boolean' ? meta.replaceAll : undefined,
    diff,
    backups: readBackupPaths(meta.backups),
  };
}

function appendWorkspaceChangeSummary(text: string, changes: WorkspaceChange[], language: 'zh-CN' | 'en-US'): string {
  if (changes.length === 0) return text;
  const summary = renderWorkspaceChangeSummary(changes, language);
  if (!text.trim()) return summary;
  return `${text.trimEnd()}\n\n${summary}`;
}

function renderWorkspaceChangeSummary(changes: WorkspaceChange[], language: 'zh-CN' | 'en-US'): string {
  const isZh = language !== 'en-US';
  const lines = [isZh ? '## \u672c\u8f6e\u5de5\u4f5c\u533a\u53d8\u66f4' : '## Workspace Changes'];
  for (const change of changes) {
    const diffText = formatDiffSummary(change.diff, language);
    const action = change.toolName === 'write_file'
      ? (change.operation ?? 'write')
      : (change.replaceAll ? 'edit replace_all' : 'edit');
    lines.push(`- ${quotePath(change.path)}: ${action}${diffText ? `, ${diffText}` : ''}`);
    if (change.backups.length > 0) {
      lines.push(isZh
        ? `  \u5907\u4efd: ${change.backups.map(quotePath).join(', ')}`
        : `  Backup: ${change.backups.map(quotePath).join(', ')}`);
    }
  }
  lines.push(isZh
    ? '\u8fd9\u4e9b\u53d8\u66f4\u5747\u5df2\u901a\u8fc7 RoxyCode \u6743\u9650\u5b88\u536b\u6267\u884c\uff1b\u5df2\u6709\u6587\u4ef6\u5728\u5199\u5165\u524d\u4f1a\u81ea\u52a8\u5907\u4efd\u3002'
    : 'These changes were executed through the RoxyCode permission guard; existing files are backed up before writes.');
  return lines.join('\n');
}

function formatDiffSummary(diff: WorkspaceChange['diff'], language: 'zh-CN' | 'en-US'): string {
  if (!diff || (diff.addedLines === undefined && diff.removedLines === undefined)) return '';
  const base = `${language === 'en-US' ? 'diff' : '\u53d8\u66f4'} +${diff.addedLines ?? 0} -${diff.removedLines ?? 0}`;
  return diff.truncated ? `${base}${language === 'en-US' ? ' (truncated preview)' : '\uff08\u9884\u89c8\u5df2\u622a\u65ad\uff09'}` : base;
}

function readDiff(value: unknown): WorkspaceChange['diff'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    addedLines: typeof record.addedLines === 'number' ? record.addedLines : undefined,
    removedLines: typeof record.removedLines === 'number' ? record.removedLines : undefined,
    truncated: typeof record.truncated === 'boolean' ? record.truncated : undefined,
  };
}

function readBackupPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => item && typeof item === 'object' ? (item as Record<string, unknown>).backupPath : undefined)
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function stringArgFromTool(toolCall: ToolCall, key: string): string | undefined {
  const value = toolCall.arguments[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function quotePath(value: string): string {
  return `\`${value}\``;
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

function filterToolsForPermissionMode(tools: Tool[], permissionMode: ToolPermissionMode): Tool[] {
  if (permissionMode !== 'read-only') return tools;
  return tools.filter(tool => tool.isReadOnly);
}

function filterToolDefinitionsForPermissionMode(
  definitions: ToolDefinition[],
  runtimeTools: Tool[],
  permissionMode: ToolPermissionMode,
): ToolDefinition[] {
  if (permissionMode !== 'read-only') return definitions;
  const allowed = new Set(runtimeTools.map(tool => tool.definition.name));
  return definitions.filter(definition => allowed.has(definition.name));
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
