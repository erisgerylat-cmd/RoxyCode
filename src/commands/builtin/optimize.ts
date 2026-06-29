/**
 * /optimize 命令 — 提示词优化
 *
 * 用法：
 *   /optimize <文本>              自动优化提示词
 *   /optimize --strategy cot <文本>  指定 CoT 策略
 *   /optimize --diff              显示差异对比
 *   /optimize --copy              复制到剪贴板（如可用）
 *
 * 子命令：
 *   /optimize                     显示使用帮助
 *   /optimize strategies          列出可用策略
 */

import chalk from 'chalk';
import type { LLMProvider } from '../../core/types/llm.js';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import { PromptOptimizer } from '../../session/prompt/PromptOptimizer.js';
import type { PromptStrategyType, PromptOptimizerOptions } from '../../session/prompt/types.js';
import { BUILTIN_STRATEGIES } from '../../session/prompt/types.js';

/** 解析命令行参数 */
function parseArgs(args: string[]): {
  strategy?: PromptStrategyType;
  diff: boolean;
  copy: boolean;
  text: string;
  subCommand?: string;
} {
  let strategy: PromptStrategyType | undefined;
  let diff = false;
  let copy = false;
  const textParts: string[] = [];
  let subCommand: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--strategy' || arg === '-s') {
      const next = args[++i];
      if (next && ['structured', 'fewshot', 'cot', 'rolebased', 'auto'].includes(next)) {
        strategy = next as PromptStrategyType;
      }
    } else if (arg === '--diff' || arg === '-d') {
      diff = true;
    } else if (arg === '--copy' || arg === '-c') {
      copy = true;
    } else if (i === 0 && ['strategies', 'help'].includes(arg)) {
      subCommand = arg;
    } else {
      textParts.push(arg);
    }
  }

  return { strategy, diff, copy, text: textParts.join(' '), subCommand };
}

/** 显示使用帮助 */
function showUsage(): void {
  console.log('');
  console.log(chalk.white.bold('  /optimize — 提示词优化'));
  console.log('');
  console.log(chalk.dim('  用法:'));
  console.log(chalk.white('    /optimize <文本>') + chalk.dim('              自动选择最佳策略优化'));
  console.log(chalk.white('    /optimize -s cot <文本>') + chalk.dim('       指定 CoT 推理策略'));
  console.log(chalk.white('    /optimize -s structured <文本>') + chalk.dim('  指定结构化策略'));
  console.log(chalk.white('    /optimize --diff <文本>') + chalk.dim('       显示优化前后对比'));
  console.log(chalk.white('    /optimize strategies') + chalk.dim('          列出所有可用策略'));
  console.log('');
  console.log(chalk.dim('  策略:'));
  for (const s of BUILTIN_STRATEGIES) {
    console.log(chalk.white(`    ${s.type.padEnd(12)}`) + chalk.dim(`${s.name} — ${s.description}`));
  }
  console.log('');
}

/** 显示策略列表 */
function showStrategies(): void {
  console.log('');
  console.log(chalk.cyan('  ┌── 可用优化策略 ──┐'));
  for (const s of BUILTIN_STRATEGIES) {
    const tags = s.tags.map(t => chalk.dim(`#${t}`)).join(' ');
    console.log(chalk.cyan('  │') + chalk.white(`  ${s.type.padEnd(12)}`) + chalk.hex('#FFD700')(` ${s.name}`));
    console.log(chalk.cyan('  │') + chalk.dim(`  ${s.description}`));
    console.log(chalk.cyan('  │') + '  ' + tags);
    console.log(chalk.cyan('  │'));
  }
  console.log(chalk.cyan('  └' + '─'.repeat(40) + '┘'));
  console.log('');
}

/** 主处理函数 */
export async function handleOptimizeCommand(
  args: string[],
  llmProvider: LLMProvider,
  characterManager: CharacterManager,
): Promise<void> {
  const { strategy, diff, text, subCommand } = parseArgs(args);

  // 子命令处理
  if (subCommand === 'strategies') {
    return showStrategies();
  }
  if (subCommand === 'help' || (!text && !subCommand)) {
    return showUsage();
  }

  // 执行优化
  const character = characterManager.getCurrentCharacter();
  const border = chalk.hex(character.theme.primary);
  const accent = chalk.hex(character.theme.accent);
  const secondary = chalk.hex(character.theme.secondary);

  console.log('');
  console.log(border('  ┌── ') + accent('✨ 提示词优化') + border(' ──┐'));
  console.log(border('  │'));

  // 构建优化选项
  const options: PromptOptimizerOptions = {
    strategy: strategy ?? 'auto',
    includePersona: true,
    characterName: character.name,
    characterPrompt: character.systemPromptPersona,
  };

  const optimizer = new PromptOptimizer({ llmProvider });

  // 显示进度
  process.stdout.write(border('  │') + chalk.dim('  ⏳ 分析中...'));

  try {
    const result = await optimizer.optimize(text, options);

    // 清除进度行
    process.stdout.write('\r\x1b[K');

    // 显示分析报告
    console.log(border('  │') + secondary('  📋 分析报告'));
    console.log(border('  │') + chalk.dim(`  目标: ${result.analysis.goal}`));
    console.log(border('  │') + chalk.dim(`  模糊度: ${(result.analysis.ambiguityScore * 100).toFixed(0)}%`));
    console.log(border('  │') + chalk.dim(`  推荐策略: ${result.analysis.recommendedStrategy}`));

    if (result.analysis.constraints.length > 0) {
      console.log(border('  │') + chalk.dim(`  约束: ${result.analysis.constraints.join(', ')}`));
    }
    if (result.analysis.missingInfo.length > 0) {
      console.log(border('  │') + chalk.dim(`  建议补充: ${result.analysis.missingInfo.join(', ')}`));
    }

    console.log(border('  │'));

    // 显示优化结果
    const strategyName = BUILTIN_STRATEGIES.find(s => s.type === result.strategy)?.name ?? result.strategy;
    console.log(border('  │') + secondary(`  ✨ 优化结果`) + chalk.dim(` (${strategyName})`));
    console.log(border('  │'));

    // 优化后文本
    const optLines = result.optimized.split('\n');
    for (const line of optLines) {
      console.log(border('  │') + chalk.white(`  ${line}`));
    }

    console.log(border('  │'));

    // 统计信息
    console.log(border('  │') + chalk.dim(`  变更: ${result.changes.length} 处 | Token: ~${result.estimatedTokens} | 质量: ${(result.qualityScore * 100).toFixed(0)}%`));

    // 差异对比
    if (diff) {
      console.log(border('  │'));
      console.log(border('  │') + secondary('  📊 变更明细'));
      for (const change of result.changes) {
        const icon = change.type === 'added' ? '+' :
                     change.type === 'removed' ? '-' :
                     change.type === 'clarified' ? '~' : '·';
        const color = change.type === 'added' ? chalk.green :
                      change.type === 'removed' ? chalk.red :
                      chalk.yellow;
        console.log(border('  │') + color(`  ${icon} ${change.description}`));
      }
    }

    console.log(border('  │'));
    console.log(border('  └' + '─'.repeat(50) + '┘'));
    console.log('');
  } catch (err: unknown) {
    process.stdout.write('\r\x1b[K');
    const message = err instanceof Error ? err.message : String(err);
    console.log(border('  │') + chalk.red(`  ✗ 优化失败: ${message}`));
    console.log(border('  │'));
    console.log(border('  └' + '─'.repeat(50) + '┘'));
    console.log('');
  }
}
