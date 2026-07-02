import type { AestheticMode, CharacterId } from '../../aesthetic/character/types.js';

export type MCPTransportType = 'stdio' | 'sse' | 'http' | 'streamable-http' | 'ws' | 'websocket';

export interface MCPOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  callbackPort?: number;
  issuerUrl?: string;
  authServerMetadataUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
}

export interface MCPServerConfig {
  type?: MCPTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  oauth?: MCPOAuthConfig;
  enabled?: boolean;
  timeoutMs?: number;
}

export interface RoxyCodeConfig {
  character: {
    current: CharacterId;
    showStartupQuote: boolean;
    demonEye: boolean;
    telepathy: boolean;
  };
  llm: {
    provider: string;
    model: string;
    fallbackModels: string[];
    apiKey?: string;
    baseUrl?: string;
  };
  ui: {
    language: 'zh-CN' | 'en-US';
    aestheticMode: AestheticMode;
  };
  mode: 'auto' | 'lite' | 'economic' | 'standard' | 'ultimate';
  questioning: {
    mode: 'always' | 'smart' | 'minimal' | 'never';
  };
  cost: {
    pricingMethod: 'token' | 'plan' | 'none';
    tokenPricing?: {
      inputPricePer1K: number;
      outputPricePer1K: number;
    };
  };
  mcp: {
    enabled: boolean;
    servers: Record<string, MCPServerConfig>;
    directories: string[];
  };
  security: {
    apiKeyEncryption: boolean;
    fileAccess: {
      mode: 'project-only' | 'unrestricted';
      backupBeforeWrite: boolean;
    };
    shell: {
      mode: 'whitelist' | 'unrestricted';
      requireConfirmation: boolean;
      whitelist: string[];
    };
    highRisk: {
      requireSecondConfirmation: boolean;
    };
  };
  tools: {
    builtin: boolean;
    disabled: string[];
  };
  skills: {
    builtin: boolean;
    directories: string[];
  };
  workflows: {
    builtin: boolean;
    directories: string[];
  };
  memory: {
    auto: boolean;
  };
  context: {
    maxTokens: number;
    enableCompression: boolean;
    compressThreshold: number;
  };
  hooks: {
    enabled: boolean;
    directories: string[];
  };
  plugins: {
    enabled: boolean;
    directories: string[];
    trust: 'project-only' | 'allow-local';
  };
}

export const DEFAULT_CONFIG: RoxyCodeConfig = {
  character: {
    current: 'roxy',
    showStartupQuote: true,
    demonEye: false,
    telepathy: false,
  },
  llm: {
    provider: 'qwen',
    model: 'qwen-max',
    fallbackModels: [],
  },
  ui: {
    language: 'zh-CN',
    aestheticMode: 'balanced',
  },
  mode: 'auto',
  questioning: { mode: 'smart' },
  cost: { pricingMethod: 'none' },
  mcp: { enabled: true, servers: {}, directories: ['.roxycode'] },
  security: {
    apiKeyEncryption: true,
    fileAccess: { mode: 'project-only', backupBeforeWrite: true },
    shell: {
      mode: 'whitelist',
      requireConfirmation: true,
      whitelist: [
        'pwd',
        'ls',
        'dir',
        'type',
        'cat',
        'echo',
        'git status',
        'git diff',
        'git log',
        'git branch',
        'Get-Location',
        'Get-ChildItem',
        'Get-Content',
        'Select-String',
      ],
    },
    highRisk: { requireSecondConfirmation: true },
  },
  tools: {
    builtin: true,
    disabled: [],
  },
  skills: {
    builtin: true,
    directories: ['.roxycode/skills'],
  },
  workflows: {
    builtin: true,
    directories: ['.roxycode/workflows'],
  },
  memory: {
    auto: true,
  },
  context: {
    maxTokens: 0,
    enableCompression: true,
    compressThreshold: 0.8,
  },
  hooks: {
    enabled: true,
    directories: ['.roxycode/hooks'],
  },
  plugins: {
    enabled: true,
    directories: ['.roxycode/plugins'],
    trust: 'project-only',
  },
};
