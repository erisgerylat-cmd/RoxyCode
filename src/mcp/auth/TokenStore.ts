import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
}

export interface StoredOAuthTokenSet extends OAuthTokenSet {
  serverName: string;
  updatedAt: string;
}

export interface TokenStoreBackend {
  load(serverName: string): Promise<StoredOAuthTokenSet | null>;
  save(serverName: string, tokens: OAuthTokenSet): Promise<StoredOAuthTokenSet>;
  delete(serverName: string): Promise<void>;
  list(): Promise<StoredOAuthTokenSet[]>;
}

export class TokenStore implements TokenStoreBackend {
  private readonly path: string;

  constructor(path: string = join(homedir(), '.roxycode', 'mcp-tokens.json')) {
    this.path = path;
  }

  async load(serverName: string): Promise<StoredOAuthTokenSet | null> {
    const data = await this.readAll();
    return data[normalizeServerName(serverName)] ?? null;
  }

  async save(serverName: string, tokens: OAuthTokenSet): Promise<StoredOAuthTokenSet> {
    const data = await this.readAll();
    const key = normalizeServerName(serverName);
    const stored: StoredOAuthTokenSet = {
      ...tokens,
      tokenType: tokens.tokenType ?? 'Bearer',
      serverName: key,
      updatedAt: new Date().toISOString(),
    };
    data[key] = stored;
    await this.writeAll(data);
    return stored;
  }

  async delete(serverName: string): Promise<void> {
    const data = await this.readAll();
    delete data[normalizeServerName(serverName)];
    await this.writeAll(data);
  }

  async list(): Promise<StoredOAuthTokenSet[]> {
    return Object.values(await this.readAll());
  }

  private async readAll(): Promise<Record<string, StoredOAuthTokenSet>> {
    if (!existsSync(this.path)) return {};
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, StoredOAuthTokenSet> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (isStoredToken(value)) out[key] = value;
      }
      return out;
    } catch {
      return {};
    }
  }

  private async writeAll(data: Record<string, StoredOAuthTokenSet>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.path);
  }
}

export function isTokenExpired(tokens: OAuthTokenSet | null, skewMs = 60_000): boolean {
  if (!tokens?.accessToken) return true;
  if (!tokens.expiresAt) return false;
  return Date.now() + skewMs >= tokens.expiresAt;
}

function normalizeServerName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'mcp';
}

function isStoredToken(value: unknown): value is StoredOAuthTokenSet {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as StoredOAuthTokenSet).serverName === 'string'
    && typeof (value as StoredOAuthTokenSet).accessToken === 'string'
    && typeof (value as StoredOAuthTokenSet).updatedAt === 'string';
}