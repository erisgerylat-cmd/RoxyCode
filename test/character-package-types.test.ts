import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Character } from '../src/aesthetic/character/types.js';

test('character package fields support marketplace-ready manifests', () => {
  const character = {
    id: 'market-roxy',
    name: '市场洛琪希',
    nameEn: 'Market Roxy',
    title: '可安装角色包示例',
    description: '用于验证 RoxyCode 标准角色包字段。',
    personality: '教学友好、审查谨慎。',
    theme: {
      primary: '#5B9BD5',
      secondary: '#7EC8E3',
      accent: '#FFD166',
      tagline: '#98D8C8',
      dim: '#888888',
      error: '#E85D75',
      success: '#4ECDC4',
    },
    statusText: {
      thinking: '思考中',
      analyzing: '分析中',
      planning: '规划中',
      executing: '执行中',
      reading: (file: string) => `读取 ${file}`,
      writing: (file: string) => `写入 ${file}`,
      running: (cmd: string) => `运行 ${cmd}`,
      searching: '搜索中',
      waiting: '等待中',
      done: '完成',
      error: '错误',
      step: (current: number, total: number, desc: string) => `${current}/${total} ${desc}`,
    },
    splash: {
      tagline: 'Personal Anime Coding Workbench',
      welcome: 'Welcome back.',
      asciiArt: ['ROXY CODE'],
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
      toolFailed: (tool: string) => `${tool} 执行失败。`,
      permissionDenied: '权限不足。',
      rateLimit: '请求过快。',
      contextOverflow: '上下文溢出。',
    },
    systemPromptPersona: 'You are a RoxyCode character package example.',
    packageInfo: {
      packageName: 'roxycode-character-market-roxy',
      version: '1.0.0',
      author: { name: 'RoxyCode Team', email: 'team@example.com', url: 'https://example.com' },
      license: 'MIT',
      repository: 'https://example.com/repo.git',
      installPath: 'D:/RoxyCode/characters/market-roxy',
      installedAt: '2026-07-02T00:00:00.000Z',
    },
    assets: {
      icon: 'assets/icon.png',
      avatar: 'assets/avatar.png',
      splashArt: ['assets/splash/roxy.txt'],
      sprites: {
        idle: ['assets/sprites/idle-1.txt'],
        thinking: ['assets/sprites/thinking-1.txt'],
        success: ['assets/sprites/success-1.txt'],
        warning: ['assets/sprites/warning-1.txt'],
        error: ['assets/sprites/error-1.txt'],
      },
      sounds: {
        notification: 'assets/sounds/notification.wav',
        success: 'assets/sounds/success.wav',
        error: 'assets/sounds/error.wav',
      },
    },
    extensions: {
      hooks: 'hooks/hooks.json',
      workflows: ['workflows/vue-page.yml'],
      prompts: {
        systemPrompt: 'prompts/system.md',
        planPrompt: 'prompts/plan.md',
        verificationPrompt: 'prompts/verify.md',
      },
      tools: ['tools/tools.json'],
    },
    i18n: {
      'en-US': {
        name: 'Market Roxy',
        title: 'Installable Character Package Example',
        description: 'Validates RoxyCode character package fields.',
        personality: 'Teaching-friendly and careful during review.',
        statusText: { thinking: 'Thinking' },
        easterEggs: { startup: ['Ready.'] },
        errorMessages: { generic: 'Something went wrong.' },
      },
    },
    metadata: {
      source: 'RoxyCode original',
      characterType: 'teacher',
      tags: ['teaching', 'review', 'anime'],
      ageRating: 'everyone',
    },
  } satisfies Character;

  assert.equal(character.packageInfo.packageName, 'roxycode-character-market-roxy');
  assert.equal(character.assets.sprites?.thinking?.[0], 'assets/sprites/thinking-1.txt');
  assert.equal(character.extensions.prompts?.verificationPrompt, 'prompts/verify.md');
  assert.equal(character.i18n['en-US']?.statusText?.thinking, 'Thinking');
  assert.equal(character.metadata.ageRating, 'everyone');
});
