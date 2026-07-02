import type { CommandDefinition } from '../CommandRegistry.js';

export interface CommandSourceLoadContext {
  runAgentPrompt?: (prompt: string) => Promise<void>;
  reservedNames?: Iterable<string>;
}

export interface CommandSourceLoadResult {
  commands: CommandDefinition[];
  errors: Array<{ source: string; message: string; path?: string }>;
}

export interface DynamicCommandSource {
  readonly name: string;
  discover(context: CommandSourceLoadContext): Promise<CommandSourceLoadResult>;
  watchPaths?(context: CommandSourceLoadContext): Promise<string[]> | string[];
}
