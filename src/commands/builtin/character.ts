import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import { CHARACTER_ORDER, ALL_CHARACTERS } from '../../aesthetic/character/characters/index.js';
import { characterToTemplate, createCustomCharacterTemplate, serializeCustomCharacterTemplate } from '../../aesthetic/character/custom/CharacterTemplate.js';
import { ensureProjectCharacterDirectory, isValidCharacterId } from '../../aesthetic/character/custom/CustomCharacterLoader.js';
import type { Character, CharacterId } from '../../aesthetic/character/types.js';
import { renderCharacterSwitch } from '../../ui/renderers/CharacterArt.js';

const ID_ALIASES: Record<string, CharacterId> = {
  roxy: 'roxy',
  rudeus: 'rudeus',
  eris: 'eris',
  sylphiette: 'sylphiette',
  sylphy: 'sylphiette',
  nanahoshi: 'nanahoshi',
  nanahosi: 'nanahoshi',
  seven: 'nanahoshi',
};

export async function handleCharacterCommand(
  args: string[],
  characterManager: CharacterManager,
): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand || subCommand === 'list') {
    return showCharacterList(characterManager);
  }

  if (subCommand === 'info') {
    const target = args[1] ? resolveCharacterId(args[1], characterManager) : characterManager.getCurrentCharacter().id;
    const character = target ? characterManager.getCharacter(target) : undefined;
    return showCharacterInfo(characterManager, character);
  }

  if (subCommand === 'create') {
    return createCharacter(args.slice(1), characterManager);
  }

  if (subCommand === 'paths') {
    return showCharacterPaths(characterManager);
  }

  if (subCommand === 'random') {
    const ids = characterManager.getCharacterList()
      .map(item => item.id)
      .filter(id => id !== characterManager.getCurrentCharacter().id);
    const randomId = ids[Math.floor(Math.random() * ids.length)];
    if (randomId) return switchTo(randomId, characterManager);
  }

  const targetId = resolveCharacterId(subCommand, characterManager);
  if (targetId) {
    if (targetId === characterManager.getCurrentCharacter().id) {
      const current = characterManager.getCurrentCharacter();
      console.log(chalk.yellow(`  当前已经是 ${current.name}。`));
      return;
    }
    return switchTo(targetId, characterManager);
  }

  console.log(chalk.red(`  未知角色或子命令: /character ${subCommand}`));
  console.log(chalk.dim('  可用: list, info, create, paths, random, roxy, rudeus, eris, sylphiette, nanahoshi, 或自定义角色 id'));
}

function showCharacterList(characterManager: CharacterManager): void {
  const list = characterManager.getCharacterList();
  const current = characterManager.getCurrentCharacter();
  const border = chalk.hex(current.theme.primary);

  console.log('');
  console.log(border('  +-- RoxyCode Character Selection --+'));
  for (const item of list) {
    const marker = item.isActive ? chalk.hex(item.primaryColor)('*') : chalk.dim('-');
    const source = item.custom ? `${item.source}/custom` : 'builtin';
    const behavior = item.behavior ? ` | ${item.behavior.explanationStyle}, ${item.behavior.riskPreference}` : '';
    const companion = item.companion ? ` | buddy: ${item.companion}` : '';
    console.log(`  ${marker} ${chalk.hex(item.primaryColor).bold(item.id)} ${item.name} - ${item.title}`);
    console.log(chalk.dim(`      ${item.description}`));
    console.log(chalk.dim(`      source: ${source}${companion}${behavior}`));
  }

  const errors = characterManager.getCustomLoadErrors();
  if (errors.length > 0) {
    console.log(chalk.yellow(''));
    console.log(chalk.yellow('  自定义角色加载警告:'));
    for (const error of errors.slice(0, 5)) {
      console.log(chalk.dim(`  - ${error.path}: ${error.message}`));
    }
  }

  console.log(chalk.dim(''));
  console.log(chalk.dim('  用法: /character <id> | /character create <id> | /character info [id] | /character paths'));
  console.log('');
}

function showCharacterInfo(characterManager: CharacterManager, character?: Character): void {
  const c = character ?? characterManager.getCurrentCharacter();
  if (!c) {
    console.log(chalk.red('  角色不存在。'));
    return;
  }

  const border = chalk.hex(c.theme.primary);
  console.log('');
  console.log(border(`  +-- ${c.name} / ${c.nameEn} --+`));
  console.log(`  ${chalk.bold(c.title)}`);
  console.log(chalk.dim(`  ${c.description}`));
  console.log(`  性格: ${c.personality}`);
  console.log(`  来源: ${c.source ?? 'builtin'}${c.custom ? ' / custom' : ''}`);
  console.log('');
  console.log(chalk.bold('  主题色'));
  for (const [key, value] of Object.entries(c.theme)) {
    console.log(`  - ${key}: ${chalk.hex(value)('██')} ${chalk.dim(value)}`);
  }
  console.log('');
  console.log(chalk.bold('  状态术语'));
  console.log(`  - thinking: ${c.statusText.thinking}`);
  console.log(`  - planning:  ${c.statusText.planning}`);
  console.log(`  - executing: ${c.statusText.executing}`);
  console.log(`  - done:      ${c.statusText.done}`);

  if (c.companion) {
    console.log('');
    console.log(chalk.bold('  Pixel 小伙伴'));
    console.log(`  - ${c.companion.name} (${c.companion.kind})`);
    for (const line of c.companion.art.slice(0, 6)) console.log(`    ${line}`);
  }

  if (c.behavior) {
    console.log('');
    console.log(chalk.bold('  Agent 行为策略'));
    console.log(`  - explanationStyle: ${c.behavior.explanationStyle}`);
    console.log(`  - reviewFocus:      ${c.behavior.reviewFocus.join(', ')}`);
    console.log(`  - riskPreference:   ${c.behavior.riskPreference}`);
    console.log(`  - preferredMode:    ${c.behavior.preferredMode}`);
    if (c.behavior.workflowBias.length) console.log(`  - workflowBias:     ${c.behavior.workflowBias.join(' / ')}`);
    if (c.behavior.responseRules.length) console.log(`  - responseRules:    ${c.behavior.responseRules.join(' / ')}`);
  }

  console.log('');
}

async function createCharacter(args: string[], characterManager: CharacterManager): Promise<void> {
  const id = args.find(arg => !arg.startsWith('--'));
  const force = args.includes('--force');
  const fromCurrent = args.includes('--from-current') || args.includes('--from') && args.includes('current');

  if (!id) {
    console.log(chalk.red('  缺少角色 id。'));
    console.log(chalk.dim('  用法: /character create <id> [--force] [--from-current]'));
    return;
  }

  if (!isValidCharacterId(id)) {
    console.log(chalk.red('  角色 id 只能包含字母、数字、下划线和短横线，且长度不超过 64。'));
    return;
  }

  const dir = await ensureProjectCharacterDirectory(process.cwd());
  const path = join(dir, `${id}.json`);
  if (existsSync(path) && !force) {
    console.log(chalk.yellow(`  角色模板已存在: ${path}`));
    console.log(chalk.dim('  如需覆盖，请使用 /character create <id> --force'));
    return;
  }

  const template = fromCurrent
    ? characterToTemplate(characterManager.getCurrentCharacter(), id)
    : createCustomCharacterTemplate({ id });

  await mkdir(dir, { recursive: true });
  await writeFile(path, serializeCustomCharacterTemplate(template), 'utf-8');
  console.log(chalk.green(`  已生成自定义角色模板: ${path}`));
  console.log(chalk.dim('  修改 theme/statusText/companion/behavior 后重启 RoxyCode，或后续接入热加载命令。'));
  console.log(chalk.dim(`  然后使用 /character ${id} 切换。`));
}

function showCharacterPaths(characterManager: CharacterManager): void {
  const paths = characterManager.getCustomCharacterPaths();
  console.log('');
  console.log(chalk.bold('  自定义角色目录'));
  if (!paths) {
    console.log(chalk.dim('  目录尚未加载，重启后会自动扫描。'));
    return;
  }
  console.log(`  Global:  ${paths.global}`);
  console.log(`  Project: ${paths.project}`);
  console.log(chalk.dim('  优先级: project > global > builtin'));
  console.log('');
}

async function switchTo(id: CharacterId, characterManager: CharacterManager): Promise<void> {
  await characterManager.switchCharacter(id);
  const c = characterManager.getCurrentCharacter();
  const pool = c.easterEggs.startup;
  const quote = pool[Math.floor(Math.random() * pool.length)] ?? '';

  console.log(renderCharacterSwitch(
    c.id,
    c.theme,
    quote,
    c.name,
    c.nameEn,
    c.splash.asciiArt,
  ));
}

function resolveCharacterId(input: string, characterManager: CharacterManager): CharacterId | undefined {
  const normalized = input.toLowerCase();
  const alias = ID_ALIASES[normalized];
  if (alias) return alias;
  const exact = characterManager.getCharacter(input as CharacterId);
  if (exact) return exact.id;
  const caseInsensitive = characterManager.getCharacterList().find(item => String(item.id).toLowerCase() === normalized);
  return caseInsensitive?.id;
}
