import { isAbsolute, resolve } from 'node:path';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import { WorkflowLoader, parseWorkflowArguments, renderWorkflowPrompt } from '../../workflow/index.js';
import type { CommandDefinition } from '../CommandRegistry.js';
import type { CommandSourceLoadContext, CommandSourceLoadResult, DynamicCommandSource } from './types.js';

export interface WorkflowCommandSourceOptions {
  cwd: string;
  configManager: ConfigManager;
  characterManager: CharacterManager;
  sessionId?: string;
}

export class WorkflowCommandSource implements DynamicCommandSource {
  readonly name = 'workflow';

  constructor(private readonly options: WorkflowCommandSourceOptions) {}

  async discover(context: CommandSourceLoadContext): Promise<CommandSourceLoadResult> {
    const builtin = this.options.configManager.get('workflows.builtin') !== false;
    const directories = this.workflowDirectories();
    const loaded = await new WorkflowLoader({ cwd: this.options.cwd, builtin, directories }).load();
    const language = normalizeLanguage(this.options.configManager.get('ui.language'));
    const commands: CommandDefinition[] = loaded.workflows.map(workflow => ({
      name: `wf:${workflow.id}`,
      description: workflow.description || workflow.name,
      aliases: workflow.aliases?.map(alias => `wf:${alias}`),
      category: 'workflow',
      source: 'workflow',
      type: 'prompt',
      argumentHint: workflow.inputs.length ? workflow.inputs.map(input => `--${input.name}`).join(' ') : undefined,
      usage: `/wf:${workflow.id} [--input value]`,
      examples: [`/wf:${workflow.id}`],
      handler: async args => {
        const parsed = parseWorkflowArguments(workflow, args);
        const prompt = renderWorkflowPrompt(workflow, parsed, {
          cwd: this.options.cwd,
          language,
          characterName: this.options.characterManager.getCurrentCharacter().name,
          sessionId: this.options.sessionId,
        });
        if (!context.runAgentPrompt) {
          console.log(prompt);
          return;
        }
        await context.runAgentPrompt(prompt);
      },
    }));

    return {
      commands,
      errors: loaded.errors.map(error => ({ source: this.name, path: error.path, message: error.message })),
    };
  }

  watchPaths(): string[] {
    return this.workflowDirectories().map(directory => isAbsolute(directory) ? directory : resolve(this.options.cwd, directory));
  }

  private workflowDirectories(): string[] {
    const configuredDirs = this.options.configManager.get('workflows.directories');
    return Array.isArray(configuredDirs)
      ? configuredDirs.map(String).filter(Boolean)
      : ['.roxycode/workflows'];
  }
}
