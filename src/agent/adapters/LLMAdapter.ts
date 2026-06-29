import type { Message, ToolCall } from '../../core/types/message.js';
import type { ToolDefinition } from '../../core/types/tool.js';
import type { LLMProvider } from '../../core/types/llm.js';

export interface LLMResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMResponseWithTools extends LLMResponse {
  toolCalls: ToolCall[];
}

export async function chat(
  provider: LLMProvider,
  messages: Message[],
): Promise<LLMResponse> {
  const result = await provider.chat({
    messages,
    tools: [],
  });

  return {
    content: result.text,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  };
}

export async function chatWithTools(
  provider: LLMProvider,
  messages: Message[],
  tools: ToolDefinition[],
): Promise<LLMResponseWithTools> {
  const toolCalls: ToolCall[] = [];
  let content = '';
  let usage = { inputTokens: 0, outputTokens: 0 };

  for await (const chunk of provider.chatStream({ messages, tools })) {
    switch (chunk.type) {
      case 'text':
        content += chunk.text;
        break;
      case 'done':
        toolCalls.push(...chunk.toolCalls);
        usage = {
          inputTokens: chunk.usage.inputTokens,
          outputTokens: chunk.usage.outputTokens,
        };
        break;
    }
  }

  return {
    content,
    toolCalls,
    usage,
  };
}

export function createLLMWrapper(provider: LLMProvider) {
  return {
    async chat(messages: Message[]): Promise<LLMResponse> {
      return chat(provider, messages);
    },

    async chatWithTools(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponseWithTools> {
      return chatWithTools(provider, messages, tools);
    },

    provider,
  };
}
