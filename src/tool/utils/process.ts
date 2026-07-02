import { spawn } from 'node:child_process';
import type { ToolExecutionContext } from '../types.js';
import { throwIfAborted } from './abort.js';

export interface CommandOutput {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted?: boolean;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export function runCommand(command: string, args: string[], ctx: ToolExecutionContext, options: RunCommandOptions = {}): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    try {
      throwIfAborted(ctx);
    } catch (error) {
      reject(error);
      return;
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    const child = spawn(command, args, {
      cwd: ctx.cwd,
      env: { ...process.env, ...ctx.env },
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    const cleanup = () => {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      const text = String(chunk);
      stdout += text;
      options.onOutput?.('stdout', text);
    });
    child.stderr.on('data', chunk => {
      const text = String(chunk);
      stderr += text;
      options.onOutput?.('stderr', text);
    });
    child.on('error', error => {
      cleanup();
      reject(error);
    });
    child.on('close', exitCode => {
      cleanup();
      resolve({ command: [command, ...args].join(' '), exitCode, stdout, stderr, timedOut, aborted });
    });
  });
}
