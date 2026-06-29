import { spawn } from 'node:child_process';
import type { LLMProvider } from '../core/types/llm.js';
import { systemMessage, userMessage } from '../core/types/message.js';
import type { HookExecutionRecord, HookRunPayload, HookRunResult, RoxyHookDefinition, RoxyHookEvent } from './types.js';

export interface HookManagerOptions {
  hooks: RoxyHookDefinition[];
  llmProvider?: LLMProvider;
  signal?: AbortSignal;
}

export class HookManager {
  private hooks: RoxyHookDefinition[];
  private readonly llmProvider?: LLMProvider;
  private readonly signal?: AbortSignal;

  constructor(options: HookManagerOptions) {
    this.hooks = options.hooks;
    this.llmProvider = options.llmProvider;
    this.signal = options.signal;
  }

  setHooks(hooks: RoxyHookDefinition[]): void {
    this.hooks = hooks;
  }

  list(): RoxyHookDefinition[] {
    return [...this.hooks];
  }

  async run(event: RoxyHookEvent, payload: HookRunPayload): Promise<HookRunResult> {
    const matched = this.hooks.filter(hook => hook.enabled !== false && hook.event === event && matches(hook, payload));
    const additionalContexts: string[] = [];
    const executions: HookExecutionRecord[] = [];

    for (const hook of matched) {
      const started = Date.now();
      try {
        const result = await this.executeHook(hook, payload);
        const record: HookExecutionRecord = {
          hookId: hook.id,
          event,
          kind: hook.kind,
          outcome: result.blocked ? 'blocked' : 'success',
          duration: Date.now() - started,
          message: result.reason,
          additionalContext: result.additionalContexts.join('\n'),
        };
        executions.push(record);
        additionalContexts.push(...result.additionalContexts);
        if (result.blocked) return { blocked: true, reason: result.reason, additionalContexts, executions };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        executions.push({ hookId: hook.id, event, kind: hook.kind, outcome: 'error', duration: Date.now() - started, message });
        if (hook.blocking) return { blocked: true, reason: message, additionalContexts, executions };
      }
    }

    return { blocked: false, additionalContexts, executions };
  }

  private async executeHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    switch (hook.kind) {
      case 'command':
        return this.executeCommandHook(hook, payload);
      case 'prompt':
        return this.executePromptHook(hook, payload);
      case 'http':
        return this.executeHttpHook(hook, payload);
      case 'agent':
        return this.executeAgentHook(hook, payload);
    }
  }

  private async executeCommandHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.command) throw new Error('Command hook requires command.');
    const output = await runProcess(hook.command, hook.args ?? [], payload.cwd, hook.timeoutMs ?? 15_000, this.signal);
    const ok = output.exitCode === 0 && !output.timedOut;
    if (!ok && hook.blocking) {
      return { blocked: true, reason: `Hook command failed: ${output.stderr || output.stdout || output.exitCode}`, additionalContexts: [], executions: [] };
    }
    const context = output.stdout.trim() ? [`[hook:${hook.id}]\n${output.stdout.trim()}`] : [];
    return { blocked: false, additionalContexts: context, executions: [] };
  }

  private async executePromptHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.prompt) throw new Error('Prompt hook requires prompt.');
    if (!this.llmProvider) return { blocked: false, additionalContexts: [renderTemplate(hook.prompt, payload)], executions: [] };
    const prompt = renderTemplate(hook.prompt, payload);
    const response = await this.llmProvider.chat({
      messages: [
        systemMessage(payload.language === 'en-US'
          ? 'You are running a RoxyCode prompt hook. Return concise additional context or a blocking reason.'
          : '你正在执行 RoxyCode Prompt Hook。请返回简洁的补充上下文；如果需要阻断，请说明原因。'),
        userMessage(prompt),
      ],
      signal: this.signal,
    });
    return { blocked: false, additionalContexts: [`[hook:${hook.id}]\n${response.text.trim()}`], executions: [] };
  }

  private async executeHttpHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.url) throw new Error('HTTP hook requires url.');
    const parsed = new URL(hook.url);
    if (parsed.protocol !== 'https:' && !(hook.allowInsecureHttp && isLocalhost(parsed.hostname))) {
      throw new Error('HTTP Hook 默认只允许 https，localhost 调试需设置 allowInsecureHttp=true。');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), hook.timeoutMs ?? 15_000);
    const abort = () => controller.abort();
    this.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(hook.headers ?? {}) },
        body: JSON.stringify({ hook: hook.id, event: hook.event, payload }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok && hook.blocking) return { blocked: true, reason: `HTTP hook failed: ${response.status} ${text}`, additionalContexts: [], executions: [] };
      return { blocked: false, additionalContexts: text.trim() ? [`[hook:${hook.id}]\n${text.trim()}`] : [], executions: [] };
    } finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener('abort', abort);
    }
  }

  private async executeAgentHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.prompt) throw new Error('Agent hook requires prompt.');
    const rendered = renderTemplate(hook.prompt, payload);
    const context = payload.language === 'en-US'
      ? `[hook:${hook.id}] Agent hook task queued as context:\n${rendered}`
      : `[hook:${hook.id}] Agent Hook 已作为上下文注入：\n${rendered}`;
    return { blocked: false, additionalContexts: [context], executions: [] };
  }
}

function matches(hook: RoxyHookDefinition, payload: HookRunPayload): boolean {
  if (!hook.matcher) return true;
  const target = payload.toolName ?? payload.commandName ?? payload.userInput ?? '';
  if (!target) return false;
  if (hook.matcher.startsWith('/') && hook.matcher.endsWith('/')) {
    try { return new RegExp(hook.matcher.slice(1, -1)).test(target); } catch { return false; }
  }
  return target.includes(hook.matcher);
}

function renderTemplate(template: string, payload: HookRunPayload): string {
  const data = JSON.stringify(payload, null, 2);
  return template
    .replace(/\$ARGUMENTS/g, data)
    .replace(/\{\{input\}\}/g, payload.userInput ?? '')
    .replace(/\{\{tool\}\}/g, payload.toolName ?? '')
    .replace(/\{\{command\}\}/g, payload.commandName ?? '')
    .replace(/\{\{cwd\}\}/g, payload.cwd);
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', exitCode => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function isLocalhost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}