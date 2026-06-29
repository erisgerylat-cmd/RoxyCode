/**
 * /context 命令 — 上下文配置管理
 *
 * 用法：
 *   /context                    查看当前上下文状态
 *   /context maxTokens <number> 设置最大 token 数（0 = 自动）
 *   /context compress on|off    启用/禁用自动压缩
 *   /context threshold <number> 设置压缩阈值（0.1 ~ 0.95）
 */

import chalk from 'chalk';
import type { ConfigManager } from '../../core/ConfigManager.js';
import type { ContextManager } from '../../session/context/ContextManager.js';

/** 格式化数字为千分位格式 */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** 生成进度条 */
function progressBar(ratio: number, width: number = 30): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}

/** 打印用法说明 */
function printUsage(): void {
  console.log('');
  console.log(chalk.dim('  用法:'));
  console.log(chalk.white('    /context') + chalk.dim('                    查看当前上下文状态'));
  console.log(chalk.white('    /context maxTokens <number>') + chalk.dim(' 设置最大 token 数（0 = 自动）'));
  console.log(chalk.white('    /context compress on|off') + chalk.dim('    启用/禁用自动压缩'));
  console.log(chalk.white('    /context threshold <number>') + chalk.dim(' 设置压缩阈值（0.1 ~ 0.95）'));
  console.log('');
}

export async function handleContextCommand(
  args: string[],
  configManager: ConfigManager,
  contextManager: ContextManager,
): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand) {
    return showContextStatus(configManager, contextManager);
  }

  switch (subCommand) {
    case 'maxtokens':
      return setMaxTokens(args[1], configManager);
    case 'compress':
      return setCompression(args[1], configManager);
    case 'threshold':
      return setThreshold(args[1], configManager);
    default:
      console.log(chalk.red(`  未知子命令: /context ${subCommand}`));
      printUsage();
  }
}

/** 显示当前上下文状态 */
async function showContextStatus(
  configManager: ConfigManager,
  contextManager: ContextManager,
): Promise<void> {
  // 使用空消息数组，因为当前没有活跃会话
  const status = await contextManager.getStatus([]);

  const sourceLabel = status.source === 'user-config'
    ? chalk.dim(' (用户配置)')
    : status.source === 'provider-default'
      ? chalk.dim(' (Provider 默认)')
      : chalk.dim(' (全局默认)');

  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.cyan('  ┌── 上下文配置 ──┐'));
  lines.push(chalk.cyan('  │'));
  lines.push(chalk.cyan('  │') + chalk.white(`  最大 Token:  ${formatNumber(status.maxContextTokens)}`) + sourceLabel);
  lines.push(chalk.cyan('  │') + chalk.white(`  当前使用:    ${formatNumber(status.currentTokens)} / ${formatNumber(status.maxContextTokens)} (${(status.usageRatio * 100).toFixed(1)}%)`));
  lines.push(chalk.cyan('  │') + `  ${progressBar(status.usageRatio)}`);
  lines.push(chalk.cyan('  │'));
  lines.push(chalk.cyan('  │') + chalk.white(`  自动压缩:    ${status.compressionEnabled ? chalk.green('开启') : chalk.red('关闭')}`));
  lines.push(chalk.cyan('  │') + chalk.white(`  压缩阈值:    ${(status.compressThreshold * 100).toFixed(0)}%`));
  lines.push(chalk.cyan('  │') + chalk.white(`  消息数量:    ${status.messageCount}`));
  lines.push(chalk.cyan('  │'));

  if (status.registeredStrategies.length > 0) {
    lines.push(chalk.cyan('  │') + chalk.white(`  可用策略:    ${status.registeredStrategies.join(', ')}`));
  } else {
    lines.push(chalk.cyan('  │') + chalk.dim('  可用策略:    无'));
  }

  lines.push(chalk.cyan('  │'));
  lines.push(chalk.cyan('  └──────────────────────────────────┘'));
  lines.push('');

  console.log(lines.join('\n'));
}

/** 设置最大 token 数 */
async function setMaxTokens(value: string | undefined, configManager: ConfigManager): Promise<void> {
  if (!value) {
    console.log(chalk.red('  请指定 token 数量'));
    console.log(chalk.dim('  示例: /context maxTokens 128000'));
    return;
  }

  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    console.log(chalk.red(`  无效的数字: ${value}`));
    return;
  }

  await configManager.set('context.maxTokens', num);

  if (num === 0) {
    console.log(chalk.green('  ✓ 已设置为自动（使用 Provider 默认值）'));
  } else {
    console.log(chalk.green(`  ✓ 最大 Token 已设置为: ${formatNumber(num)}`));
  }
}

/** 设置压缩开关 */
async function setCompression(value: string | undefined, configManager: ConfigManager): Promise<void> {
  if (!value) {
    console.log(chalk.red('  请指定 on 或 off'));
    console.log(chalk.dim('  示例: /context compress on'));
    return;
  }

  const normalized = value.toLowerCase();
  if (normalized !== 'on' && normalized !== 'off') {
    console.log(chalk.red(`  无效的值: ${value}（应为 on 或 off）`));
    return;
  }

  const enabled = normalized === 'on';
  await configManager.set('context.enableCompression', enabled);

  console.log(chalk.green(`  ✓ 自动压缩已${enabled ? '开启' : '关闭'}`));
}

/** 设置压缩阈值 */
async function setThreshold(value: string | undefined, configManager: ConfigManager): Promise<void> {
  if (!value) {
    console.log(chalk.red('  请指定阈值'));
    console.log(chalk.dim('  示例: /context threshold 0.8'));
    return;
  }

  const num = parseFloat(value);
  if (isNaN(num) || num < 0.1 || num > 0.95) {
    console.log(chalk.red(`  无效的阈值: ${value}（应为 0.1 ~ 0.95）`));
    return;
  }

  await configManager.set('context.compressThreshold', num);

  console.log(chalk.green(`  ✓ 压缩阈值已设置为: ${(num * 100).toFixed(0)}%`));
}
