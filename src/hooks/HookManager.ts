import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { LLMProvider } from '../core/types/llm.js';
import { systemMessage, userMessage } from '../core/types/message.js';
import type { CharacterBehavior } from '../aesthetic/character/types.js';
import { createPluginSandboxGuard, renderPluginVariables } from '../plugin/PluginVariables.js';
import type {
  HookExecutionRecord,
  HookProtocolOutput,
  HookRunPayload,
  HookRunResult,
  RoxyHookDefinition,
  RoxyHookEvent,
} from './types.js';
import type { RuntimeHookRunInput } from '../runtime/index.js';

const DEFAULT_HOOK_TIMEOUT_MS = 15_000;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_RECORD_OUTPUT_CHARS = 1_000;

export interface HookManagerOptions {
  hooks: RoxyHookDefinition[];
  llmProvider?: LLMProvider;
  signal?: AbortSignal;
  onRun?: (record: RuntimeHookRunInput) => void;
}

export class HookManager {
  private hooks: RoxyHookDefinition[];
  private readonly llmProvider?: LLMProvider;
  private readonly signal?: AbortSignal;
  private readonly onRun?: (record: RuntimeHookRunInput) => void;

  constructor(options: HookManagerOptions) {
    this.hooks = options.hooks;
    this.llmProvider = options.llmProvider;
    this.signal = options.signal;
    this.onRun = options.onRun;
  }

  setHooks(hooks: RoxyHookDefinition[]): void {
    this.hooks = hooks;
  }

  list(): RoxyHookDefinition[] {
    return [...this.hooks];
  }

  async run(event: RoxyHookEvent, payload: HookRunPayload): Promise<HookRunResult> {
    const startedRun = Date.now();
    const matched = this.hooks.filter(hook => hook.enabled !== false && hook.event === event && matches(hook, payload));
    const additionalContexts: string[] = [];
    const executions: HookExecutionRecord[] = [];
    let finalResult: HookRunResult | null = null;
    let updatedInput: Record<string, unknown> | undefined;

    try {
      for (const hook of matched) {
        const started = Date.now();
        try {
          const result = await this.executeHook(hook, payload);
          const record = buildExecutionRecord(hook, event, result, Date.now() - started);
          executions.push(record);
          additionalContexts.push(...result.additionalContexts);
          if (result.updatedInput) updatedInput = mergeUpdatedInput(event, payload, updatedInput, result.updatedInput);
          if (result.blocked) {
            finalResult = { blocked: true, reason: result.reason, additionalContexts, updatedInput, executions };
            return finalResult;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          executions.push({
            hookId: hook.id,
            event,
            kind: hook.kind,
            outcome: 'error',
            duration: Date.now() - started,
            message,
            source: hook.source,
            statusMessage: hook.statusMessage,
          });
          if (hook.blocking) {
            finalResult = { blocked: true, reason: message, additionalContexts, updatedInput, executions };
            return finalResult;
          }
        }
      }

      finalResult = { blocked: false, additionalContexts, updatedInput, executions };
      return finalResult;
    } finally {
      const result = finalResult ?? { blocked: false, additionalContexts, updatedInput, executions };
      this.onRun?.({
        event,
        matched: matched.length,
        duration: Date.now() - startedRun,
        blocked: result.blocked,
        reason: result.reason,
        executions,
      });
    }
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
      case 'character':
        return this.executeCharacterHook(hook, payload);
    }
  }

  private async executeCommandHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.command) throw new Error('Command hook requires command.');
    const command = renderHookPluginVariables(hook, hook.command, `hook ${hook.id} command`);
    const args = (hook.args ?? []).map((arg, index) => renderHookPluginVariables(hook, arg, `hook ${hook.id} arg ${index + 1}`));
    assertPluginHookCommandAllowed(hook, command);
    const cwd = hook.pluginSandbox?.pluginRoot ?? payload.cwd;
    const output = await runProcess(command, args, cwd, hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS, this.signal, getPluginHookEnv(hook));
    const protocol = parseHookProtocolOutput(output.stdout);
    const contexts = contextsFromOutput(hook, output.stdout, protocol);
    const reason = protocol?.reason ?? protocol?.stopReason ?? trimForRecord(output.stderr || output.stdout || String(output.exitCode));
    const blocked = protocolBlocks(protocol) || (hook.blocking === true && (output.exitCode !== 0 || output.timedOut));

    return {
      blocked,
      reason: blocked ? reason : undefined,
      additionalContexts: contexts,
      updatedInput: protocolUpdatedInput(protocol),
      executions: [{
        hookId: hook.id,
        event: hook.event,
        kind: hook.kind,
        outcome: blocked ? 'blocked' : output.exitCode === 0 && !output.timedOut ? 'success' : 'error',
        duration: output.durationMs,
        message: blocked ? reason : output.timedOut ? 'Hook command timed out.' : output.exitCode === 0 ? undefined : `Hook command exited with ${output.exitCode}`,
        exitCode: output.exitCode,
        timedOut: output.timedOut,
        stdout: trimForRecord(output.stdout),
        stderr: trimForRecord(output.stderr),
        additionalContext: contexts.join('\n'),
        source: hook.source,
        statusMessage: hook.statusMessage,
      }],
    };
  }

  private async executePromptHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.prompt) throw new Error('Prompt hook requires prompt.');
    const prompt = renderHookTemplate(hook, hook.prompt, payload);
    if (!this.llmProvider) {
      return { blocked: false, additionalContexts: [`[hook:${hook.id}]\n${truncateContext(prompt)}`], executions: [] };
    }
    const response = await this.llmProvider.chat({
      messages: [
        systemMessage(payload.language === 'en-US'
          ? 'You are running a RoxyCode prompt hook. Return concise additional context or a blocking reason.'
          : '你正在执行 RoxyCode Prompt Hook。请返回简洁的补充上下文；如果需要阻断，请说明原因。'),
        userMessage(prompt),
      ],
      signal: this.signal,
    });
    const protocol = parseHookProtocolOutput(response.text);
    const contexts = contextsFromOutput(hook, response.text, protocol);
    return {
      blocked: protocolBlocks(protocol),
      reason: protocol?.reason ?? protocol?.stopReason,
      additionalContexts: contexts,
      updatedInput: protocolUpdatedInput(protocol),
      executions: [],
    };
  }

  private async executeHttpHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.url) throw new Error('HTTP hook requires url.');
    const url = renderHookPluginVariables(hook, hook.url, `hook ${hook.id} url`);
    assertPluginHookNetworkAllowed(hook, url);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(hook.allowInsecureHttp && isLocalhost(parsed.hostname))) {
      throw new Error('HTTP Hook 默认只允许 https；localhost 调试必须设置 allowInsecureHttp=true。');
    }
    assertNoUnsafeHost(parsed);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS);
    const abort = () => controller.abort();
    this.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...sanitizeHeaders(renderHookHeaders(hook), new Set(hook.allowedEnvVars ?? [])) },
        body: JSON.stringify({ hook: hook.id, event: hook.event, payload }),
        signal: controller.signal,
        redirect: 'error',
      });
      const text = await response.text();
      const protocol = parseHookProtocolOutput(text);
      const contexts = contextsFromOutput(hook, text, protocol);
      const blocked = protocolBlocks(protocol) || (!response.ok && hook.blocking === true);
      return {
        blocked,
        reason: blocked ? protocol?.reason ?? protocol?.stopReason ?? `HTTP hook failed: ${response.status} ${trimForRecord(text)}` : undefined,
        additionalContexts: contexts,
        updatedInput: protocolUpdatedInput(protocol),
        executions: [],
      };
    } finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener('abort', abort);
    }
  }

  private async executeAgentHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    if (!hook.prompt) throw new Error('Agent hook requires prompt.');
    const rendered = renderHookTemplate(hook, hook.prompt, payload);
    const context = payload.language === 'en-US'
      ? `[hook:${hook.id}] Agent hook task queued as context:\n${truncateContext(rendered)}`
      : `[hook:${hook.id}] Agent Hook 已作为上下文注入：\n${truncateContext(rendered)}`;
    return { blocked: false, additionalContexts: [context], executions: [] };
  }

  private async executeCharacterHook(hook: RoxyHookDefinition, payload: HookRunPayload): Promise<HookRunResult> {
    const behavior = mergeCharacterBehavior(hook);
    const context = renderCharacterOverlay(hook, payload, behavior);
    return { blocked: false, additionalContexts: context ? [context] : [], executions: [] };
  }
}

function mergeCharacterBehavior(hook: RoxyHookDefinition): Partial<CharacterBehavior> {
  const behavior: Partial<CharacterBehavior> = { ...(hook.behavior ?? {}) };
  if (hook.explanationStyle) behavior.explanationStyle = hook.explanationStyle;
  if (hook.reviewFocus) behavior.reviewFocus = [...hook.reviewFocus];
  if (hook.riskPreference) behavior.riskPreference = hook.riskPreference;
  if (hook.preferredMode) behavior.preferredMode = hook.preferredMode;
  if (hook.workflowBias) behavior.workflowBias = [...hook.workflowBias];
  if (hook.responseRules) behavior.responseRules = [...hook.responseRules];
  return behavior;
}

function renderCharacterOverlay(hook: RoxyHookDefinition, payload: HookRunPayload, behavior: Partial<CharacterBehavior>): string {
  const zh = payload.language !== 'en-US';
  const hasBehavior = Object.keys(behavior).length > 0;
  const renderedPrompt = hook.prompt ? renderHookTemplate(hook, hook.prompt, payload) : '';
  if (!hasBehavior && !renderedPrompt) return '';

  const characterId = payload.characterId ?? hook.characterId ?? 'unknown';
  const lines = zh
    ? [`[character:${characterId}:${hook.id}]`, '角色行为叠加（只影响解释风格、审查重点和工作习惯，不授予工具权限）']
    : [`[character:${characterId}:${hook.id}]`, 'Character behavior overlay (affects explanation style, review focus, and workflow habits only; it does not grant tool permission)'];

  if (behavior.explanationStyle) lines.push(`${zh ? '解释风格' : 'explanation style'}: ${behavior.explanationStyle}`);
  if (behavior.reviewFocus?.length) lines.push(`${zh ? '审查重点' : 'review focus'}: ${behavior.reviewFocus.join(', ')}`);
  if (behavior.riskPreference) lines.push(`${zh ? '风险偏好' : 'risk preference'}: ${behavior.riskPreference}`);
  if (behavior.preferredMode) lines.push(`${zh ? '模式倾向' : 'preferred mode'}: ${behavior.preferredMode}`);
  if (behavior.workflowBias?.length) lines.push(`${zh ? '工作流偏好' : 'workflow bias'}: ${behavior.workflowBias.join('; ')}`);
  if (behavior.responseRules?.length) lines.push(`${zh ? '响应规则' : 'response rules'}: ${behavior.responseRules.join('; ')}`);
  if (renderedPrompt) lines.push(`${zh ? '补充角色提示' : 'extra character prompt'}: ${truncateContext(renderedPrompt)}`);
  lines.push(zh
    ? '权限边界：角色叠加不能 approve/allow 工具调用，不能跳过 PermissionGuard，不能绕过二次确认。'
    : 'Permission boundary: character overlays cannot approve/allow tool calls, bypass PermissionGuard, or skip second confirmation.');
  return lines.join('\n');
}
function buildExecutionRecord(hook: RoxyHookDefinition, event: RoxyHookEvent, result: HookRunResult, duration: number): HookExecutionRecord {
  const nested = result.executions[0];
  return {
    hookId: hook.id,
    event,
    kind: hook.kind,
    outcome: result.blocked ? 'blocked' : nested?.outcome ?? 'success',
    duration: nested?.duration ?? duration,
    message: result.reason ?? nested?.message,
    additionalContext: result.additionalContexts.join('\n'),
    exitCode: nested?.exitCode,
    timedOut: nested?.timedOut,
    stdout: nested?.stdout,
    stderr: nested?.stderr,
    source: hook.source,
    statusMessage: hook.statusMessage,
  };
}

function contextsFromOutput(hook: RoxyHookDefinition, output: string, protocol: HookProtocolOutput | null): string[] {
  const contexts: string[] = [];
  const specificContext = protocol?.hookSpecificOutput?.additionalContext;
  const protocolContext = protocol?.additionalContext ?? specificContext;
  if (protocolContext) contexts.push(`[hook:${hook.id}]\n${truncateContext(protocolContext)}`);
  if (!protocol?.suppressOutput) {
    const clean = stripProtocolJson(output).trim();
    if (clean) contexts.push(`[hook:${hook.id}]\n${truncateContext(clean)}`);
  }
  return contexts;
}

function parseHookProtocolOutput(output: string): HookProtocolOutput | null {
  const candidates = extractJsonCandidates(output);
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isHookProtocolOutput(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function extractJsonCandidates(output: string): string[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    const candidate = value?.trim();
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) add(match[1]);
  if (trimmed.startsWith('{')) add(trimmed);

  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate.startsWith('{')) add(candidate);
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) add(trimmed.slice(first, last + 1));
  return candidates;
}

function isHookProtocolOutput(value: unknown): value is HookProtocolOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return 'continue' in record
    || 'decision' in record
    || 'additionalContext' in record
    || 'updatedInput' in record
    || 'hookSpecificOutput' in record
    || 'stopReason' in record
    || 'suppressOutput' in record;
}

function protocolBlocks(protocol: HookProtocolOutput | null): boolean {
  return protocol?.continue === false || protocol?.decision === 'block' || protocol?.hookSpecificOutput?.permissionDecision === 'deny';
}

function protocolUpdatedInput(protocol: HookProtocolOutput | null): Record<string, unknown> | undefined {
  return protocol?.updatedInput ?? protocol?.hookSpecificOutput?.updatedInput;
}

function stripProtocolJson(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return '';
  const fenced = trimmed.replace(/```(?:json)?\s*[\s\S]*?```/gi, '').trim();
  const start = fenced.lastIndexOf('{');
  if (start <= 0) return fenced;
  const before = fenced.slice(0, start).trim();
  const maybeJson = fenced.slice(start).trim();
  try {
    const parsed: unknown = JSON.parse(maybeJson);
    if (isHookProtocolOutput(parsed)) return before;
  } catch {
    return fenced;
  }
  return fenced;
}

function mergeUpdatedInput(
  event: RoxyHookEvent,
  payload: HookRunPayload,
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const base = current ?? (event === 'before_tool' ? payload.toolArgs : undefined) ?? {};
  return { ...base, ...next };
}

function matches(hook: RoxyHookDefinition, payload: HookRunPayload): boolean {
  if (hook.kind === 'character' && hook.characterId && hook.characterId !== payload.characterId) return false;
  if (!hook.matcher) return true;
  const target = matchTarget(hook.event, payload);
  if (!target) return false;
  if (hook.matcher.startsWith('/') && hook.matcher.endsWith('/')) {
    try { return new RegExp(hook.matcher.slice(1, -1)).test(target); } catch { return false; }
  }
  return target.includes(hook.matcher);
}

function matchTarget(event: RoxyHookEvent, payload: HookRunPayload): string {
  switch (event) {
    case 'command':
      return payload.commandName ?? payload.userInput ?? '';
    case 'before_tool':
    case 'after_tool':
      return payload.toolName ?? '';
    case 'before_prompt':
      return payload.userInput ?? '';
    case 'after_response':
      return payload.responseText ?? payload.userInput ?? '';
    case 'agent_start':
    case 'agent_done':
      return payload.characterId ?? payload.userInput ?? payload.toolName ?? '';
    case 'session_start':
      return payload.sessionId;
  }
}

function renderHookTemplate(hook: RoxyHookDefinition, template: string, payload: HookRunPayload): string {
  return renderHookPluginVariables(hook, renderTemplate(template, payload), `hook ${hook.id} template`);
}

function renderHookPluginVariables(hook: RoxyHookDefinition, value: string, owner: string): string {
  return renderPluginVariables(value, hook.pluginSandbox, owner);
}

function renderHookHeaders(hook: RoxyHookDefinition): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(hook.headers ?? {})) {
    headers[key] = renderHookPluginVariables(hook, value, `hook ${hook.id} header ${key}`);
  }
  return headers;
}

function assertPluginHookCommandAllowed(hook: RoxyHookDefinition, command: string): void {
  if (!hook.pluginSandbox || !isAbsolute(command)) return;
  const validation = createPluginSandboxGuard(hook.pluginSandbox).validatePath(command);
  if (!validation.allowed) {
    throw new Error(`Plugin hook ${hook.id} command executable is outside its sandbox: ${command}`);
  }
}

function assertPluginHookNetworkAllowed(hook: RoxyHookDefinition, url: string): void {
  if (!hook.pluginSandbox) return;
  const validation = createPluginSandboxGuard(hook.pluginSandbox).validateNetworkAccess(url);
  if (!validation.allowed) {
    throw new Error(`Plugin hook ${hook.id} network access denied: ${validation.reason ?? url}`);
  }
}

function getPluginHookEnv(hook: RoxyHookDefinition): NodeJS.ProcessEnv | undefined {
  const sandbox = hook.pluginSandbox;
  if (!sandbox) return undefined;
  return {
    ...process.env,
    ROXY_PLUGIN_ID: sandbox.pluginId,
    ROXY_PLUGIN_ROOT: sandbox.pluginRoot,
  };
}

function renderTemplate(template: string, payload: HookRunPayload): string {
  const data = JSON.stringify(sanitizePayload(payload), null, 2);
  return template
    .replace(/\$ARGUMENTS/g, data)
    .replace(/\{\{input\}\}/g, payload.userInput ?? '')
    .replace(/\{\{tool\}\}/g, payload.toolName ?? '')
    .replace(/\{\{command\}\}/g, payload.commandName ?? '')
    .replace(/\{\{cwd\}\}/g, payload.cwd);
}

function sanitizePayload(payload: HookRunPayload): HookRunPayload {
  return {
    ...payload,
    toolArgs: sanitizeRecord(payload.toolArgs),
    metadata: sanitizeRecord(payload.metadata),
  };
}

function sanitizeRecord(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (/key|token|secret|password|authorization/i.test(key)) {
      out[key] = '[redacted]';
    } else if (typeof value === 'string' && value.length > 500) {
      out[key] = `${value.slice(0, 500)}... [truncated ${value.length - 500} chars]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: env ?? process.env });
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
      resolve({ exitCode, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

function sanitizeHeaders(headers: Record<string, string>, allowedEnvVars: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (_, braced, unbraced) => {
      const varName = String(braced ?? unbraced);
      return allowedEnvVars.has(varName) ? sanitizeHeaderValue(process.env[varName] ?? '') : '';
    });
  }
  return out;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\x00]/g, '');
}

function assertNoUnsafeHost(url: URL): void {
  const host = url.hostname.toLowerCase();
  if (isLocalhost(host)) return;
  if (/^(169\.254\.|0\.|10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) {
    throw new Error(`HTTP Hook blocked unsafe host: ${url.hostname}`);
  }
  if (['metadata.google.internal'].includes(host)) {
    throw new Error(`HTTP Hook blocked metadata host: ${url.hostname}`);
  }
}

function isLocalhost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase());
}

function truncateContext(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONTEXT_CHARS)}\n... [hook context truncated ${text.length - MAX_CONTEXT_CHARS} chars]`;
}

function trimForRecord(text: string): string {
  const safe = text.replace(/[\r\n]+/g, '\n').trim();
  if (safe.length <= MAX_RECORD_OUTPUT_CHARS) return safe;
  return `${safe.slice(0, MAX_RECORD_OUTPUT_CHARS)}... [truncated ${safe.length - MAX_RECORD_OUTPUT_CHARS} chars]`;
}
