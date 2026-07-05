import { resolve } from 'node:path';

import type { CommandDefinition } from '../commands/CommandRegistry.js';
import type { RoxyPluginCommand } from './types.js';
import { PluginSandbox } from './PluginSandbox.js';

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
  if (!command.pluginSandbox) return template;
  validatePluginRootReferences(command, template);
  return template
    .replace(/\$\{ROXY_PLUGIN_ROOT\}/g, command.pluginSandbox.pluginRoot)
    .replace(/\$\{ROXY_PLUGIN_ID\}/g, command.pluginSandbox.pluginId);
}

function validatePluginRootReferences(command: RoxyPluginCommand, template: string): void {
  const sandbox = command.pluginSandbox;
  if (!sandbox) return;
  const guard = new PluginSandbox({
    pluginRoot: sandbox.pluginRoot,
    allowedPaths: sandbox.allowedPaths,
    allowNetworkAccess: sandbox.allowNetworkAccess,
    allowedHosts: sandbox.allowedHosts,
  });

  for (const match of template.matchAll(/\$\{ROXY_PLUGIN_ROOT\}([^\s"'`<>{}|]*)/g)) {
    const referencedPath = resolvePluginRootReference(sandbox.pluginRoot, match[1] ?? '');
    const validation = guard.validatePath(referencedPath);
    if (!validation.allowed) {
      throw new Error(`Plugin command /${command.name} references a path outside its sandbox: ${match[0]}`);
    }
  }
}

function resolvePluginRootReference(pluginRoot: string, suffix: string): string {
  const trimmed = suffix.trim();
  if (!trimmed) return pluginRoot;
  const withoutLeadingSlash = trimmed.replace(/^[\\/]+/, '');
  return resolve(pluginRoot, withoutLeadingSlash);
}
