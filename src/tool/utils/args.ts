import { relative, resolve } from 'node:path';
import type { ToolExecutionContext } from '../types.js';

export function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`Argument ${key} must be string`);
  return value;
}

export function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Argument ${key} must be string`);
  return value;
}

export function optionalNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') throw new Error(`Argument ${key} must be number`);
  return value;
}

export function optionalBooleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Argument ${key} must be boolean`);
  return value;
}

export function resolveToolPath(ctx: ToolExecutionContext, inputPath: string): string {
  return resolve(ctx.cwd, inputPath);
}

export function relativeToCwd(ctx: ToolExecutionContext, inputPath: string): string {
  const rel = relative(ctx.cwd, inputPath);
  return rel || '.';
}

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars]`, truncated: true };
}

export function okBody(title: string, lines: string[]): string {
  return [`${title}`, ...lines.map(line => `- ${line}`)].join('\n');
}
