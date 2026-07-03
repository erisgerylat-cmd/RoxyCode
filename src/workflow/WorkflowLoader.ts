import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { getBuiltinWorkflows } from './builtin.js';
import type {
  ParsedWorkflowArguments,
  WorkflowDefinition,
  WorkflowDirectory,
  WorkflowInputDefinition,
  WorkflowLoadError,
  WorkflowLoadResult,
  WorkflowStep,
  WorkflowStepDefinition,
  WorkflowToolName,
} from './types.js';
import { WORKFLOW_ALLOWED_TOOL_NAMES, WORKFLOW_CATEGORIES, WORKFLOW_MODES } from './types.js';
import { parseWorkflowYaml } from './yaml.js';

export interface WorkflowLoaderOptions {
  cwd?: string;
  builtin?: boolean;
  directories?: string[];
}

export class WorkflowLoader {
  private readonly cwd: string;
  private readonly builtin: boolean;
  private readonly directories: string[];

  constructor(options: WorkflowLoaderOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.builtin = options.builtin ?? true;
    this.directories = options.directories ?? ['.roxycode/workflows'];
  }

  async load(): Promise<WorkflowLoadResult> {
    const workflows = new Map<string, WorkflowDefinition>();
    const errors: WorkflowLoadError[] = [];
    const directories = this.resolveDirectories();

    if (this.builtin) {
      for (const workflow of getBuiltinWorkflows()) workflows.set(workflow.id, workflow);
    }

    for (const directory of directories) {
      const loaded = await this.loadDirectory(directory.resolved);
      for (const error of loaded.errors) errors.push(error);
      for (const workflow of loaded.workflows) workflows.set(workflow.id, workflow);
    }

    return {
      workflows: Array.from(workflows.values()).sort(compareWorkflow),
      errors,
      directories,
    };
  }

  private resolveDirectories(): WorkflowDirectory[] {
    return this.directories.map(raw => ({
      raw,
      resolved: isAbsolute(raw) ? raw : resolve(this.cwd, raw),
    }));
  }

  private async loadDirectory(directory: string): Promise<{ workflows: WorkflowDefinition[]; errors: WorkflowLoadError[] }> {
    if (!existsSync(directory)) return { workflows: [], errors: [] };

    const workflows: WorkflowDefinition[] = [];
    const errors: WorkflowLoadError[] = [];
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push({ path: directory, message: error instanceof Error ? error.message : String(error) });
      return { workflows, errors };
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!['.yml', '.yaml'].includes(extname(entry.name).toLowerCase())) continue;
      const path = resolve(directory, entry.name);
      try {
        const raw = await readFile(path, 'utf-8');
        const parsed = parseWorkflowYaml(raw);
        workflows.push(normalizeWorkflow(parsed, path));
      } catch (error) {
        errors.push({ path, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { workflows, errors };
  }
}

export function parseWorkflowArguments(workflow: WorkflowDefinition, args: string[]): ParsedWorkflowArguments {
  const values: Record<string, string> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        values[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        values[key] = next;
        index++;
      } else {
        values[key] = 'true';
      }
      continue;
    }
    positionals.push(arg);
  }

  let positionalIndex = 0;
  for (const input of workflow.inputs) {
    if (values[input.name] !== undefined) continue;
    if (positionals[positionalIndex] !== undefined) {
      values[input.name] = positionals[positionalIndex++];
    } else if (input.defaultValue !== undefined) {
      values[input.name] = input.defaultValue;
    }
  }

  const missingRequired = workflow.inputs.filter(input => input.required && !values[input.name]);
  return {
    raw: args.join(' '),
    values,
    positionals,
    missingRequired,
  };
}

export function findWorkflow(workflows: WorkflowDefinition[], idOrAlias: string): WorkflowDefinition | undefined {
  const normalized = normalizeId(idOrAlias);
  return workflows.find(workflow => (
    workflow.id === normalized ||
    normalizeId(workflow.name) === normalized ||
    (workflow.aliases ?? []).some(alias => normalizeId(alias) === normalized)
  ));
}

function normalizeWorkflow(raw: Record<string, unknown>, path: string): WorkflowDefinition {
  const id = normalizeId(asString(raw.id) || basename(path, extname(path)));
  const name = requiredString(raw.name, 'name', path);
  const description = requiredString(raw.description, 'description', path);
  const prompt = requiredString(raw.prompt, 'prompt', path);
  const mode = asEnum(asString(raw.mode), WORKFLOW_MODES, 'standard');
  const category = asEnum(asString(raw.category), WORKFLOW_CATEGORIES, 'custom');
  const inputs = normalizeInputs(raw.inputs);

  return {
    id,
    name,
    description,
    mode,
    category,
    tags: asStringArray(raw.tags),
    aliases: asStringArray(raw.aliases),
    when: asString(raw.when),
    inputs,
    prompt,
    steps: normalizeSteps(raw.steps),
    allowedTools: normalizeTools(raw.allowedTools ?? raw.tools),
    verify: normalizeSteps(raw.verify),
    source: 'project',
    path,
    version: asString(raw.version),
  };
}

function normalizeInputs(value: unknown): WorkflowInputDefinition[] {
  if (!Array.isArray(value)) return [];
  const inputs: WorkflowInputDefinition[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const name = normalizeId(item);
      if (name) inputs.push({ name, label: item, required: true });
      continue;
    }
    if (!isRecord(item)) continue;
    const name = normalizeId(asString(item.name));
    if (!name) continue;
    inputs.push({
      name,
      label: asString(item.label) || name,
      description: asString(item.description),
      required: item.required === undefined ? true : asBoolean(item.required),
      defaultValue: asString(item.default ?? item.defaultValue),
    });
  }
  return inputs;
}

function normalizeTools(value: unknown): WorkflowToolName[] {
  const raw = asStringArray(value);
  const allowed = new Set<string>(WORKFLOW_ALLOWED_TOOL_NAMES);
  const tools = raw.filter((tool): tool is WorkflowToolName => allowed.has(tool));
  return tools.length > 0 ? tools : ['read_file', 'list_directory', 'grep_search'];
}

function normalizeSteps(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) return [];
  const steps: WorkflowStep[] = [];
  for (const item of value) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const text = asString(item);
      if (text) steps.push(text);
      continue;
    }
    if (!isRecord(item)) continue;
    const step: WorkflowStepDefinition = {};
    const id = asString(item.id);
    const name = asString(item.name);
    const type = asEnum(asString(item.type), ['prompt', 'tool', 'agent'] as const, 'prompt');
    const prompt = asString(item.prompt ?? item.run ?? item.text);
    const tool = asEnum(asString(item.tool), WORKFLOW_ALLOWED_TOOL_NAMES, undefined);
    const condition = asString(item.if);
    const unless = asString(item.unless);
    const repeat = item.repeat === undefined ? undefined : typeof item.repeat === 'number' ? item.repeat : asString(item.repeat);
    const set = item.set;
    if (id) step.id = normalizeId(id);
    if (name) step.name = name;
    if (type) step.type = type;
    if (prompt) step.prompt = prompt;
    if (tool) step.tool = tool;
    if (isRecord(item.args) || typeof item.args === 'string') step.args = item.args as Record<string, unknown> | string;
    if (condition) step.if = condition;
    if (unless) step.unless = unless;
    if (repeat !== undefined) step.repeat = repeat;
    if (isRecord(set) || typeof set === 'string') step.set = set as Record<string, unknown> | string;
    if (Object.keys(step).length > 0) steps.push(step);
  }
  return steps;
}

function compareWorkflow(a: WorkflowDefinition, b: WorkflowDefinition): number {
  if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function requiredString(value: unknown, field: string, path: string): string {
  const result = asString(value);
  if (!result) throw new Error(`Workflow ${path} is missing required field: ${field}`);
  return result;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean);
  const raw = asString(value);
  if (!raw) return [];
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', '1', 'on'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function asEnum<const T extends readonly string[]>(value: string, candidates: T, fallback: T[number]): T[number];
function asEnum<const T extends readonly string[]>(value: string, candidates: T, fallback: undefined): T[number] | undefined;
function asEnum<const T extends readonly string[]>(value: string, candidates: T, fallback: T[number] | undefined): T[number] | undefined {
  return (candidates as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
