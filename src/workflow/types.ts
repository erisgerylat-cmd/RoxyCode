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
  steps: string[];
  allowedTools: WorkflowToolName[];
  verify: string[];
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
