import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderDiagnosticsCommand } from '../src/commands/builtin/diagnostics.js';
import { DEFAULT_CONFIG, type RoxyCodeConfig } from '../src/core/types/config.js';
import type { ConfigManager } from '../src/core/ConfigManager.js';
import type { LLMProvider } from '../src/core/types/llm.js';
import type { ContextManager } from '../src/session/context/ContextManager.js';
import type { CharacterManager } from '../src/aesthetic/character/CharacterManager.js';
import type { RuntimeStateSnapshot } from '../src/runtime/index.js';

test('diagnostics gives targeted Chinese advice for recent provider config errors', async () => {
  const output = await captureConsole(async () => {
    await renderDiagnosticsCommand({
      language: 'zh-CN',
      configManager: fakeConfigManager({
        ...DEFAULT_CONFIG,
        llm: { provider: 'compatible', model: 'gpt-contract', fallbackModels: [], apiKey: 'test-key', baseUrl: 'https://example.test' },
      }),
      contextManager: fakeContextManager(),
      llmProvider: fakeProvider(),
      characterManager: fakeCharacterManager(),
      getCommandCount: () => 12,
      getRuntimeSnapshot: () => runtimeWithProviderError('INVALID_CONFIG', 401),
      getMemoryStats: async () => ({
        enabled: true,
        total: 0,
        manual: 0,
        auto: 0,
        global: 0,
        project: 0,
        archived: 0,
        byType: { user: 0, project: 0, feedback: 0, reference: 0, learning: 0, workflow: 0 },
      }),
    });
  });

  assert.match(output, /HTTP 401/);
  assert.ok(output.includes('/config validate'));
  assert.match(output, /ROXY_OPENAI_BASE_URL/);
  assert.ok(output.includes('/v1'));
});


test('diagnostics displays provider request id, retry-after, and fallback advice', async () => {
  const output = await captureConsole(async () => {
    await renderDiagnosticsCommand({
      language: 'zh-CN',
      configManager: fakeConfigManager({
        ...DEFAULT_CONFIG,
        llm: { provider: 'compatible', model: 'gpt-contract', fallbackModels: ['gpt-fallback'], apiKey: 'test-key', baseUrl: 'https://example.test/v1' },
      }),
      contextManager: fakeContextManager(),
      llmProvider: fakeProvider(),
      characterManager: fakeCharacterManager(),
      getCommandCount: () => 12,
      getRuntimeSnapshot: () => runtimeWithProviderRateLimit(),
      getMemoryStats: async () => ({
        enabled: true,
        total: 0,
        manual: 0,
        auto: 0,
        global: 0,
        project: 0,
        archived: 0,
        byType: { user: 0, project: 0, feedback: 0, reference: 0, learning: 0, workflow: 0 },
      }),
    });
  });

  assert.match(output, /HTTP 429/);
  assert.match(output, /request_id=req-rate-limit-1/);
  assert.match(output, /retry_after=2s/);
  assert.match(output, /fallback=gpt-fallback/);
  assert.ok(output.includes('/model'));
  assert.ok(output.includes('gpt-fallback')); 
});

test('diagnostics surfaces tool result pairing repair statistics', async () => {
  const output = await captureConsole(async () => {
    await renderDiagnosticsCommand({
      language: 'zh-CN',
      configManager: fakeConfigManager({
        ...DEFAULT_CONFIG,
        llm: { provider: 'compatible', model: 'gpt-contract', fallbackModels: [], apiKey: 'test-key', baseUrl: 'https://example.test/v1' },
      }),
      contextManager: fakeContextManager(),
      llmProvider: fakeProvider(),
      characterManager: fakeCharacterManager(),
      getCommandCount: () => 12,
      getRuntimeSnapshot: () => ({
        ...baseRuntime(),
        operations: {
          ...baseRuntime().operations,
          toolResultPairing: {
            totalRepairs: 1,
            insertedSyntheticResults: 1,
            removedOrphanResults: 2,
            removedDuplicateToolUses: 1,
            removedDuplicateToolResults: 1,
            last: {
              originalMessageCount: 4,
              repairedMessageCount: 5,
              insertedSyntheticResults: 1,
              removedOrphanResults: 2,
              removedDuplicateToolUses: 1,
              removedDuplicateToolResults: 1,
              at: Date.now(),
            },
          },
        },
      }),
      getMemoryStats: async () => ({
        enabled: true,
        total: 0,
        manual: 0,
        auto: 0,
        global: 0,
        project: 0,
        archived: 0,
        byType: { user: 0, project: 0, feedback: 0, reference: 0, learning: 0, workflow: 0 },
      }),
    });
  });

  assert.match(output, /\u5de5\u5177\u6d88\u606f\u914d\u5bf9\u53d1\u751f\u8fc7\u81ea\u52a8\u4fee\u590d/);
  assert.match(output, /synthetic=1/);
  assert.match(output, /orphan=2/);
  assert.match(output, /duplicate=2/);
  assert.ok(output.includes('/rewind'));
});
test('diagnostics keeps generic advice for non-provider runtime errors', async () => {
  const output = await captureConsole(async () => {
    await renderDiagnosticsCommand({
      language: 'zh-CN',
      configManager: fakeConfigManager({
        ...DEFAULT_CONFIG,
        llm: { provider: 'compatible', model: 'gpt-contract', fallbackModels: [], apiKey: 'test-key', baseUrl: 'https://example.test/v1' },
      }),
      contextManager: fakeContextManager(),
      llmProvider: fakeProvider(),
      characterManager: fakeCharacterManager(),
      getCommandCount: () => 12,
      getRuntimeSnapshot: () => runtimeWithGenericError(),
      getMemoryStats: async () => ({
        enabled: true,
        total: 0,
        manual: 0,
        auto: 0,
        global: 0,
        project: 0,
        archived: 0,
        byType: { user: 0, project: 0, feedback: 0, reference: 0, learning: 0, workflow: 0 },
      }),
    });
  });

  assert.match(output, /tool:read_file/);
  assert.match(output, /File not found/);
  assert.doesNotMatch(output, /ROXY_OPENAI_BASE_URL/);
});

function runtimeWithProviderError(code: string, statusCode: number): RuntimeStateSnapshot {
  return {
    ...baseRuntime(),
    agent: { ...baseRuntime().agent, lastError: 'Provider HTTP 401: bad key' },
    operations: {
      ...baseRuntime().operations,
      recentErrors: [{
        source: 'agent',
        message: 'Provider HTTP 401: bad key',
        timestamp: Date.now(),
        metadata: {
          descriptor: {
            category: 'config',
            code,
            details: { statusCode },
            recoverable: false,
            recoveryAction: 'check_config',
          },
        },
      }],
    },
  };
}


function runtimeWithProviderRateLimit(): RuntimeStateSnapshot {
  return {
    ...baseRuntime(),
    agent: { ...baseRuntime().agent, lastError: 'Provider HTTP 429: rate limited' },
    providerDiagnostics: {
      providerId: 'compatible',
      model: 'gpt-contract',
      requestId: 'req-rate-limit-1',
      statusCode: 429,
      retryAfterMs: 2000,
      fallbackModel: 'gpt-fallback',
      fallbackModels: ['gpt-fallback'],
      code: 'RATE_LIMIT',
      recoverable: true,
      at: Date.now(),
    },
    operations: {
      ...baseRuntime().operations,
      recentErrors: [{
        source: 'agent',
        message: 'Provider HTTP 429: rate limited',
        timestamp: Date.now(),
        metadata: {
          descriptor: {
            category: 'network',
            code: 'RATE_LIMIT',
            details: {
              statusCode: 429,
              requestId: 'req-rate-limit-1',
              retryAfterMs: 2000,
              providerId: 'compatible',
              model: 'gpt-contract',
              fallbackModel: 'gpt-fallback',
              fallbackModels: ['gpt-fallback'],
            },
            recoverable: true,
            recoveryAction: 'retry',
          },
        },
      }],
    },
  };
}

function runtimeWithGenericError(): RuntimeStateSnapshot {
  return {
    ...baseRuntime(),
    operations: {
      ...baseRuntime().operations,
      recentErrors: [{ source: 'tool:read_file', message: 'File not found', timestamp: Date.now() }],
    },
  };
}

function baseRuntime(): RuntimeStateSnapshot {
  return {
    runtimeId: 'runtime-test',
    cwd: process.cwd(),
    projectRoot: process.cwd(),
    startedAt: Date.now(),
    lastInteractionAt: Date.now(),
    language: 'zh-CN',
    characterId: 'roxy',
    providerId: 'compatible',
    model: 'gpt-contract',
    isInteractive: false,
    session: { sessionId: 'session-test', transcriptPath: 'missing.jsonl', messageCount: 0, turns: 0 },
    agent: { active: false, mode: 'standard', contextCompactions: 0, tokenBudgetContinuations: 0 },
    usage: { requests: 1, total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    extensions: {
      plugins: { enabled: 0, disabled: 0, errors: [] },
      hooks: { count: 0, errors: [] },
      mcp: { servers: 0, tools: 0, errors: [] },
      commands: { builtin: 12, extension: 0, total: 12 },
      tools: { builtin: 7, mcp: 0, total: 7 },
    },
    operations: {
      tools: { totalCalls: 0, failedCalls: 0, totalDurationMs: 0, turnCalls: 0, turnDurationMs: 0 },
      hooks: { totalRuns: 0, blockedRuns: 0, errorRuns: 0, totalDurationMs: 0, turnRuns: 0, turnDurationMs: 0 },
      slowOperations: [],
      recentErrors: [],
      queryProfiles: { slowProfiles: [] },
      toolResultPairing: {
        totalRepairs: 0,
        insertedSyntheticResults: 0,
        removedOrphanResults: 0,
        removedDuplicateToolUses: 0,
        removedDuplicateToolResults: 0,
      },
    },
    telemetry: { enabled: false, path: 'disabled', eventCount: 0, droppedEvents: 0 },
  };
}

function fakeConfigManager(config: RoxyCodeConfig): ConfigManager {
  return {
    snapshot: () => config,
    validate: () => ({ ok: true, issues: [] }),
    get: (path: string) => path.split('.').reduce((value: unknown, key) => {
      return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
    }, config),
  } as unknown as ConfigManager;
}

function fakeContextManager(): ContextManager {
  return {
    getStatus: async () => ({
      maxContextTokens: 128000,
      currentTokens: 0,
      usageRatio: 0,
      compressionEnabled: true,
      compressThreshold: 0.8,
      needsCompression: false,
      messageCount: 0,
      source: 'provider-default',
      registeredStrategies: ['summary'],
    }),
  } as unknown as ContextManager;
}

function fakeProvider(): LLMProvider {
  return {
    id: 'compatible',
    name: 'OpenAI Compatible',
    maxContextTokens: 128000,
    supportsTools: true,
    chatStream: async function* () {},
    chat: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
    countTokens: async text => text.length,
    validate: async () => true,
  };
}

function fakeCharacterManager(): CharacterManager {
  return {
    getCurrentCharacter: () => ({ name: 'Roxy' }),
  } as unknown as CharacterManager;
}

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}
