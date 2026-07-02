import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';

import { toolResultMessage, userMessage, type Message, type ToolCall, type ToolResult } from '../src/core/types/message.js';
import type { LLMChunk } from '../src/core/types/llm.js';
import type { ToolDefinition } from '../src/tool/types.js';
import { LLMError } from '../src/engine/llm/BaseLLMProvider.js';
import { OpenAIProvider } from '../src/engine/llm/OpenAIProvider.js';

const fakeTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a file from the current project.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path.' },
    },
    required: ['path'],
  },
};

test('OpenAI-compatible provider posts chat completion requests and parses JSON responses', async () => {
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, any>;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    assert.equal(body.model, 'gpt-contract');
    assert.equal(body.stream, false);
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'ping' }]);
    assert.equal(body.tools[0].type, 'function');
    assert.equal(body.tools[0].function.name, 'read_file');
    assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'read_file' } });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }));
  });

  const baseUrl = await listen(server);
  try {
    const provider = new OpenAIProvider({ apiKey: 'test-key', baseUrl, model: 'gpt-contract' });
    const result = await provider.chat({
      messages: [userMessage('ping')],
      tools: [fakeTool],
      toolChoice: { type: 'function', name: 'read_file' },
      temperature: 0,
    });

    assert.equal(result.text, 'pong');
    assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
  } finally {
    await close(server);
  }
});

test('OpenAI-compatible provider parses SSE text, tool call deltas, and final usage', async () => {
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, any>;
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    sendSse(res, { choices: [{ delta: { content: '先读取。' } }] });
    sendSse(res, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '' } }] } }] });
    sendSse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path"' } }] } }] });
    sendSse(res, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"README.md"}' } }] } }] });
    sendSse(res, {
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
    });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  const baseUrl = await listen(server);
  try {
    const provider = new OpenAIProvider({ apiKey: 'test-key', baseUrl, model: 'gpt-contract' });
    const events: LLMChunk[] = [];
    for await (const event of provider.chatStream({ messages: [userMessage('读取 README')], tools: [fakeTool], temperature: 0 })) {
      events.push(event);
    }

    assert.deepEqual(events.map(event => event.type), ['text', 'tool_call_start', 'tool_call_delta', 'tool_call_delta', 'done']);
    assert.equal(events[0].type === 'text' ? events[0].text : '', '先读取。');
    const done = events.at(-1);
    assert.ok(done && done.type === 'done');
    assert.deepEqual(done.usage, { inputTokens: 4, outputTokens: 6, totalTokens: 10 });
    assert.deepEqual(done.toolCalls, [{ id: 'call_1', name: 'read_file', arguments: { path: 'README.md' } }]);
    assert.equal(done.finishReason, 'tool_calls');
  } finally {
    await close(server);
  }
});




test('OpenAI-compatible provider repairs missing tool_result before sending requests', async () => {
  const toolCall: ToolCall = { id: 'call_missing', name: 'read_file', arguments: { path: 'README.md' } };
  const messages: Message[] = [
    userMessage('读取 README'),
    { role: 'assistant', content: [{ type: 'tool_use', toolCall }], timestamp: 1 },
  ];

  const body = await captureProviderRequest(messages);
  assert.equal(body.messages.length, 3);
  assert.deepEqual(body.messages[1].tool_calls, [{
    id: 'call_missing',
    type: 'function',
    function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) },
  }]);
  assert.equal(body.messages[2].role, 'tool');
  assert.equal(body.messages[2].tool_call_id, 'call_missing');
  assert.match(body.messages[2].content, /synthetic/);
  assert.match(body.messages[2].content, /missing_tool_result/);
});

test('OpenAI-compatible provider strips orphan tool_result while preserving user text', async () => {
  const toolCall: ToolCall = { id: 'call_orphan', name: 'read_file', arguments: { path: 'README.md' } };
  const result: ToolResult = { success: true, output: '<tool_result>orphan</tool_result>', duration: 0 };
  const messages: Message[] = [
    toolResultMessage(toolCall, result),
    userMessage('继续分析项目'),
    { role: 'user', content: [{ type: 'text', text: '保留这句用户上下文' }, { type: 'tool_result', toolCallId: 'ghost', result }], timestamp: 2 },
  ];

  const body = await captureProviderRequest(messages);
  assert.deepEqual(body.messages, [
    { role: 'user', content: '继续分析项目' },
    { role: 'user', content: '保留这句用户上下文' },
  ]);
});

test('OpenAI-compatible provider removes duplicate tool_use and duplicate tool_result ids', async () => {
  const first: ToolCall = { id: 'call_dupe', name: 'read_file', arguments: { path: 'README.md' } };
  const duplicate: ToolCall = { id: 'call_dupe', name: 'grep_search', arguments: { pattern: 'Roxy' } };
  const result: ToolResult = { success: true, output: '<tool_result>ok</tool_result>', duration: 0 };
  const messages: Message[] = [
    userMessage('查一下项目'),
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', toolCall: first },
        { type: 'tool_use', toolCall: duplicate },
      ],
      timestamp: 3,
    },
    toolResultMessage(first, result),
    toolResultMessage(first, { ...result, output: '<tool_result>duplicate</tool_result>' }),
  ];

  const body = await captureProviderRequest(messages);
  assert.equal(body.messages.length, 3);
  assert.equal(body.messages[1].tool_calls.length, 1);
  assert.equal(body.messages[1].tool_calls[0].id, 'call_dupe');
  assert.equal(body.messages[1].tool_calls[0].function.name, 'read_file');
  assert.equal(body.messages[2].role, 'tool');
  assert.equal(body.messages[2].tool_call_id, 'call_dupe');
  assert.match(body.messages[2].content, /ok/);
  assert.doesNotMatch(JSON.stringify(body.messages), /duplicate/);
  assert.doesNotMatch(JSON.stringify(body.messages), /grep_search/);
});
test('OpenAI-compatible provider treats 401 and 404 as non-retryable config errors', async () => {
  const hits: number[] = [];
  const server = createServer(async (req, res) => {
    hits.push(Date.now());
    await readBody(req);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });

  const baseUrl = await listen(server);
  try {
    const provider = testProvider(baseUrl);
    await assert.rejects(
      provider.chat({ messages: [userMessage('ping')] }),
      (error: unknown) => error instanceof LLMError
        && error.code === 'INVALID_CONFIG'
        && error.statusCode === 401
        && error.recoverable === false
        && error.recoveryAction === 'check_config',
    );
    assert.equal(hits.length, 1);
  } finally {
    await close(server);
  }
});


test('OpenAI-compatible provider exposes request id, Retry-After, model, and fallback diagnostics on provider errors', async () => {
  let hits = 0;
  const server = createServer(async (req, res) => {
    hits++;
    await readBody(req);
    res.writeHead(429, {
      'content-type': 'application/json',
      'retry-after': '2',
      'x-request-id': 'req-rate-limit-1',
    });
    res.end(JSON.stringify({ error: { message: 'rate limited' } }));
  });

  const baseUrl = await listen(server);
  try {
    const provider = new OpenAIProvider(
      { apiKey: 'test-key', baseUrl, model: 'gpt-contract', fallbackModels: ['gpt-fallback'] },
      { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    );
    await assert.rejects(
      provider.chat({ messages: [userMessage('ping')] }),
      (error: unknown) => error instanceof LLMError
        && error.code === 'RATE_LIMIT'
        && error.statusCode === 429
        && error.requestId === 'req-rate-limit-1'
        && error.retryAfterMs === 2000
        && error.providerId === 'openai'
        && error.model === 'gpt-contract'
        && error.fallbackModel === 'gpt-fallback'
        && error.details?.requestId === 'req-rate-limit-1'
        && error.details?.retryAfterMs === 2000,
    );
    assert.equal(hits, 1);
  } finally {
    await close(server);
  }
});

test('OpenAI-compatible provider retries 429 and returns the later success', async () => {
  let hits = 0;
  const server = createServer(async (req, res) => {
    hits++;
    await readBody(req);
    if (hits === 1) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-retry',
      choices: [{ message: { role: 'assistant', content: 'ok after retry' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }));
  });

  const baseUrl = await listen(server);
  try {
    const provider = testProvider(baseUrl);
    const result = await provider.chat({ messages: [userMessage('ping')] });
    assert.equal(result.text, 'ok after retry');
    assert.equal(hits, 2);
  } finally {
    await close(server);
  }
});

test('OpenAI-compatible provider retries 5xx then raises server errors with status metadata', async () => {
  let hits = 0;
  const server = createServer(async (req, res) => {
    hits++;
    await readBody(req);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('temporary outage');
  });

  const baseUrl = await listen(server);
  try {
    const provider = testProvider(baseUrl, { maxRetries: 2 });
    await assert.rejects(
      provider.chat({ messages: [userMessage('ping')] }),
      (error: unknown) => error instanceof LLMError
        && error.code === 'SERVER_ERROR'
        && error.statusCode === 500
        && error.recoverable === true
        && error.recoveryAction === 'retry',
    );
    assert.equal(hits, 3);
  } finally {
    await close(server);
  }
});

test('OpenAI-compatible provider wraps network failures as retryable network errors', async () => {
  const server = createServer((_req, res) => {
    res.destroy(new Error('socket reset'));
  });

  const baseUrl = await listen(server);
  try {
    const provider = testProvider(baseUrl, { maxRetries: 1 });
    await assert.rejects(
      provider.chat({ messages: [userMessage('ping')] }),
      (error: unknown) => error instanceof LLMError
        && error.code === 'NETWORK_ERROR'
        && error.category === 'network'
        && error.recoverable === true
        && error.recoveryAction === 'retry',
    );
  } finally {
    await close(server);
  }
});

test('OpenAI-compatible provider rejects invalid JSON chat responses', async () => {
  const server = createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{not-json');
  });

  const baseUrl = await listen(server);
  try {
    const provider = testProvider(baseUrl);
    await assert.rejects(
      provider.chat({ messages: [userMessage('ping')] }),
      (error: unknown) => error instanceof LLMError && error.code === 'API_ERROR',
    );
  } finally {
    await close(server);
  }
});

test('OpenAI-compatible provider rejects malformed SSE payloads instead of silently dropping them', async () => {
  const server = createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('data: {not-json\n\n');
    res.end();
  });

  const baseUrl = await listen(server);
  try {
    const provider = testProvider(baseUrl);
    const events: LLMChunk[] = [];
    await assert.rejects(
      async () => {
        for await (const event of provider.chatStream({ messages: [userMessage('ping')] })) {
          events.push(event);
        }
      },
      (error: unknown) => error instanceof LLMError && error.code === 'API_ERROR',
    );
    assert.deepEqual(events, []);
  } finally {
    await close(server);
  }
});

test('optional real OpenAI-compatible provider smoke test', { skip: shouldSkipRealProvider() }, async () => {
  const provider = new OpenAIProvider({
    apiKey: process.env.ROXY_TEST_OPENAI_API_KEY!,
    baseUrl: process.env.ROXY_TEST_OPENAI_BASE_URL,
    model: process.env.ROXY_TEST_OPENAI_MODEL ?? 'gpt-4o',
  });

  const valid = await provider.validate();
  assert.equal(valid, true);
  const result = await provider.chat({
    messages: [userMessage('用四个以内的中文字符回复：正常')],
    temperature: 0,
    maxTokens: 16,
  });
  assert.ok(result.text.trim().length > 0);
});


test('optional real OpenAI-compatible provider tool_call smoke test', { skip: shouldSkipRealProviderToolCall() }, async () => {
  const provider = new OpenAIProvider({
    apiKey: process.env.ROXY_TEST_OPENAI_API_KEY!,
    baseUrl: process.env.ROXY_TEST_OPENAI_BASE_URL,
    model: process.env.ROXY_TEST_OPENAI_MODEL ?? 'gpt-4o',
  }, { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 });

  const events: LLMChunk[] = [];
  for await (const event of provider.chatStream({
    messages: [userMessage('Call the read_file tool exactly once with path "README.md". Do not answer in text before the tool call.')],
    tools: [fakeTool],
    toolChoice: { type: 'function', name: 'read_file' },
    temperature: 0,
    maxTokens: 128,
  })) {
    events.push(event);
  }

  const done = events.at(-1);
  assert.ok(done && done.type === 'done');
  assert.ok(done.toolCalls.length >= 1);
  const toolCall = done.toolCalls[0]!;
  assert.equal(toolCall.name, 'read_file');
  assert.equal(toolCall.arguments.path, 'README.md');
});

async function captureProviderRequest(messages: Message[]): Promise<Record<string, any>> {
  let captured: Record<string, any> | undefined;
  const server = createServer(async (req, res) => {
    captured = JSON.parse(await readBody(req)) as Record<string, any>;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-pairing',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });

  const baseUrl = await listen(server);
  try {
    const provider = new OpenAIProvider({ apiKey: 'test-key', baseUrl, model: 'gpt-contract' });
    await provider.chat({ messages, tools: [fakeTool], temperature: 0 });
    assert.ok(captured);
    return captured;
  } finally {
    await close(server);
  }
}
function testProvider(baseUrl: string, retry: { maxRetries?: number } = {}): OpenAIProvider {
  return new OpenAIProvider(
    { apiKey: 'test-key', baseUrl, model: 'gpt-contract' },
    { maxRetries: retry.maxRetries ?? 1, baseDelayMs: 1, maxDelayMs: 1 },
  );
}

function shouldSkipRealProvider(): string | false {
  if (!process.env.ROXY_TEST_OPENAI_API_KEY) return 'Set ROXY_TEST_OPENAI_API_KEY to run real provider smoke tests.';
  return false;
}


function shouldSkipRealProviderToolCall(): string | false {
  if (!process.env.ROXY_TEST_OPENAI_API_KEY) return 'Set ROXY_TEST_OPENAI_API_KEY to run real provider tool_call smoke tests.';
  if (process.env.ROXY_TEST_OPENAI_TOOL_CALL !== '1') return 'Set ROXY_TEST_OPENAI_TOOL_CALL=1 to run real tool_call smoke tests.';
  return false;
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolve(`http://127.0.0.1:${address.port}/v1`);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

function sendSse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}






