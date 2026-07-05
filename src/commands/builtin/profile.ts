import chalk from 'chalk';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';
import {
  isAestheticMode,
  isCharacterId,
  isExplanationDepth,
  isModelStrategy,
  ProfileManager,
  ProfileOnboarding,
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

  if (subCommand === 'init') {
    await handleProfileInit(args.slice(1), configManager, characterManager, language);
    return;
  }

  if (subCommand === 'show') {
    await handleProfileShow(language);
    return;
  }

  if (subCommand === 'update') {
    await handleProfileUpdate(args.slice(1), language);
    return;
  }

  console.log(chalk.red(language === 'zh-CN' ? `  未知子命令: /profile ${subCommand}` : `  Unknown subcommand: /profile ${subCommand}`));
  printProfileUsage(language);
}

async function handleProfileInit(
  args: string[],
  configManager: ConfigManager,
  characterManager: CharacterManager,
  language: 'zh-CN' | 'en-US',
): Promise<void> {
  const parsed = parseProfileInitOptions(args);
  if (!parsed.ok) {
    console.log(chalk.red(`  ${parsed.message}`));
    printProfileUsage(language);
    return;
  }

  const result = await new ProfileOnboarding().runOnboarding({
    configManager,
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

async function handleProfileShow(language: 'zh-CN' | 'en-US'): Promise<void> {
  const manager = new ProfileManager();
  const profile = await manager.load();

  if (!profile) {
    console.log(chalk.yellow(language === 'zh-CN' ? '  未找到个人画像。运行 /profile init 创建。' : '  No profile found. Run /profile init to create one.'));
    return;
  }

  console.log('');
  console.log(chalk.cyan(language === 'zh-CN' ? '  ┌── 个人画像 ──┐' : '  ┌── User Profile ──┐'));
  console.log(chalk.cyan('  │') + chalk.white(`  Path: ${manager.getPath()}`));
  console.log(chalk.cyan('  │'));
  console.log(chalk.cyan('  │') + chalk.white(`  Language:          ${profile.language}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Tech stack:        ${profile.techStack.join(', ') || '-'}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Explanation depth: ${profile.explanationDepth}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Default character: ${profile.defaultCharacter}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Model strategy:    ${profile.modelStrategy}`));
  console.log(chalk.cyan('  │') + chalk.white(`  Aesthetic mode:    ${profile.aestheticMode}`));
  if (profile.notes.length > 0) {
    console.log(chalk.cyan('  │'));
    console.log(chalk.cyan('  │') + chalk.white(`  Notes:`));
    for (const note of profile.notes) {
      console.log(chalk.cyan('  │') + chalk.dim(`    - ${note}`));
    }
  }
  console.log(chalk.cyan('  │'));
  console.log(chalk.cyan('  │') + chalk.dim(`  Created:  ${new Date(profile.createdAt).toLocaleString()}`));
  console.log(chalk.cyan('  │') + chalk.dim(`  Updated:  ${new Date(profile.updatedAt).toLocaleString()}`));
  console.log(chalk.cyan('  └──────────────────────────┘'));
  console.log('');
}

async function handleProfileUpdate(args: string[], language: 'zh-CN' | 'en-US'): Promise<void> {
  const manager = new ProfileManager();
  await manager.load();

  if (!manager.get()) {
    console.log(chalk.yellow(language === 'zh-CN' ? '  未找到个人画像。运行 /profile init 创建。' : '  No profile found. Run /profile init to create one.'));
    return;
  }

  if (args.length < 2) {
    console.log(chalk.red(language === 'zh-CN' ? '  用法: /profile update <key> <value>' : '  Usage: /profile update <key> <value>'));
    console.log(chalk.dim(language === 'zh-CN' ? '  可用的 key: depth, character, model, aesthetic, tech' : '  Available keys: depth, character, model, aesthetic, tech'));
    return;
  }

  const key = args[0].toLowerCase();
  const value = args.slice(1).join(' ');

  try {
    if (key === 'depth') {
      if (!isExplanationDepth(value)) throw new Error('Invalid depth. Use: concise, balanced, teaching, deep');
      await manager.updateExplanationDepth(value);
    } else if (key === 'character' || key === 'role') {
      if (!isCharacterId(value)) throw new Error('Invalid character. Use: roxy, rudeus, eris, sylphiette, nanahoshi');
      await manager.updateDefaultCharacter(value as any);
    } else if (key === 'model' || key === 'strategy') {
      if (!isModelStrategy(value)) throw new Error('Invalid model strategy. Use: auto, fast, balanced, quality, budget');
      await manager.updateModelStrategy(value);
    } else if (key === 'aesthetic' || key === 'mode') {
      if (!isAestheticMode(value)) throw new Error('Invalid aesthetic mode. Use: minimal, balanced, immersive');
      await manager.updateAestheticMode(value);
    } else if (key === 'tech' || key === 'stack') {
      const techStack = value.split(',').map(item => item.trim()).filter(Boolean);
      await manager.updateTechStack(techStack);
    } else {
      throw new Error(`Unknown key: ${key}`);
    }

    console.log(chalk.green(language === 'zh-CN' ? `  ✓ 已更新 ${key} = ${value}` : `  ✓ Updated ${key} = ${value}`));
  } catch (error) {
    console.log(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
  }
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
