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
  toolCalls?: ToolCall[];
}

export function createLLMWrapper(provider: LLMProvider) {
  return {
    async chat(messages: Message[]): Promise<LLMResponse> {
      const result = await provider.chat({ messages, tools: [] });
      return {
        content: result.text,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      };
    },

    async chatWithTools(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponseWithTools> {
      let content = '';
      let usage = { inputTokens: 0, outputTokens: 0 };
      const toolCalls: ToolCall[] = [];

      for await (const chunk of provider.chatStream({ messages, tools })) {
        if (chunk.type === 'text') content += chunk.text;
        if (chunk.type === 'done') {
          toolCalls.push(...chunk.toolCalls);
          usage = {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
          };
        }
      }

      return { content, usage, toolCalls };
    },
  };
}
