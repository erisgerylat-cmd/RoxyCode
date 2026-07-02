import { resolve } from 'node:path';
import type { ToolExecutionContext } from '../types.js';

export interface FileReadRecord {
  path: string;
  content: string;
  mtimeMs: number;
  size: number;
  isPartialView: boolean;
  offset?: number;
  limit?: number;
  totalLines?: number;
  readAt: number;
}

export class FileReadState {
  private readonly records = new Map<string, FileReadRecord>();

  record(input: Omit<FileReadRecord, 'path' | 'readAt'> & { path: string; readAt?: number }): FileReadRecord {
    const record: FileReadRecord = {
      ...input,
      path: normalizePath(input.path),
      readAt: input.readAt ?? Date.now(),
    };
    this.records.set(record.path, record);
    return record;
  }

  get(path: string): FileReadRecord | undefined {
    return this.records.get(normalizePath(path));
  }

  clear(path?: string): void {
    if (path) {
      this.records.delete(normalizePath(path));
      return;
    }
    this.records.clear();
  }

  snapshot(): FileReadRecord[] {
    return Array.from(this.records.values()).map(record => ({ ...record }));
  }
}

export function createFileReadState(): FileReadState {
  return new FileReadState();
}

export function ensureFileReadState(ctx: ToolExecutionContext): FileReadState {
  if (!ctx.fileReadState) ctx.fileReadState = createFileReadState();
  return ctx.fileReadState;
}

function normalizePath(path: string): string {
  return resolve(path);
}
