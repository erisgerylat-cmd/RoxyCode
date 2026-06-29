import chalk from 'chalk';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import type { AestheticMode } from '../../aesthetic/character/types.js';
import type { ConfigManager } from '../../core/ConfigManager.js';
import { normalizeLanguage } from '../../i18n/index.js';

const MODES: Record<AestheticMode, { zh: string; en: string; detailZh: string; detailEn: string }> = {
  minimal: {
    zh: '极简',
    en: 'Minimal',
    detailZh: '保留专业状态栏和清爽输出，减少角色台词与装饰，适合专注修 bug 或长时间编码。',
    detailEn: 'Keeps professional status/output and reduces character flavor for focused coding.',
  },
  balanced: {
    zh: '平衡',
    en: 'Balanced',
    detailZh: '默认模式。保留角色主题、状态术语、适量台词和小伙伴提示，兼顾效率与审美。',
    detailEn: 'Default mode. Keeps theme, status terms, moderate flavor, and companion hints.',
  },
  immersive: {
    zh: '沉浸',
    en: 'Immersive',
    detailZh: '增强启动艺术字、角色台词、小伙伴提示和解释风格，适合学习、vibe coding 和个人工作台体验。',
    detailEn: 'Enhances splash art, character lines, companion hints, and learning-friendly output.',
  },
};

export async function handleAestheticCommand(
  args: string[],
  configManager: ConfigManager,
  characterManager: CharacterManager,
): Promise<void> {
  const language = normalizeLanguage(configManager.get('ui.language'));
  const isZh = language !== 'en-US';
  const next = args[0]?.toLowerCase();

  if (!next) {
    renderAestheticStatus(configManager, characterManager, isZh);
    return;
  }

  if (!isAestheticMode(next)) {
    console.log(chalk.red(isZh ? `  未知审美模式: ${next}` : `  Unknown aesthetic mode: ${next}`));
    console.log(chalk.dim('  /aesthetic minimal | balanced | immersive'));
    return;
  }

  await configManager.set('ui.aestheticMode', next);
  const mode = MODES[next];
  const character = characterManager.getCurrentCharacter();
  console.log('');
  console.log(chalk.hex(character.theme.primary).bold(isZh ? `  审美模式已切换为：${mode.zh} (${next})` : `  Aesthetic mode set to: ${mode.en} (${next})`));
  console.log(chalk.dim(`  ${isZh ? mode.detailZh : mode.detailEn}`));
  console.log(chalk.dim(isZh
    ? '  该设置写入配置；角色主题、状态术语、Pixel 小伙伴和 Agent 行为策略仍由当前角色定义。'
    : '  Saved to config; theme, status terms, companion, and behavior still come from the active character.'));
  console.log('');
}

function renderAestheticStatus(configManager: ConfigManager, characterManager: CharacterManager, isZh: boolean): void {
  const current = normalizeAestheticMode(configManager.get('ui.aestheticMode'));
  const character = characterManager.getCurrentCharacter();
  const border = chalk.hex(character.theme.primary);

  console.log('');
  console.log(border(isZh ? '  +-- RoxyCode 审美模式 --+' : '  +-- RoxyCode Aesthetic Mode --+'));
  console.log(`  ${isZh ? '当前模式' : 'Current'}: ${chalk.bold(current)} (${isZh ? MODES[current].zh : MODES[current].en})`);
  console.log(`  ${isZh ? '当前角色' : 'Character'}: ${character.name} / ${character.nameEn}`);
  if (character.companion) console.log(`  ${isZh ? '小伙伴' : 'Companion'}: ${character.companion.name} (${character.companion.kind})`);
  if (character.behavior) {
    console.log(`  ${isZh ? '解释风格' : 'Explanation'}: ${character.behavior.explanationStyle}`);
    console.log(`  ${isZh ? '风险偏好' : 'Risk'}: ${character.behavior.riskPreference}`);
    console.log(`  ${isZh ? '推荐模式' : 'Preferred mode'}: ${character.behavior.preferredMode}`);
  }
  console.log('');
  for (const [id, mode] of Object.entries(MODES) as Array<[AestheticMode, typeof MODES[AestheticMode]]>) {
    const marker = id === current ? '*' : '-';
    console.log(`  ${marker} ${chalk.bold(id)} - ${isZh ? mode.zh : mode.en}`);
    console.log(chalk.dim(`      ${isZh ? mode.detailZh : mode.detailEn}`));
  }
  console.log(chalk.dim(''));
  console.log(chalk.dim('  /aesthetic minimal | balanced | immersive'));
  console.log('');
}

function normalizeAestheticMode(value: unknown): AestheticMode {
  return isAestheticMode(value) ? value : 'balanced';
}

function isAestheticMode(value: unknown): value is AestheticMode {
  return value === 'minimal' || value === 'balanced' || value === 'immersive';
}
