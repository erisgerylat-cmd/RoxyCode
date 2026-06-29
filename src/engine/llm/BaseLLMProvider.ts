
import type {
  LLMProvider,
  LLMProviderConfig,
  LLMCallOptions,
  LLMChunk,
  LLMUsage,
} from '../../core/types/llm.js';
import type { Message, ToolCall, MessageContent } from '../../core/types/message.js';
import type { ToolDefinition } from '../../core/types/tool.js';

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream_options?: { include_usage: boolean };
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{ message: OpenAIMessage; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 10000 };

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly maxContextTokens: number;
  abstract readonly supportsTools: boolean;

  protected readonly config: LLMProviderConfig;
  protected readonly retry: RetryConfig;

  constructor(config: LLMProviderConfig, retry?: Partial<RetryConfig>) {
    this.config = config;
    this.retry = { ...DEFAULT_RETRY, ...retry };
  }

  protected get baseUrl(): string {
    return this.config.baseUrl ?? 'https://api.openai.com/v1';
  }

  async *chatStream(options: LLMCallOptions): AsyncIterable<LLMChunk> {
    this.assertConfigured();
    const body = this.buildRequest(options, true);
    const response = await this.fetchWithRetry(body, options.signal);
    if (!response.body) throw new LLMError('Response body is null', 'NETWORK_ERROR');
    yield* this.parseSSEStream(response.body, options.signal);
  }

  async chat(options: LLMCallOptions): Promise<{ text: string; usage: LLMUsage }> {
    this.assertConfigured();
    const body = this.buildRequest(options, false);
    const response = await this.fetchWithRetry(body, options.signal);
    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    if (!choice) throw new LLMError('No choices in response', 'API_ERROR');
    return { text: choice.message?.content ?? '', usage: this.parseUsage(data.usage) };
  }

  async countTokens(text: string): Promise<number> {
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    const totalChars = text.length;
    if (totalChars === 0) return 0;
    const chineseRatio = chineseChars / totalChars;
    return Math.ceil(totalChars / (1.5 * chineseRatio + 4 * (1 - chineseRatio)));
  }

  async validate(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      const body: ChatCompletionRequest = {
        model: this.config.model,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        max_tokens: 1,
      };
      const response = await this.fetchRaw(body);
      return response.ok;
    } catch {
      return false;
    }
  }

  protected buildRequest(options: LLMCallOptions, stream: boolean): ChatCompletionRequest {
    const request: ChatCompletionRequest = {
      model: this.config.model,
      messages: this.convertMessages(options.messages),
      stream,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      top_p: options.topP ?? this.config.topP,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
    };
    if (stream) request.stream_options = { include_usage: true };
    if (options.tools && options.tools.length > 0 && this.supportsTools) {
      request.tools = this.convertTools(options.tools);
    }
    return request;
  }

  protected convertMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map(msg => this.convertMessage(msg));
  }

  protected convertMessage(msg: Message): OpenAIMessage {
    if (typeof msg.content === 'string') return { role: msg.role, content: msg.content };

    const parts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];
    for (const block of msg.content as MessageContent[]) {
      switch (block.type) {
        case 'text':
          parts.push(block.text);
          break;
        case 'tool_use':
          toolCalls.push({
            id: block.toolCall.id,
            type: 'function',
            function: { name: block.toolCall.name, arguments: JSON.stringify(block.toolCall.arguments) },
          });
          break;
        case 'tool_result':
          return { role: 'tool', content: block.result.output, tool_call_id: block.toolCallId };
      }
    }

    const result: OpenAIMessage = { role: msg.role, content: parts.length > 0 ? parts.join('\n') : null };
    if (toolCalls.length > 0) result.tool_calls = toolCalls;
    return result;
  }

  protected convertTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>,
      },
    }));
  }

  protected parseUsage(usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): LLMUsage {
    return {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    };
  }

  private async *parseSSEStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<LLMChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalUsage: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason = 'stop';
    const pendingToolCalls = new Map<number, { id: string; name: string; argsJson: string; started: boolean }>();

    try {
      while (true) {
        if (signal?.aborted) throw new LLMError('Request aborted', 'ABORTED');
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            yield { type: 'done', usage: finalUsage, toolCalls: finalizeToolCalls(pendingToolCalls), finishReason };
            return;
          }
          const chunk = safeParseObject(payload);
          if (!chunk) continue;
          if (isRecord(chunk.usage)) finalUsage = this.parseUsage(chunk.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number });
          const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
          if (isRecord(choice) && typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
          const delta = isRecord(choice?.delta) ? choice.delta : undefined;
          if (!delta) continue;
          if (typeof delta.content === 'string' && delta.content.length > 0) yield { type: 'text', text: delta.content };

          if (Array.isArray(delta.tool_calls)) {
            for (const raw of delta.tool_calls) {
              if (!isRecord(raw)) continue;
              const index = typeof raw.index === 'number' ? raw.index : pendingToolCalls.size;
              const fn = isRecord(raw.function) ? raw.function : {};
              const existing = pendingToolCalls.get(index) ?? {
                id: typeof raw.id === 'string' ? raw.id : `call_${Date.now()}_${index}`,
                name: '',
                argsJson: '',
                started: false,
              };
              if (typeof raw.id === 'string') existing.id = raw.id;
              if (typeof fn.name === 'string' && fn.name.length > 0) existing.name = fn.name;
              const argsDelta = typeof fn.arguments === 'string' ? fn.arguments : '';
              existing.argsJson += argsDelta;
              pendingToolCalls.set(index, existing);
              if (!existing.started && existing.name) {
                existing.started = true;
                yield { type: 'tool_call_start', toolCall: { id: existing.id, name: existing.name, arguments: {} } };
              }
              if (argsDelta) yield { type: 'tool_call_delta', id: existing.id, argsDelta };
            }
          }
        }
      }
      yield { type: 'done', usage: finalUsage, toolCalls: finalizeToolCalls(pendingToolCalls), finishReason };
    } finally {
      reader.releaseLock();
    }
  }

  private async fetchWithRetry(body: ChatCompletionRequest, signal?: AbortSignal): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(this.retry.baseDelayMs * Math.pow(2, attempt - 1), this.retry.maxDelayMs);
          await sleep(delay);
        }
        const response = await this.fetchRaw(body, signal);
        if (response.ok) return response;
        const errorText = await response.text().catch(() => 'Unknown error');
        const statusCode = response.status;
        if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
          throw new LLMError(`API error ${statusCode}: ${errorText.slice(0, 500)}`, 'API_ERROR', statusCode);
        }
        lastError = new LLMError(`HTTP ${statusCode}: ${errorText.slice(0, 500)}`, statusCode === 429 ? 'RATE_LIMIT' : 'SERVER_ERROR', statusCode);
      } catch (err) {
        if (err instanceof LLMError && (err.code === 'API_ERROR' || err.code === 'ABORTED')) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError ?? new LLMError('Unknown error after retries', 'NETWORK_ERROR');
  }

  private async fetchRaw(body: ChatCompletionRequest, signal?: AbortSignal): Promise<Response> {
    const base = this.baseUrl.replace(/\/$/, '');
    return fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  }

  private assertConfigured(): void {
    if (!this.config.apiKey) {
      throw new LLMError(`Missing API key for provider ${this.id}. Set llm.apiKey or the matching environment variable.`, 'INVALID_CONFIG');
    }
  }
}

export type LLMErrorCode = 'API_ERROR' | 'NETWORK_ERROR' | 'RATE_LIMIT' | 'SERVER_ERROR' | 'ABORTED' | 'INVALID_CONFIG';

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly statusCode?: number;

  constructor(message: string, code: LLMErrorCode, statusCode?: number) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function finalizeToolCalls(pending: Map<number, { id: string; name: string; argsJson: string }>): ToolCall[] {
  return Array.from(pending.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({ id: tc.id, name: tc.name, arguments: safeParseArguments(tc.argsJson) }))
    .filter(tc => tc.name.length > 0);
}

function safeParseArguments(str: string): Record<string, unknown> {
  if (!str.trim()) return {};
  try {
    const parsed = JSON.parse(str) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return { _raw: str };
  }
}

function safeParseObject(str: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(str) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
