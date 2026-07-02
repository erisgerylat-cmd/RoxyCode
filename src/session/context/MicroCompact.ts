import type { Message, MessageContent, ToolResult } from '../../core/types/message.js';

export const MICROCOMPACT_CLEARED_MESSAGE = '[RoxyCode microcompact: old tool result shortened]';

const DEFAULT_PRESERVE_RECENT_TOOL_RESULTS = 4;
const DEFAULT_MIN_TOOL_RESULT_CHARS = 1_500;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 900;
const DEFAULT_MAX_METADATA_CHARS = 600;

const COMPACTABLE_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'grep_search',
  'execute_command',
  'git',
]);

export interface MicroCompactOptions {
  preserveRecentToolResults?: number;
  minToolResultChars?: number;
  maxToolResultChars?: number;
}

export interface MicroCompactResult {
  messages: Message[];
  changed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  compactedToolResults: number;
}

interface ToolResultLocation {
  messageIndex: number;
  blockIndex: number;
  toolCallId: string;
}

export function microcompactMessages(messages: Message[], options: MicroCompactOptions = {}): MicroCompactResult {
  const tokensBefore = estimateMessagesTokens(messages);
  if (messages.length === 0) {
    return { messages, changed: false, tokensBefore, tokensAfter: tokensBefore, compactedToolResults: 0 };
  }

  const preserveRecent = Math.max(1, options.preserveRecentToolResults ?? DEFAULT_PRESERVE_RECENT_TOOL_RESULTS);
  const minToolResultChars = Math.max(200, options.minToolResultChars ?? DEFAULT_MIN_TOOL_RESULT_CHARS);
  const maxToolResultChars = Math.max(120, options.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS);
  const toolNamesById = collectToolUseNames(messages);
  const resultLocations = collectCompactableToolResults(messages, toolNamesById);
  const keepIds = new Set(resultLocations.slice(-preserveRecent).map(location => location.toolCallId));

  let compactedToolResults = 0;
  const nextMessages = messages.map((message, messageIndex) => {
    if (!Array.isArray(message.content)) return message;

    let touched = false;
    const content = message.content.map((block, blockIndex): MessageContent => {
      if (block.type !== 'tool_result') return block;
      if (keepIds.has(block.toolCallId)) return block;
      if (block.result.metadata?.microcompacted === true) return block;
      if (!resultLocations.some(location => location.messageIndex === messageIndex && location.blockIndex === blockIndex)) return block;

      const originalOutput = renderToolResultOutput(block.result);
      if (originalOutput.length < minToolResultChars || originalOutput === MICROCOMPACT_CLEARED_MESSAGE) {
        return block;
      }

      touched = true;
      compactedToolResults++;
      return {
        ...block,
        result: {
          ...block.result,
          output: renderCompactedToolResult(block.result, originalOutput, maxToolResultChars),
          metadata: {
            ...block.result.metadata,
            microcompacted: true,
            originalChars: originalOutput.length,
          },
        },
      };
    });

    return touched ? { ...message, content } : message;
  });

  const changed = compactedToolResults > 0;
  const tokensAfter = changed ? estimateMessagesTokens(nextMessages) : tokensBefore;
  return {
    messages: changed ? nextMessages : messages,
    changed,
    tokensBefore,
    tokensAfter,
    compactedToolResults,
  };
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function estimateMessageTokens(message: Message): number {
  if (message.metadata?.tokens) {
    return message.metadata.tokens.input + message.metadata.tokens.output;
  }
  return estimateTextTokens(messageToTokenText(message));
}

function collectToolUseNames(messages: Message[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'tool_use') names.set(block.toolCall.id, block.toolCall.name);
    }
  }
  return names;
}

function collectCompactableToolResults(messages: Message[], toolNamesById: Map<string, string>): ToolResultLocation[] {
  const locations: ToolResultLocation[] = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (!Array.isArray(message.content)) continue;

    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
      const block = message.content[blockIndex];
      if (block.type !== 'tool_result') continue;
      const toolName = toolNamesById.get(block.toolCallId);
      if (!toolName || !COMPACTABLE_TOOLS.has(toolName)) continue;
      locations.push({ messageIndex, blockIndex, toolCallId: block.toolCallId });
    }
  }
  return locations;
}

function renderCompactedToolResult(result: ToolResult, originalOutput: string, maxChars: number): string {
  const metadata = result.metadata ? JSON.stringify(result.metadata) : '{}';
  const clippedMetadata = metadata.length > DEFAULT_MAX_METADATA_CHARS
    ? `${metadata.slice(0, DEFAULT_MAX_METADATA_CHARS)}...`
    : metadata;
  const preview = clipMiddle(originalOutput, maxChars);
  return [
    MICROCOMPACT_CLEARED_MESSAGE,
    `success: ${result.success}`,
    `durationMs: ${result.duration}`,
    `originalChars: ${originalOutput.length}`,
    `metadata: ${clippedMetadata}`,
    'preview:',
    preview,
  ].join('\n');
}

function renderToolResultOutput(result: ToolResult): string {
  if (!result.success && result.error) return `${result.error}\n${result.output}`;
  return result.output;
}

function messageToTokenText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'tool_use') return `${block.toolCall.name} ${JSON.stringify(block.toolCall.arguments)}`;
    return renderToolResultOutput(block.result);
  }).join('\n');
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

function clipMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.max(80, Math.floor(maxChars * 0.7));
  const tailChars = Math.max(40, maxChars - headChars);
  return [
    text.slice(0, headChars).trimEnd(),
    `[... ${text.length - headChars - tailChars} chars compacted ...]`,
    text.slice(-tailChars).trimStart(),
  ].join('\n');
}
