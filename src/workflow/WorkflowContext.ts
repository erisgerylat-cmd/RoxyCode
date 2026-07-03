import type { ParsedWorkflowArguments, WorkflowDefinition, WorkflowRunStatus, WorkflowStepResult } from './types.js';

export interface WorkflowContextOptions {
  cwd: string;
  language: 'zh-CN' | 'en-US';
  characterName: string;
  sessionId?: string;
}

export class WorkflowContext {
  readonly workflow: WorkflowDefinition;
  readonly args: ParsedWorkflowArguments;
  readonly options: WorkflowContextOptions;
  readonly variables: Record<string, unknown>;
  readonly results: WorkflowStepResult[] = [];
  status: WorkflowRunStatus = 'pending';

  constructor(workflow: WorkflowDefinition, args: ParsedWorkflowArguments, options: WorkflowContextOptions) {
    this.workflow = workflow;
    this.args = args;
    this.options = options;
    this.variables = {
      cwd: options.cwd,
      language: options.language,
      characterName: options.characterName,
      sessionId: options.sessionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      rawArgs: args.raw,
      ...args.values,
    };
  }

  set(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  get(name: string): unknown {
    return this.variables[name];
  }

  interpolate(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\$\{([A-Za-z0-9_.-]+)\}/g, (_match, a: string | undefined, b: string | undefined) => {
        const key = a ?? b ?? '';
        const resolved = this.get(key);
        return resolved === undefined || resolved === null ? '' : String(resolved);
      });
    }
    if (Array.isArray(value)) return value.map(item => this.interpolate(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.interpolate(item)]));
    }
    return value;
  }

  shouldRun(condition?: string, unless?: string): boolean {
    if (condition && !this.evaluate(condition)) return false;
    if (unless && this.evaluate(unless)) return false;
    return true;
  }

  evaluate(expression: string): boolean {
    const trimmed = expression.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith('!')) return !this.evaluate(trimmed.slice(1));

    const comparison = /^([A-Za-z0-9_.-]+)\s*(==|!=)\s*(.+)$/.exec(trimmed);
    if (comparison) {
      const actual = this.get(comparison[1]);
      const expected = stripQuotes(comparison[3]);
      return comparison[2] === '=='
        ? String(actual ?? '') === expected
        : String(actual ?? '') !== expected;
    }

    const value = this.get(trimmed);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.trim().length > 0 && !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
    return Boolean(value);
  }
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
