import { existsSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve } from 'node:path';

export interface PluginSandboxOptions {
  pluginRoot: string;
  allowedPaths?: string[];
  allowNetworkAccess?: boolean;
  allowedHosts?: string[];
}

export interface PathValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Plugin 沙箱机制 - 限制插件的文件访问和网络访问
 */
export class PluginSandbox {
  private readonly pluginRoot: string;
  private readonly allowedPaths: Set<string>;
  private readonly allowNetworkAccess: boolean;
  private readonly allowedHosts: Set<string>;

  constructor(options: PluginSandboxOptions) {
    this.pluginRoot = normalize(resolve(options.pluginRoot));
    this.allowedPaths = new Set([
      this.pluginRoot,
      ...(options.allowedPaths?.map(p => normalize(resolve(p))) ?? []),
    ]);
    this.allowNetworkAccess = options.allowNetworkAccess ?? false;
    this.allowedHosts = new Set(options.allowedHosts ?? []);
  }

  /**
   * 验证路径是否在沙箱允许范围内
   */
  validatePath(requestedPath: string): PathValidationResult {
    const normalized = normalize(resolve(requestedPath));

    for (const allowedPath of this.allowedPaths) {
      if (isPathInside(allowedPath, normalized)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `Plugin can only access files within ${this.pluginRoot} or explicitly allowed paths.`,
    };
  }

  /**
   * 验证网络访问是否允许
   */
  validateNetworkAccess(url: string): PathValidationResult {
    if (!this.allowNetworkAccess) {
      return {
        allowed: false,
        reason: 'Plugin does not have network access permission.',
      };
    }

    // 如果指定了允许的主机列表，检查 URL 是否匹配
    if (this.allowedHosts.size > 0) {
      try {
        const parsed = new URL(url);
        const isAllowed = this.allowedHosts.has(parsed.hostname) ||
                         this.allowedHosts.has(`${parsed.hostname}:${parsed.port}`);

        if (!isAllowed) {
          return {
            allowed: false,
            reason: `Plugin can only access allowed hosts: ${Array.from(this.allowedHosts).join(', ')}`,
          };
        }
      } catch {
        return { allowed: false, reason: 'Invalid URL.' };
      }
    }

    return { allowed: true };
  }

  /**
   * 获取相对于插件根目录的安全路径
   */
  getRelativePath(absolutePath: string): string {
    return relative(this.pluginRoot, normalize(resolve(absolutePath)));
  }

  /**
   * 检查路径是否存在且在沙箱内
   */
  async validateAndCheckExists(requestedPath: string): Promise<PathValidationResult> {
    const validation = this.validatePath(requestedPath);
    if (!validation.allowed) return validation;

    const normalized = normalize(resolve(requestedPath));
    if (!existsSync(normalized)) {
      return { allowed: false, reason: 'Path does not exist.' };
    }

    return { allowed: true };
  }
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const rel = relative(basePath, targetPath);
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel));
}
