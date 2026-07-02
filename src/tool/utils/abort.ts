import type { ToolExecutionContext } from '../types.js';

export function throwIfAborted(ctx: ToolExecutionContext): void {
  if (!ctx.signal?.aborted) return;
  const reason = ctx.signal.reason;
  const message = typeof reason === 'string' && reason.trim()
    ? `Tool execution aborted: ${reason}`
    : 'Tool execution aborted.';
  const error = new Error(message);
  error.name = 'AbortError';
  throw error;
}