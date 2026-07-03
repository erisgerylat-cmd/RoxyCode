import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ConfigManager } from '../src/core/ConfigManager.js';
import {
  ProfileManager,
  ProfileOnboarding,
  ProjectProfileManager,
  parseRoxyMd,
} from '../src/session/index.js';

test('profile manager loads, updates, and preserves custom character ids', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-profile-manager-'));
  try {
    const manager = new ProfileManager(cwd);
    await manager.save({
      schemaVersion: 1,
      language: 'zh-CN',
      techStack: ['TypeScript'],
      explanationDepth: 'teaching',
      defaultCharacter: 'custom-sensei',
      modelStrategy: 'quality',
      aestheticMode: 'immersive',
      notes: ['prefer Chinese explanations'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const loaded = await manager.load();
    assert.equal(loaded?.defaultCharacter, 'custom-sensei');
    assert.deepEqual(await manager.getTechStack(), ['TypeScript']);

    const updated = await manager.update({ modelStrategy: 'budget', techStack: ['TypeScript', 'Vue'] });
    assert.equal(updated.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(updated.modelStrategy, 'budget');
    assert.deepEqual((await manager.getWorkflowPreferences())?.techStack, ['TypeScript', 'Vue']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('profile onboarding detects project stack and writes the existing profile format', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-profile-onboarding-'));
  try {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({
      name: 'demo',
      dependencies: { react: '^18.0.0', vite: '^5.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }, null, 2));
    await writeFile(join(cwd, 'tsconfig.json'), '{}');

    const onboarding = new ProfileOnboarding(cwd);
    const stack = await onboarding.detectTechStack();
    assert.deepEqual(stack, ['JavaScript', 'React', 'TypeScript', 'Vite']);

    const result = await onboarding.runOnboarding({
      configManager: createConfigManager(),
      force: true,
    });
    assert.equal(result.profile.language, 'zh-CN');
    assert.equal(result.profile.defaultCharacter, 'sylphiette');
    assert.deepEqual(result.profile.techStack, stack);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('project profile manager scans project metadata and parses ROXY.md', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'roxy-project-manager-'));
  try {
    await mkdir(join(cwd, 'src'));
    await mkdir(join(cwd, 'test'));
    await writeFile(join(cwd, 'package.json'), JSON.stringify({
      name: 'demo',
      scripts: { test: 'vitest run', lint: 'eslint src' },
      dependencies: { vue: '^3.0.0' },
      devDependencies: { vitest: '^1.0.0', eslint: '^9.0.0' },
    }, null, 2));
    await writeFile(join(cwd, 'eslint.config.js'), 'export default []');
    await writeFile(join(cwd, 'ROXY.md'), [
      '# ROXY.md',
      '## RoxyCode 工作规则',
      '- 修改前先说明计划。',
      '- 使用 /workflow run bug-fix 处理缺陷。',
      '## 工作流',
      '- /workflow run code-review',
    ].join('\n'));

    const manager = new ProjectProfileManager(cwd);
    const profile = await manager.refresh();
    assert.equal(profile.name, 'demo');
    assert.equal(await manager.getProjectType(), 'single-package');
    assert.deepEqual(profile.structure.sourceDirs, ['src']);
    assert.deepEqual(profile.structure.testDirs, ['test']);
    assert.ok((await manager.getTestFramework()).some(item => item.framework === 'vitest'));
    assert.ok((await manager.getLintConfig()).some(item => item.tool === 'eslint'));

    const manifest = await manager.loadRoxyManifest();
    assert.equal(manifest.exists, true);
    assert.deepEqual(manifest.instructions, ['修改前先说明计划。', '使用 /workflow run bug-fix 处理缺陷。']);
    assert.deepEqual(manifest.workflows, ['使用 /workflow run bug-fix 处理缺陷。', '/workflow run code-review']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('parseRoxyMd extracts instructions and workflow hints from markdown sections', () => {
  const manifest = parseRoxyMd([
    '# ROXY.md',
    '## Instructions',
    '- Keep answers concise.',
    '## Common Commands',
    '- /workflow run spring-crud',
  ].join('\n'));

  assert.deepEqual(manifest.instructions, ['Keep answers concise.']);
  assert.deepEqual(manifest.workflows, ['/workflow run spring-crud']);
});

function createConfigManager(): ConfigManager {
  return {
    get(path: string): unknown {
      if (path === 'ui.language') return 'zh-CN';
      if (path === 'mode') return 'standard';
      if (path === 'character.current') return 'roxy';
      return undefined;
    },
  } as ConfigManager;
}
