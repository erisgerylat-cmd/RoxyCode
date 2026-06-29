import chalk from 'chalk';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import {
  WorkflowLoader,
  findWorkflow,
  parseWorkflowArguments,
  renderWorkflowPrompt,
  type WorkflowDefinition,
  type WorkflowLoadResult,
} from '../../workflow/index.js';

export interface WorkflowCommandOptions {
  configManager: ConfigManager;
  characterManager: CharacterManager;
  runAgentPrompt?: (prompt: string) => Promise<void>;
  sessionId?: string;
}

type Lang = 'zh-CN' | 'en-US';

export async function handleWorkflowCommand(args: string[], options: WorkflowCommandOptions): Promise<void> {
  const language = normalizeLanguage(options.configManager.get('ui.language'));
  const action = (args[0] ?? 'list').toLowerCase();
  const loadResult = await loadWorkflows(options.configManager);

  if (action === 'list' || action === 'ls') {
    printWorkflowList(loadResult, language);
    return;
  }

  if (action === 'show' || action === 'info') {
    printWorkflowDetail(loadResult, args[1], language);
    return;
  }

  if (action === 'paths') {
    printWorkflowPaths(loadResult, language);
    return;
  }

  if (action === 'run' || action === 'use') {
    await runWorkflow(loadResult, args.slice(1), options, language);
    return;
  }

  const maybeWorkflow = findWorkflow(loadResult.workflows, action);
  if (maybeWorkflow) {
    await runWorkflow(loadResult, args, options, language);
    return;
  }

  printUsage(language);
}

async function loadWorkflows(configManager: ConfigManager): Promise<WorkflowLoadResult> {
  const builtin = configManager.get('workflows.builtin') !== false;
  const configuredDirs = configManager.get('workflows.directories');
  const directories = Array.isArray(configuredDirs)
    ? configuredDirs.map(String).filter(Boolean)
    : ['.roxycode/workflows'];
  return new WorkflowLoader({ cwd: process.cwd(), builtin, directories }).load();
}

async function runWorkflow(
  loadResult: WorkflowLoadResult,
  args: string[],
  options: WorkflowCommandOptions,
  language: Lang,
): Promise<void> {
  const workflowId = args[0];
  if (!workflowId) {
    console.log(chalk.red(language === 'zh-CN' ? zh('missingWorkflow') : '  Please provide a workflow id.'));
    printUsage(language);
    return;
  }

  const workflow = findWorkflow(loadResult.workflows, workflowId);
  if (!workflow) {
    console.log(chalk.red(`${language === 'zh-CN' ? zh('notFound') : 'Workflow not found'}: ${workflowId}`));
    printWorkflowList(loadResult, language);
    return;
  }

  const parsed = parseWorkflowArguments(workflow, args.slice(1));
  if (parsed.missingRequired.length > 0) {
    console.log(chalk.red(language === 'zh-CN' ? zh('missingRequired') : '  Missing required workflow inputs:'));
    for (const input of parsed.missingRequired) {
      console.log(`  - --${input.name} (${input.label})`);
    }
    console.log(chalk.dim(formatRunExample(workflow)));
    return;
  }

  const prompt = renderWorkflowPrompt(workflow, parsed, {
    cwd: process.cwd(),
    language,
    characterName: options.characterManager.getCurrentCharacter().name,
    sessionId: options.sessionId,
  });

  if (!options.runAgentPrompt) {
    console.log(chalk.yellow(language === 'zh-CN' ? zh('agentMissing') : '  Agent runner is not available in this environment.'));
    console.log(chalk.dim(prompt));
    return;
  }

  console.log(chalk.cyan(`  ${language === 'zh-CN' ? zh('running') : 'Running workflow'}: ${workflow.id} - ${workflow.name}`));
  console.log(chalk.dim(`  ${language === 'zh-CN' ? zh('mode') : 'Recommended mode'}: ${workflow.mode}`));
  await options.runAgentPrompt(prompt);
}

function printWorkflowList(loadResult: WorkflowLoadResult, language: Lang): void {
  console.log('');
  console.log(chalk.bold(language === 'zh-CN' ? zh('title') : 'RoxyCode Workflows'));
  if (loadResult.workflows.length === 0) {
    console.log(chalk.dim(`  ${language === 'zh-CN' ? zh('empty') : 'No workflows found.'}`));
  }
  for (const workflow of loadResult.workflows) {
    const source = workflow.source === 'builtin'
      ? (language === 'zh-CN' ? zh('builtin') : 'builtin')
      : (language === 'zh-CN' ? zh('project') : 'project');
    console.log(`  ${chalk.cyan(workflow.id.padEnd(16))} ${workflow.name}`);
    console.log(chalk.dim(`    ${source} / ${workflow.mode} / ${workflow.category} - ${workflow.description}`));
  }
  printErrors(loadResult, language);
  console.log(chalk.dim(`  ${language === 'zh-CN' ? zh('hint') : 'Use /workflow show <id> or /workflow run <id> [args].'}`));
  console.log('');
}

function printWorkflowDetail(loadResult: WorkflowLoadResult, id: string | undefined, language: Lang): void {
  if (!id) {
    console.log(chalk.red(language === 'zh-CN' ? zh('missingWorkflow') : '  Please provide a workflow id.'));
    return;
  }
  const workflow = findWorkflow(loadResult.workflows, id);
  if (!workflow) {
    console.log(chalk.red(`${language === 'zh-CN' ? zh('notFound') : 'Workflow not found'}: ${id}`));
    return;
  }

  console.log('');
  console.log(chalk.bold(`  ${workflow.id} - ${workflow.name}`));
  console.log(`  ${workflow.description}`);
  console.log(chalk.dim(`  source=${workflow.source} mode=${workflow.mode} category=${workflow.category}${workflow.path ? ` path=${workflow.path}` : ''}`));
  if (workflow.when) console.log(`  ${language === 'zh-CN' ? zh('when') : 'When'}: ${workflow.when}`);
  if (workflow.inputs.length > 0) {
    console.log(`  ${language === 'zh-CN' ? zh('inputs') : 'Inputs'}:`);
    for (const input of workflow.inputs) {
      console.log(`    --${input.name} ${input.required ? '*' : ''} ${input.label}`);
    }
  }
  if (workflow.steps.length > 0) {
    console.log(`  ${language === 'zh-CN' ? zh('steps') : 'Steps'}:`);
    workflow.steps.forEach((step, index) => console.log(`    ${index + 1}. ${step}`));
  }
  if (workflow.verify.length > 0) {
    console.log(`  ${language === 'zh-CN' ? zh('verify') : 'Verification'}:`);
    workflow.verify.forEach((step, index) => console.log(`    ${index + 1}. ${step}`));
  }
  console.log(chalk.dim(`  ${formatRunExample(workflow)}`));
  console.log('');
}

function printWorkflowPaths(loadResult: WorkflowLoadResult, language: Lang): void {
  console.log('');
  console.log(chalk.bold(language === 'zh-CN' ? zh('pathsTitle') : 'Workflow paths'));
  for (const directory of loadResult.directories) {
    console.log(`  ${directory.raw}: ${directory.resolved}`);
  }
  printErrors(loadResult, language);
  console.log('');
}

function printErrors(loadResult: WorkflowLoadResult, language: Lang): void {
  if (loadResult.errors.length === 0) return;
  console.log(chalk.yellow(`  ${language === 'zh-CN' ? zh('loadErrors') : 'Load warnings'}:`));
  for (const error of loadResult.errors) console.log(chalk.dim(`    ${error.path}: ${error.message}`));
}

function printUsage(language: Lang): void {
  const usage = '/workflow [list|show|run|paths]';
  console.log(chalk.dim(`  ${language === 'zh-CN' ? zh('usage') : 'Usage'}: ${usage}`));
}

function formatRunExample(workflow: WorkflowDefinition): string {
  const required = workflow.inputs.filter(input => input.required).map(input => `--${input.name} <${input.label}>`);
  return `/workflow run ${workflow.id}${required.length ? ` ${required.join(' ')}` : ''}`;
}

type ZhKey =
  | 'usage'
  | 'title'
  | 'empty'
  | 'builtin'
  | 'project'
  | 'hint'
  | 'missingWorkflow'
  | 'notFound'
  | 'missingRequired'
  | 'agentMissing'
  | 'running'
  | 'mode'
  | 'when'
  | 'inputs'
  | 'steps'
  | 'verify'
  | 'pathsTitle'
  | 'loadErrors';

const ZH: Record<ZhKey, string> = {
  usage: '\u7528\u6cd5',
  title: 'RoxyCode \u5de5\u4f5c\u6d41',
  empty: '\u6682\u65e0\u5de5\u4f5c\u6d41\u3002',
  builtin: '\u5185\u7f6e',
  project: '\u9879\u76ee',
  hint: '\u4f7f\u7528 /workflow show <id> \u67e5\u770b\u8be6\u60c5\uff0c\u6216 /workflow run <id> [\u53c2\u6570] \u6267\u884c\u3002',
  missingWorkflow: '\u8bf7\u63d0\u4f9b\u5de5\u4f5c\u6d41 ID\u3002',
  notFound: '\u672a\u627e\u5230\u5de5\u4f5c\u6d41',
  missingRequired: '\u7f3a\u5c11\u5fc5\u586b\u5de5\u4f5c\u6d41\u53c2\u6570\uff1a',
  agentMissing: '\u5f53\u524d\u73af\u5883\u6ca1\u6709\u53ef\u7528\u7684 Agent \u6267\u884c\u5668\u3002',
  running: '\u6267\u884c\u5de5\u4f5c\u6d41',
  mode: '\u63a8\u8350\u6a21\u5f0f',
  when: '\u9002\u7528\u573a\u666f',
  inputs: '\u8f93\u5165\u53c2\u6570',
  steps: '\u6267\u884c\u6b65\u9aa4',
  verify: '\u9a8c\u8bc1\u8981\u6c42',
  pathsTitle: '\u5de5\u4f5c\u6d41\u8def\u5f84',
  loadErrors: '\u52a0\u8f7d\u8b66\u544a',
};

function zh(key: ZhKey): string {
  return ZH[key];
}
