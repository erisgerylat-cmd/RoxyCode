import type { Tool, ToolDefinition } from '../types.js';
import { normalizeToolName, withToolDefaults } from '../builder/ToolBuilder.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly aliases = new Map<string, string>();

  register(tool: Tool): void {
    const normalizedTool = withToolDefaults(tool);
    const name = normalizeToolName(normalizedTool.definition.name);
    if (this.tools.has(name) || this.aliases.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    this.tools.set(name, normalizedTool);

    const aliases = collectAliases(normalizedTool);
    for (const alias of aliases) {
      const normalizedAlias = normalizeToolName(alias);
      if (!normalizedAlias || normalizedAlias === name) continue;
      if (this.tools.has(normalizedAlias) || this.aliases.has(normalizedAlias)) {
        throw new Error(`Tool alias already registered: ${normalizedAlias}`);
      }
      this.aliases.set(normalizedAlias, name);
    }
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  clear(): void {
    this.tools.clear();
    this.aliases.clear();
  }

  get(name: string): Tool | undefined {
    const normalized = normalizeToolName(name);
    return this.tools.get(normalized) ?? this.tools.get(this.aliases.get(normalized) ?? '');
  }

  resolveName(name: string): string | undefined {
    const normalized = normalizeToolName(name);
    if (this.tools.has(normalized)) return normalized;
    return this.aliases.get(normalized);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  definitions(): ToolDefinition[] {
    return this.list().map(tool => ({
      ...tool.definition,
      aliases: collectAliases(tool),
      searchHint: tool.searchHint ?? tool.definition.searchHint,
      strict: tool.strict ?? tool.definition.strict,
    }));
  }
}

function collectAliases(tool: Tool): string[] {
  return [...new Set([...(tool.definition.aliases ?? []), ...(tool.aliases ?? [])])];
}