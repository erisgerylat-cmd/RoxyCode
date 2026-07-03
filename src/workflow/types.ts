export const WORKFLOW_MODES = ['lite', 'economic', 'standard', 'ultimate'] as const;
export type WorkflowMode = typeof WORKFLOW_MODES[number];

export const WORKFLOW_SOURCES = ['builtin', 'project'] as const;
export type WorkflowSource = typeof WORKFLOW_SOURCES[number];

export const WORKFLOW_CATEGORIES = ['backend', 'frontend', 'bugfix', 'testing', 'review', 'custom'] as const;
export type WorkflowCategory = typeof WORKFLOW_CATEGORIES[number];

export const WORKFLOW_ALLOWED_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'grep_search',
  'execute_command',
  'git',
] as const;

export type WorkflowToolName = typeof WORKFLOW_ALLOWED_TOOL_NAMES[number];

export type WorkflowStepKind = 'prompt' | 'tool' | 'agent';

export interface WorkflowStepDefinition {
  id?: string;
  name?: string;
  type?: WorkflowStepKind;
  prompt?: string;
  tool?: WorkflowToolName;
  args?: Record<string, unknown> | string;
  if?: string;
  unless?: string;
  repeat?: number | string;
  set?: Record<string, unknown> | string;
}

export type WorkflowStep = string | WorkflowStepDefinition;

export interface WorkflowInputDefinition {
  name: string;
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  mode: WorkflowMode;
  category: WorkflowCategory;
  tags: string[];
  aliases?: string[];
  when?: string;
  inputs: WorkflowInputDefinition[];
  prompt: string;
  steps: WorkflowStep[];
  allowedTools: WorkflowToolName[];
  verify: WorkflowStep[];
  source: WorkflowSource;
  path?: string;
  version?: string;
}

export interface WorkflowDirectory {
  raw: string;
  resolved: string;
}

export interface WorkflowLoadError {
  path: string;
  message: string;
}

export interface WorkflowLoadResult {
  workflows: WorkflowDefinition[];
  errors: WorkflowLoadError[];
  directories: WorkflowDirectory[];
}

export interface WorkflowRenderOptions {
  cwd: string;
  language: 'zh-CN' | 'en-US';
  characterName: string;
  sessionId?: string;
}

export interface ParsedWorkflowArguments {
  raw: string;
  values: Record<string, string>;
  positionals: string[];
  missingRequired: WorkflowInputDefinition[];
}

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowStepResult {
  id: string;
  name: string;
  type: WorkflowStepKind;
  status: WorkflowRunStatus;
  skipped?: boolean;
  output?: string;
  error?: string;
  startedAt: string;
  finishedAt: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowRunResult {
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string;
  steps: WorkflowStepResult[];
  variables: Record<string, unknown>;
  errors: string[];
}
