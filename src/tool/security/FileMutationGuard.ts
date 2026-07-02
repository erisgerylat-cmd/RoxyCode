import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolExecutionContext } from '../types.js';
import { ensureFileReadState } from './FileReadState.js';

export interface FileSnapshot {
  path: string;
  exists: boolean;
  content: string;
  mtimeMs: number;
  size: number;
}

export interface MutationValidation {
  snapshot: FileSnapshot;
  error: string | null;
}

export async function readFileSnapshot(path: string): Promise<FileSnapshot> {
  const absolutePath = resolve(path);
  try {
    const content = await readFile(absolutePath, 'utf8');
    const fileStat = await stat(absolutePath);
    return {
      path: absolutePath,
      exists: fileStat.isFile(),
      content,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return {
        path: absolutePath,
        exists: false,
        content: '',
        mtimeMs: 0,
        size: 0,
      };
    }
    throw error;
  }
}

export async function validateReadBeforeMutation(path: string, ctx: ToolExecutionContext): Promise<MutationValidation> {
  const snapshot = await readFileSnapshot(path);
  if (!snapshot.exists) return { snapshot, error: null };

  const record = ctx.fileReadState?.get(snapshot.path);
  if (!record) {
    return { snapshot, error: text(ctx, 'existingFileNotRead') };
  }

  if (record.isPartialView) {
    return { snapshot, error: text(ctx, 'partialRead') };
  }

  if (snapshot.mtimeMs > record.mtimeMs + 1 && snapshot.content !== record.content) {
    return { snapshot, error: text(ctx, 'modifiedSinceRead') };
  }

  return { snapshot, error: null };
}

export async function recordFullFileState(path: string, content: string, ctx: ToolExecutionContext): Promise<void> {
  const fileStat = await stat(path);
  ensureFileReadState(ctx).record({
    path,
    content,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    isPartialView: false,
  });
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT';
}

function text(ctx: ToolExecutionContext, key: 'existingFileNotRead' | 'partialRead' | 'modifiedSinceRead'): string {
  const en = ctx.language === 'en-US';
  if (en) {
    switch (key) {
      case 'existingFileNotRead':
        return 'Existing file has not been read yet. Read it with read_file before writing or editing it.';
      case 'partialRead':
        return 'Only part of this file was read. Read the full file before writing or editing it.';
      case 'modifiedSinceRead':
        return 'File has changed since it was read. Read it again before writing or editing it.';
    }
  }

  switch (key) {
    case 'existingFileNotRead':
      return '\u73b0\u6709\u6587\u4ef6\u5c1a\u672a\u8bfb\u53d6\u3002\u8bf7\u5148\u7528 read_file \u8bfb\u53d6\u5b8c\u6574\u6587\u4ef6\uff0c\u518d\u5199\u5165\u6216\u7f16\u8f91\u3002';
    case 'partialRead':
      return '\u4f60\u53ea\u8bfb\u53d6\u4e86\u6587\u4ef6\u7684\u4e00\u90e8\u5206\u3002\u5199\u5165\u6216\u7f16\u8f91\u524d\u9700\u8981\u5148\u8bfb\u53d6\u5b8c\u6574\u6587\u4ef6\u3002';
    case 'modifiedSinceRead':
      return '\u6587\u4ef6\u5728\u8bfb\u53d6\u540e\u5df2\u88ab\u7528\u6237\u3001\u683c\u5f0f\u5316\u5668\u6216\u5176\u4ed6\u8fdb\u7a0b\u4fee\u6539\u3002\u8bf7\u91cd\u65b0\u8bfb\u53d6\u540e\u518d\u5199\u5165\u6216\u7f16\u8f91\u3002';
  }
}
