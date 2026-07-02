export type RoxyHookEvent =
  | 'session_start'
  | 'before_prompt'
  | 'after_response'
  | 'before_tool'
  | 'after_tool'
  | 'command'
  | 'agent_start'
  | 'agent_done';

export type RoxyHookKind = 'command' | 'prompt' | 'http' | 'agent';
export type RoxyHookOutcome = 'success' | 'blocked' | 'error' | 'skipped';

export interface RoxyHookDefinition {
  id: string;
  event: RoxyHookEvent;
  kind: RoxyHookKind;
  description?: string;
  matcher?: string;
  enabled?: boolean;
  blocking?: boolean;
  timeoutMs?: number;
  command?: string;
  args?: string[];
  prompt?: string;
  url?: string;
  method?: 'POST';
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  allowInsecureHttp?: boolean;
  statusMessage?: string;
  source?: string;
  pluginId?: string;
}

export interface HookRunPayload {
  cwd: string;
  sessionId: string;
  language: 'zh-CN' | 'en-US';
  characterId?: string;
  userInput?: string;
  commandName?: string;
  commandArgs?: string[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  responseText?: string;
  metadata?: Record<string, unknown>;
}

export interface HookExecutionRecord {
  hookId: string;
  event: RoxyHookEvent;
  kind: RoxyHookKind;
  outcome: RoxyHookOutcome;
  duration: number;
  message?: string;
  additionalContext?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  source?: string;
  statusMessage?: string;
}

export interface HookProtocolOutput {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  reason?: string;
  systemMessage?: string;
  additionalContext?: string;
  updatedInput?: Record<string, unknown>;
  hookSpecificOutput?: {
    additionalContext?: string;
    updatedInput?: Record<string, unknown>;
    permissionDecision?: 'allow' | 'deny' | 'ask' | 'passthrough';
    permissionDecisionReason?: string;
  };
}

export interface HookRunResult {
  blocked: boolean;
  reason?: string;
  additionalContexts: string[];
  updatedInput?: Record<string, unknown>;
  executions: HookExecutionRecord[];
}

export interface HookLoadError {
  path: string;
  message: string;
}

export interface HookLoadResult {
  hooks: RoxyHookDefinition[];
  errors: HookLoadError[];
  directories: string[];
}

export interface HookRunner {
  run(event: RoxyHookEvent, payload: HookRunPayload): Promise<HookRunResult>;
}