import chalk from 'chalk';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import {
  isAestheticMode,
  isCharacterId,
  isExplanationDepth,
  isModelStrategy,
  ProfileInitializer,
  type ProfileInitOptions,
} from '../../profile/index.js';

export async function handleProfileCommand(
  args: string[],
  configManager: ConfigManager,
  characterManager: CharacterManager,
): Promise<void> {
  const language = normalizeLanguage(configManager.get('ui.language'));
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand) {
    printProfileUsage(language);
    return;
  }

  if (subCommand !== 'init') {
    console.log(chalk.red(language === 'zh-CN' ? `  未知子命令: /profile ${subCommand}` : `  Unknown subcommand: /profile ${subCommand}`));
    printProfileUsage(language);
    return;
  }

  const parsed = parseProfileInitOptions(args.slice(1));
  if (!parsed.ok) {
    console.log(chalk.red(`  ${parsed.message}`));
    printProfileUsage(language);
    return;
  }

  const initializer = new ProfileInitializer(configManager);
  const result = await initializer.init({
    defaultCharacter: characterManager.getCurrentCharacter().id,
    ...parsed.options,
  });
  const profile = result.profile;

  console.log('');
  console.log(chalk.cyan(language === 'zh-CN' ? '  ┌── 个人画像初始化 ──┐' : '  ┌── Profile Initialized ──┐'));
  console.log(chalk.cyan('  │') + chalk.white(`  ${result.created ? ok(language, '已生成', 'Created') : ok(language, '已存在', 'Already exists')}: ${result.path}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Language:          ${profile.language}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Tech stack:        ${profile.techStack.join(', ') || '-'}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Explanation depth: ${profile.explanationDepth}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Default character: ${profile.defaultCharacter}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Model strategy:    ${profile.modelStrategy}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Aesthetic mode:    ${profile.aestheticMode}`));
  if (result.gitignoreUpdated) {
    console.log(chalk.cyan('  │') + chalk.dim(language === 'zh-CN' ? '  已加入 .gitignore，作为个人私有画像。' : '  Added to .gitignore as a private personal profile.'));
  }
  if (!result.created) {
    console.log(chalk.cyan('  │') + chalk.dim(language === 'zh-CN' ? '  如需覆盖，请使用 /profile init --force' : '  Use /profile init --force to overwrite it.'));
  }
  console.log(chalk.cyan('  └──────────────────────────┘'));
  console.log('');
}

function parseProfileInitOptions(args: string[]): { ok: true; options: ProfileInitOptions } | { ok: false; message: string } {
  const options: ProfileInitOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--language' || arg === '--lang') {
      if (!next) return { ok: false, message: 'Missing value for --language' };
      options.language = normalizeLanguage(next);
      i++;
      continue;
    }

    if (arg === '--tech' || arg === '--stack') {
      if (!next) return { ok: false, message: 'Missing value for --tech' };
      options.techStack = next.split(',').map(item => item.trim()).filter(Boolean);
      i++;
      continue;
    }

    if (arg === '--depth') {
      if (!next || !isExplanationDepth(next)) return { ok: false, message: 'Invalid --depth. Use concise, balanced, teaching, or deep.' };
      options.explanationDepth = next;
      i++;
      continue;
    }

    if (arg === '--role' || arg === '--character') {
      if (!next || !isCharacterId(next)) return { ok: false, message: 'Invalid --role. Use roxy, rudeus, eris, sylphiette, or nanahoshi.' };
      options.defaultCharacter = next;
      i++;
      continue;
    }

    if (arg === '--model') {
      if (!next || !isModelStrategy(next)) return { ok: false, message: 'Invalid --model. Use auto, fast, balanced, quality, or budget.' };
      options.modelStrategy = next;
      i++;
      continue;
    }

    if (arg === '--aesthetic') {
      if (!next || !isAestheticMode(next)) return { ok: false, message: 'Invalid --aesthetic. Use minimal, balanced, or immersive.' };
      options.aestheticMode = next;
      i++;
      continue;
    }

    return { ok: false, message: `Unknown option: ${arg}` };
  }

  return { ok: true, options };
}

function printProfileUsage(language: 'zh-CN' | 'en-US'): void {
  if (language === 'zh-CN') {
    console.log(chalk.dim('  用法: /profile init [--force] [--language zh|en] [--tech ts,react] [--depth teaching] [--role roxy] [--model auto]'));
  } else {
    console.log(chalk.dim('  Usage: /profile init [--force] [--language zh|en] [--tech ts,react] [--depth teaching] [--role roxy] [--model auto]'));
  }
}

function ok(language: 'zh-CN' | 'en-US', zh: string, en: string): string {
  return language === 'zh-CN' ? zh : en;
}
