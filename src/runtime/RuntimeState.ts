import { randomUUID } from 'node:crypto';
import type { CharacterId } from '../aesthetic/character/types.js';
import type { RoxyCodeConfig } from '../core/types/config.js';
import type { LLMToolResultPairingRepair, LLMUsage } from '../core/types/llm.js';
import type { ToolCall, ToolResult } from '../core/types/message.js';
import type { Language } from '../i18n/index.js';
import type { HookExecutionRecord, RoxyHookEvent } from '../hooks/types.js';
import type { HookLoadError } from '../hooks/types.js';
import type { McpLoadError } from '../mcp/types.js';
import type { PluginLoadError } from '../plugin/types.js';
import { getRoxyErrorDescriptor } from '../core/errors.js';
import type { TelemetrySnapshot } from '../telemetry/index.js';
import type { QueryProfileSummary } from './QueryProfiler.js';

const MAX_RECENT_ERRORS = 20;
const MAX_SLOW_OPERATIONS = 10;
const SLOW_OPERATION_THRESHOLD_MS = 3_000;
const SLOW_OPERATION_TTL_MS = 5 * 60_000;
const SLOW_QUERY_THRESHOLD_MS = 5_000;
const MAX_SLOW_QUERY_PROFILES = 5;

export interface RuntimeExtensionSnapshot {
  plugins: {
    enabled: number;
    disabled: number;
    errors: PluginLoadError[];
  };
  hooks: {
    count: number;
    errors: HookLoadError[];
  };
  mcp: {
    servers: number;
    tools: number;
    errors: Array<McpLoadError | { source: string; message: string }>;
  };
  commands: {
    builtin: number;
    extension: number;
    total: number;
  };
  tools: {
    builtin: number;
    mcp: number;
    total: number;
  };
}

export interface RuntimeSessionSnapshot {
  sessionId: string;
  transcriptPath: string;
  messageCount: number;
  turns: number;
}

export interface RuntimeAgentSnapshot {
  active: boolean;
  mode: string;
  lastInput?: string;
  lastError?: string;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  contextCompactions: number;
  tokenBudgetContinuations: number;
}

export interface RuntimeUsageSnapshot {
  total: LLMUsage;
  requests: number;
}

export interface RuntimeProviderDiagnosticsSnapshot {
  providerId?: string;
  model?: string;
  requestId?: string;
  statusCode?: number;
  retryAfterMs?: number;
  fallbackModel?: string;
  fallbackModels?: string[];
  code?: string;
  recoverable?: boolean;
  at: number;
}

export interface RuntimeToolResultPairingRepairSnapshot extends LLMToolResultPairingRepair {
  at: number;
}

export interface RuntimeToolResultPairingSnapshot {
  totalRepairs: number;
  insertedSyntheticResults: number;
  removedOrphanResults: number;
  removedDuplicateToolUses: number;
  removedDuplicateToolResults: number;
  last?: RuntimeToolResultPairingRepairSnapshot;
}

export interface RuntimeLastToolSnapshot {
  name: string;
  durationMs: number;
  success: boolean;
  at: number;
  error?: string;
}

export interface RuntimeToolStatsSnapshot {
  totalCalls: number;
  failedCalls: number;
  totalDurationMs: number;
  turnCalls: number;
  turnDurationMs: number;
  last?: RuntimeLastToolSnapshot;
}

export interface RuntimeLastHookSnapshot {
  event: string;
  matched: number;
  durationMs: number;
  blocked: boolean;
  errors: number;
  at: number;
  reason?: string;
  kinds?: string[];
  characterOverlays?: string[];
}

export interface RuntimeHookStatsSnapshot {
  totalRuns: number;
  blockedRuns: number;
  errorRuns: number;
  totalDurationMs: number;
  turnRuns: number;
  turnDurationMs: number;
  last?: RuntimeLastHookSnapshot;
}

export interface RuntimeSlowOperationSnapshot {
  operation: string;
  durationMs: number;
  timestamp: number;
  kind: 'tool' | 'hook' | 'agent' | 'command' | 'system';
}

export interface RuntimeErrorSnapshot {
  source: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeQueryProfileSnapshot {
  last?: QueryProfileSummary;
  slowProfiles: QueryProfileSummary[];
}

export interface RuntimeOperationsSnapshot {
  tools: RuntimeToolStatsSnapshot;
  hooks: RuntimeHookStatsSnapshot;
  slowOperations: RuntimeSlowOperationSnapshot[];
  recentErrors: RuntimeErrorSnapshot[];
  queryProfiles: RuntimeQueryProfileSnapshot;
  toolResultPairing: RuntimeToolResultPairingSnapshot;
}

export interface RuntimeStateSnapshot {
  runtimeId: string;
  cwd: string;
  projectRoot: string;
  startedAt: number;
  lastInteractionAt: number;
  language: Language;
  characterId: CharacterId;
  providerId: string;
  model: string;
  providerDiagnostics?: RuntimeProviderDiagnosticsSnapshot;
  isInteractive: boolean;
  session: RuntimeSessionSnapshot;
  agent: RuntimeAgentSnapshot;
  usage: RuntimeUsageSnapshot;
  extensions: RuntimeExtensionSnapshot;
  operations: RuntimeOperationsSnapshot;
  telemetry?: TelemetrySnapshot;
}

export interface RuntimeStateInit {
  cwd: string;
  projectRoot?: string;
  language: Language;
  characterId: CharacterId;
  providerId: string;
  model: string;
  isInteractive?: boolean;
  sessionId: string;
  transcriptPath: string;
}

export interface RuntimeHookRunInput {
  event: RoxyHookEvent | string;
  matched: number;
  duration: number;
  blocked: boolean;
  reason?: string;
  executions: HookExecutionRecord[];
}

export class RuntimeState {
  private readonly runtimeId = randomUUID();
  private readonly startedAt = Date.now();
  private cwd: string;
  private projectRoot: string;
  private language: Language;
  private characterId: CharacterId;
  private providerId: string;
  private model: string;
  private providerDiagnostics?: RuntimeProviderDiagnosticsSnapshot;
  private isInteractive: boolean;
  private lastInteractionAt = Date.now();
  private session: RuntimeSessionSnapshot;
  private agent: RuntimeAgentSnapshot = {
    active: false,
    mode: 'standard',
    contextCompactions: 0,
    tokenBudgetContinuations: 0,
  };
  private usage: RuntimeUsageSnapshot = {
    total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    requests: 0,
  };
  private extensions: RuntimeExtensionSnapshot = emptyExtensionSnapshot();
  private toolStats: RuntimeToolStatsSnapshot = emptyToolStats();
  private hookStats: RuntimeHookStatsSnapshot = emptyHookStats();
  private slowOperations: RuntimeSlowOperationSnapshot[] = [];
  private recentErrors: RuntimeErrorSnapshot[] = [];
  private toolResultPairingStats: RuntimeToolResultPairingSnapshot = emptyToolResultPairingStats();
  private lastQueryProfile?: QueryProfileSummary;
  private slowQueryProfiles: QueryProfileSummary[] = [];
  private telemetry?: TelemetrySnapshot;

  constructor(init: RuntimeStateInit) {
    this.cwd = init.cwd;
    this.projectRoot = init.projectRoot ?? init.cwd;
    this.language = init.language;
    this.characterId = init.characterId;
    this.providerId = init.providerId;
    this.model = init.model;
    this.isInteractive = init.isInteractive ?? false;
    this.session = {
      sessionId: init.sessionId,
      transcriptPath: init.transcriptPath,
      messageCount: 0,
      turns: 0,
    };
  }

  getRuntimeId(): string {
    return this.runtimeId;
  }

  touch(): void {
    this.lastInteractionAt = Date.now();
  }

  setInteractive(value: boolean): void {
    this.isInteractive = value;
  }

  updateConfig(input: {
    language?: Language;
    characterId?: CharacterId;
    providerId?: string;
    model?: string;
    config?: RoxyCodeConfig;
  }): void {
    if (input.language) this.language = input.language;
    if (input.characterId) this.characterId = input.characterId;
    if (input.providerId) this.providerId = input.providerId;
    if (input.model) this.model = input.model;
    if (input.config) {
      this.language = input.config.ui.language;
      this.characterId = input.config.character.current;
      this.providerId = input.config.llm.provider;
      this.model = input.config.llm.model;
    }
  }

  switchSession(input: { sessionId: string; transcriptPath: string; messageCount?: number; turns?: number }): void {
    this.session = {
      sessionId: input.sessionId,
      transcriptPath: input.transcriptPath,
      messageCount: input.messageCount ?? 0,
      turns: input.turns ?? 0,
    };
    this.touch();
  }

  updateSession(input: Partial<Pick<RuntimeSessionSnapshot, 'messageCount' | 'turns'>>): void {
    this.session = { ...this.session, ...input };
    this.touch();
  }

  recordExtensions(snapshot: RuntimeExtensionSnapshot): void {
    this.extensions = cloneExtensionSnapshot(snapshot);
  }

  recordTelemetry(snapshot: TelemetrySnapshot): void {
    this.telemetry = { ...snapshot, lastEvent: snapshot.lastEvent ? { ...snapshot.lastEvent } : undefined };
  }

  recordAgentStart(input: { mode: string; userInput: string }): void {
    this.toolStats = { ...this.toolStats, turnCalls: 0, turnDurationMs: 0 };
    this.hookStats = { ...this.hookStats, turnRuns: 0, turnDurationMs: 0 };
    this.agent = {
      ...this.agent,
      active: true,
      mode: input.mode,
      lastInput: input.userInput,
      lastError: undefined,
      lastStartedAt: Date.now(),
    };
    this.touch();
  }

  recordAgentEvent(event: { type: string; usage?: LLMUsage; error?: Error; toolCall?: ToolCall; result?: unknown; profile?: unknown; report?: unknown }): void {
    switch (event.type) {
      case 'context_compacted':
        this.agent.contextCompactions += 1;
        break;
      case 'token_budget_continue':
        this.agent.tokenBudgetContinuations += 1;
        break;
      case 'tool_result_pairing_repaired':
        if (isToolResultPairingRepair(event.report)) this.recordToolResultPairingRepair(event.report);
        break;
      case 'tool_result':
        if (isToolResult(event.result)) {
          this.recordToolResult({
            name: event.toolCall?.name ?? String(event.result.metadata?.tool ?? 'unknown_tool'),
            durationMs: event.result.duration,
            success: event.result.success,
            error: event.result.error,
          });
        }
        break;
      case 'usage':
        if (event.usage) this.addUsage(event.usage);
        break;
      case 'done':
        this.agent.active = false;
        this.agent.lastCompletedAt = Date.now();
        if (isQueryProfile(event.profile)) this.recordQueryProfile(event.profile);
        break;
      case 'error': {
        this.agent.active = false;
        this.agent.lastCompletedAt = Date.now();
        this.agent.lastError = event.error?.message;
        if (isQueryProfile(event.profile)) this.recordQueryProfile(event.profile);
        const descriptor = getRoxyErrorDescriptor(event.error);
        this.recordProviderDiagnostics(descriptor);
        this.recordError('agent', event.error?.message ?? 'Unknown agent error', { descriptor, provider: this.providerDiagnostics ? { ...this.providerDiagnostics } : undefined });
        break;
      }
    }
    this.touch();
  }

  recordToolResultPairingRepair(report: LLMToolResultPairingRepair): void {
    this.toolResultPairingStats = {
      totalRepairs: this.toolResultPairingStats.totalRepairs + 1,
      insertedSyntheticResults: this.toolResultPairingStats.insertedSyntheticResults + report.insertedSyntheticResults,
      removedOrphanResults: this.toolResultPairingStats.removedOrphanResults + report.removedOrphanResults,
      removedDuplicateToolUses: this.toolResultPairingStats.removedDuplicateToolUses + report.removedDuplicateToolUses,
      removedDuplicateToolResults: this.toolResultPairingStats.removedDuplicateToolResults + report.removedDuplicateToolResults,
      last: { ...report, at: Date.now() },
    };
    this.touch();
  }

  recordToolResult(input: { name: string; durationMs: number; success: boolean; error?: string }): void {
    const durationMs = Math.max(0, Math.round(input.durationMs));
    this.toolStats = {
      totalCalls: this.toolStats.totalCalls + 1,
      failedCalls: this.toolStats.failedCalls + (input.success ? 0 : 1),
      totalDurationMs: this.toolStats.totalDurationMs + durationMs,
      turnCalls: this.toolStats.turnCalls + 1,
      turnDurationMs: this.toolStats.turnDurationMs + durationMs,
      last: {
        name: input.name,
        durationMs,
        success: input.success,
        at: Date.now(),
        error: input.error,
      },
    };
    if (!input.success && input.error) this.recordError(`tool:${input.name}`, input.error);
    this.recordSlowOperation({ kind: 'tool', operation: input.name, durationMs });
  }

  recordHookRun(input: RuntimeHookRunInput): void {
    const durationMs = Math.max(0, Math.round(input.duration));
    const errors = input.executions.filter(execution => execution.outcome === 'error').length;
    const kinds = unique(input.executions.map(execution => execution.kind));
    const characterOverlays = input.executions.filter(execution => execution.kind === 'character').map(execution => execution.hookId);
    this.hookStats = {
      totalRuns: this.hookStats.totalRuns + 1,
      blockedRuns: this.hookStats.blockedRuns + (input.blocked ? 1 : 0),
      errorRuns: this.hookStats.errorRuns + (errors > 0 ? 1 : 0),
      totalDurationMs: this.hookStats.totalDurationMs + durationMs,
      turnRuns: this.hookStats.turnRuns + 1,
      turnDurationMs: this.hookStats.turnDurationMs + durationMs,
      last: {
        event: input.event,
        matched: input.matched,
        durationMs,
        blocked: input.blocked,
        errors,
        at: Date.now(),
        reason: input.reason,
        kinds: kinds.length > 0 ? kinds : undefined,
        characterOverlays: characterOverlays.length > 0 ? characterOverlays : undefined,
      },
    };
    if (input.blocked && input.reason) this.recordError(`hook:${input.event}`, input.reason);
    for (const execution of input.executions) {
      if (execution.outcome === 'error' && execution.message) this.recordError(`hook:${execution.hookId}`, execution.message);
    }
    this.recordSlowOperation({ kind: 'hook', operation: String(input.event), durationMs });
    this.touch();
  }

  recordQueryProfile(profile: QueryProfileSummary): void {
    this.lastQueryProfile = cloneQueryProfile(profile);
    if (profile.totalMs >= SLOW_QUERY_THRESHOLD_MS) {
      this.slowQueryProfiles.push(cloneQueryProfile(profile));
      if (this.slowQueryProfiles.length > MAX_SLOW_QUERY_PROFILES) this.slowQueryProfiles = this.slowQueryProfiles.slice(-MAX_SLOW_QUERY_PROFILES);
      this.recordSlowOperation({ kind: 'agent', operation: 'query:' + profile.mode, durationMs: profile.totalMs });
    }
    this.touch();
  }

  recordProviderDiagnostics(descriptor: ReturnType<typeof getRoxyErrorDescriptor>): void {
    const details = descriptor.details;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return;
    const providerId = asString(details.providerId);
    const model = asString(details.model);
    const requestId = asString(details.requestId);
    const fallbackModel = asString(details.fallbackModel);
    const fallbackModels = asStringArray(details.fallbackModels);
    const statusCode = asNumber(details.statusCode);
    const retryAfterMs = asNumber(details.retryAfterMs);
    const providerLike = providerId || model || requestId || statusCode !== undefined || retryAfterMs !== undefined || fallbackModel;
    if (!providerLike) return;
    this.providerDiagnostics = {
      providerId,
      model,
      requestId,
      statusCode,
      retryAfterMs,
      fallbackModel,
      fallbackModels,
      code: descriptor.code,
      recoverable: descriptor.recoverable,
      at: Date.now(),
    };
  }

  recordError(source: string, message: string, metadata?: Record<string, unknown>): void {
    if (!message) return;
    this.recentErrors.push({ source, message, timestamp: Date.now(), metadata });
    if (this.recentErrors.length > MAX_RECENT_ERRORS) this.recentErrors = this.recentErrors.slice(-MAX_RECENT_ERRORS);
  }

  addUsage(usage: LLMUsage): void {
    this.usage = {
      requests: this.usage.requests + 1,
      total: {
        inputTokens: this.usage.total.inputTokens + usage.inputTokens,
        outputTokens: this.usage.total.outputTokens + usage.outputTokens,
        totalTokens: this.usage.total.totalTokens + usage.totalTokens,
        cost: (this.usage.total.cost ?? 0) + (usage.cost ?? 0) || undefined,
      },
    };
  }

  snapshot(): RuntimeStateSnapshot {
    this.pruneSlowOperations();
    return {
      runtimeId: this.runtimeId,
      cwd: this.cwd,
      projectRoot: this.projectRoot,
      startedAt: this.startedAt,
      lastInteractionAt: this.lastInteractionAt,
      language: this.language,
      characterId: this.characterId,
      providerId: this.providerId,
      model: this.model,
      providerDiagnostics: this.providerDiagnostics ? { ...this.providerDiagnostics, fallbackModels: this.providerDiagnostics.fallbackModels ? [...this.providerDiagnostics.fallbackModels] : undefined } : undefined,
      isInteractive: this.isInteractive,
      session: { ...this.session },
      agent: { ...this.agent },
      usage: { requests: this.usage.requests, total: { ...this.usage.total } },
      extensions: cloneExtensionSnapshot(this.extensions),
      operations: {
        tools: cloneToolStats(this.toolStats),
        hooks: cloneHookStats(this.hookStats),
        slowOperations: this.slowOperations.map(operation => ({ ...operation })),
        recentErrors: this.recentErrors.map(error => ({ ...error, metadata: error.metadata ? { ...error.metadata } : undefined })),
        queryProfiles: {
          last: this.lastQueryProfile ? cloneQueryProfile(this.lastQueryProfile) : undefined,
          slowProfiles: this.slowQueryProfiles.map(profile => cloneQueryProfile(profile)),
        },
        toolResultPairing: cloneToolResultPairingStats(this.toolResultPairingStats),
      },
      telemetry: this.telemetry ? { ...this.telemetry, lastEvent: this.telemetry.lastEvent ? { ...this.telemetry.lastEvent } : undefined } : undefined,
    };
  }

  private recordSlowOperation(input: { kind: RuntimeSlowOperationSnapshot['kind']; operation: string; durationMs: number }): void {
    if (input.durationMs < SLOW_OPERATION_THRESHOLD_MS) return;
    this.pruneSlowOperations();
    this.slowOperations.push({ operation: input.operation, durationMs: input.durationMs, kind: input.kind, timestamp: Date.now() });
    if (this.slowOperations.length > MAX_SLOW_OPERATIONS) this.slowOperations = this.slowOperations.slice(-MAX_SLOW_OPERATIONS);
  }

  private pruneSlowOperations(): void {
    const now = Date.now();
    this.slowOperations = this.slowOperations.filter(operation => now - operation.timestamp < SLOW_OPERATION_TTL_MS);
  }
}

export function createRuntimeState(init: RuntimeStateInit): RuntimeState {
  return new RuntimeState(init);
}

export function emptyExtensionSnapshot(): RuntimeExtensionSnapshot {
  return {
    plugins: { enabled: 0, disabled: 0, errors: [] },
    hooks: { count: 0, errors: [] },
    mcp: { servers: 0, tools: 0, errors: [] },
    commands: { builtin: 0, extension: 0, total: 0 },
    tools: { builtin: 0, mcp: 0, total: 0 },
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
  return items.length > 0 ? items : undefined;
}

function emptyToolStats(): RuntimeToolStatsSnapshot {
  return { totalCalls: 0, failedCalls: 0, totalDurationMs: 0, turnCalls: 0, turnDurationMs: 0 };
}

function emptyHookStats(): RuntimeHookStatsSnapshot {
  return { totalRuns: 0, blockedRuns: 0, errorRuns: 0, totalDurationMs: 0, turnRuns: 0, turnDurationMs: 0 };
}

function cloneExtensionSnapshot(snapshot: RuntimeExtensionSnapshot): RuntimeExtensionSnapshot {
  return {
    plugins: {
      enabled: snapshot.plugins.enabled,
      disabled: snapshot.plugins.disabled,
      errors: snapshot.plugins.errors.map(error => ({ ...error })),
    },
    hooks: {
      count: snapshot.hooks.count,
      errors: snapshot.hooks.errors.map(error => ({ ...error })),
    },
    mcp: {
      servers: snapshot.mcp.servers,
      tools: snapshot.mcp.tools,
      errors: snapshot.mcp.errors.map(error => ({ ...error })),
    },
    commands: { ...snapshot.commands },
    tools: { ...snapshot.tools },
  };
}

function cloneToolStats(snapshot: RuntimeToolStatsSnapshot): RuntimeToolStatsSnapshot {
  return { ...snapshot, last: snapshot.last ? { ...snapshot.last } : undefined };
}

function cloneHookStats(snapshot: RuntimeHookStatsSnapshot): RuntimeHookStatsSnapshot {
  return {
    ...snapshot,
    last: snapshot.last ? {
      ...snapshot.last,
      kinds: snapshot.last.kinds ? [...snapshot.last.kinds] : undefined,
      characterOverlays: snapshot.last.characterOverlays ? [...snapshot.last.characterOverlays] : undefined,
    } : undefined,
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
function emptyToolResultPairingStats(): RuntimeToolResultPairingSnapshot {
  return {
    totalRepairs: 0,
    insertedSyntheticResults: 0,
    removedOrphanResults: 0,
    removedDuplicateToolUses: 0,
    removedDuplicateToolResults: 0,
  };
}

function cloneToolResultPairingStats(snapshot: RuntimeToolResultPairingSnapshot): RuntimeToolResultPairingSnapshot {
  return { ...snapshot, last: snapshot.last ? { ...snapshot.last } : undefined };
}

function isToolResult(value: unknown): value is ToolResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.success === 'boolean'
    && typeof record.output === 'string'
    && typeof record.duration === 'number';
}
function cloneQueryProfile(profile: QueryProfileSummary): QueryProfileSummary {
  return {
    ...profile,
    slowestPhase: profile.slowestPhase ? { ...profile.slowestPhase } : undefined,
    checkpoints: profile.checkpoints.map(checkpoint => ({ ...checkpoint, memory: checkpoint.memory ? { ...checkpoint.memory } : undefined })),
    phases: profile.phases.map(phase => ({ ...phase })),
  };
}

function isToolResultPairingRepair(value: unknown): value is LLMToolResultPairingRepair {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.originalMessageCount === 'number'
    && typeof record.repairedMessageCount === 'number'
    && typeof record.insertedSyntheticResults === 'number'
    && typeof record.removedOrphanResults === 'number'
    && typeof record.removedDuplicateToolUses === 'number'
    && typeof record.removedDuplicateToolResults === 'number';
}

function isQueryProfile(value: unknown): value is QueryProfileSummary {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.mode === 'string'
    && typeof record.totalMs === 'number'
    && Array.isArray(record.checkpoints)
    && Array.isArray(record.phases);
}
