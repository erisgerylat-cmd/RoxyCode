import { createHash, randomBytes } from 'node:crypto';
import type { McpServerDefinition, McpOAuthConfig } from '../types.js';
import { TokenStore, isTokenExpired, type OAuthTokenSet, type TokenStoreBackend } from './TokenStore.js';

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export interface OAuthAuthorizationRequest {
  authorizationUrl: string;
  verifier: string;
  state: string;
  redirectUri: string;
}

export interface OAuthFlowOptions {
  tokenStore?: TokenStoreBackend;
  fetchFn?: typeof fetch;
}

type ResolvedOAuthConfig = McpOAuthConfig & { clientId: string };

export class OAuthFlow {
  private readonly tokenStore: TokenStoreBackend;
  private readonly fetchFn: typeof fetch;

  constructor(options: OAuthFlowOptions = {}) {
    this.tokenStore = options.tokenStore ?? new TokenStore();
    this.fetchFn = options.fetchFn ?? fetch;
  }

  createAuthorizationRequest(server: McpServerDefinition, options: { redirectUri?: string; state?: string; scope?: string } = {}): OAuthAuthorizationRequest {
    const oauth = requireOAuth(server);
    const endpoints = getOAuthEndpoints(server, oauth);
    const pkce = createPkcePair();
    const state = options.state ?? base64Url(randomBytes(24));
    const redirectUri = options.redirectUri ?? defaultRedirectUri(oauth);
    const url = new URL(endpoints.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', oauth.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', pkce.method);
    url.searchParams.set('state', state);
    const scope = options.scope ?? oauth.scope;
    if (scope) url.searchParams.set('scope', scope);
    return { authorizationUrl: url.toString(), verifier: pkce.verifier, state, redirectUri };
  }

  async exchangeAuthorizationCode(server: McpServerDefinition, code: string, verifier: string, redirectUri: string): Promise<OAuthTokenSet> {
    const oauth = requireOAuth(server);
    const endpoints = getOAuthEndpoints(server, oauth);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: oauth.clientId,
      code_verifier: verifier,
    });
    if (oauth.clientSecret) body.set('client_secret', oauth.clientSecret);
    const tokens = await this.postToken(endpoints.tokenEndpoint, body);
    await this.tokenStore.save(server.name, tokens);
    return tokens;
  }

  async refresh(server: McpServerDefinition, refreshToken: string): Promise<OAuthTokenSet> {
    const oauth = requireOAuth(server);
    const endpoints = getOAuthEndpoints(server, oauth);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oauth.clientId,
    });
    if (oauth.clientSecret) body.set('client_secret', oauth.clientSecret);
    const tokens = await this.postToken(endpoints.tokenEndpoint, body);
    if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
    await this.tokenStore.save(server.name, tokens);
    return tokens;
  }

  async getValidToken(server: McpServerDefinition): Promise<OAuthTokenSet | null> {
    if (!server.oauth) return null;
    const stored = await this.tokenStore.load(server.name);
    if (!stored) return null;
    if (!isTokenExpired(stored)) return stored;
    if (!stored.refreshToken) return stored;
    return this.refresh(server, stored.refreshToken).catch(() => stored);
  }

  private async postToken(endpoint: string, body: URLSearchParams): Promise<OAuthTokenSet> {
    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`OAuth token endpoint returned non-JSON response: ${endpoint}`);
    }
    if (!response.ok) {
      const message = isRecord(parsed) && typeof parsed.error_description === 'string'
        ? parsed.error_description
        : isRecord(parsed) && typeof parsed.error === 'string'
          ? parsed.error
          : response.statusText;
      throw new Error(`OAuth token request failed: ${response.status} ${message}`);
    }
    return normalizeTokenResponse(parsed);
  }
}

export async function getMcpAuthorizationHeader(server: McpServerDefinition, tokenStore: TokenStoreBackend = new TokenStore()): Promise<string | undefined> {
  if (server.oauth) {
    const flow = new OAuthFlow({ tokenStore });
    const token = await flow.getValidToken(server);
    if (token?.accessToken) return `${token.tokenType ?? 'Bearer'} ${token.accessToken}`;
  }
  return undefined;
}

export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

function normalizeTokenResponse(value: unknown): OAuthTokenSet {
  if (!isRecord(value) || typeof value.access_token !== 'string') {
    throw new Error('OAuth token response missing access_token.');
  }
  const expiresIn = typeof value.expires_in === 'number' ? value.expires_in : undefined;
  return {
    accessToken: value.access_token,
    refreshToken: typeof value.refresh_token === 'string' ? value.refresh_token : undefined,
    tokenType: typeof value.token_type === 'string' ? value.token_type : 'Bearer',
    scope: typeof value.scope === 'string' ? value.scope : undefined,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

function getOAuthEndpoints(server: McpServerDefinition, oauth: McpOAuthConfig): { authorizationEndpoint: string; tokenEndpoint: string } {
  if (oauth.authorizationUrl && oauth.tokenUrl) return { authorizationEndpoint: oauth.authorizationUrl, tokenEndpoint: oauth.tokenUrl };
  const base = oauth.issuerUrl ?? oauth.authServerMetadataUrl ?? server.url;
  if (!base) throw new Error(`OAuth server requires issuerUrl/authServerMetadataUrl or MCP server url: ${server.name}`);
  const url = new URL(base);
  const root = `${url.protocol}//${url.host}`;
  return {
    authorizationEndpoint: oauth.authorizationUrl ?? `${root}/authorize`,
    tokenEndpoint: oauth.tokenUrl ?? `${root}/token`,
  };
}

function requireOAuth(server: McpServerDefinition): ResolvedOAuthConfig {
  if (!server.oauth) throw new Error(`MCP server has no OAuth config: ${server.name}`);
  if (!server.oauth.clientId) throw new Error(`MCP OAuth config requires clientId: ${server.name}`);
  return server.oauth as ResolvedOAuthConfig;
}

function defaultRedirectUri(oauth: McpOAuthConfig): string {
  const port = oauth.callbackPort ?? 0;
  return port > 0 ? `http://127.0.0.1:${port}/callback` : 'http://127.0.0.1/callback';
}

function base64Url(data: Buffer): string {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
