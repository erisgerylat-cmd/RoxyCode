import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export interface PathBoundaryResult {
  allowed: boolean;
  resolvedPath: string;
  reason?: string;
}

export interface DangerousPathResult {
  dangerous: boolean;
  reasons: string[];
  paths: string[];
}

const DANGEROUS_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.gitconfig',
  '.gitmodules',
  '.mcp.json',
  '.npmrc',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  'settings.json',
  'settings.local.json',
]);

const DANGEROUS_DIRECTORIES = new Set([
  '.git',
  '.claude',
  '.roxycode',
  '.vscode',
  '.idea',
  '.ssh',
]);

export function checkProjectBoundary(cwd: string, inputPath: string): PathBoundaryResult {
  const projectRoot = resolve(cwd);
  const resolvedPath = resolve(cwd, inputPath);
  const rel = relative(projectRoot, resolvedPath);
  const allowed = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  return allowed
    ? { allowed: true, resolvedPath }
    : { allowed: false, resolvedPath, reason: `路径超出当前项目目录: ${resolvedPath}` };
}

export function inspectDangerousPaths(cwd: string, paths: string[]): DangerousPathResult {
  const reasons: string[] = [];
  const dangerousPaths: string[] = [];

  for (const inputPath of paths) {
    const resolvedPath = resolve(cwd, inputPath);
    const segments = relative(resolve(cwd), resolvedPath)
      .split(/[\\/]+/)
      .filter(Boolean)
      .map(segment => normalizeForComparison(segment));
    const fileName = normalizeForComparison(basename(resolvedPath));

    const dangerousDirectory = segments.find(segment => DANGEROUS_DIRECTORIES.has(segment));
    const dangerousFile = DANGEROUS_FILES.has(fileName);

    if (dangerousDirectory || dangerousFile) {
      dangerousPaths.push(resolvedPath);
      if (dangerousDirectory) {
        reasons.push(`命中了敏感目录 ${dangerousDirectory}${sep}，这里通常保存配置、权限或版本控制数据。`);
      }
      if (dangerousFile) {
        reasons.push(`命中了敏感文件 ${fileName}，这里可能包含密钥、执行配置或代理权限规则。`);
      }
    }
  }

  return {
    dangerous: dangerousPaths.length > 0,
    reasons: [...new Set(reasons)],
    paths: [...new Set(dangerousPaths)],
  };
}

export function normalizeForComparison(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase();
}
