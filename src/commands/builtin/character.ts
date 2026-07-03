import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import { exportCharacterPackage } from '../../aesthetic/character/custom/CharacterPackageExporter.js';
import { CharacterPackageManager } from '../../aesthetic/character/custom/CharacterPackageManager.js';
import { packCharacterPackage } from '../../aesthetic/character/custom/CharacterPackagePacker.js';
import { createCharacterPackageTemplate } from '../../aesthetic/character/custom/CharacterPackageTemplate.js';
import { validateCharacterPackage } from '../../aesthetic/character/custom/CharacterPackageValidator.js';
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

  if (subCommand === 'packages') {
    return showCharacterPackages(args.slice(1));
  }

  if (subCommand === 'install') {
    return installCharacterPackageCommand(args.slice(1), characterManager);
  }

  if (subCommand === 'uninstall' || subCommand === 'remove') {
    return uninstallCharacterPackageCommand(args.slice(1), characterManager);
  }

  if (subCommand === 'update') {
    return updateCharacterPackageCommand(args.slice(1), characterManager);
  }

  if (subCommand === 'validate') {
    return validateCharacterPackageCommand(args.slice(1));
  }

  if (subCommand === 'pack') {
    return packCharacterPackageCommand(args.slice(1));
  }

  if (subCommand === 'export') {
    return exportCharacterPackageCommand(args.slice(1), characterManager);
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
  console.log(chalk.dim('  可用: list, info, create, paths, packages, install, uninstall, update, validate, pack, export, random, roxy, rudeus, eris, sylphiette, nanahoshi，或自定义角色 id'));
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
    console.log(chalk.yellow('  自定义角色加载警告'));
    for (const error of errors.slice(0, 5)) {
      console.log(chalk.dim(`  - ${error.path}: ${error.message}`));
    }
  }

  console.log(chalk.dim(''));
  console.log(chalk.dim('  用法: /character <id> | /character create <id> | /character packages | /character install <path>'));
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
  if (c.packageInfo) {
    console.log(`  角色包: ${c.packageInfo.packageName}@${c.packageInfo.version}`);
  }
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
  const id = firstPositional(args);
  const force = args.includes('--force');
  const fromCurrent = args.includes('--from-current') || args.includes('--from') && args.includes('current');
  const asPackage = args.includes('--package');

  if (!id) {
    console.log(chalk.red('  缺少角色 id。'));
    console.log(chalk.dim('  用法: /character create <id> [--force] [--from-current] [--package]'));
    return;
  }

  if (!isValidCharacterId(id)) {
    console.log(chalk.red('  角色 id 只能包含字母、数字、下划线和短横线，且长度不超过 64。'));
    return;
  }

  const dir = await ensureProjectCharacterDirectory(process.cwd());
  if (asPackage) {
    const packageDir = join(dir, id);
    try {
      const result = await createCharacterPackageTemplate({
        id,
        directory: packageDir,
        character: fromCurrent ? characterManager.getCurrentCharacter() : undefined,
        force,
      });
      await characterManager.loadCustomCharacters();
      console.log(chalk.green('  标准角色包模板已生成'));
      console.log(`  路径: ${result.packageDir}`);
      console.log(`  包名: ${result.manifest.name}`);
      console.log(`  角色 id: ${result.character.id}`);
      console.log(chalk.dim(`  下一步: /character validate ${result.packageDir}`));
      console.log(chalk.dim(`  切换角色: /character ${result.character.id}`));
    } catch (error) {
      console.log(chalk.red(`  标准角色包模板生成失败: ${errorMessage(error)}`));
    }
    return;
  }

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

async function showCharacterPackages(args: string[]): Promise<void> {
  const scope = parseScope(args);
  const packages = await new CharacterPackageManager(process.cwd()).listInstalledPackages();
  const filtered = packages.filter(pkg => {
    if (scope === 'global') return pkg.scope === 'global';
    if (scope === 'project') return pkg.scope === 'project';
    return true;
  });

  console.log('');
  console.log(chalk.bold('  RoxyCode 角色包'));
  if (filtered.length === 0) {
    console.log(chalk.dim('  暂无已安装角色包。'));
    console.log(chalk.dim('  使用 /character install ./my-character 或 /character install ./roxy-sensei.roxychar 安装。'));
    console.log('');
    return;
  }

  for (const pkg of filtered) {
    const scopeLabel = pkg.scope === 'global' ? chalk.cyan('global') : chalk.green('project');
    console.log(`  ${chalk.bold(pkg.name)} ${chalk.dim(`v${pkg.version}`)} ${scopeLabel}`);
    console.log(`    displayName: ${pkg.displayName}`);
    console.log(`    description: ${pkg.description}`);
    console.log(`    installPath: ${pkg.installPath}`);
  }
  console.log('');
}

async function installCharacterPackageCommand(args: string[], characterManager: CharacterManager): Promise<void> {
  const packagePath = firstPositional(args);
  if (!packagePath) {
    console.log(chalk.red('  缺少角色包路径。'));
    console.log(chalk.dim('  用法: /character install <path> [--global] [--force]'));
    return;
  }

  try {
    const result = await new CharacterPackageManager(process.cwd()).installPackage(packagePath, {
      global: args.includes('--global'),
      force: args.includes('--force'),
    });
    await characterManager.loadCustomCharacters();

    console.log(chalk.green('  角色包安装成功'));
    console.log(`  包名: ${result.manifest.name}`);
    console.log(`  版本: ${result.manifest.version}`);
    console.log(`  范围: ${result.scope}`);
    console.log(`  角色 id: ${result.character.id}`);
    console.log(chalk.dim(`  下一步: /character ${result.character.id}`));
  } catch (error) {
    console.log(chalk.red(`  角色包安装失败: ${errorMessage(error)}`));
  }
}

async function uninstallCharacterPackageCommand(args: string[], characterManager: CharacterManager): Promise<void> {
  const packageName = firstPositional(args);
  if (!packageName) {
    console.log(chalk.red('  缺少角色包名。'));
    console.log(chalk.dim('  用法: /character uninstall <name> [--global]'));
    return;
  }

  try {
    const manager = new CharacterPackageManager(process.cwd());
    const previousCharacterId = String(characterManager.getCurrentCharacter().id);
    const installed = await manager.getInstalledPackage(packageName);
    const result = await manager.uninstallPackage(packageName, {
      global: args.includes('--global') || installed?.scope === 'global',
    });

    await characterManager.loadCustomCharacters();
    if (previousCharacterId === result.characterId || !characterManager.getCharacter(previousCharacterId as CharacterId)) {
      await characterManager.switchCharacter('roxy');
    }

    console.log(chalk.green('  角色包已卸载'));
    console.log(`  包名: ${result.packageName}`);
    console.log(`  范围: ${result.scope}`);
    console.log(`  路径: ${result.installPath}`);
  } catch (error) {
    console.log(chalk.red(`  角色包卸载失败: ${errorMessage(error)}`));
  }
}

async function updateCharacterPackageCommand(args: string[], characterManager: CharacterManager): Promise<void> {
  const packagePath = firstPositional(args);
  if (!packagePath) {
    console.log(chalk.red('  缺少角色包路径。'));
    console.log(chalk.dim('  用法: /character update <path> [--global]'));
    return;
  }

  try {
    const result = await new CharacterPackageManager(process.cwd()).updatePackage(
      packagePath,
      args.includes('--global') ? { global: true } : {},
    );
    await characterManager.loadCustomCharacters();

    console.log(chalk.green('  角色包更新成功'));
    console.log(`  包名: ${result.manifest.name}`);
    console.log(`  版本: ${result.previousVersion ?? 'unknown'} -> ${result.manifest.version}`);
    console.log(`  范围: ${result.scope}`);
    console.log(`  角色 id: ${result.character.id}`);
  } catch (error) {
    const message = errorMessage(error);
    console.log(chalk.red(`  角色包更新失败: ${message}`));
    if (/not installed/i.test(message)) {
      console.log(chalk.dim('  该角色包尚未安装，请先使用 /character install <path>。'));
    }
  }
}

async function validateCharacterPackageCommand(args: string[]): Promise<void> {
  const packagePath = firstPositional(args);
  if (!packagePath) {
    console.log(chalk.red('  缺少角色包路径。'));
    console.log(chalk.dim('  用法: /character validate <path>'));
    return;
  }

  try {
    const result = await validateCharacterPackage(packagePath);
    console.log('');
    console.log(chalk.bold(`  验证角色包: ${packagePath}`));
    if (result.manifest) {
      console.log(`  包名: ${result.manifest.name}`);
      console.log(`  版本: ${result.manifest.version}`);
    }
    if (result.character) console.log(`  角色 id: ${result.character.id}`);

    for (const error of result.errors) {
      console.log(chalk.red(`  error ${error.path}: ${error.message}`));
    }
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  warning ${warning.path}: ${warning.message}`));
    }

    if (result.success) {
      console.log(result.warnings.length ? chalk.yellow('  验证通过，但存在 warning。') : chalk.green('  验证通过。'));
    } else {
      console.log(chalk.red('  验证失败。'));
    }
    console.log('');
  } catch (error) {
    console.log(chalk.red(`  角色包验证失败: ${errorMessage(error)}`));
  }
}

async function packCharacterPackageCommand(args: string[]): Promise<void> {
  const packagePath = firstPositional(args);
  if (!packagePath) {
    console.log(chalk.red('  缺少角色包目录。'));
    console.log(chalk.dim('  用法: /character pack <package-dir> [--out <dir>] [--force]'));
    return;
  }

  try {
    const result = await packCharacterPackage(packagePath, {
      outDir: optionValue(args, '--out'),
      force: args.includes('--force'),
    });
    console.log(chalk.green('  角色包打包成功'));
    console.log(`  包名: ${result.packageName}`);
    console.log(`  版本: ${result.version}`);
    console.log(`  文件数: ${result.files.length}`);
    console.log(`  输出: ${result.packagePath}`);
    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`  warning: ${result.warnings.length} 条，请用 /character validate 查看详情。`));
    }
    console.log(chalk.dim(`  下一步: /character install ${result.packagePath}`));
  } catch (error) {
    console.log(chalk.red(`  角色包打包失败: ${errorMessage(error)}`));
  }
}

async function exportCharacterPackageCommand(args: string[], characterManager: CharacterManager): Promise<void> {
  const target = firstPositional(args);
  if (!target) {
    console.log(chalk.red('  缺少要导出的角色 id。'));
    console.log(chalk.dim('  用法: /character export <id|current> [--out <dir>] [--package|--roxychar] [--force]'));
    return;
  }

  const characterId = target === 'current' ? characterManager.getCurrentCharacter().id : resolveCharacterId(target, characterManager);
  const character = characterId ? characterManager.getCharacter(characterId) : undefined;
  if (!character) {
    console.log(chalk.red(`  角色不存在: ${target}`));
    return;
  }

  try {
    const outDir = optionValue(args, '--out') ?? join(process.cwd(), 'packages');
    const result = await exportCharacterPackage(character, {
      outDir,
      force: args.includes('--force'),
      roxychar: args.includes('--roxychar'),
    });
    console.log(chalk.green('  角色导出成功'));
    console.log(`  角色 id: ${character.id}`);
    console.log(`  包目录: ${result.packageDir}`);
    if (result.archivePath) {
      console.log(`  归档: ${result.archivePath}`);
      console.log(chalk.dim(`  下一步: /character install ${result.archivePath}`));
    } else {
      console.log(chalk.dim(`  下一步: /character validate ${result.packageDir}`));
      console.log(chalk.dim(`  打包: /character pack ${result.packageDir}`));
    }
  } catch (error) {
    console.log(chalk.red(`  角色导出失败: ${errorMessage(error)}`));
  }
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

function firstPositional(args: string[]): string | undefined {
  return positionalArgs(args)[0];
}

function positionalArgs(args: string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && optionTakesValue(arg)) i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

function parseScope(args: string[]): 'all' | 'global' | 'project' {
  if (args.includes('--global')) return 'global';
  if (args.includes('--project')) return 'project';
  return 'all';
}

function optionValue(args: string[], name: string): string | undefined {
  const equals = args.find(arg => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function optionTakesValue(name: string): boolean {
  return name === '--out';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
