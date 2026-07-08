import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConfigManager } from '../../core/ConfigManager.js';
import type { CharacterManager } from '../../aesthetic/character/CharacterManager.js';
import { exportCharacterPackage } from '../../aesthetic/character/custom/CharacterPackageExporter.js';
import { CharacterPackageManager } from '../../aesthetic/character/custom/CharacterPackageManager.js';
import { StoreClient, type StoreClientOptions } from '../../aesthetic/character/marketplace/StoreClient.js';
import { packCharacterPackage } from '../../aesthetic/character/custom/CharacterPackagePacker.js';
import { verifyCharacterPackageIntegrity } from '../../aesthetic/character/custom/CharacterPackageIntegrity.js';
import { createCharacterPackageTemplate } from '../../aesthetic/character/custom/CharacterPackageTemplate.js';
import { validateCharacterPackage } from '../../aesthetic/character/custom/CharacterPackageValidator.js';
import { characterToTemplate, createCustomCharacterTemplate, serializeCustomCharacterTemplate } from '../../aesthetic/character/custom/CharacterTemplate.js';
import { ensureProjectCharacterDirectory, isValidCharacterId } from '../../aesthetic/character/custom/CustomCharacterLoader.js';
import {
  listCharacterMarketplacePackages,
  validateCharacterMarketplaceIndex,
} from '../../aesthetic/character/marketplace/CharacterMarketplaceIndex.js';
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
  configManager?: ConfigManager,
): Promise<void> {
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand || subCommand === 'list') {
    return showCharacterList(characterManager);
  }

  if (subCommand === 'search') {
    return searchStoreCommand(args.slice(1), configManager);
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
    return installCharacterPackageCommand(args.slice(1), characterManager, configManager);
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

  if (subCommand === 'verify') {
    return verifyCharacterPackageCommand(args.slice(1));
  }

  if (subCommand === 'export') {
    return exportCharacterPackageCommand(args.slice(1), characterManager);
  }

  if (subCommand === 'marketplace') {
    return characterMarketplaceCommand(args.slice(1));
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
  console.log(chalk.dim('  可用: list, info, create, paths, packages, install, uninstall, update, validate, pack, verify, export, marketplace, random, roxy, rudeus, eris, sylphiette, nanahoshi，或自定义角色 id'));
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

async function installCharacterPackageCommand(
  args: string[],
  characterManager: CharacterManager,
  configManager?: ConfigManager,
): Promise<void> {
  const target = firstPositional(args);
  if (!target) {
    console.log(chalk.red('  缺少角色包路径或名称。'));
    console.log(chalk.dim('  本地: /character install <path> [--global] [--force]'));
    console.log(chalk.dim('  商城: /character install <name>[@version] [--global] [--force]'));
    return;
  }

  const remote = parseRemoteInstallTarget(target);
  if (remote && isLikelyRemoteInstall(target)) {
    return installFromStoreCommand(remote, args, characterManager, configManager);
  }

  try {
    const result = await new CharacterPackageManager(process.cwd()).installPackage(target, {
      global: args.includes('--global'),
      force: args.includes('--force'),
    });
    await characterManager.loadCustomCharacters();

    console.log(chalk.green('  角色包安装成功'));
    console.log(`  包名: ${result.manifest.name}`);
    console.log(`  版本: ${result.manifest.version}`);
    console.log(`  范围: ${result.scope}`);
    console.log(`  角色 id: ${result.character.id}`);
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  warning: ${warning}`));
    }
    console.log(chalk.dim(`  下一步: /character ${result.character.id}`));
  } catch (error) {
    console.log(chalk.red(`  角色包安装失败: ${errorMessage(error)}`));
  }
}

async function installFromStoreCommand(
  remote: { name: string; version?: string },
  args: string[],
  characterManager: CharacterManager,
  configManager?: ConfigManager,
): Promise<void> {
  const storeOptions = resolveStoreOptions(configManager);
  if (!storeOptions) {
    console.log(chalk.red('  未配置 RoxyStore 商城地址。'));
    console.log(chalk.dim('  请先设置: /config set store.baseUrl <https://your-roxystore>'));
    console.log(chalk.dim(`  或使用本地文件安装: /character install ./${remote.name}.roxychar`));
    return;
  }

  try {
    console.log(chalk.dim(`  正在从商城下载 ${remote.name}${remote.version ? `@${remote.version}` : ''} ...`));
    const result = await new CharacterPackageManager(process.cwd()).installFromStore(remote.name, {
      storeOptions,
      version: remote.version,
      global: args.includes('--global'),
      force: args.includes('--force'),
    });
    await characterManager.loadCustomCharacters();

    const { download } = result;
    console.log(chalk.green('  角色包已从商城安装'));
    console.log(`  包名: ${result.manifest.name}`);
    console.log(`  版本: ${result.manifest.version}`);
    console.log(`  范围: ${result.scope}`);
    console.log(`  角色 id: ${result.character.id}`);
    console.log(`  SHA-256: ${download.sha256}${download.verified ? chalk.green(' (已校验)') : chalk.yellow(' (服务端未提供期望值)')}`);
    if (download.riskLevel !== 'UNKNOWN') {
      const riskColor = download.riskLevel === 'SAFE' || download.riskLevel === 'LOW'
        ? chalk.green
        : download.riskLevel === 'MEDIUM'
          ? chalk.yellow
          : chalk.red;
      console.log(`  风险等级: ${riskColor(download.riskLevel)}${download.riskSummary ? ` - ${download.riskSummary}` : ''}`);
    }
    if (result.installRecord.recorded) {
      console.log(chalk.green(`  Store install record: synced${result.installRecord.installedVersion ? ` (${result.installRecord.installedVersion})` : ''}`));
    } else if (result.installRecord.skippedReason === 'missing-token') {
      console.log(chalk.yellow('  Store install record: skipped because store.token is not configured.'));
    } else if (result.installRecord.error) {
      console.log(chalk.yellow(`  Store install record: sync failed (${result.installRecord.error})`));
    }
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  warning: ${warning}`));
    }
    console.log(chalk.dim(`  下一步: /character ${result.character.id}`));
  } catch (error) {
    console.log(chalk.red(`  从商城安装失败: ${errorMessage(error)}`));
  }
}

async function searchStoreCommand(args: string[], configManager?: ConfigManager): Promise<void> {
  const storeOptions = resolveStoreOptions(configManager);
  if (!storeOptions) {
    console.log(chalk.red('  未配置 RoxyStore 商城地址。'));
    console.log(chalk.dim('  请先设置: /config set store.baseUrl <https://your-roxystore>'));
    return;
  }

  const query = positionalArgs(args).join(' ').trim();
  try {
    const client = new StoreClient(storeOptions);
    const results = await client.searchPackages({
      q: query || undefined,
      official: args.includes('--official') ? true : undefined,
      sort: optionValue(args, '--sort'),
    });

    console.log('');
    console.log(chalk.bold(`  RoxyStore 角色包${query ? `: "${query}"` : ''}`));
    if (results.length === 0) {
      console.log(chalk.dim('  没有匹配的角色包。'));
      console.log('');
      return;
    }

    for (const pkg of results) {
      const officialTag = pkg.official ? chalk.cyan(' [官方]') : '';
      const riskTag = pkg.riskLevel !== 'UNKNOWN' ? chalk.dim(` risk:${pkg.riskLevel}`) : '';
      console.log(`  ${chalk.bold(pkg.name)} ${chalk.dim(`v${pkg.latestVersion}`)}${officialTag}${riskTag}`);
      console.log(chalk.dim(`    ${pkg.displayName} - ${pkg.description}`));
      const stats = [`↓ ${pkg.downloads}`];
      if (typeof pkg.rating === 'number') stats.push(`★ ${pkg.rating.toFixed(1)}`);
      if (pkg.author) stats.push(`by ${pkg.author}`);
      console.log(chalk.dim(`    ${stats.join('  ')}`));
      console.log(chalk.dim(`    安装: /character install ${pkg.name}`));
    }
    console.log('');
  } catch (error) {
    console.log(chalk.red(`  商城搜索失败: ${errorMessage(error)}`));
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
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  warning: ${warning}`));
    }
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
    console.log(`  SHA-256: ${result.sha256}`);
    console.log(`  校验文件: ${result.sha256Path}`);
    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`  warning: ${result.warnings.length} 条，请用 /character validate 查看详情。`));
    }
    console.log(chalk.dim(`  下一步: /character verify ${result.packagePath}`));
    console.log(chalk.dim(`  安装: /character install ${result.packagePath}`));
  } catch (error) {
    console.log(chalk.red(`  角色包打包失败: ${errorMessage(error)}`));
  }
}

async function verifyCharacterPackageCommand(args: string[]): Promise<void> {
  const packagePath = firstPositional(args);
  if (!packagePath) {
    console.log(chalk.red('  缺少角色包文件路径。'));
    console.log(chalk.dim('  用法: /character verify <file.roxychar> [--sha256 <hash>] [--sidecar <file.sha256>]'));
    return;
  }

  try {
    const result = await verifyCharacterPackageIntegrity(packagePath, {
      sha256: optionValue(args, '--sha256'),
      sidecarPath: optionValue(args, '--sidecar'),
    });
    console.log('');
    console.log(chalk.bold(`  校验角色包: ${result.path}`));
    console.log(`  SHA-256: ${result.sha256}`);
    if (result.expectedSha256) {
      console.log(`  期望值: ${result.expectedSha256}`);
      console.log(result.verified ? chalk.green('  完整性校验通过。') : chalk.red('  完整性校验失败，请不要安装该角色包。'));
    } else {
      console.log(chalk.yellow('  未提供期望 SHA-256，也未找到 .sha256 文件。'));
      console.log(chalk.dim(`  可使用: /character verify ${result.path} --sha256 ${result.sha256}`));
    }
    console.log('');
  } catch (error) {
    console.log(chalk.red(`  角色包完整性校验失败: ${errorMessage(error)}`));
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
      if (result.sha256) console.log(`  SHA-256: ${result.sha256}`);
      if (result.sha256Path) console.log(`  校验文件: ${result.sha256Path}`);
      console.log(chalk.dim(`  下一步: /character verify ${result.archivePath}`));
      console.log(chalk.dim(`  下一步: /character install ${result.archivePath}`));
    } else {
      console.log(chalk.dim(`  下一步: /character validate ${result.packageDir}`));
      console.log(chalk.dim(`  打包: /character pack ${result.packageDir}`));
    }
  } catch (error) {
    console.log(chalk.red(`  角色导出失败: ${errorMessage(error)}`));
  }
}

async function characterMarketplaceCommand(args: string[]): Promise<void> {
  const action = args[0]?.toLowerCase();
  const marketplacePath = firstPositional(args.slice(1));

  if (!action || action === 'help') {
    console.log(chalk.bold('  角色包市场命令'));
    console.log(chalk.dim('  /character marketplace validate <marketplace.json|dir>'));
    console.log(chalk.dim('  /character marketplace list <marketplace.json|dir>'));
    return;
  }

  if (!marketplacePath) {
    console.log(chalk.red('  缺少 marketplace 路径。'));
    console.log(chalk.dim(`  用法: /character marketplace ${action} <marketplace.json|dir>`));
    return;
  }

  if (action === 'validate') {
    await validateCharacterMarketplaceCommand(marketplacePath);
    return;
  }

  if (action === 'list') {
    await listCharacterMarketplaceCommand(marketplacePath);
    return;
  }

  console.log(chalk.red(`  未知角色包市场子命令: ${action}`));
  console.log(chalk.dim('  可用: validate, list'));
}

async function validateCharacterMarketplaceCommand(marketplacePath: string): Promise<void> {
  try {
    const result = await validateCharacterMarketplaceIndex(marketplacePath);
    console.log('');
    console.log(chalk.bold(`  验证角色包市场: ${result.marketplacePath}`));
    if (result.marketplace) {
      console.log(`  市场: ${result.marketplace.displayName ?? result.marketplace.name}`);
      console.log(`  包数量: ${result.marketplace.packages.length}`);
    }
    for (const error of result.errors) {
      console.log(chalk.red(`  error ${error.path}: ${error.message}`));
    }
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  warning ${warning.path}: ${warning.message}`));
    }
    console.log(result.success ? chalk.green('  验证通过。') : chalk.red('  验证失败。'));
    console.log('');
  } catch (error) {
    console.log(chalk.red(`  角色包市场验证失败: ${errorMessage(error)}`));
  }
}

async function listCharacterMarketplaceCommand(marketplacePath: string): Promise<void> {
  try {
    const result = await validateCharacterMarketplaceIndex(marketplacePath);
    console.log('');
    console.log(chalk.bold(`  角色包市场: ${result.marketplace?.displayName ?? result.marketplace?.name ?? marketplacePath}`));

    if (!result.marketplace || !result.success) {
      for (const error of result.errors) {
        console.log(chalk.red(`  error ${error.path}: ${error.message}`));
      }
      console.log(chalk.red('  市场索引存在错误，无法列出可安装角色包。'));
      console.log('');
      return;
    }

    const packages = listCharacterMarketplacePackages(result.marketplace, result.marketplacePath);
    if (packages.length === 0) {
      console.log(chalk.dim('  暂无可安装角色包。'));
      console.log('');
      return;
    }

    for (const pkg of packages) {
      console.log(`  ${chalk.bold(pkg.name)} ${chalk.dim(`v${pkg.version}`)} - ${pkg.displayName}`);
      console.log(chalk.dim(`    ${pkg.description}`));
      console.log(chalk.dim(`    source: ${pkg.source}`));
      if (pkg.sha256) console.log(chalk.dim(`    sha256: ${pkg.sha256}`));
      if (pkg.categories.length || pkg.tags.length) {
        console.log(chalk.dim(`    tags: ${[...pkg.categories, ...pkg.tags].join(', ')}`));
      }
      console.log(chalk.dim(`    安装: ${pkg.installHint}`));
    }

    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`  warning: ${result.warnings.length} 条，请用 /character marketplace validate ${result.marketplacePath} 查看。`));
    }
    console.log('');
  } catch (error) {
    console.log(chalk.red(`  角色包市场列表失败: ${errorMessage(error)}`));
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

function resolveStoreOptions(configManager?: ConfigManager): StoreClientOptions | undefined {
  if (!configManager) return undefined;
  const baseUrl = configManager.get('store.baseUrl');
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return undefined;
  const token = configManager.get('store.token');
  return {
    baseUrl: baseUrl.trim(),
    token: typeof token === 'string' && token.trim() ? token.trim() : undefined,
  };
}

/** 解析 `name`、`name@version`、`store:name`、`store:name@version` 形式。 */
function parseRemoteInstallTarget(target: string): { name: string; version?: string } | undefined {
  const stripped = target.startsWith('store:') ? target.slice('store:'.length) : target;
  const atIndex = stripped.lastIndexOf('@');
  const name = atIndex > 0 ? stripped.slice(0, atIndex) : stripped;
  const version = atIndex > 0 ? stripped.slice(atIndex + 1) : undefined;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return undefined;
  return { name, version };
}

/**
 * 判断是否应走商城安装：显式 store: 前缀，或"不含路径分隔符/扩展名、且本地不存在"的裸包名。
 * 这样本地相对路径（./x、x.roxychar、含 / 或 \ 的路径）仍走本地安装。
 */
function isLikelyRemoteInstall(target: string): boolean {
  if (target.startsWith('store:')) return true;
  if (target.includes('/') || target.includes('\\')) return false;
  if (target.startsWith('.')) return false;
  if (/\.(roxychar|zip|json)$/i.test(target)) return false;
  const base = target.includes('@') ? target.slice(0, target.lastIndexOf('@')) : target;
  if (existsSync(base) || existsSync(target)) return false;
  return true;
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
  return name === '--out' || name === '--sha256' || name === '--sidecar';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
