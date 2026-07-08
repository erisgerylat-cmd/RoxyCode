import chalk from 'chalk';
import { join } from 'node:path';
import { WorktreeManager, type WorktreeCleanupItem, type WorktreeListItem, type WorktreeMergeResult } from '../../worktree/WorktreeManager.js';

export async function handleWorktreeCommand(args: string[], language: 'zh-CN' | 'en-US'): Promise<void> {
  const action = (args[0] ?? 'list').toLowerCase();
  const isZh = language !== 'en-US';
  const manager = new WorktreeManager(process.cwd());

  try {
    if (action === 'list' || action === 'ls') {
      renderList(await manager.list(), isZh);
      return;
    }

    if (action === 'cleanup') {
      const slug = args.find(arg => !arg.startsWith('--') && arg !== 'cleanup');
      const discardChanges = args.includes('--discard') || args.includes('--force');
      renderCleanup(await manager.cleanup({ slug, discardChanges }), isZh, discardChanges);
      return;
    }

    if (action === 'merge') {
      const slug = args.find((arg, index) => index > 0 && !arg.startsWith('--'));
      if (!slug) {
        console.log(chalk.red(`  ${isZh ? zh('missingSlug') : 'Missing worktree slug.'}`));
        console.log(chalk.dim('  /worktree merge <slug>'));
        return;
      }
      renderMerge(await manager.merge(slug), isZh);
      return;
    }

    if (action === 'paths') {
      const gitRoot = await manager.findGitRoot();
      console.log(chalk.bold(`\n  ${isZh ? zh('pathsTitle') : 'RoxyCode worktree paths'}`));
      console.log(`  ${gitRoot}`);
      console.log(`  ${join(gitRoot, '.roxycode', 'worktrees')}`);
      console.log('');
      return;
    }
  } catch (error) {
    console.log(chalk.red(`  ${isZh ? zh('failed') : 'Worktree command failed'}: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  console.log(chalk.red(`  ${isZh ? zh('unknown') : 'Unknown /worktree action'}: ${action}`));
  console.log(chalk.dim('  /worktree [list|cleanup|merge|paths]'));
}

function renderList(items: WorktreeListItem[], isZh: boolean): void {
  console.log(chalk.bold(`\n  ${isZh ? zh('listTitle') : 'RoxyCode worktrees'}`));
  if (items.length === 0) {
    console.log(chalk.dim(`  ${isZh ? zh('empty') : 'No RoxyCode-managed worktrees found.'}`));
    console.log(chalk.dim(`  ${isZh ? zh('ultimateHint') : 'Ultimate mode creates isolated worktrees for sub-agent analysis when git is available.'}`));
    console.log('');
    return;
  }

  for (const item of items) {
    const dirty = item.status.dirty ? chalk.yellow(isZh ? zh('dirty') : 'dirty') : chalk.green(isZh ? zh('clean') : 'clean');
    const metadata = item.metadataFound ? '' : chalk.dim(isZh ? ` / ${zh('metadataMissing')}` : ' / metadata missing');
    console.log(`  ${chalk.green(item.slug)} ${dirty}${metadata}`);
    console.log(chalk.dim(`    branch=${item.branch || '-'} ahead=${item.status.commitsAhead} path=${item.path}`));
    if (item.status.changedFiles.length > 0) {
      console.log(chalk.dim(`    ${isZh ? zh('changes') : 'changes'}: ${item.status.changedFiles.slice(0, 5).join(', ')}`));
    }
  }
  console.log('');
}

function renderCleanup(items: WorktreeCleanupItem[], isZh: boolean, discardChanges: boolean): void {
  console.log(chalk.bold(`\n  ${isZh ? zh('cleanupTitle') : 'Worktree cleanup'}`));
  if (items.length === 0) {
    console.log(chalk.dim(`  ${isZh ? zh('empty') : 'No RoxyCode-managed worktrees found.'}`));
    console.log('');
    return;
  }
  for (const item of items) {
    const label = item.removed ? chalk.green(isZh ? zh('removed') : 'removed') : chalk.yellow(isZh ? zh('kept') : 'kept');
    console.log(`  ${label} ${item.slug}`);
    console.log(chalk.dim(`    ${item.path}`));
    if (item.reason) console.log(chalk.dim(`    ${isZh ? zh('reason') : 'reason'}: ${item.reason}`));
    if (item.status?.changedFiles.length) console.log(chalk.dim(`    ${isZh ? zh('changes') : 'changes'}: ${item.status.changedFiles.slice(0, 5).join(', ')}`));
    for (const warning of item.warnings) console.log(chalk.dim(`    warning: ${warning}`));
  }
  if (!discardChanges) {
    console.log(chalk.dim(isZh
      ? '  dirty worktree \u9ed8\u8ba4\u4fdd\u7559\uff1b\u786e\u8ba4\u8981\u4e22\u5f03\u65f6\u518d\u4f7f\u7528 /worktree cleanup <slug> --discard\u3002'
      : '  Dirty worktrees are kept by default. Use /worktree cleanup <slug> --discard only when you intend to discard changes.'));
  }
  console.log('');
}

function renderMerge(result: WorktreeMergeResult, isZh: boolean): void {
  console.log(chalk.bold(`\n  ${isZh ? zh('mergeTitle') : 'Worktree merge'}`));
  if (result.merged) {
    console.log(chalk.green(`  ${isZh ? zh('merged') : 'Merged'}: ${result.slug}`));
    console.log(chalk.dim(`  branch=${result.branch} commit=${result.commit ?? '-'}`));
    console.log(chalk.dim(isZh
      ? '  \u5408\u5e76\u540e\u53ef\u8fd0\u884c /worktree cleanup \u6e05\u7406\u5df2\u4e0d\u9700\u8981\u7684\u9694\u79bb\u5de5\u4f5c\u533a\u3002'
      : '  After merge, run /worktree cleanup to remove isolated worktrees you no longer need.'));
  } else {
    const label = result.conflict ? (isZh ? zh('conflict') : 'Conflict detected') : (isZh ? zh('notMerged') : 'Not merged');
    console.log(chalk.yellow(`  ${label}: ${result.slug}`));
    if (result.reason) console.log(chalk.dim(`  ${isZh ? zh('reason') : 'reason'}: ${result.reason}`));
    for (const conflict of result.conflicts.slice(0, 10)) console.log(chalk.dim(`  - ${conflict}`));
    console.log(chalk.dim(isZh
      ? '  \u4e3b\u5de5\u4f5c\u533a\u672a\u88ab\u4fee\u6539\uff1b\u8bf7\u5148\u5904\u7406\u51b2\u7a81\u6216 dirty \u72b6\u6001\u540e\u518d\u91cd\u8bd5\u3002'
      : '  Main workspace was not changed; resolve conflicts or dirty state, then retry.'));
  }
  for (const warning of result.warnings) console.log(chalk.dim(`  warning: ${warning}`));
  console.log('');
}

const ZH = {
  listTitle: '\u9694\u79bb Worktree',
  cleanupTitle: 'Worktree \u6e05\u7406',
  mergeTitle: 'Worktree \u5408\u5e76',
  pathsTitle: 'Worktree \u8def\u5f84',
  empty: '\u8fd8\u6ca1\u6709 RoxyCode \u7ba1\u7406\u7684 worktree\u3002',
  ultimateHint: 'Ultimate \u6a21\u5f0f\u5728 git \u53ef\u7528\u65f6\u4f1a\u4e3a\u5b50 Agent \u521b\u5efa\u9694\u79bb worktree\u3002',
  dirty: 'dirty',
  clean: 'clean',
  metadataMissing: '\u7f3a\u5c11 metadata',
  changes: '\u53d8\u66f4',
  removed: '\u5df2\u79fb\u9664',
  kept: '\u5df2\u4fdd\u7559',
  reason: '\u539f\u56e0',
  merged: '\u5df2\u5408\u5e76',
  conflict: '\u68c0\u6d4b\u5230\u51b2\u7a81',
  notMerged: '\u672a\u5408\u5e76',
  missingSlug: '\u7f3a\u5c11 worktree slug',
  failed: 'Worktree \u547d\u4ee4\u5931\u8d25',
  unknown: '\u672a\u77e5 /worktree \u64cd\u4f5c',
} as const;

function zh(key: keyof typeof ZH): string {
  return ZH[key];
}
