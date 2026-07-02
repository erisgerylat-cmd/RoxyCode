import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { CommandDefinition } from '../CommandRegistry.js';
import type { CommandSourceLoadContext, CommandSourceLoadResult, DynamicCommandSource } from './types.js';

export interface SkillCommandSourceOptions {
  cwd: string;
  directories?: string[];
}

export class SkillCommandSource implements DynamicCommandSource {
  readonly name = 'skill';

  constructor(private readonly options: SkillCommandSourceOptions) {}

  async discover(context: CommandSourceLoadContext): Promise<CommandSourceLoadResult> {
    const directories = this.skillDirectories();
    const commands: CommandDefinition[] = [];
    const errors: CommandSourceLoadResult['errors'] = [];

    for (const raw of directories) {
      const directory = this.resolveDirectory(raw);
      if (!existsSync(directory)) continue;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        errors.push({ source: this.name, path: directory, message: error instanceof Error ? error.message : String(error) });
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = resolve(directory, entry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;
        try {
          const markdown = await readFile(skillPath, 'utf8');
          const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
          const commandName = `skill:${entry.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`;
          commands.push({
            name: commandName,
            description: firstHeading || `Run skill ${entry.name}`,
            category: 'workflow',
            source: 'skill',
            type: 'prompt',
            usage: `/${commandName} [task]`,
            argumentHint: '[task]',
            handler: async (args: string[]) => {
              const task = args.join(' ').trim();
              const prompt = [`Use this RoxyCode skill: ${entry.name}`, markdown, task ? `Task:\n${task}` : ''].filter(Boolean).join('\n\n');
              if (!context.runAgentPrompt) {
                console.log(prompt);
                return;
              }
              await context.runAgentPrompt(prompt);
            },
          });
        } catch (error) {
          errors.push({ source: this.name, path: skillPath, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    return { commands, errors };
  }

  watchPaths(): string[] {
    return this.skillDirectories().map(directory => this.resolveDirectory(directory));
  }

  private skillDirectories(): string[] {
    return this.options.directories?.length ? this.options.directories : ['.roxycode/skills'];
  }

  private resolveDirectory(directory: string): string {
    return isAbsolute(directory) ? directory : resolve(this.options.cwd, directory);
  }
}
