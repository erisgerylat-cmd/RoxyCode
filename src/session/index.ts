/**
 * Session layer barrel exports.
 *
 * Implemented in this stage:
 * - SessionStore: JSONL transcript persistence, resume lookup, export, rewind.
 * - microcompactMessages: lightweight pre-request compaction for old tool results.
 * - SummaryStrategy: model-based context compaction before truncation fallback.
 */

export { SessionStore } from './store/SessionStore.js';
export type { SessionEvent, SessionInfo } from './store/SessionStore.js';
export { microcompactMessages, estimateMessagesTokens } from './context/MicroCompact.js';
export { SummaryStrategy } from './context/strategies/SummaryStrategy.js';
export * from './memory/index.js';