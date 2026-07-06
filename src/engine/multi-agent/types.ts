import type { Character } from '../../aesthetic/character/types.js';
import type { LLMProvider, LLMUsage } from '../../core/types/llm.js';

export type MultiAgentTaskStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'conflict';

export type MultiAgentTaskRole =
  | 'architect'
  | 'implementer'
  | 'reviewer'
  | 'verifier'
  | 'researcher'
  | 'custom';

export type MultiAgentPlanSource = 'llm' | 'fallback';

export interface MultiAgentTask {
  id: string;
  title: string;
  description: string;
  role: MultiAgentTaskRole;
  status: MultiAgentTaskStatus;
  dependsOn: string[];
  fileScopes: string[];
  prompt: string;
  assignedAgent?: string;
  createdAt: string;
  claimedAt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: string;
  metadata?: Record<string, unknown>;
}

export interface MultiAgentPlan {
  id: string;
  runId: string;
  goal: string;
  createdAt: string;
  language: 'zh-CN' | 'en-US';
  maxConcurrency: number;
  source: MultiAgentPlanSource;
  tasks: MultiAgentTask[];
  notes?: string[];
}

export interface TaskClaim {
  runId: string;
  taskId: string;
  agentId: string;
  claimedAt: string;
  cwd: string;
}

export interface FileLock {
  runId: string;
  taskId: string;
  agentId: string;
  path: string;
  lockPath?: string;
  createdAt: string;
  reason?: string;
}

export interface MultiAgentConflict {
  taskId?: string;
  agentId?: string;
  path?: string;
  message: string;
  holder?: FileLock | TaskClaim;
  resolution: 'serialized' | 'blocked' | 'merged';
}

export interface MultiAgentTaskResult {
  taskId: string;
  agentId: string;
  title: string;
  role: MultiAgentTaskRole;
  status: 'done' | 'failed' | 'conflict';
  text: string;
  usage: LLMUsage;
  duration: number;
  fileScopes: string[];
  error?: string;
  worktree?: MultiAgentWorktreeInfo;
}

export interface MultiAgentWorktreeInfo {
  path: string;
  branch: string;
  baseSha: string;
  cleanup: 'pending' | 'removed' | 'kept' | 'unavailable';
  cleanupReason?: string;
}

export interface MultiAgentRunResult {
  runId: string;
  stateDir: string;
  plan: MultiAgentPlan;
  results: MultiAgentTaskResult[];
  conflicts: MultiAgentConflict[];
  usage: LLMUsage;
  mergeReport: string;
}

export interface MultiAgentStateFile {
  runId: string;
  updatedAt: string;
  plan: MultiAgentPlan;
  results: MultiAgentTaskResult[];
  conflicts: MultiAgentConflict[];
  usage: LLMUsage;
  mergeReport?: string;
}

export type MultiAgentEvent =
  | { type: 'multi_agent_plan'; plan: MultiAgentPlan; usage: LLMUsage }
  | { type: 'multi_agent_task_claimed'; task: MultiAgentTask; agentId: string }
  | { type: 'multi_agent_task_start'; task: MultiAgentTask; agentId: string }
  | { type: 'multi_agent_task_done'; task: MultiAgentTask; result: MultiAgentTaskResult }
  | { type: 'multi_agent_conflict'; conflict: MultiAgentConflict }
  | { type: 'multi_agent_merge'; result: MultiAgentRunResult; text: string }
  | { type: 'multi_agent_done'; result: MultiAgentRunResult };

export interface MultiAgentRuntimeOptions {
  llmProvider: LLMProvider;
  cwd: string;
  sessionId: string;
  language: 'zh-CN' | 'en-US';
  character: Character;
  maxConcurrency: number;
  runtimeContext?: string | null;
  signal?: AbortSignal;
}

export interface MultiAgentRunInput {
  userInput: string;
  runtimeContext?: string | null;
}

export interface CoordinatorCreatePlanInput {
  userInput: string;
  runId: string;
  runtimeContext?: string | null;
}

export interface CoordinatorPlanResult {
  plan: MultiAgentPlan;
  usage: LLMUsage;
  rawText?: string;
  warnings: string[];
}
