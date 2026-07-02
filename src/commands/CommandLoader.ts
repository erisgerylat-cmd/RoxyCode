import type { CommandDefinition } from './CommandRegistry.js';
import type { CommandSourceLoadContext, DynamicCommandSource } from './sources/types.js';

export interface CommandLoaderResult {
  commands: CommandDefinition[];
  errors: Array<{ source: string; message: string; path?: string }>;
}

export class CommandLoader {
  constructor(private readonly sources: DynamicCommandSource[]) {}

  async load(context: CommandSourceLoadContext = {}): Promise<CommandLoaderResult> {
    const commands: CommandDefinition[] = [];
    const errors: CommandLoaderResult['errors'] = [];
    const seenNames = new Map<string, string>();

    for (const name of context.reservedNames ?? []) {
      seenNames.set(name, 'reserved');
    }

    for (const source of this.sources) {
      try {
        const result = await source.discover(context);
        for (const command of result.commands) {
          const names = [command.name, ...(command.aliases ?? [])];
          const conflict = names.find(name => seenNames.has(name));
          if (conflict) {
            errors.push({
              source: source.name,
              message: `Command /${command.name} conflicts with ${seenNames.get(conflict)} on /${conflict}.`,
            });
            continue;
          }
          commands.push(command);
          for (const name of names) seenNames.set(name, source.name);
        }
        errors.push(...result.errors);
      } catch (error) {
        errors.push({
          source: source.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { commands, errors };
  }

  async watchPaths(context: CommandSourceLoadContext = {}): Promise<string[]> {
    const paths = new Set<string>();
    for (const source of this.sources) {
      if (!source.watchPaths) continue;
      try {
        for (const path of await source.watchPaths(context)) {
          if (path) paths.add(path);
        }
      } catch {
        // Discovery errors are reported by load(); watching should stay best-effort.
      }
    }
    return Array.from(paths);
  }
}
