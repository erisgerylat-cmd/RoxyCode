import chalk from 'chalk';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import { ProjectInitializer } from '../../project/index.js';

export async function handleProjectCommand(args: string[], configManager: ConfigManager): Promise<void> {
  const language = normalizeLanguage(configManager.get('ui.language'));
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand) {
    printProjectUsage(language);
    return;
  }

  if (subCommand !== 'init') {
    console.log(chalk.red(language === 'zh-CN' ? `  未知子命令: /project ${subCommand}` : `  Unknown subcommand: /project ${subCommand}`));
    printProjectUsage(language);
    return;
  }

  const force = args.slice(1).includes('--force');
  const unknown = args.slice(1).find(arg => arg !== '--force');
  if (unknown) {
    console.log(chalk.red(language === 'zh-CN' ? `  未知选项: ${unknown}` : `  Unknown option: ${unknown}`));
    printProjectUsage(language);
    return;
  }

  const result = await new ProjectInitializer().init({ force }, language);
  const profile = result.profile;

  console.log('');
  console.log(chalk.cyan(language === 'zh-CN' ? '  ┌── 项目画像初始化 ──┐' : '  ┌── Project Initialized ──┐'));
  console.log(chalk.cyan('  │') + chalk.white(`  ROXY.md:              ${result.roxyWritten ? status(language, '已生成', 'Created') : status(language, '已存在，未覆盖', 'Already exists, kept')}`));
  console.log(chalk.cyan('  │') + chalk.white(`  ${result.roxyPath}`));
  console.log(chalk.cyan('  │') + chalk.white(`  project.json:         ${status(language, '已生成', 'Created')}`));
  console.log(chalk.cyan('  │') + chalk.white(`  ${result.projectPath}`));
  console.log(chalk.cyan('  │'));
  console.log(chalk.cyan('  │') + chalk.white(`  Name:                 ${profile.name}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Package manager:      ${profile.packageManager ?? 'unknown'}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Languages:            ${profile.languages.join(', ') || '-'}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Frameworks:           ${profile.frameworks.join(', ') || '-'}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Source dirs:          ${profile.structure.sourceDirs.join(', ') || '-'}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Test dirs:            ${profile.structure.testDirs.join(', ') || '-'}`));
  if (!result.roxyWritten) {
    console.log(chalk.cyan('  │') + chalk.dim(language === 'zh-CN' ? '  如需覆盖 ROXY.md，请使用 /project init --force' : '  Use /project init --force to overwrite ROXY.md.'));
  }
  console.log(chalk.cyan('  └──────────────────────────┘'));
  console.log('');
}

function printProjectUsage(language: 'zh-CN' | 'en-US'): void {
  if (language === 'zh-CN') {
    console.log(chalk.dim('  用法: /project init [--force]'));
  } else {
    console.log(chalk.dim('  Usage: /project init [--force]'));
  }
}

function status(language: 'zh-CN' | 'en-US', zh: string, en: string = zh): string {
  return language === 'zh-CN' ? zh : en;
}
