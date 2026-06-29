import type { Message } from '../core/types/message.js';
import type { ToolDefinition } from '../core/types/tool.js';
import type { ConfigManager } from '../core/ConfigManager.js';
import type { LLMProvider } from '../core/types/llm.js';
import type { ToolExecutor } from '../tool/executor/ToolExecutor.js';
import type { I18n } from '../i18n/types.js';

export interface RuntimeContext {
  messages: Message[];
  llm: LLMProvider;
  tools: ToolDefinition[];
  toolExecutor: ToolExecutor;
  config: ConfigManager;
  i18n: I18n;
  cwd: string;
  projectRoot: string;
  sessionId: string;
  userId?: string;
}

export function createRuntimeContext(options: {
  llm: LLMProvider;
  toolExecutor: ToolExecutor;
  config: ConfigManager;
  i18n: I18n;
  tools: ToolDefinition[];
  messages?: Message[];
  cwd?: string;
  projectRoot?: string;
  sessionId?: string;
}): RuntimeContext {
  return {
    messages: options.messages || [],
    llm: options.llm,
    tools: options.tools,
    toolExecutor: options.toolExecutor,
    config: options.config,
    i18n: options.i18n,
    cwd: options.cwd || process.cwd(),
    projectRoot: options.projectRoot || process.cwd(),
    sessionId: options.sessionId || generateSessionId(),
  };
}

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
