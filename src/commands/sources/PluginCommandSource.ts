import { collectPluginContributions, createPluginCommands, PluginLoader } from '../../plugin/index.js';
import type { PluginLoadResult } from '../../plugin/index.js';
import type { RoxyCodeConfig } from '../../core/types/config.js';
import type { CommandSourceLoadContext, CommandSourceLoadResult, DynamicCommandSource } from './types.js';

export interface PluginCommandSourceOptions {
  cwd: string;
  config: RoxyCodeConfig;
  loadResult?: PluginLoadResult;
}

export class PluginCommandSource implements DynamicCommandSource {
  readonly name = 'plugin';

  constructor(private readonly options: PluginCommandSourceOptions) {}

  async discover(context: CommandSourceLoadContext): Promise<CommandSourceLoadResult> {
    const result = this.options.loadResult ?? await new PluginLoader({ cwd: this.options.cwd, config: this.options.config }).load();
    const contributions = collectPluginContributions(result.enabled);
    return {
      commands: createPluginCommands({ commands: contributions.commands, runAgentPrompt: context.runAgentPrompt }),
      errors: result.errors.map(error => ({ source: this.name, path: error.path, message: error.message })),
    };
  }
}