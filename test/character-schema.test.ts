import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CharacterSchema, ManifestSchema, validateCharacterJson, validateManifest } from '../src/aesthetic/character/CharacterSchema.js';

const validManifest = {
  $schema: 'https://roxycode.dev/schemas/manifest.v1.json',
  name: 'roxy-sensei',
  version: '1.2.0',
  displayName: '洛琪希老师',
  description: '温柔耐心的编程导师，适合中文初学者使用。',
  author: { name: 'tanghao', email: 'tanghao@example.com', url: 'https://github.com/tanghao' },
  license: 'MIT',
  repository: { type: 'git', url: 'https://github.com/roxycode/character-roxy-sensei' },
  keywords: ['anime', 'teacher'],
  categories: ['anime', 'teaching'],
  engines: { roxycode: '>=0.2.0' },
  main: 'character.json',
  contributes: {
    character: 'character.json',
    workflows: ['behaviors/workflows/code-review.yml'],
    hooks: 'behaviors/hooks.json',
    themes: ['themes/terminal-colors.json'],
  },
  dependencies: { '@roxycode/workflow-base': '^1.0.0' },
  metadata: {
    source: 'Mushoku Tensei',
    characterType: 'teacher',
    tags: ['blue-hair', 'magic'],
    ageRating: 'everyone',
    preview: 'https://example.com/preview.gif',
  },
};

const validCharacter = {
  id: 'roxy-sensei',
  name: '洛琪希老师',
  nameEn: 'Roxy Sensei',
  title: '温柔耐心的编程导师',
  description: '适合中文初学者和希望获得清晰解释的开发者。',
  personality: '耐心、严谨、善于拆解复杂问题。',
  theme: {
    primary: '#5B9BD5',
    secondary: '#7EC8E3',
    accent: '#FFD166',
    tagline: 'RoxyCode',
    dim: '#888888',
    error: '#E85D75',
    success: '#4ECDC4',
  },
  behavior: {
    explanationStyle: 'teaching',
    reviewFocus: ['correctness', 'testing', 'learning'],
    riskPreference: 'conservative',
    preferredMode: 'standard',
    workflowBias: ['explain before editing'],
    responseRules: ['use clear Chinese'],
  },
  statusText: {
    thinking: '思考中',
    analyzing: '分析中',
    planning: '规划中',
    executing: '执行中',
    reading: '读取 {file}',
    writing: '写入 {file}',
    running: '运行 {cmd}',
    searching: '搜索中',
    waiting: '等待中',
    done: '完成',
    error: '错误',
    step: '步骤 {current}/{total}: {desc}',
  },
  splash: {
    asciiArt: ['ROXY CODE'],
    tagline: 'Personal Anime Coding Workbench',
    welcome: 'Welcome back.',
    tips: ['Use /character to switch roles.'],
  },
  easterEggs: {
    startup: ['开始吧。'],
    success: ['做得不错。'],
    error: ['我们复盘一下。'],
    idle: ['需要我帮忙吗？'],
    special: {},
  },
  errorMessages: {
    generic: '出错了。',
    networkError: '网络错误。',
    tokenLimit: '上下文过长。',
    toolFailed: '{tool} 执行失败。',
    permissionDenied: '权限不足。',
    rateLimit: '请求过快。',
    contextOverflow: '上下文溢出。',
  },
  systemPromptPersona: 'You are Roxy Sensei, a careful teaching coding partner.',
  source: 'marketplace',
  packageInfo: {
    packageName: 'roxy-sensei',
    version: '1.2.0',
    author: { name: 'tanghao', email: 'tanghao@example.com', url: 'https://github.com/tanghao' },
    license: 'MIT',
    repository: 'https://github.com/roxycode/character-roxy-sensei',
    installPath: 'D:/RoxyCode/characters/roxy-sensei',
    installedAt: '2026-07-02T00:00:00.000Z',
  },
  assets: {
    icon: 'assets/icon.png',
    avatar: 'assets/avatar.png',
    splashArt: ['assets/splash-art.txt'],
    sprites: {
      idle: ['assets/sprites/idle-1.txt'],
      thinking: ['assets/sprites/thinking.txt'],
      success: ['assets/sprites/success.txt'],
      error: ['assets/sprites/error.txt'],
    },
  },
  extensions: {
    hooks: 'behaviors/hooks.json',
    workflows: ['behaviors/workflows/code-review.yml'],
    prompts: { systemPrompt: 'behaviors/prompts/system-prompt.md' },
  },
  i18n: {
    'en-US': { name: 'Roxy Sensei', statusText: { thinking: 'Thinking' } },
  },
  metadata: {
    source: 'Mushoku Tensei',
    characterType: 'teacher',
    tags: ['blue-hair', 'magic'],
    ageRating: 'everyone',
  },
};

test('manifest schema accepts marketplace-ready manifest files', () => {
  const parsed = validateManifest(validManifest);
  assert.equal(parsed.name, 'roxy-sensei');
  assert.equal(parsed.main, 'character.json');
});

test('manifest schema defaults main to character.json', () => {
  const parsed = ManifestSchema.parse({ ...validManifest, main: undefined });
  assert.equal(parsed.main, 'character.json');
});

test('manifest schema rejects non-kebab package names and path traversal', () => {
  assert.equal(ManifestSchema.safeParse({ ...validManifest, name: 'Roxy Sensei' }).success, false);
  assert.equal(ManifestSchema.safeParse({ ...validManifest, main: '../character.json' }).success, false);
});

test('character schema accepts character package json with template strings', () => {
  const parsed = validateCharacterJson(validCharacter);
  assert.equal(parsed.id, 'roxy-sensei');
  assert.equal(parsed.source, 'marketplace');
  assert.equal(parsed.assets?.icon, 'assets/icon.png');
});

test('character schema accepts runtime renderer functions for built-in characters', () => {
  const parsed = CharacterSchema.parse({
    ...validCharacter,
    statusText: {
      ...validCharacter.statusText,
      reading: (file: string) => `读取 ${file}`,
      step: (current: number, total: number, desc: string) => `${current}/${total} ${desc}`,
    },
    errorMessages: {
      ...validCharacter.errorMessages,
      toolFailed: (tool: string) => `${tool} failed`,
    },
  });
  assert.equal(typeof parsed.statusText.reading, 'function');
});

test('character schema rejects invalid colors and unsafe package paths', () => {
  assert.equal(CharacterSchema.safeParse({ ...validCharacter, theme: { ...validCharacter.theme, primary: 'blue' } }).success, false);
  assert.equal(CharacterSchema.safeParse({ ...validCharacter, assets: { icon: '../secret.png' } }).success, false);
});
