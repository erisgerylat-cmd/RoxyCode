import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { Tool, ToolExecutionContext } from '../types.js';

export interface BackupRecord {
  source: string;
  backupPath: string;
  bytes: number;
}

export async function backupAffectedFiles(tool: Tool, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<BackupRecord[]> {
  if (tool.isReadOnly || !ctx.config.security.fileAccess.backupBeforeWrite) return [];

  const affectedPaths = tool.getAffectedPaths?.(args, ctx) ?? [];
  if (affectedPaths.length === 0) return [];

  const backupRoot = join(resolve(ctx.cwd), '.roxycode', 'backups', timestamp());
  const records: BackupRecord[] = [];

  for (const affectedPath of affectedPaths) {
    const source = resolve(ctx.cwd, affectedPath);
    const fileStat = await stat(source).catch(() => null);
    if (!fileStat?.isFile()) continue;

    const relativePath = relative(resolve(ctx.cwd), source);
    const backupPath = join(backupRoot, `${sanitizeRelativePath(relativePath)}.bak`);
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(source, backupPath);
    records.push({ source, backupPath, bytes: fileStat.size });
  }

  return records;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replaceAll('/', '__');
}
