import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MultiAgentStateFile, FileLock } from '../../engine/multi-agent/index.js';

export async function handleAgentsCommand(args: string[], language: 'zh-CN' | 'en-US'): Promise<void> {
  const action = (args[0] ?? 'status').toLowerCase();
  const runId = args[1];
  const root = join(process.cwd(), '.roxycode', 'multi-agent');
  const isZh = language !== 'en-US';

  if (action === 'paths') {
    console.log(chalk.bold(`\n  ${isZh ? zh('pathsTitle') : 'Multi-agent paths'}`));
    console.log(`  ${root}`);
    console.log('');
    return;
  }

  if (!existsSync(root)) {
    console.log(chalk.yellow(`  ${isZh ? zh('empty') : 'No multi-agent runs found.'}`));
    console.log(chalk.dim(`  ${root}`));
    return;
  }

  if (action === 'locks') {
    await renderLocks(root, runId, language);
    return;
  }

  if (action === 'status' || action === 'list') {
    await renderStatus(root, runId, language);
    return;
  }

  console.log(chalk.red(`  ${isZh ? zh('unknownAction') : 'Unknown /agents action'}: ${action}`));
  console.log(chalk.dim('  /agents [status|list|locks|paths] [runId]'));
}

async function renderStatus(root: string, runId: string | undefined, language: 'zh-CN' | 'en-US'): Promise<void> {
  const isZh = language !== 'en-US';
  const states = await readStates(root);
  const selected = runId ? states.filter(item => item.runId === runId) : states.slice(0, 5);
  if (selected.length === 0) {
    console.log(chalk.yellow(`  ${isZh ? zh('notFound') : 'No matching multi-agent run found.'}`));
    return;
  }

  console.log(chalk.bold(`\n  ${isZh ? zh('statusTitle') : 'Multi-agent status'}`));
  for (const state of selected) {
    const counts = countStatuses(state);
    console.log(chalk.green(`  ${state.runId}`));
    console.log(`    ${isZh ? zh('goal') : 'Goal'}: ${trim(state.plan.goal, 96)}`);
    console.log(`    ${isZh ? zh('source') : 'Plan'}: ${state.plan.source} / ${state.plan.tasks.length} ${isZh ? zh('tasks') : 'tasks'}`);
    console.log(`    ${isZh ? zh('status') : 'Status'}: ${formatCounts(counts)}`);
    console.log(`    ${isZh ? zh('conflicts') : 'Conflicts'}: ${state.conflicts.length}`);
    console.log(chalk.dim(`    ${isZh ? zh('updatedAt') : 'Updated'}: ${state.updatedAt}`));
  }
  console.log('');
}

async function renderLocks(root: string, runId: string | undefined, language: 'zh-CN' | 'en-US'): Promise<void> {
  const isZh = language !== 'en-US';
  const runDirs = runId ? [runId] : await latestRunIds(root, 3);
  console.log(chalk.bold(`\n  ${isZh ? zh('locksTitle') : 'Multi-agent locks'}`));

  let count = 0;
  for (const id of runDirs) {
    const locksDir = join(root, id, 'locks');
    if (!existsSync(locksDir)) continue;
    const files = (await readdir(locksDir)).filter(file => file.endsWith('.lock.json'));
    for (const file of files) {
      const lock = JSON.parse(await readFile(join(locksDir, file), 'utf8')) as FileLock;
      count++;
      console.log(`  ${lock.path}`);
      console.log(chalk.dim(`    ${lock.agentId} / ${lock.taskId} / ${lock.createdAt}`));
    }
  }

  if (count === 0) console.log(chalk.dim(`  ${isZh ? zh('noLocks') : 'No active lock files.'}`));
  console.log('');
}

async function readStates(root: string): Promise<MultiAgentStateFile[]> {
  const ids = await latestRunIds(root, 50);
  const states: MultiAgentStateFile[] = [];
  for (const id of ids) {
    const path = join(root, id, 'state.json');
    if (!existsSync(path)) continue;
    try {
      states.push(JSON.parse(await readFile(path, 'utf8')) as MultiAgentStateFile);
    } catch {
      continue;
    }
  }
  return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function latestRunIds(root: string, limit: number): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  return dirs.sort().reverse().slice(0, limit);
}

function countStatuses(state: MultiAgentStateFile): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of state.plan.tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ') || 'none';
}

function trim(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

const ZH = {
  pathsTitle: '\u591a Agent \u8fd0\u884c\u8def\u5f84',
  empty: '\u8fd8\u6ca1\u6709\u591a Agent \u8fd0\u884c\u8bb0\u5f55\u3002',
  unknownAction: '\u672a\u77e5 /agents \u64cd\u4f5c',
  notFound: '\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u591a Agent \u8fd0\u884c\u8bb0\u5f55\u3002',
  statusTitle: '\u591a Agent \u72b6\u6001',
  goal: '\u76ee\u6807',
  source: '\u8ba1\u5212',
  tasks: '\u4e2a\u4efb\u52a1',
  status: '\u72b6\u6001',
  conflicts: '\u51b2\u7a81',
  updatedAt: '\u66f4\u65b0',
  locksTitle: '\u591a Agent \u6587\u4ef6\u9501',
  noLocks: '\u6ca1\u6709\u6d3b\u52a8\u9501\u6587\u4ef6\u3002',
} as const;

function zh(key: keyof typeof ZH): string {
  return ZH[key];
}
