import type { ToolResult } from '../core/types/message.js';
import type { WorkflowContext } from './WorkflowContext.js';
import type { WorkflowStep, WorkflowStepKind, WorkflowStepResult, WorkflowToolName } from './types.js';

export interface WorkflowExecutorOptions {
  runAgentPrompt?: (prompt: string) => Promise<void>;
  executeTool?: (name: WorkflowToolName, args: Record<string, unknown>) => Promise<ToolResult>;
}

export class WorkflowExecutor {
  constructor(private readonly options: WorkflowExecutorOptions = {}) {}

  async executeStep(step: WorkflowStep, context: WorkflowContext, index: number): Promise<WorkflowStepResult> {
    const normalized = normalizeStep(step, index);
    const startedAt = new Date().toISOString();

    if (!context.shouldRun(normalized.if, normalized.unless)) {
      return {
        id: normalized.id,
        name: normalized.name,
        type: normalized.type,
        status: 'skipped',
        skipped: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        metadata: { condition: normalized.if, unless: normalized.unless },
      };
    }

    try {
      if (normalized.set) applySet(context, normalized.set);
      const result = await this.dispatch(normalized, context);
      return {
        id: normalized.id,
        name: normalized.name,
        type: normalized.type,
        status: 'completed',
        output: result,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        id: normalized.id,
        name: normalized.name,
        type: normalized.type,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }
  }

  private async dispatch(step: NormalizedWorkflowStep, context: WorkflowContext): Promise<string> {
    if (step.type === 'tool') return this.executeToolStep(step, context);
    if (step.type === 'agent') return this.executeAgentStep(step, context);
    return this.executePromptStep(step, context);
  }

  private async executePromptStep(step: NormalizedWorkflowStep, context: WorkflowContext): Promise<string> {
    return String(context.interpolate(step.prompt || step.name));
  }

  private async executeAgentStep(step: NormalizedWorkflowStep, context: WorkflowContext): Promise<string> {
    const prompt = String(context.interpolate(step.prompt || step.name));
    if (!this.options.runAgentPrompt) return prompt;
    await this.options.runAgentPrompt(prompt);
    return prompt;
  }

  private async executeToolStep(step: NormalizedWorkflowStep, context: WorkflowContext): Promise<string> {
    if (!step.tool) throw new Error('Tool step is missing tool name.');
    if (!this.options.executeTool) throw new Error(`No tool executor is available for workflow tool step: ${step.tool}`);
    const args = parseArgs(step.args, context);
    const result = await this.options.executeTool(step.tool, args);
    return result.output;
  }
}

interface NormalizedWorkflowStep {
  id: string;
  name: string;
  type: WorkflowStepKind;
  prompt?: string;
  tool?: WorkflowToolName;
  args?: Record<string, unknown> | string;
  if?: string;
  unless?: string;
  repeat?: number | string;
  set?: Record<string, unknown> | string;
}

export function normalizeStep(step: WorkflowStep, index: number): NormalizedWorkflowStep {
  if (typeof step === 'string') {
    return {
      id: `step-${index + 1}`,
      name: step,
      type: 'prompt',
      prompt: step,
    };
  }

  const type = step.type ?? (step.tool ? 'tool' : step.prompt ? 'agent' : 'prompt');
  return {
    id: step.id ?? `step-${index + 1}`,
    name: step.name ?? step.prompt ?? step.tool ?? `step-${index + 1}`,
    type,
    prompt: step.prompt,
    tool: step.tool,
    args: step.args,
    if: step.if,
    unless: step.unless,
    repeat: step.repeat,
    set: step.set,
  };
}

export function getRepeatCount(step: WorkflowStep, context: WorkflowContext): number {
  if (typeof step === 'string' || step.repeat === undefined) return 1;
  const raw = context.interpolate(step.repeat);
  const count = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(Math.floor(count), 50);
}

function applySet(context: WorkflowContext, value: Record<string, unknown> | string): void {
  const entries = typeof value === 'string' ? parseKeyValueList(value) : value;
  for (const [key, item] of Object.entries(entries)) context.set(key, context.interpolate(item));
}

function parseArgs(value: Record<string, unknown> | string | undefined, context: WorkflowContext): Record<string, unknown> {
  if (!value) return {};
  const raw = typeof value === 'string' ? parseKeyValueList(value) : value;
  return context.interpolate(raw) as Record<string, unknown>;
}

function parseKeyValueList(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) {
      result[trimmed] = 'true';
      continue;
    }
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}
