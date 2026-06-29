import { spawn } from 'node:child_process';
import type { ToolExecutionContext } from '../types.js';

export interface CommandOutput {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runCommand(command: string, args: string[], ctx: ToolExecutionContext, options: { timeoutMs?: number } = {}): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    ctx.signal?.addEventListener('abort', () => {
      child.kill('SIGTERM');
    }, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', exitCode => {
      clearTimeout(timer);
      resolve({ command: [command, ...args].join(' '), exitCode, stdout, stderr, timedOut });
    });
  });
}
