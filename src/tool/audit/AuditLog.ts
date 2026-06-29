import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ToolAuditRecord } from '../types.js';

export class AuditLog {
  constructor(private readonly cwd: string = process.cwd()) {}

  getPath(): string {
    return join(this.cwd, '.roxycode', 'audit', 'tools.jsonl');
  }

  async record(record: ToolAuditRecord): Promise<void> {
    const path = this.getPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf-8');
  }
}
