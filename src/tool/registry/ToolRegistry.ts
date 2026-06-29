import type { Tool, ToolDefinition } from '../types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    this.tools.set(name, tool);
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  clear(): void {
    this.tools.clear();
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  definitions(): ToolDefinition[] {
    return this.list().map(tool => tool.definition);
  }
}
