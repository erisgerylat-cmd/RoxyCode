import type { I18n } from './types.js';

export type Language = 'zh-CN' | 'en-US';

export interface I18nText {
  splash: {
    tipsTitle: string;
    whatsNewTitle: string;
    defaultTips: string[];
    whatsNew: string[];
    tagline: string;
    welcome: string;
    footerSwitch: string;
  };
  commands: {
    categories: Record<string, string>;
    help: {
      description: string;
      usage: string;
      header: string;
      inputHint: string;
      detailHint: string;
      shortcuts: string;
      openPalette: string;
      chooseOrHistory: string;
      complete: string;
      confirm: string;
      closePanel: string;
      exit: string;
      notFound: string;
      seeAll: string;
      descriptionLabel: string;
      categoryLabel: string;
      aliasesLabel: string;
      usageLabel: string;
      examplesLabel: string;
    };
    clear: { description: string; done: string };
    context: {
      description: string;
      usage: string;
      status: string;
      maxTokens: string;
      compress: string;
      threshold: string;
    };
    compact: {
      description: string;
      title: string;
      done: string;
      before: string;
      after: string;
      saved: string;
      strategy: string;
      notNeeded: string;
      failed: string;
      unknownError: string;
    };
    model: {
      description: string;
      title: string;
      auto: string;
      model: string;
      contextWindow: string;
      tools: string;
      supported: string;
      unsupported: string;
      configured: string;
      notConfigured: string;
      configPath: string;
      example: string;
    };
    status: {
      description: string;
      title: string;
      role: string;
      model: string;
      elapsed: string;
      turns: string;
      contextUsage: string;
      autoCompression: string;
      enabled: string;
      disabled: string;
      threshold: string;
      commandCount: string;
      historyCount: string;
      items: string;
    };
    optimize: { description: string; strategies: string; textInput: string };
    project: { description: string; usage: string; init: string };
    profile: { description: string; usage: string; init: string };
    character: { description: string };
    party: { description: string };
    demonEye: { description: string };
    telepathy: { description: string };
    history: {
      description: string;
      title: string;
      empty: string;
      more: string;
    };
    language: {
      description: string;
      usage: string;
      title: string;
      current: string;
      changed: string;
      unchanged: string;
      available: string;
      invalid: string;
      zh: string;
      en: string;
    };
    config: {
      description: string;
      usage: string;
      title: string;
      current: string;
      value: string;
      global: string;
      project: string;
      saved: string;
      scope: string;
      paths: string;
      invalidUsage: string;
      invalidScope: string;
      parseFailed: string;
      missingPath: string;
      examples: string;
    };
    version: { description: string; title: string };
    exit: { description: string; goodbye: string };
    unknownCommand: string;
    typeHelp: string;
    received: string;
    agentMissing: string;
  };
}

export const DEFAULT_LANGUAGE: Language = 'zh-CN';

export function normalizeLanguage(value: unknown): Language {
  if (typeof value !== 'string') return DEFAULT_LANGUAGE;
  const normalized = value.trim().toLowerCase();
  if (['en', 'en-us', 'english'].includes(normalized)) return 'en-US';
  if (['zh', 'zh-cn', 'cn', 'chinese', '中文'].includes(normalized)) return 'zh-CN';
  return DEFAULT_LANGUAGE;
}

export function languageLabel(language: Language): string {
  return language === 'zh-CN' ? '中文' : 'English';
}

export const i18n: Record<Language, I18nText> = {
  'zh-CN': {
    splash: {
      tipsTitle: '使用提示',
      whatsNewTitle: '更新内容',
      defaultTips: [
        '输入 /help 查看可用命令',
        '输入 /mode 切换推理模式',
        '输入 /language en 切换英文界面',
      ],
      whatsNew: [
        'RoxyCode 初始版本发布！',
        '· 四级推理模式 (Lite/Economic/Standard/Ultimate)',
        '· 多 Agent 协同执行',
        '· 向量记忆跨会话召回',
        '· MCP 协议接入外部工具',
      ],
      tagline: '░▒▓  AI 编程助手  ▓▒░',
      welcome: '>_ RoxyCode · 面向中文用户的 AI 编程助手',
      footerSwitch: '/language 切换语言',
    },
    commands: {
      categories: {
        basic: '基础命令',
        dev: '开发辅助',
        workflow: '工作流',
        context: '上下文管理',
        character: '角色与个性化',
        debug: '调试与实验',
        system: '系统命令',
      },
      help: {
        description: '显示帮助信息，查看所有可用命令及其详细说明',
        usage: '/help [命令名]',
        header: '命令帮助',
        inputHint: '输入 /<命令名> 执行命令，直接输入文字与 AI 对话',
        detailHint: '使用 /help <命令名> 查看命令详细帮助',
        shortcuts: '快捷键',
        openPalette: '打开命令面板',
        chooseOrHistory: '选择/浏览历史',
        complete: '补全',
        confirm: '确认',
        closePanel: '关闭面板',
        exit: '退出',
        notFound: '未找到命令',
        seeAll: '输入 /help 查看所有命令',
        descriptionLabel: '描述',
        categoryLabel: '分类',
        aliasesLabel: '别名',
        usageLabel: '用法',
        examplesLabel: '示例',
      },
      clear: { description: '清空当前对话上下文，重新开始干净对话', done: '✓ 对话上下文已清空' },
      context: {
        description: '上下文配置管理：查看状态、设置 token 限制、压缩策略',
        usage: '/context [子命令] [参数]',
        status: '查看当前上下文配置状态',
        maxTokens: '设置最大 token 数（0 = 自动）',
        compress: '启用/禁用自动压缩',
        threshold: '设置压缩阈值 0.1~0.95',
      },
      compact: {
        description: '手动触发上下文压缩，减少 token 使用',
        title: '📦 上下文压缩',
        done: '✓ 压缩完成',
        before: '压缩前',
        after: '压缩后',
        saved: '节省',
        strategy: '策略',
        notNeeded: '当前上下文不需要压缩',
        failed: '压缩失败',
        unknownError: '未知错误',
      },
      model: {
        description: '查看当前 LLM 模型信息和配置',
        title: '🤖 模型信息',
        auto: '自动',
        model: '模型',
        contextWindow: '上下文窗口',
        tools: '工具调用',
        supported: '✓ 支持',
        unsupported: '不支持',
        configured: '✓ 已配置',
        notConfigured: '✗ 未配置',
        configPath: '配置路径: ~/.roxycode/config.json',
        example: '示例: { "llm": { "provider": "qwen", "model": "qwen-max", "apiKey": "sk-..." } }',
      },
      status: {
        description: '查看当前会话状态：角色、模型、上下文使用率',
        title: '📊 会话状态',
        role: '角色',
        model: '模型',
        elapsed: '会话时长',
        turns: '对话轮数',
        contextUsage: '上下文使用',
        autoCompression: '自动压缩',
        enabled: '开启',
        disabled: '关闭',
        threshold: '压缩阈值',
        commandCount: '已注册命令',
        historyCount: '历史记录',
        items: '条',
      },
      optimize: { description: '提示词优化：分析并优化自然语言请求，提升 LLM 理解效果', strategies: '列出所有可用优化策略', textInput: '输入要优化的提示词文本' },
      project: {
        description: '初始化项目画像，生成 ROXY.md 和 .roxycode/project.json',
        usage: '/project init [--force]',
        init: '扫描当前项目并生成项目级说明与结构化画像',
      },
      profile: {
        description: '初始化个人画像，定制语言、技术栈、解释深度、默认角色和模型策略',
        usage: '/profile init [选项]',
        init: '生成个人私有画像',
      },
      character: { description: '角色选择与切换，改变主题色、状态文字和 System Prompt' },
      party: { description: '全员集合！所有角色一起登场' },
      demonEye: { description: '魔眼调试模式 — 显示内部状态和调试信息' },
      telepathy: { description: '念话模式 — 安静简洁的输出风格' },
      history: { description: '查看最近的输入历史记录', title: '📜 输入历史', empty: '暂无历史记录', more: '还有 {count} 条记录' },
      language: {
        description: '切换界面语言，支持中文和英文',
        usage: '/language [zh|en]',
        title: '语言设置',
        current: '当前语言',
        changed: '界面语言已切换为',
        unchanged: '当前已经是',
        available: '可用语言: zh, en',
        invalid: '不支持的语言',
        zh: '中文',
        en: '英文',
      },
      config: {
        description: '查看和修改配置，支持全局/项目作用域',
        usage: '/config [get|set|paths] ...',
        title: '配置',
        current: '当前生效配置',
        value: '值',
        global: '全局配置',
        project: '项目配置',
        saved: '已保存配置',
        scope: '作用域',
        paths: '配置路径',
        invalidUsage: '用法错误',
        invalidScope: '不支持的作用域，请使用 global 或 project',
        parseFailed: '配置值解析失败',
        missingPath: '请提供配置路径',
        examples: '示例: /config get ui.language · /config set character.current roxy --scope project',
      },
      version: { description: '显示 RoxyCode 版本信息', title: '版本信息' },
      exit: { description: '退出 RoxyCode', goodbye: '再见，祝你编程顺利！' },
      unknownCommand: '未知命令',
      typeHelp: '输入 /help 查看可用命令',
      received: '收到',
      agentMissing: '(Agent Loop 尚未实现，请先完成 engine/ 模块)',
    },
  },
  'en-US': {
    splash: {
      tipsTitle: 'Tips for getting started',
      whatsNewTitle: "What's new",
      defaultTips: [
        'Run /help to see available commands',
        'Run /mode to switch reasoning mode',
        'Run /language zh to switch Chinese UI',
      ],
      whatsNew: [
        'RoxyCode initial release',
        '· Four reasoning modes (Lite/Economic/Standard/Ultimate)',
        '· Multi-agent coordination',
        '· Vector memory across sessions',
        '· MCP integration for external tools',
      ],
      tagline: '░▒▓  AI Programming Assistant  ▓▒░',
      welcome: '>_ RoxyCode · AI coding assistant',
      footerSwitch: '/language to switch UI language',
    },
    commands: {
      categories: {
        basic: 'Basic',
        dev: 'Development',
        workflow: 'Workflow',
        context: 'Context',
        character: 'Characters',
        debug: 'Debug',
        system: 'System',
      },
      help: {
        description: 'Show help and list all available commands',
        usage: '/help [command]',
        header: 'Command Help',
        inputHint: 'Type /<command> to run a command, or type text to chat with AI',
        detailHint: 'Use /help <command> for detailed command help',
        shortcuts: 'Shortcuts',
        openPalette: 'open command palette',
        chooseOrHistory: 'select/browse history',
        complete: 'complete',
        confirm: 'confirm',
        closePanel: 'close panel',
        exit: 'exit',
        notFound: 'Command not found',
        seeAll: 'Type /help to see all commands',
        descriptionLabel: 'Description',
        categoryLabel: 'Category',
        aliasesLabel: 'Aliases',
        usageLabel: 'Usage',
        examplesLabel: 'Examples',
      },
      clear: { description: 'Clear current conversation context', done: '✓ Conversation context cleared' },
      context: {
        description: 'Manage context settings: status, token limit, compression strategy',
        usage: '/context [subcommand] [args]',
        status: 'Show current context settings',
        maxTokens: 'Set max token count (0 = auto)',
        compress: 'Enable/disable automatic compression',
        threshold: 'Set compression threshold 0.1~0.95',
      },
      compact: {
        description: 'Manually compress context to reduce token usage',
        title: '📦 Context Compression',
        done: '✓ Compression complete',
        before: 'Before',
        after: 'After',
        saved: 'Saved',
        strategy: 'Strategy',
        notNeeded: 'Current context does not need compression',
        failed: 'Compression failed',
        unknownError: 'Unknown error',
      },
      model: {
        description: 'Show current LLM model and configuration',
        title: '🤖 Model Info',
        auto: 'Auto',
        model: 'Model',
        contextWindow: 'Context window',
        tools: 'Tool calling',
        supported: '✓ Supported',
        unsupported: 'Unsupported',
        configured: '✓ Configured',
        notConfigured: '✗ Not configured',
        configPath: 'Config path: ~/.roxycode/config.json',
        example: 'Example: { "llm": { "provider": "qwen", "model": "qwen-max", "apiKey": "sk-..." } }',
      },
      status: {
        description: 'Show session status: character, model, context usage',
        title: '📊 Session Status',
        role: 'Character',
        model: 'Model',
        elapsed: 'Elapsed',
        turns: 'Turns',
        contextUsage: 'Context',
        autoCompression: 'Auto compression',
        enabled: 'Enabled',
        disabled: 'Disabled',
        threshold: 'Threshold',
        commandCount: 'Commands',
        historyCount: 'History',
        items: 'items',
      },
      optimize: { description: 'Optimize prompts to improve LLM understanding', strategies: 'List all optimization strategies', textInput: 'Enter prompt text to optimize' },
      project: {
        description: 'Initialize a project profile and generate ROXY.md plus .roxycode/project.json',
        usage: '/project init [--force]',
        init: 'Scan this project and generate project guidance plus a structured profile',
      },
      profile: {
        description: 'Initialize your personal profile: language, stack, explanation depth, default character, and model strategy',
        usage: '/profile init [options]',
        init: 'Generate a private personal profile',
      },
      character: { description: 'Select or switch character, theme, status text, and system prompt' },
      party: { description: 'Bring every character on stage' },
      demonEye: { description: 'Demon-eye debug mode: show internal state and diagnostics' },
      telepathy: { description: 'Telepathy mode: quiet and concise output' },
      history: { description: 'Show recent input history', title: '📜 Input History', empty: 'No history yet', more: '{count} more records' },
      language: {
        description: 'Switch UI language between Chinese and English',
        usage: '/language [zh|en]',
        title: 'Language',
        current: 'Current language',
        changed: 'UI language switched to',
        unchanged: 'Already using',
        available: 'Available languages: zh, en',
        invalid: 'Unsupported language',
        zh: 'Chinese',
        en: 'English',
      },
      config: {
        description: 'View and edit configuration with global/project scopes',
        usage: '/config [get|set|paths] ...',
        title: 'Configuration',
        current: 'Effective configuration',
        value: 'Value',
        global: 'Global config',
        project: 'Project config',
        saved: 'Saved config',
        scope: 'Scope',
        paths: 'Config paths',
        invalidUsage: 'Invalid usage',
        invalidScope: 'Unsupported scope. Use global or project',
        parseFailed: 'Failed to parse config value',
        missingPath: 'Please provide a config path',
        examples: 'Examples: /config get ui.language · /config set character.current roxy --scope project',
      },
      version: { description: 'Show RoxyCode version information', title: 'Version Info' },
      exit: { description: 'Exit RoxyCode', goodbye: 'Goodbye. Happy coding!' },
      unknownCommand: 'Unknown command',
      typeHelp: 'Type /help to see available commands',
      received: 'received',
      agentMissing: '(Agent Loop is not implemented yet. Finish engine/ first.)',
    },
  },
};

export function t(language: Language): I18nText {
  return i18n[language] ?? i18n[DEFAULT_LANGUAGE];
}

/**
 * 创建 I18n 实例
 */
export function createI18n(language: Language): I18n {
  const texts = t(language);

  return {
    t(key: string, params?: Record<string, any>): string {
      const keys = key.split('.');
      let value: any = texts;

      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return key; // 键不存在，返回原键
        }
      }

      if (typeof value !== 'string') {
        return key;
      }

      // 替换参数
      if (params) {
        return value.replace(/\{(\w+)\}/g, (_, paramKey) => {
          return params[paramKey]?.toString() || '';
        });
      }

      return value;
    },
    language,
  };
}



