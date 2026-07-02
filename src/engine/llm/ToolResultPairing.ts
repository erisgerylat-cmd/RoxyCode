import type { Message, MessageContent, ToolCall, ToolResult } from '../../core/types/message.js';

export const SYNTHETIC_TOOL_RESULT_OUTPUT =
  '[RoxyCode synthetic tool_result: missing result repaired before provider request]';

export interface ToolResultPairingReport {
  messages: Message[];
  repaired: boolean;
  insertedSyntheticResults: number;
  removedOrphanResults: number;
  removedDuplicateToolUses: number;
  removedDuplicateToolResults: number;
}

interface ToolResultBlock {
  toolCallId: string;
  result: ToolResult;
}

interface ToolResultCarrier {
  message: Message;
  block: ToolResultBlock;
}

export function normalizeToolResultPairing(messages: Message[]): Message[] {
  return repairToolResultPairing(messages).messages;
}

export function repairToolResultPairing(messages: Message[]): ToolResultPairingReport {
  const output: Message[] = [];
  const seenToolUseIds = new Set<string>();
  const stats = {
    insertedSyntheticResults: 0,
    removedOrphanResults: 0,
    removedDuplicateToolUses: 0,
    removedDuplicateToolResults: 0,
  };

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;

    if (message.role === 'assistant') {
      const assistant = sanitizeAssistantToolUses(message, seenToolUseIds, stats);
      output.push(assistant.message);

      if (assistant.toolCalls.length === 0) {
        continue;
      }

      const followingResults: ToolResultCarrier[] = [];
      const deferredMessages: Message[] = [];
      let j = i + 1;
      while (j < messages.length) {
        const nextMessage = messages[j]!;
        const carriers = getToolResultCarriers(nextMessage);
        if (carriers.length === 0) break;
        followingResults.push(...carriers);
        if (nextMessage.role !== 'tool') {
          const residual = sanitizeNonAssistantMessage(nextMessage);
          if (residual) deferredMessages.push(residual);
        }
        j++;
      }

      const resultById = collectValidToolResults(assistant.toolCalls, followingResults, stats);
      for (const toolCall of assistant.toolCalls) {
        const existing = resultById.get(toolCall.id);
        if (existing) {
          output.push(existing.message);
          continue;
        }
        output.push(createSyntheticToolResultMessage(toolCall, message.timestamp));
        stats.insertedSyntheticResults++;
      }
      output.push(...deferredMessages);

      i = j - 1;
      continue;
    }

    const orphanCarriers = getToolResultCarriers(message);
    if (message.role === 'tool') {
      if (orphanCarriers.length > 0) stats.removedOrphanResults += orphanCarriers.length;
      else stats.removedOrphanResults++;
      continue;
    }

    if (orphanCarriers.length > 0) {
      stats.removedOrphanResults += orphanCarriers.length;
    }
    const sanitized = sanitizeNonAssistantMessage(message);
    if (sanitized) output.push(sanitized);
  }

  const repaired = Object.values(stats).some(value => value > 0);
  return { messages: output, repaired, ...stats };
}

function sanitizeAssistantToolUses(
  message: Message,
  seenToolUseIds: Set<string>,
  stats: Pick<ToolResultPairingReport, 'removedDuplicateToolUses' | 'removedOrphanResults'>,
): { message: Message; toolCalls: ToolCall[] } {
  if (!Array.isArray(message.content)) return { message, toolCalls: [] };

  let changed = false;
  const toolCalls: ToolCall[] = [];
  const content: MessageContent[] = [];

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      changed = true;
      stats.removedOrphanResults++;
      continue;
    }

    if (block.type !== 'tool_use') {
      content.push(block);
      continue;
    }

    if (!block.toolCall.id || seenToolUseIds.has(block.toolCall.id)) {
      changed = true;
      stats.removedDuplicateToolUses++;
      continue;
    }

    seenToolUseIds.add(block.toolCall.id);
    toolCalls.push(block.toolCall);
    content.push(block);
  }

  if (content.length === 0) {
    content.push({
      type: 'text',
      text: '[RoxyCode removed duplicate tool calls before provider request]',
    });
    changed = true;
  }

  return {
    message: changed ? { ...message, content } : message,
    toolCalls,
  };
}

function collectValidToolResults(
  toolCalls: ToolCall[],
  carriers: ToolResultCarrier[],
  stats: Pick<ToolResultPairingReport, 'removedOrphanResults' | 'removedDuplicateToolResults'>,
): Map<string, ToolResultCarrier> {
  const expected = new Set(toolCalls.map(toolCall => toolCall.id));
  const resultById = new Map<string, ToolResultCarrier>();

  for (const carrier of carriers) {
    const id = carrier.block.toolCallId;
    if (!expected.has(id)) {
      stats.removedOrphanResults++;
      continue;
    }
    if (resultById.has(id)) {
      stats.removedDuplicateToolResults++;
      continue;
    }
    resultById.set(id, normalizeToolResultMessage(carrier));
  }

  return resultById;
}

function normalizeToolResultMessage(carrier: ToolResultCarrier): ToolResultCarrier {
  if (carrier.message.role === 'tool' && isSingleToolResultMessage(carrier.message)) {
    return carrier;
  }

  const message: Message = {
    ...carrier.message,
    role: 'tool',
    content: [{ type: 'tool_result', toolCallId: carrier.block.toolCallId, result: carrier.block.result }],
  };
  return { message, block: carrier.block };
}

function createSyntheticToolResultMessage(toolCall: ToolCall, timestamp: number): Message {
  const output = [
    `<tool_result name="${escapeAttribute(toolCall.name)}" status="error">`,
    '\u5de5\u5177\u7ed3\u679c\u7f3a\u5931\uff1aRoxyCode \u5728\u53d1\u9001\u7ed9\u6a21\u578b\u524d\u4fee\u590d\u4e86\u4e00\u4e2a\u672a\u914d\u5bf9\u7684\u5de5\u5177\u8c03\u7528\u3002',
    '\u8fd9\u901a\u5e38\u6765\u81ea\u4f1a\u8bdd\u6062\u590d\u3001\u4e0a\u4e0b\u6587\u538b\u7f29\u6216\u6d41\u5f0f\u8f93\u51fa\u4e2d\u65ad\uff0c\u4e0d\u4ee3\u8868\u5de5\u5177\u771f\u6b63\u6267\u884c\u6210\u529f\u3002',
    `metadata: ${JSON.stringify({ synthetic: true, reason: 'missing_tool_result', tool: toolCall.name, toolCallId: toolCall.id })}`,
    '</tool_result>',
  ].join('\n');

  return {
    role: 'tool',
    content: [{
      type: 'tool_result',
      toolCallId: toolCall.id,
      result: {
        success: false,
        output,
        error: SYNTHETIC_TOOL_RESULT_OUTPUT,
        duration: 0,
        metadata: {
          synthetic: true,
          reason: 'missing_tool_result',
          tool: toolCall.name,
          toolCallId: toolCall.id,
        },
      },
    }],
    timestamp,
  };
}

function getToolResultCarriers(message: Message): ToolResultCarrier[] {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((block): block is Extract<MessageContent, { type: 'tool_result' }> => block.type === 'tool_result')
    .map(block => ({
      message,
      block: { toolCallId: block.toolCallId, result: block.result },
    }));
}

function sanitizeNonAssistantMessage(message: Message): Message | null {
  if (!Array.isArray(message.content)) return message;
  const content = message.content.filter(block => block.type === 'text');
  if (content.length === message.content.length) return message;
  if (content.length === 0) return null;
  return { ...message, content };
}

function isSingleToolResultMessage(message: Message): boolean {
  return Array.isArray(message.content)
    && message.content.length === 1
    && message.content[0]?.type === 'tool_result';
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}




