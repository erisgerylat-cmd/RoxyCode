import type { CommandDefinition } from '../CommandRegistry.js';

export interface CommandSourceLoadContext {
  runAgentPrompt?: (prompt: string) => Promise<void>;
}

export interface CommandSourceLoadResult {
  commands: CommandDefinition[];
  errors: Array<{ source: string; message: string; path?: string }>;
}

export interface DynamicCommandSource {
  readonly name: string;
  discover(context: CommandSourceLoadContext): Promise<CommandSourceLoadResult>;
}
