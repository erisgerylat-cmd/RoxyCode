import type { CommandDefinition } from '../commands/CommandRegistry.js';
import type { RoxyPluginCommand } from './types.js';
import { renderPluginVariables } from './PluginVariables.js';

export interface PluginCommandOptions {
  commands: RoxyPluginCommand[];
  runAgentPrompt?: (prompt: string) => Promise<void>;
}

export function createPluginCommands(options: PluginCommandOptions): CommandDefinition[] {
  return options.commands.map(command => ({
    name: command.name,
    description: command.description || 'Plugin command',
    aliases: command.aliases,
    category: command.category ?? 'workflow',
    source: 'plugin',
    type: 'prompt',
    usage: command.usage ?? `/${command.name}`,
    examples: command.examples,
    handler: async args => {
      if (!options.runAgentPrompt) {
        console.log(`  插件命令 ${command.name} 需要 Agent Loop 才能执行。`);
        return;
      }
      const suffix = args.length > 0 ? `\n\n用户参数：${args.join(' ')}` : '';
      await options.runAgentPrompt(renderPluginCommandPrompt(command, suffix));
    },
  }));
}

function renderPluginCommandPrompt(command: RoxyPluginCommand, suffix: string): string {
  const template = `${command.prompt}${suffix}`;
  return renderPluginVariables(template, command.pluginSandbox, `command /${command.name}`);
}
