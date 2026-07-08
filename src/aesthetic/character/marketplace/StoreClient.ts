import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RoxyError } from '../../../core/errors.js';

/**
 * StoreClient —— RoxyStore 角色包商城的 REST API 客户端。
 *
 * 负责搜索、详情、版本列表查询，以及"申请下载 → 取预签名 URL → 流式下载到本地缓存"
 * 的完整远程获取链路。下载后不做安装，安装交由 CharacterPackageManager 处理。
 *
 * 安全约定：
 * - 服务端返回的 sha256 只作为"期望值"，真实校验由调用方对本地文件重新计算比对。
 * - 预签名 URL 仅允许 http(s)，避免被诱导访问本地文件或非预期协议。
 */

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_RETRIES = 2;

export type StoreRiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export interface StoreClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  maxDownloadBytes?: number;
  retries?: number;
  /** 缓存根目录，默认 ~/.roxycode/cache/packages */
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}

export interface StoreSearchFilters {
  q?: string;
  explanationStyle?: string;
  riskPreference?: string;
  characterType?: string;
  rating?: number;
  official?: boolean;
  sort?: string;
  page?: number;
  size?: number;
}

export interface StorePackageSummary {
  name: string;
  displayName: string;
  description: string;
  latestVersion: string;
  author?: string;
  official: boolean;
  downloads: number;
  rating?: number;
  riskLevel: StoreRiskLevel;
  tags: string[];
}

export interface StorePackageVersion {
  version: string;
  status: string;
  sha256?: string;
  sizeBytes?: number;
  riskLevel: StoreRiskLevel;
  publishedAt?: string;
}

export interface StorePackageDetail extends StorePackageSummary {
  versions: StorePackageVersion[];
}

export interface StoreDownloadTicket {
  name: string;
  version: string;
  downloadUrl: string;
  sha256?: string;
  sizeBytes?: number;
  riskLevel: StoreRiskLevel;
  riskSummary?: string;
  installCommand?: string;
  verifyCommand?: string;
  recordInstallApi?: string;
}

export interface StoreInstallPlan {
  packageId?: number;
  versionId?: number;
  packageName: string;
  displayName: string;
  version: string;
  latestVersion?: string;
  installedVersion?: string;
  updateAvailable: boolean;
  installCommand?: string;
  updateCommand?: string;
  uninstallCommand?: string;
  verifyCommand?: string;
  downloadApi?: string;
  recordInstallApi?: string;
  sha256?: string;
  sizeBytes?: number;
  riskLevel: StoreRiskLevel;
  riskSummary?: string;
  manifest?: unknown;
}

export interface StoreInstallRecordResult {
  recorded: boolean;
  skippedReason?: 'missing-token';
  error?: string;
  installStatus?: string;
  installedVersion?: string;
  updateAvailable?: boolean;
  raw?: unknown;
}

export interface StoreDownloadResult {
  name: string;
  version: string;
  filePath: string;
  sha256: string;
  expectedSha256?: string;
  verified: boolean;
  riskLevel: StoreRiskLevel;
  riskSummary?: string;
  sizeBytes: number;
  installPlan?: StoreInstallPlan;
  installCommand?: string;
  verifyCommand?: string;
  recordInstallApi?: string;
}

export class StoreClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly maxDownloadBytes: number;
  private readonly retries: number;
  private readonly cacheDir: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StoreClientOptions) {
    if (!options.baseUrl || !isValidHttpUrl(options.baseUrl)) {
      throw new RoxyError('RoxyStore baseUrl 未配置或不是合法的 http(s) 地址。', {
        category: 'config',
        code: 'STORE_BASE_URL_INVALID',
        recoveryAction: 'check_config',
      });
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.cacheDir = options.cacheDir ?? join(homedir(), '.roxycode', 'cache', 'packages');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (typeof this.fetchImpl !== 'function') {
      throw new RoxyError('当前运行时不支持 fetch，无法访问 RoxyStore。请使用 Node 18+ 或提供 fetchImpl。', {
        category: 'network',
        code: 'FETCH_UNAVAILABLE',
      });
    }
  }

  async searchPackages(filters: StoreSearchFilters = {}): Promise<StorePackageSummary[]> {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.explanationStyle) params.set('explanationStyle', filters.explanationStyle);
    if (filters.riskPreference) params.set('riskPreference', filters.riskPreference);
    if (filters.characterType) params.set('characterType', filters.characterType);
    if (typeof filters.rating === 'number') params.set('rating', String(filters.rating));
    if (typeof filters.official === 'boolean') params.set('official', String(filters.official));
    if (filters.sort) params.set('sort', filters.sort);
    params.set('page', String(filters.page ?? 0));
    params.set('size', String(filters.size ?? 20));

    const body = await this.getJson(`/packages?${params.toString()}`);
    const items = extractArray(body, ['content', 'items', 'packages', 'data']);
    return items.map(normalizeSummary);
  }

  async getPackageInfo(name: string): Promise<StorePackageDetail> {
    assertPackageName(name);
    const body = await this.getJson(`/packages/${encodeURIComponent(name)}`);
    if (!isRecord(body)) {
      throw new RoxyError(`角色包详情响应格式异常：${name}`, { category: 'network', code: 'STORE_BAD_RESPONSE' });
    }
    const summary = normalizeSummary(body);
    const versionsRaw = extractArray(body, ['versions']);
    return {
      ...summary,
      versions: versionsRaw.map(normalizeVersion),
    };
  }

  async listVersions(name: string): Promise<StorePackageVersion[]> {
    assertPackageName(name);
    const body = await this.getJson(`/packages/${encodeURIComponent(name)}/versions`);
    const items = extractArray(body, ['content', 'versions', 'items', 'data']);
    return items.map(normalizeVersion);
  }

  async getInstallPlan(
    name: string,
    options: { version?: string; installedVersion?: string } = {},
  ): Promise<StoreInstallPlan> {
    assertPackageName(name);
    const params = new URLSearchParams();
    if (options.version) params.set('version', options.version);
    if (options.installedVersion) params.set('installedVersion', options.installedVersion);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const body = await this.getJson(`/packages/${encodeURIComponent(name)}/install-plan${suffix}`);
    return normalizeInstallPlan(body, name, options.version);
  }

  /**
   * 申请下载，取回预签名 URL + 期望 sha256 + 风险摘要。
   * version 省略时下载最新版（走 GET /packages/{name}/download）。
   */
  async requestDownload(name: string, version?: string): Promise<StoreDownloadTicket> {
    assertPackageName(name);
    const suffix = version ? `?version=${encodeURIComponent(version)}` : '';
    try {
      const body = await this.requestJson(`/packages/${encodeURIComponent(name)}/download${suffix}`, { method: 'GET' });
      return normalizeDownloadTicket(body, name, version);
    } catch (error) {
      if (!version || (!isHttpStatus(error, 404) && !isHttpStatus(error, 405))) throw error;
      const legacyBody = await this.requestJson(
        `/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/download`,
        { method: 'POST' },
      );
      return normalizeDownloadTicket(legacyBody, name, version);
    }
  }

  /**
   * 完整流程：申请下载 → 流式写入本地缓存 → 计算 sha256 并与期望值比对。
   * 返回本地 .roxychar 文件路径，供 CharacterPackageManager 安装。
   */
  async downloadToCache(name: string, version?: string, installedVersion?: string): Promise<StoreDownloadResult> {
    const plan = await this.tryGetInstallPlan(name, { version, installedVersion });
    const ticket = plan?.downloadApi
      ? await this.requestDownloadByApi(plan.downloadApi, plan)
      : await this.requestDownload(name, plan?.version ?? version);
    await mkdir(this.cacheDir, { recursive: true });
    const safeVersion = ticket.version.replace(/[^0-9A-Za-z.\-+]/g, '_');
    const filePath = join(this.cacheDir, `${name}-${safeVersion}.roxychar`);

    const buffer = await this.downloadBinary(ticket.downloadUrl);
    if (buffer.byteLength > this.maxDownloadBytes) {
      throw new RoxyError(`下载内容超过大小上限（${this.maxDownloadBytes} 字节）：${name}`, {
        category: 'validation',
        code: 'STORE_DOWNLOAD_TOO_LARGE',
      });
    }

    await writeFile(filePath, buffer);
    const actualSha256 = createHash('sha256').update(buffer).digest('hex');

    if (ticket.sha256 && actualSha256.toLowerCase() !== ticket.sha256.toLowerCase()) {
      await rm(filePath, { force: true });
      throw new RoxyError(
        `SHA-256 校验失败：${name}@${ticket.version}。期望 ${ticket.sha256}，实际 ${actualSha256}。文件已删除。`,
        { category: 'validation', code: 'STORE_SHA256_MISMATCH', recoverable: false },
      );
    }

    return {
      name,
      version: ticket.version,
      filePath,
      sha256: actualSha256,
      expectedSha256: ticket.sha256,
      verified: Boolean(ticket.sha256),
      riskLevel: ticket.riskLevel,
      riskSummary: ticket.riskSummary,
      sizeBytes: buffer.byteLength,
      installPlan: plan,
      installCommand: ticket.installCommand ?? plan?.installCommand,
      verifyCommand: ticket.verifyCommand ?? plan?.verifyCommand,
      recordInstallApi: ticket.recordInstallApi ?? plan?.recordInstallApi,
    };
  }

  async recordInstall(name: string, version?: string, recordInstallApi?: string): Promise<StoreInstallRecordResult> {
    assertPackageName(name);
    if (!this.token) {
      return { recorded: false, skippedReason: 'missing-token' };
    }

    const suffix = version ? `?version=${encodeURIComponent(version)}` : '';
    const path = recordInstallApi || `/packages/${encodeURIComponent(name)}/install${suffix}`;
    try {
      const body = await this.requestJson(path, { method: 'POST' });
      const raw = isRecord(body) ? body : {};
      return {
        recorded: true,
        installStatus: readString(raw, ['installStatus']) || undefined,
        installedVersion: readString(raw, ['installedVersion']) || version,
        updateAvailable: readBooleanOptional(raw, ['updateAvailable']),
        raw: body,
      };
    } catch (error) {
      return { recorded: false, error: errorText(error) };
    }
  }

  private async tryGetInstallPlan(
    name: string,
    options: { version?: string; installedVersion?: string },
  ): Promise<StoreInstallPlan | undefined> {
    try {
      return await this.getInstallPlan(name, options);
    } catch (error) {
      if (isHttpStatus(error, 404) || isHttpStatus(error, 405)) return undefined;
      throw error;
    }
  }

  private async requestDownloadByApi(path: string, plan: StoreInstallPlan): Promise<StoreDownloadTicket> {
    const body = await this.requestJson(path, { method: 'GET' });
    return normalizeDownloadTicket(body, plan.packageName, plan.version, plan);
  }

  private async downloadBinary(url: string): Promise<Buffer> {
    const response = await this.fetchWithRetry(url, {});
    if (!response.ok) {
      throw new RoxyError(`下载失败：HTTP ${response.status}`, {
        category: 'network',
        code: 'STORE_DOWNLOAD_HTTP_ERROR',
        details: { status: response.status },
      });
    }
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > this.maxDownloadBytes) {
      throw new RoxyError(`下载内容声明大小超过上限（${this.maxDownloadBytes} 字节）。`, {
        category: 'validation',
        code: 'STORE_DOWNLOAD_TOO_LARGE',
      });
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async getJson(path: string): Promise<unknown> {
    return this.requestJson(path, { method: 'GET' });
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const url = isValidHttpUrl(path)
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (init.method && init.method !== 'GET') headers['Content-Type'] = 'application/json';

    const response = await this.fetchWithRetry(url, { ...init, headers });
    const text = await response.text();
    if (!response.ok) {
      throw new RoxyError(`RoxyStore 请求失败：HTTP ${response.status} ${path}`, {
        category: response.status >= 500 ? 'network' : 'validation',
        code: 'STORE_HTTP_ERROR',
        recoveryAction: response.status >= 500 ? 'retry' : 'fix_input',
        details: { status: response.status, body: text.slice(0, 500) },
      });
    }
    if (!text.trim()) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new RoxyError(`RoxyStore 响应不是合法 JSON：${path}`, {
        category: 'network',
        code: 'STORE_BAD_JSON',
      });
    }
    return unwrapApiResponse(parsed, path);
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await this.fetchImpl(url, { ...init, signal: controller.signal });
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) {
          await delay(200 * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new RoxyError(`无法连接 RoxyStore：${errorText(lastError)}`, {
      category: 'network',
      code: 'STORE_CONNECT_FAILED',
      recoveryAction: 'retry',
      cause: lastError,
    });
  }
}

function normalizeSummary(value: unknown): StorePackageSummary {
  const raw = isRecord(value) ? value : {};
  return {
    name: readString(raw, ['name', 'packageName']),
    displayName: readString(raw, ['displayName']) || readString(raw, ['name', 'packageName']),
    description: readString(raw, ['description']),
    latestVersion: readString(raw, ['latestVersion', 'version']),
    author: readString(raw, ['author', 'authorName']) || undefined,
    official: readBoolean(raw, ['official', 'isOfficial']),
    downloads: readNumber(raw, ['downloads', 'downloadCount', 'totalDownloads']) ?? 0,
    rating: readNumber(raw, ['rating', 'ratingAverage', 'ratingAvg']),
    riskLevel: normalizeRisk(readString(raw, ['riskLevel', 'risk'])),
    tags: [
      ...readStringArray(raw, ['tags', 'keywords']),
      ...readStringArray(raw, ['categories']),
    ],
  };
}

function normalizeInstallPlan(value: unknown, fallbackName: string, fallbackVersion?: string): StoreInstallPlan {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    throw new RoxyError(`RoxyStore install plan response is invalid: ${fallbackName}`, {
      category: 'network',
      code: 'STORE_BAD_RESPONSE',
    });
  }
  const risk = isRecord(raw.risk) ? raw.risk : raw;
  const version = readString(raw, ['version']) || fallbackVersion || readString(raw, ['latestVersion']) || 'latest';
  return {
    packageId: readNumber(raw, ['packageId']),
    versionId: readNumber(raw, ['versionId']),
    packageName: readString(raw, ['packageName', 'name']) || fallbackName,
    displayName: readString(raw, ['displayName']) || fallbackName,
    version,
    latestVersion: readString(raw, ['latestVersion']) || undefined,
    installedVersion: readString(raw, ['installedVersion']) || undefined,
    updateAvailable: readBoolean(raw, ['updateAvailable']),
    installCommand: readString(raw, ['installCommand']) || undefined,
    updateCommand: readString(raw, ['updateCommand']) || undefined,
    uninstallCommand: readString(raw, ['uninstallCommand']) || undefined,
    verifyCommand: readString(raw, ['verifyCommand']) || undefined,
    downloadApi: readString(raw, ['downloadApi']) || undefined,
    recordInstallApi: readString(raw, ['recordInstallApi']) || undefined,
    sha256: normalizeSha256(readString(raw, ['sha256', 'fileSha256', 'checksum'])),
    sizeBytes: readNumber(raw, ['sizeBytes', 'size', 'fileSize']),
    riskLevel: normalizeRisk(readString(risk, ['level', 'riskLevel'])),
    riskSummary: readRiskSummary(risk),
    manifest: raw.manifest,
  };
}

function normalizeDownloadTicket(
  value: unknown,
  fallbackName: string,
  fallbackVersion?: string,
  plan?: StoreInstallPlan,
): StoreDownloadTicket {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    throw new RoxyError(`RoxyStore download response is invalid: ${fallbackName}`, {
      category: 'network',
      code: 'STORE_BAD_RESPONSE',
    });
  }

  const downloadUrl = readString(raw, ['downloadUrl', 'url', 'presignedUrl', 'signedUrl']);
  if (!downloadUrl || !isValidHttpUrl(downloadUrl)) {
    throw new RoxyError(`RoxyStore download response is missing a valid URL: ${fallbackName}`, {
      category: 'network',
      code: 'STORE_DOWNLOAD_URL_INVALID',
    });
  }

  const risk = isRecord(raw.risk) ? raw.risk : raw;
  const riskLevel = normalizeRisk(readString(risk, ['level', 'riskLevel']));
  return {
    name: readString(raw, ['packageName', 'name']) || plan?.packageName || fallbackName,
    version: readString(raw, ['version']) || plan?.version || fallbackVersion || 'latest',
    downloadUrl,
    sha256: normalizeSha256(readString(raw, ['sha256', 'fileSha256', 'checksum'])) ?? plan?.sha256,
    sizeBytes: readNumber(raw, ['sizeBytes', 'size', 'fileSize']) ?? plan?.sizeBytes,
    riskLevel: riskLevel === 'UNKNOWN' ? plan?.riskLevel ?? 'UNKNOWN' : riskLevel,
    riskSummary: readRiskSummary(risk) ?? plan?.riskSummary,
    installCommand: readString(raw, ['installCommand']) || plan?.installCommand,
    verifyCommand: readString(raw, ['verifyCommand']) || plan?.verifyCommand,
    recordInstallApi: readString(raw, ['recordInstallApi']) || plan?.recordInstallApi,
  };
}

function normalizeVersion(value: unknown): StorePackageVersion {
  const raw = isRecord(value) ? value : {};
  return {
    version: readString(raw, ['version']),
    status: readString(raw, ['status']) || 'UNKNOWN',
    sha256: normalizeSha256(readString(raw, ['sha256', 'fileSha256'])),
    sizeBytes: readNumber(raw, ['sizeBytes', 'size']),
    riskLevel: normalizeRisk(readString(raw, ['riskLevel', 'risk'])),
    publishedAt: readString(raw, ['publishedAt', 'createdAt']) || undefined,
  };
}

function normalizeRisk(value: string): StoreRiskLevel {
  const upper = value.toUpperCase();
  if (upper === 'SAFE' || upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH' || upper === 'CRITICAL') return upper;
  return 'UNKNOWN';
}

function readRiskSummary(raw: Record<string, unknown>): string | undefined {
  const summary = readString(raw, ['summary', 'message', 'description']);
  if (summary) return summary;
  const warnings = readStringArray(raw, ['warnings']);
  return warnings.length > 0 ? warnings.join('; ') : undefined;
}

function unwrapApiResponse(body: unknown, path: string): unknown {
  if (!isRecord(body) || !('code' in body) || !('message' in body)) return body;

  const code = typeof body.code === 'number' ? body.code : Number(body.code);
  if (code !== 200) {
    const message = readString(body, ['message']) || `code ${body.code}`;
    throw new RoxyError(`RoxyStore API request failed: ${message}`, {
      category: code >= 500 ? 'network' : 'validation',
      code: 'STORE_API_ERROR',
      details: { code: body.code, message, path },
    });
  }
  return body.data ?? {};
}

function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof RoxyError && error.details?.status === status;
}

function normalizeSha256(value: string): string | undefined {
  return SHA256_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function assertPackageName(name: string): void {
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new RoxyError(`角色包名称必须为 kebab-case：${name}`, {
      category: 'validation',
      code: 'STORE_INVALID_NAME',
      recoveryAction: 'fix_input',
    });
  }
}

function extractArray(body: unknown, keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (isRecord(body)) {
    for (const key of keys) {
      if (Array.isArray(body[key])) return body[key] as unknown[];
    }
  }
  return [];
}

function readString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function readNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readBoolean(obj: Record<string, unknown>, keys: string[]): boolean {
  return readBooleanOptional(obj, keys) ?? false;
}

function readBooleanOptional(obj: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof obj[key] === 'boolean') return obj[key] as boolean;
  }
  return undefined;
}

function readStringArray(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
