import type { ConfigManager } from '../../core/ConfigManager.js';
import type { LLMProvider, LLMProviderConfig } from '../../core/types/llm.js';
import { LLMError } from './BaseLLMProvider.js';
import { QwenProvider } from './QwenProvider.js';
import { GLMProvider } from './GLMProvider.js';
import { DeepSeekProvider } from './DeepSeekProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

type ProviderConstructor = new (config: LLMProviderConfig) => LLMProvider;

const PROVIDER_REGISTRY: Record<string, ProviderConstructor> = {
  qwen: QwenProvider,
  dashscope: QwenProvider,
  glm: GLMProvider,
  bigmodel: GLMProvider,
  deepseek: DeepSeekProvider,
  openai: OpenAIProvider,
  compatible: OpenAIProvider,
};

const DEFAULT_MODELS: Record<string, string> = {
  qwen: 'qwen-max',
  dashscope: 'qwen-max',
  glm: 'glm-5',
  bigmodel: 'glm-5',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o',
  compatible: 'gpt-4o',
};

export class LLMFactory {
  static create(configManager: ConfigManager): LLMProvider {
    const providerId = normalizeProviderId((configManager.get('llm.provider') as string) || 'qwen');
    const defaultModel = DEFAULT_MODELS[providerId] || 'qwen-max';
    const model = (configManager.get('llm.model') as string) || defaultModel;
    const apiKey = (configManager.get('llm.apiKey') as string) || '';
    const baseUrl = (configManager.get('llm.baseUrl') as string) || undefined;
    const fallbackModels = readFallbackModels(configManager.get('llm.fallbackModels'));

    const ProviderClass = PROVIDER_REGISTRY[providerId];
    if (!ProviderClass) {
      throw new LLMError(
        `Unknown LLM provider: "${providerId}". Available: ${Object.keys(PROVIDER_REGISTRY).join(', ')}`,
        'INVALID_CONFIG',
      );
    }

    return new ProviderClass({ apiKey, model, baseUrl, fallbackModels, providerId });
  }

  static getAvailableProviders(): string[] {
    return Object.keys(PROVIDER_REGISTRY);
  }

  static getDefaultModel(providerId: string): string | undefined {
    return DEFAULT_MODELS[normalizeProviderId(providerId)];
  }

  static register(id: string, provider: ProviderConstructor, defaultModel?: string): void {
    const normalized = normalizeProviderId(id);
    PROVIDER_REGISTRY[normalized] = provider;
    if (defaultModel) DEFAULT_MODELS[normalized] = defaultModel;
  }
}

function readFallbackModels(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'aliyun' || normalized === 'tongyi') return 'qwen';
  if (normalized === 'zhipu' || normalized === 'bigmodel') return 'glm';
  if (normalized === 'openai-compatible' || normalized === 'openai_compatible') return 'compatible';
  return normalized;
}
