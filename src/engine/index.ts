/**
 * engine/ 引擎层 barrel export
 *
 * 引擎层包含：
 * - llm/     — LLM Provider 实现（Qwen/GLM/DeepSeek/OpenAI）
 * - agent/   — Agent Loop（Lite/Economic/Standard/Ultimate）
 */

// ── LLM 模块 ──
export { BaseLLMProvider, LLMError } from './llm/BaseLLMProvider.js';
export type { LLMErrorCode } from './llm/BaseLLMProvider.js';
export { QwenProvider } from './llm/QwenProvider.js';
export { GLMProvider } from './llm/GLMProvider.js';
export { DeepSeekProvider } from './llm/DeepSeekProvider.js';
export { OpenAIProvider } from './llm/OpenAIProvider.js';
export { LLMFactory } from './llm/LLMFactory.js';

// ── Agent Loop 模块 ──
export { AgentLoop, getAgentModeSpec, isConfigurableAgentMode, normalizeAgentMode } from './agent/index.js';
export type {
  AgentLoopEvent,
  AgentLoopMode,
  AgentLoopOptions,
  AgentModeSpec,
  AgentRunInput,
} from './agent/index.js';

