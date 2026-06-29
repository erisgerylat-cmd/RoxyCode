/**
 * 配置管理器
 *
 * Claude Code 将设置拆分为 user/project/local/flag/policy 等多个 source，并按优先级合并。
 * RoxyCode 当前先实现最关键的两层：
 * 1. project: <cwd>/.roxycode/config.json
 * 2. global:  ~/.roxycode/config.json
 *
 * project 覆盖 global，global 覆盖默认值。写入时必须明确目标 scope，避免把项目定制误写入全局。
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_CONFIG, type RoxyCodeConfig } from './types/config.js';

export type ConfigScope = 'global' | 'project';

export interface ConfigSetOptions {
  scope?: ConfigScope;
}

export interface ConfigPathSnapshot {
  global: string;
  project: string;
}

export class ConfigManager {
  private config: RoxyCodeConfig;
  private globalConfig: Partial<RoxyCodeConfig> = {};
  private projectConfig: Partial<RoxyCodeConfig> = {};
  private globalConfigPath: string;
  private projectConfigPath: string;

  constructor(cwd: string = process.cwd()) {
    this.globalConfigPath = join(homedir(), '.roxycode', 'config.json');
    this.projectConfigPath = join(cwd, '.roxycode', 'config.json');
    this.config = structuredClone(DEFAULT_CONFIG);
  }

  /** 加载配置并按默认值 < global < project 的顺序合并。 */
  async load(): Promise<void> {
    this.globalConfig = await this.readConfigFile(this.globalConfigPath);
    this.projectConfig = await this.readConfigFile(this.projectConfigPath);
    this.rebuildEffectiveConfig();
  }

  /** 重新加载磁盘配置。 */
  async reload(): Promise<void> {
    await this.load();
  }

  /** 获取配置值，支持点号路径，例如 character.current。 */
  get(path: string): unknown {
    return path.split('.').reduce((obj: any, key) => obj?.[key], this.config);
  }

  /** 设置配置值，并写入指定 scope；未指定时写入已有项目覆盖层，否则写入 global。 */
  async set(path: string, value: unknown, options: ConfigSetOptions = {}): Promise<void> {
    const scope = options.scope ?? (hasNestedValue(this.projectConfig as Record<string, unknown>, path) ? 'project' : 'global');
    const target = scope === 'project' ? this.projectConfig : this.globalConfig;
    setNestedValue(target as Record<string, unknown>, path, value);
    await this.saveScope(scope);
    this.rebuildEffectiveConfig();
  }

  /** 获取配置文件路径，供命令和诊断面板展示。 */
  getPaths(): ConfigPathSnapshot {
    return {
      global: this.globalConfigPath,
      project: this.projectConfigPath,
    };
  }

  /** 获取完整配置快照，只读深拷贝。 */
  snapshot(): Readonly<RoxyCodeConfig> {
    return structuredClone(this.config);
  }

  private rebuildEffectiveConfig(): void {
    const withGlobal = deepMerge(structuredClone(DEFAULT_CONFIG), this.globalConfig);
    this.config = deepMerge(withGlobal, this.projectConfig);
  }

  private async readConfigFile(path: string): Promise<Partial<RoxyCodeConfig>> {
    if (!existsSync(path)) {
      return {};
    }

    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed as Partial<RoxyCodeConfig> : {};
    } catch {
      return {};
    }
  }

  private async saveScope(scope: ConfigScope): Promise<void> {
    const path = scope === 'project' ? this.projectConfigPath : this.globalConfigPath;
    const data = scope === 'project' ? this.projectConfig : this.globalConfig;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  }
}

function hasNestedValue(target: Record<string, unknown>, path: string): boolean {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) {
    return false;
  }

  let obj: unknown = target;
  for (const key of keys) {
    if (!isPlainObject(obj) || !(key in obj)) {
      return false;
    }
    obj = obj[key];
  }
  return true;
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.').filter(Boolean);
  if (keys.length === 0) {
    throw new Error('Config path cannot be empty');
  }

  let obj = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const current = obj[key];
    if (!isPlainObject(current)) {
      obj[key] = {};
    }
    obj = obj[key] as Record<string, unknown>;
  }

  obj[keys[keys.length - 1]] = value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(targetVal as Record<string, any>, sourceVal as Record<string, any>) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}
