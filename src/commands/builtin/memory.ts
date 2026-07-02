import chalk from 'chalk';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import { MemoryPolicyError, MemoryStore, MEMORY_TYPES, isMemoryScope, isMemoryType, type MemoryScope, type MemoryType } from '../../session/memory/index.js';

export interface MemoryCommandOptions {
  configManager: ConfigManager;
  characterManager: CharacterManager;
  sessionId?: string;
}

type Lang = 'zh-CN' | 'en-US';

export async function handleMemoryCommand(args: string[], options: MemoryCommandOptions): Promise<void> {
  const language = normalizeLanguage(options.configManager.get('ui.language'));
  const store = new MemoryStore({ cwd: process.cwd() });
  const action = args[0]?.toLowerCase();

  if (!action || action === 'list') {
    await listMemories(store, args.slice(action ? 1 : 0), language);
    return;
  }

  if (action === 'add') {
    await addMemory(store, args.slice(1), options, language);
    return;
  }

  if (action === 'forget' || action === 'remove' || action === 'delete') {
    await forgetMemory(store, args[1], language);
    return;
  }

  if (action === 'stats' || action === 'status') {
    await printStats(store, options, language);
    return;
  }

  if (action === 'types') {
    printTypes(language);
    return;
  }

  if (action === 'policy' || action === 'rules') {
    printPolicy(language);
    return;
  }

  if (action === 'auto') {
    await handleAutoMemory(args.slice(1), options.configManager, language);
    return;
  }

  if (action === 'paths') {
    const paths = store.getPaths();
    console.log('');
    console.log(chalk.bold(language === 'zh-CN' ? zh('pathsTitle') : 'Memory paths'));
    console.log(`  global:  ${paths.global}`);
    console.log(`  project: ${paths.project}`);
    console.log('');
    return;
  }

  printUsage(language);
}

async function addMemory(store: MemoryStore, args: string[], options: MemoryCommandOptions, language: Lang): Promise<void> {
  const parsed = parseAddArgs(args);
  if (!parsed.ok) {
    console.log(chalk.red(`  ${formatError(parsed.message, language)}`));
    printUsage(language);
    return;
  }

  try {
    const result = await store.add({
      type: parsed.type,
      scope: parsed.scope,
      content: parsed.content,
      tags: parsed.tags,
      source: 'manual',
      sessionId: options.sessionId,
      characterId: options.characterManager.getCurrentCharacter().id,
    });

    const label = result.created
      ? (language === 'zh-CN' ? zh('added') : 'Memory added')
      : (language === 'zh-CN' ? zh('duplicate') : 'Memory already exists');
    console.log(chalk.green(`  ${label}: ${result.record.id}`));
    console.log(chalk.dim(`  ${result.record.scope}/${result.record.type}: ${result.record.content}`));
  } catch (error) {
    if (error instanceof MemoryPolicyError) {
      printPolicyRejection(error, language);
      return;
    }
    throw error;
  }
}

async function forgetMemory(store: MemoryStore, id: string | undefined, language: Lang): Promise<void> {
  if (!id) {
    console.log(chalk.red(language === 'zh-CN' ? zh('missingId') : '  Please provide a memory id.'));
    return;
  }
  const ok = await store.archive(id, 'manual forget');
  console.log(ok
    ? chalk.green(`  ${language === 'zh-CN' ? zh('forgot') : 'Forgot'}: ${id}`)
    : chalk.yellow(`  ${language === 'zh-CN' ? zh('notFound') : 'Not found'}: ${id}`));
}

async function listMemories(store: MemoryStore, args: string[], language: Lang): Promise<void> {
  const parsed = parseListArgs(args);
  if (!parsed.ok) {
    console.log(chalk.red(`  ${formatError(parsed.message, language)}`));
    printUsage(language);
    return;
  }

  const records = await store.list({ type: parsed.type, scope: parsed.scope, query: parsed.query, limit: parsed.limit });
  console.log('');
  console.log(chalk.bold(language === 'zh-CN' ? zh('listTitle') : 'RoxyCode Memory'));
  if (records.length === 0) {
    console.log(chalk.dim(`  ${language === 'zh-CN' ? zh('empty') : 'No memories yet.'}`));
    console.log('');
    return;
  }

  for (const record of records) {
    const tags = record.tags.length ? chalk.dim(` [${record.tags.join(', ')}]`) : '';
    console.log(`  ${chalk.cyan(record.id)} ${chalk.dim(`${record.scope}/${record.type}/${record.source}`)}${tags}`);
    console.log(`    ${record.content}`);
  }
  console.log('');
}

async function printStats(store: MemoryStore, options: MemoryCommandOptions, language: Lang): Promise<void> {
  const stats = await store.getStats({ enabled: options.configManager.get('memory.auto') !== false, language });
  const enabled = stats.enabled
    ? (language === 'zh-CN' ? zh('enabled') : 'enabled')
    : (language === 'zh-CN' ? zh('disabled') : 'disabled');
  const typeSummary = Object.entries(stats.byType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${type}=${count}`)
    .join(', ');

  console.log('');
  console.log(chalk.bold(language === 'zh-CN' ? zh('statsTitle') : 'Memory statistics'));
  console.log(`  ${language === 'zh-CN' ? zh('autoStatus') : 'Auto memory'}: ${enabled}`);
  console.log(`  total=${stats.total} / global=${stats.global} / project=${stats.project} / manual=${stats.manual} / auto=${stats.auto}`);
  console.log(`  ${language === 'zh-CN' ? zh('typeDistribution') : 'Type distribution'}: ${typeSummary || 'empty'}`);
  if (stats.latestAge) console.log(`  ${language === 'zh-CN' ? zh('latestMemory') : 'Latest memory'}: ${stats.latestAge}`);
  console.log(chalk.dim(`  ${language === 'zh-CN' ? zh('claudeReference') : 'Claude Code reference'}: status/doctor style visibility for memory health.`));
  console.log('');
}

async function handleAutoMemory(args: string[], configManager: ConfigManager, language: Lang): Promise<void> {
  const action = args[0]?.toLowerCase();
  if (!action || action === 'status') {
    const enabled = configManager.get('memory.auto') !== false;
    console.log(chalk.bold(language === 'zh-CN' ? zh('autoTitle') : 'Auto memory'));
    console.log(`  ${language === 'zh-CN' ? zh('autoStatus') : 'Status'}: ${enabled ? (language === 'zh-CN' ? zh('enabled') : 'enabled') : (language === 'zh-CN' ? zh('disabled') : 'disabled')}`);
    console.log(chalk.dim(`  ${language === 'zh-CN' ? zh('autoHint') : 'Use /memory auto on or /memory auto off.'}`));
    return;
  }

  if (['on', 'enable', 'enabled', 'true'].includes(action)) {
    await configManager.set('memory.auto', true);
    console.log(chalk.green(`  ${language === 'zh-CN' ? zh('autoEnabled') : 'Auto memory enabled.'}`));
    return;
  }

  if (['off', 'disable', 'disabled', 'false'].includes(action)) {
    await configManager.set('memory.auto', false);
    console.log(chalk.yellow(`  ${language === 'zh-CN' ? zh('autoDisabled') : 'Auto memory disabled.'}`));
    return;
  }

  printUsage(language);
}

function parseAddArgs(args: string[]): { ok: true; type: MemoryType; scope?: MemoryScope; tags: string[]; content: string } | { ok: false; message: ErrorKey } {
  const typeRaw = args[0];
  if (!isMemoryType(typeRaw)) return { ok: false, message: 'invalidType' };

  let scope: MemoryScope | undefined;
  const tags: string[] = [];
  const contentParts: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--scope') {
      if (!isMemoryScope(next)) return { ok: false, message: 'invalidScope' };
      scope = next;
      i++;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length);
      if (!isMemoryScope(value)) return { ok: false, message: 'invalidScope' };
      scope = value;
      continue;
    }
    if (arg === '--tag' || arg === '--tags') {
      if (!next) return { ok: false, message: 'missingTag' };
      tags.push(...next.split(',').map(tag => tag.trim()).filter(Boolean));
      i++;
      continue;
    }
    contentParts.push(arg);
  }

  const content = contentParts.join(' ').trim();
  if (!content) return { ok: false, message: 'emptyContent' };
  return { ok: true, type: typeRaw, scope, tags, content };
}

function parseListArgs(args: string[]): { ok: true; type?: MemoryType; scope?: MemoryScope; query?: string; limit?: number } | { ok: false; message: ErrorKey } {
  let type: MemoryType | undefined;
  let scope: MemoryScope | undefined;
  let query: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--type') {
      if (!isMemoryType(next)) return { ok: false, message: 'invalidType' };
      type = next;
      i++;
      continue;
    }
    if (arg === '--scope') {
      if (!isMemoryScope(next)) return { ok: false, message: 'invalidScope' };
      scope = next;
      i++;
      continue;
    }
    if (arg === '--query' || arg === '-q') {
      if (!next) return { ok: false, message: 'missingQuery' };
      query = next;
      i++;
      continue;
    }
    if (arg === '--limit') {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false, message: 'invalidLimit' };
      limit = parsed;
      i++;
      continue;
    }
    if (isMemoryType(arg)) {
      type = arg;
      continue;
    }
    query = [query, arg].filter(Boolean).join(' ');
  }

  return { ok: true, type, scope, query, limit };
}

function printTypes(language: Lang): void {
  console.log('');
  console.log(chalk.bold(language === 'zh-CN' ? zh('typesTitle') : 'Memory types'));
  for (const type of MEMORY_TYPES) {
    console.log(`  ${type.padEnd(10)} ${typeDescription(type, language)}`);
  }
  console.log('');
}

function printPolicy(language: Lang): void {
  console.log('');
  console.log(chalk.bold(language === 'zh-CN' ? zh('policyTitle') : 'Memory policy'));
  const lines = language === 'zh-CN'
    ? [zh('policyDurable'), zh('policyNoDerivable'), zh('policyVerify'), zh('policyIgnore'), zh('policyLearning'), zh('policyWorkflow')]
    : [
        'Save durable facts that help future coding-agent sessions.',
        'Do not save code facts, file paths, git history, temporary task state, secrets, or anything derivable from the repo or ROXY.md.',
        'Treat memories as potentially stale and verify current files, functions, commands, and project state before acting.',
        'If the user says to ignore memory, proceed as if memory is empty and do not mention it.',
        'learning is for teaching depth, concepts being learned, and explanation style.',
        'workflow is for recurring commands, review rituals, branch/commit habits, and character-based work habits.',
      ];
  for (const line of lines) console.log(`  - ${line}`);
  console.log('');
}

function printPolicyRejection(error: MemoryPolicyError, language: Lang): void {
  const title = language === 'zh-CN' ? zh('policyRejected') : 'Memory was not saved';
  const reasonLabel = language === 'zh-CN' ? zh('policyReason') : 'Reason';
  const suggestionLabel = language === 'zh-CN' ? zh('policySuggestion') : 'Suggestion';
  console.log(chalk.yellow(`  ${title}`));
  for (const reason of error.evaluation.reasons) {
    console.log(chalk.dim(`  - ${reasonLabel}: ${reason}`));
  }
  for (const suggestion of error.evaluation.suggestions.slice(0, 3)) {
    console.log(chalk.dim(`  - ${suggestionLabel}: ${suggestion}`));
  }
}

function typeDescription(type: MemoryType, language: Lang): string {
  if (language === 'en-US') {
    return {
      user: 'Stable user role, goals, and preferences.',
      project: 'Non-derivable project goals, decisions, incidents, deadlines.',
      feedback: 'Corrections or validated guidance for agent behavior.',
      reference: 'External docs, dashboards, tickets, and where to look.',
      learning: 'Teaching depth, concepts being learned, learning style.',
      workflow: 'Recurring commands, review rituals, branch/commit habits.',
    }[type];
  }
  return {
    user: '\u7528\u6237\u8eab\u4efd\u3001\u76ee\u6807\u3001\u504f\u597d\u548c\u80cc\u666f\u3002',
    project: '\u4ee3\u7801\u548c git \u65e0\u6cd5\u76f4\u63a5\u63a8\u5bfc\u7684\u9879\u76ee\u76ee\u6807\u3001\u51b3\u7b56\u3001\u4e8b\u6545\u548c\u622a\u6b62\u671f\u3002',
    feedback: '\u7528\u6237\u5bf9 Agent \u884c\u4e3a\u7684\u7ea0\u6b63\u6216\u5df2\u9a8c\u8bc1\u7684\u504f\u597d\u3002',
    reference: '\u5916\u90e8\u6587\u6863\u3001\u4eea\u8868\u76d8\u3001\u5de5\u5355\u548c\u67e5\u627e\u4f4d\u7f6e\u3002',
    learning: '\u6559\u5b66\u6df1\u5ea6\u3001\u6b63\u5728\u5b66\u7684\u6982\u5ff5\u548c\u5b66\u4e60\u98ce\u683c\u3002',
    workflow: '\u91cd\u590d\u7684\u547d\u4ee4\u3001review \u4eea\u5f0f\u3001\u5206\u652f/\u63d0\u4ea4\u4e60\u60ef\u3002',
  }[type];
}

function printUsage(language: Lang): void {
  if (language === 'zh-CN') {
    console.log(chalk.dim(`  ${zh('usage')}`));
  } else {
    console.log(chalk.dim('  Usage: /memory [list|stats|types|policy|paths] | /memory add <type> [--scope global|project] [--tag a,b] <content> | /memory forget <id> | /memory auto [status|on|off]'));
  }
}

type ErrorKey = 'invalidType' | 'invalidScope' | 'missingTag' | 'emptyContent' | 'missingQuery' | 'invalidLimit';
function formatError(key: ErrorKey, language: Lang): string {
  if (language === 'en-US') {
    return {
      invalidType: 'Invalid memory type.',
      invalidScope: 'Invalid scope. Use global or project.',
      missingTag: 'Missing value for --tag.',
      emptyContent: 'Memory content cannot be empty.',
      missingQuery: 'Missing value for --query.',
      invalidLimit: 'Invalid --limit.',
    }[key];
  }
  return zh(key);
}

type ZhKey =
  | 'usage'
  | 'statsTitle'
  | 'typeDistribution'
  | 'latestMemory'
  | 'claudeReference'
  | 'missingId'
  | 'forgot'
  | 'notFound'
  | 'pathsTitle'
  | 'added'
  | 'duplicate'
  | 'listTitle'
  | 'empty'
  | 'typesTitle'
  | 'policyTitle'
  | 'policyDurable'
  | 'policyNoDerivable'
  | 'policyVerify'
  | 'policyIgnore'
  | 'policyLearning'
  | 'policyWorkflow'
  | 'policyRejected'
  | 'policyReason'
  | 'policySuggestion'
  | 'autoTitle'
  | 'autoStatus'
  | 'autoHint'
  | 'enabled'
  | 'disabled'
  | 'autoEnabled'
  | 'autoDisabled'
  | ErrorKey;

const ZH: Record<ZhKey, string> = {
  usage: '/memory [list|stats|types|policy|paths] | /memory add <type> [--scope global|project] [--tag a,b] <content> | /memory forget <id> | /memory auto [status|on|off]',
  statsTitle: 'RoxyCode \u8bb0\u5fc6\u7edf\u8ba1',
  typeDistribution: '\u7c7b\u578b\u5206\u5e03',
  latestMemory: '\u6700\u8fd1\u8bb0\u5fc6',
  claudeReference: '\u5bf9\u7167 Claude Code',
  missingId: '\u8bf7\u63d0\u4f9b\u8bb0\u5fc6 ID\u3002',
  forgot: '\u5df2\u5fd8\u8bb0',
  notFound: '\u672a\u627e\u5230',
  pathsTitle: '\u8bb0\u5fc6\u6587\u4ef6\u8def\u5f84',
  added: '\u8bb0\u5fc6\u5df2\u6dfb\u52a0',
  duplicate: '\u8bb0\u5fc6\u5df2\u5b58\u5728',
  listTitle: 'RoxyCode \u8bb0\u5fc6',
  empty: '\u6682\u65e0\u8bb0\u5fc6\u3002',
  typesTitle: '\u8bb0\u5fc6\u7c7b\u578b',
  policyTitle: '\u8bb0\u5fc6\u4fdd\u5b58\u8fb9\u754c',
  policyDurable: '\u53ea\u4fdd\u5b58\u5bf9\u672a\u6765\u7f16\u7a0b Agent \u4f1a\u8bdd\u6709\u7528\u7684\u957f\u671f\u4fe1\u606f\u3002',
  policyNoDerivable: '\u4e0d\u4fdd\u5b58\u4ee3\u7801\u4e8b\u5b9e\u3001\u6587\u4ef6\u8def\u5f84\u3001git \u5386\u53f2\u3001\u4e34\u65f6\u4efb\u52a1\u72b6\u6001\u3001\u5bc6\u94a5\uff0c\u4e5f\u4e0d\u4fdd\u5b58\u53ef\u4ece\u4ed3\u5e93\u6216 ROXY.md \u63a8\u5bfc\u7684\u4fe1\u606f\u3002',
  policyVerify: '\u8bb0\u5fc6\u53ef\u80fd\u8fc7\u671f\uff0c\u6d89\u53ca\u5f53\u524d\u6587\u4ef6\u3001\u51fd\u6570\u3001\u547d\u4ee4\u6216\u9879\u76ee\u72b6\u6001\u65f6\u5fc5\u987b\u5148\u6838\u9a8c\u3002',
  policyIgnore: '\u7528\u6237\u8981\u6c42\u5ffd\u7565\u8bb0\u5fc6\u65f6\uff0c\u6309\u7a7a\u8bb0\u5fc6\u5904\u7406\uff0c\u4e0d\u5f15\u7528\u3001\u4e0d\u5bf9\u6bd4\u3001\u4e0d\u6697\u793a\u3002',
  policyLearning: 'learning \u7528\u4e8e\u6559\u5b66\u6df1\u5ea6\u3001\u6b63\u5728\u5b66\u7684\u6982\u5ff5\u548c\u89e3\u91ca\u98ce\u683c\u3002',
  policyWorkflow: 'workflow \u7528\u4e8e\u56fa\u5b9a\u547d\u4ee4\u3001review \u4eea\u5f0f\u3001\u5206\u652f/\u63d0\u4ea4\u4e60\u60ef\u548c\u89d2\u8272\u5316\u5de5\u4f5c\u4e60\u60ef\u3002',
  policyRejected: '\u8bb0\u5fc6\u672a\u4fdd\u5b58\uff1a\u4e0d\u7b26\u5408\u957f\u671f\u8bb0\u5fc6\u8fb9\u754c\u3002',
  policyReason: '\u539f\u56e0',
  policySuggestion: '\u5efa\u8bae',
  autoTitle: '\u81ea\u52a8\u8bb0\u5fc6',
  autoStatus: '\u72b6\u6001',
  autoHint: '\u4f7f\u7528 /memory auto on \u6216 /memory auto off \u5207\u6362\u3002',
  enabled: '\u5df2\u542f\u7528',
  disabled: '\u5df2\u5173\u95ed',
  autoEnabled: '\u81ea\u52a8\u8bb0\u5fc6\u5df2\u542f\u7528\u3002',
  autoDisabled: '\u81ea\u52a8\u8bb0\u5fc6\u5df2\u5173\u95ed\u3002',
  invalidType: '\u65e0\u6548\u7684\u8bb0\u5fc6\u7c7b\u578b\u3002',
  invalidScope: '\u65e0\u6548\u7684 scope\uff0c\u8bf7\u4f7f\u7528 global \u6216 project\u3002',
  missingTag: '\u7f3a\u5c11 --tag \u7684\u503c\u3002',
  emptyContent: '\u8bb0\u5fc6\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a\u3002',
  missingQuery: '\u7f3a\u5c11 --query \u7684\u503c\u3002',
  invalidLimit: '\u65e0\u6548\u7684 --limit\u3002',
};
function zh(key: ZhKey): string {
  return ZH[key];
}