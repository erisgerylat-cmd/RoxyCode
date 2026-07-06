import type { AgentLoopMode, AgentModeSpec } from './types.js';

const MODE_SPECS: Record<AgentLoopMode, AgentModeSpec> = {
  lite: {
    mode: 'lite',
    label: 'Lite',
    description: '\u5355\u8f6e\u95ee\u7b54\uff1a\u6700\u5feb\u3001\u6210\u672c\u6700\u4f4e\uff0c\u4e0d\u4e3b\u52a8\u8c03\u7528\u5de5\u5177\u3002',
    maxIterations: 1,
    allowTools: false,
    requiresPlan: false,
    requiresVerification: false,
    parallelAgents: 1,
  },
  economic: {
    mode: 'economic',
    label: 'Economic',
    description: 'ReAct \u5de5\u5177\u5faa\u73af\uff1a\u5728\u5fc5\u8981\u65f6\u8bfb\u6587\u4ef6\u3001\u641c\u7d22\u6216\u6267\u884c\u547d\u4ee4\uff0c\u63a7\u5236\u8f6e\u6570\u548c\u6210\u672c\u3002',
    maxIterations: 4,
    allowTools: true,
    requiresPlan: false,
    requiresVerification: false,
    parallelAgents: 1,
  },
  standard: {
    mode: 'standard',
    label: 'Standard',
    description: '\u8ba1\u5212 -> \u6267\u884c -> \u9a8c\u8bc1\uff1a\u9002\u5408\u5e38\u89c4\u5f00\u53d1\u4efb\u52a1\uff0c\u8f93\u51fa\u66f4\u7a33\u3002',
    maxIterations: 6,
    allowTools: true,
    requiresPlan: true,
    requiresVerification: true,
    parallelAgents: 1,
  },
  plan: {
    mode: 'plan',
    label: 'Plan',
    description: '\u53ea\u8bfb\u89c4\u5212\uff1a\u5148\u751f\u6210\u65b9\u6848\uff0c\u53ea\u5141\u8bb8\u8bfb\u53d6/\u641c\u7d22/Todo \u7c7b\u5de5\u5177\uff0c\u7b49\u5f85\u7528\u6237\u6279\u51c6\u540e\u518d\u6267\u884c\u3002',
    maxIterations: 4,
    allowTools: true,
    requiresPlan: true,
    requiresVerification: false,
    parallelAgents: 1,
    toolPermissionMode: 'read-only',
  },
  ultimate: {
    mode: 'ultimate',
    label: 'Ultimate',
    description: '\u591a Agent \u5e76\u884c\uff1aCoordinator \u62c6\u89e3\u4efb\u52a1\uff0c\u5b50 Agent \u5e76\u884c\u5206\u6790\uff0c\u4e3b Agent \u6c47\u603b\u6267\u884c\u5e76\u9a8c\u8bc1\u3002',
    maxIterations: 8,
    allowTools: true,
    requiresPlan: true,
    requiresVerification: true,
    parallelAgents: 3,
  },
};

export function getAgentModeSpec(mode: AgentLoopMode): AgentModeSpec {
  return MODE_SPECS[mode] ?? MODE_SPECS.standard;
}

export function normalizeAgentMode(mode: string | undefined): AgentLoopMode {
  if (mode === 'lite' || mode === 'economic' || mode === 'standard' || mode === 'ultimate' || mode === 'plan') return mode;
  if (mode === 'auto') return 'standard';
  return 'standard';
}

export function isConfigurableAgentMode(mode: string | undefined): mode is AgentLoopMode | 'auto' {
  return mode === 'auto' || mode === 'lite' || mode === 'economic' || mode === 'standard' || mode === 'ultimate' || mode === 'plan';
}
