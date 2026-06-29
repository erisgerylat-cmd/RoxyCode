import type { ParsedWorkflowArguments, WorkflowDefinition, WorkflowRenderOptions } from './types.js';

export function renderWorkflowPrompt(
  workflow: WorkflowDefinition,
  parsedArgs: ParsedWorkflowArguments,
  options: WorkflowRenderOptions,
): string {
  return options.language === 'en-US'
    ? renderEnglishPrompt(workflow, parsedArgs, options)
    : renderChinesePrompt(workflow, parsedArgs, options);
}

function renderChinesePrompt(
  workflow: WorkflowDefinition,
  parsedArgs: ParsedWorkflowArguments,
  options: WorkflowRenderOptions,
): string {
  const inputLines = workflow.inputs.length > 0
    ? workflow.inputs.map(input => {
        const value = parsedArgs.values[input.name] ?? '';
        const required = input.required ? '必填' : '可选';
        return `- ${input.name}（${input.label}，${required}）: ${value || '(未提供)'}`;
      })
    : ['- 无结构化输入，直接根据用户原始参数执行。'];

  const sections = [
    '# RoxyCode 工作流执行请求',
    '',
    '请按照下方工作流执行任务。工作流只定义过程与约束，所有文件读取、文件写入、命令执行和 Git 操作仍必须通过 RoxyCode 工具系统，并遵守权限确认与安全策略。',
    '',
    '## 工作流',
    `- ID: ${workflow.id}`,
    `- 名称: ${workflow.name}`,
    `- 来源: ${workflow.source}${workflow.path ? ` (${workflow.path})` : ''}`,
    `- 推荐模式: ${workflow.mode}`,
    `- 分类: ${workflow.category}`,
    `- 标签: ${workflow.tags.length ? workflow.tags.join(', ') : '(无)'}`,
    workflow.when ? `- 适用场景: ${workflow.when}` : '',
    '',
    '## 当前上下文',
    `- 项目目录: ${options.cwd}`,
    `- 当前角色: ${options.characterName}`,
    options.sessionId ? `- 会话 ID: ${options.sessionId}` : '',
    '',
    '## 用户输入',
    `- 原始参数: ${parsedArgs.raw || '(无)'}`,
    ...inputLines,
    '',
    '## 工作流提示词',
    workflow.prompt.trim(),
    '',
    '## 执行步骤',
    ...numbered(workflow.steps),
    '',
    '## 允许使用的工具范围',
    workflow.allowedTools.length
      ? workflow.allowedTools.map(tool => `- ${tool}`).join('\n')
      : '- 未声明，默认只使用读取和搜索工具。',
    '',
    '## 验证要求',
    ...numbered(workflow.verify),
    '',
    '## RoxyCode 执行原则',
    '- 先检查现有项目结构和相似实现，再修改代码。',
    '- 写文件或执行命令前必须遵守权限面板结果；高危操作需要二次确认。',
    '- 默认用中文解释关键决策；代码、命令、路径和配置键保持原样。',
    '- 如果信息不足，先提出最少必要问题；如果可以通过读取项目获得信息，优先读取而不是猜测。',
    '- 结尾说明完成内容、验证结果、未验证项和残留风险。',
  ].filter(Boolean);

  return sections.join('\n');
}

function renderEnglishPrompt(
  workflow: WorkflowDefinition,
  parsedArgs: ParsedWorkflowArguments,
  options: WorkflowRenderOptions,
): string {
  const inputLines = workflow.inputs.length > 0
    ? workflow.inputs.map(input => {
        const value = parsedArgs.values[input.name] ?? '';
        const required = input.required ? 'required' : 'optional';
        return `- ${input.name} (${input.label}, ${required}): ${value || '(not provided)'}`;
      })
    : ['- No structured inputs; use the raw arguments.'];

  const sections = [
    '# RoxyCode Workflow Request',
    '',
    'Run the following workflow. The workflow defines process and constraints only; all file reads, writes, shell commands, and Git actions must still go through RoxyCode tools and permission checks.',
    '',
    '## Workflow',
    `- ID: ${workflow.id}`,
    `- Name: ${workflow.name}`,
    `- Source: ${workflow.source}${workflow.path ? ` (${workflow.path})` : ''}`,
    `- Recommended mode: ${workflow.mode}`,
    `- Category: ${workflow.category}`,
    `- Tags: ${workflow.tags.length ? workflow.tags.join(', ') : '(none)'}`,
    workflow.when ? `- When to use: ${workflow.when}` : '',
    '',
    '## Context',
    `- Project directory: ${options.cwd}`,
    `- Current character: ${options.characterName}`,
    options.sessionId ? `- Session ID: ${options.sessionId}` : '',
    '',
    '## User Input',
    `- Raw args: ${parsedArgs.raw || '(none)'}`,
    ...inputLines,
    '',
    '## Workflow Prompt',
    workflow.prompt.trim(),
    '',
    '## Steps',
    ...numbered(workflow.steps),
    '',
    '## Allowed Tool Scope',
    workflow.allowedTools.length
      ? workflow.allowedTools.map(tool => `- ${tool}`).join('\n')
      : '- Not declared; default to read/search tools.',
    '',
    '## Verification',
    ...numbered(workflow.verify),
    '',
    '## RoxyCode Rules',
    '- Inspect existing project structure and similar implementations before editing.',
    '- Respect permission panel decisions before writes or commands; high-risk operations require second confirmation.',
    '- Explain key decisions in English; keep code, commands, paths, and config keys verbatim.',
    '- Ask the minimum necessary question only when project inspection cannot resolve the gap.',
    '- End with what changed, verification results, unverified items, and residual risks.',
  ].filter(Boolean);

  return sections.join('\n');
}

function numbered(items: string[]): string[] {
  if (items.length === 0) return ['1. (未声明)'];
  return items.map((item, index) => `${index + 1}. ${item}`);
}
