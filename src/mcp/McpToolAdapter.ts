import type { Tool, ToolDefinition, ToolParameterProperty, ToolParameterSchema } from '../tool/types.js';
import { formatToolResult } from '../tool/executor/ToolExecutor.js';
import { emitToolProgress } from '../tool/progress/ToolProgress.js';
import type { McpServerDefinition, McpToolAnnotations, McpToolDefinition } from './types.js';
import { McpStdioClient } from './McpStdioClient.js';

export class McpToolAdapter {
  private readonly clients = new Map<string, McpStdioClient>();

  constructor(private readonly cwd: string = process.cwd()) {}

  async discoverTools(servers: McpServerDefinition[]): Promise<{ tools: Tool[]; errors: Array<{ server: string; message: string }> }> {
    const tools: Tool[] = [];
    const errors: Array<{ server: string; message: string }> = [];
    for (const server of servers) {
      if (server.enabled === false) continue;
      try {
        const client = this.getClient(server);
        const rawTools = await client.listTools();
        for (const rawTool of rawTools) {
          const definition = normalizeMcpTool(server.name, rawTool);
          if (definition) tools.push(this.toRoxyTool(server, definition));
        }
      } catch (error) {
        errors.push({ server: server.name, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { tools, errors };
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map(client => client.close().catch(() => undefined)));
    this.clients.clear();
  }

  private getClient(server: McpServerDefinition): McpStdioClient {
    const existing = this.clients.get(server.name);
    if (existing) return existing;
    const client = new McpStdioClient(server, this.cwd);
    this.clients.set(server.name, client);
    return client;
  }

  private toRoxyTool(server: McpServerDefinition, mcpTool: McpToolDefinition): Tool {
    const getClient = () => this.getClient(server);
    const readOnly = mcpTool.annotations?.readOnlyHint === true;
    const destructive = mcpTool.annotations?.destructiveHint === true;
    const openWorld = mcpTool.annotations?.openWorldHint === true;
    return {
      definition: {
        name: mcpTool.roxyName,
        description: `[MCP:${server.name}] ${mcpTool.description}`,
        parameters: mcpTool.inputSchema,
      },
      isReadOnly: readOnly,
      riskLevel: destructive ? 'high' : readOnly ? 'low' : 'medium',
      concurrency: readOnly ? 'safe' : 'exclusive',
      interruptBehavior: readOnly ? 'cancel' : 'block',
      isConcurrencySafe() {
        return readOnly;
      },
      isDestructive() {
        return destructive;
      },
      getPermissionPrompt(args, ctx) {
        const zh = ctx.language !== 'en-US';
        return {
          title: zh ? `确认调用 MCP 工具：${mcpTool.roxyName}` : `Confirm MCP tool: ${mcpTool.roxyName}`,
          message: zh
            ? 'MCP 工具来自外部服务，可能读取外部资源、调用第三方能力或影响项目状态。'
            : 'This MCP tool comes from an external server and may access external resources or affect project state.',
          details: [
            `server: ${server.name}`,
            `tool: ${mcpTool.originalName}`,
            `args: ${JSON.stringify(args)}`,
          ],
          riskLevel: destructive ? 'high' : readOnly ? 'low' : 'medium',
        };
      },
      async execute(args, ctx) {
        const started = Date.now();
        emitToolProgress(ctx, { type: 'mcp_call', server: server.name, tool: mcpTool.originalName, phase: 'start', readOnly, destructive, openWorld });
        const rawResult = await getClient().callTool(mcpTool.originalName, args);
        const success = !isMcpErrorResult(rawResult);
        emitToolProgress(ctx, { type: 'mcp_call', server: server.name, tool: mcpTool.originalName, phase: 'complete', readOnly, destructive, openWorld, success });
        const body = renderMcpResult(server.name, mcpTool.originalName, rawResult, ctx.language !== 'en-US');
        return {
          success,
          output: formatToolResult(mcpTool.roxyName, success, body, ctx, { server: server.name, mcpTool: mcpTool.originalName, readOnly, destructive, openWorld }),
          error: success ? undefined : 'MCP tool returned an error.',
          duration: Date.now() - started,
          metadata: { server: server.name, mcpTool: mcpTool.originalName, readOnly, destructive, openWorld },
        };
      },
      getAuditSummary(args, result) {
        return { operation: 'mcp_tool_call', server: server.name, tool: mcpTool.originalName, success: result?.success, readOnly, destructive, openWorld, args };
      },
    };
  }
}

function normalizeMcpTool(serverName: string, raw: unknown): McpToolDefinition | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const originalName = raw.name.trim();
  return {
    serverName,
    originalName,
    roxyName: `mcp__${sanitizeName(serverName)}__${sanitizeName(originalName)}`,
    description: typeof raw.description === 'string' ? raw.description : `MCP tool ${originalName}`,
    inputSchema: normalizeInputSchema(raw.inputSchema),
    annotations: normalizeAnnotations(raw.annotations),
  };
}

function normalizeAnnotations(value: unknown): McpToolAnnotations | undefined {
  if (!isRecord(value)) return undefined;
  const annotations: McpToolAnnotations = {};
  if (typeof value.title === 'string') annotations.title = value.title;
  if (typeof value.readOnlyHint === 'boolean') annotations.readOnlyHint = value.readOnlyHint;
  if (typeof value.destructiveHint === 'boolean') annotations.destructiveHint = value.destructiveHint;
  if (typeof value.openWorldHint === 'boolean') annotations.openWorldHint = value.openWorldHint;
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

function normalizeInputSchema(value: unknown): ToolParameterSchema {
  if (!isRecord(value)) return { type: 'object', properties: {} };
  const properties: Record<string, ToolParameterProperty> = {};
  const rawProperties = isRecord(value.properties) ? value.properties : {};
  for (const [key, rawProperty] of Object.entries(rawProperties)) {
    properties[key] = normalizeProperty(rawProperty);
  }
  const required = Array.isArray(value.required) ? value.required.map(String) : undefined;
  return { type: 'object', properties, required };
}

function normalizeProperty(value: unknown): ToolParameterProperty {
  if (!isRecord(value)) return { type: 'string', description: '' };
  const rawType = typeof value.type === 'string' ? value.type : 'string';
  const type = ['string', 'number', 'boolean', 'array', 'object'].includes(rawType) ? rawType as ToolParameterProperty['type'] : 'string';
  const property: ToolParameterProperty = {
    type,
    description: typeof value.description === 'string' ? value.description : '',
  };
  if (Array.isArray(value.enum)) property.enum = value.enum.map(String);
  if ('default' in value) property.default = value.default;
  if (isRecord(value.items)) property.items = normalizeProperty(value.items);
  return property;
}

function renderMcpResult(serverName: string, toolName: string, result: unknown, zh: boolean): string {
  const title = zh ? 'MCP 工具调用完成' : 'MCP tool completed';
  return [
    title,
    `server: ${serverName}`,
    `tool: ${toolName}`,
    `result:\n${formatMcpPayload(result)}`,
  ].join('\n');
}

function formatMcpPayload(result: unknown): string {
  if (isRecord(result) && Array.isArray(result.content)) {
    return result.content.map(item => {
      if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') return item.text;
      return JSON.stringify(item);
    }).join('\n');
  }
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

function isMcpErrorResult(result: unknown): boolean {
  return isRecord(result) && result.isError === true;
}

function sanitizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
