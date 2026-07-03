import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { loadCharacterFromDirectory } from '../src/aesthetic/character/custom/CustomCharacterLoader.js';
import { loadCharacterPromptContext } from '../src/aesthetic/character/CharacterPromptLoader.js';
import { validateCharacterPackage } from '../src/aesthetic/character/custom/CharacterPackageValidator.js';
import { DEFAULT_CONFIG } from '../src/core/types/config.js';
import { HookLoader } from '../src/hooks/index.js';
import { WorkflowLoader } from '../src/workflow/index.js';
import { writeCharacterPackageFixture } from './helpers/character-package-fixture.js';

test('character extension sources validate and load package-local hooks workflows prompts and i18n', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-extension-source-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, {
      manifestPatch: {
        contributes: {
          character: 'character.json',
          hooks: 'behaviors/hooks.json',
          workflows: ['behaviors/workflows/*.yml'],
        },
      },
      characterPatch: {
        extensions: {
          hooks: 'behaviors/hooks.json',
          workflows: ['behaviors/workflows/code-review.yml'],
          prompts: {
            systemPrompt: 'behaviors/prompts/system-prompt.md',
            planPrompt: 'behaviors/prompts/plan-prompt.md',
            verificationPrompt: 'behaviors/prompts/verification-prompt.md',
          },
        },
        i18n: {
          'zh-CN': 'i18n/zh-CN.json',
          'en-US': {
            name: 'Roxy Sensei',
            title: 'Careful Coding Teacher',
          },
        },
      },
    });
    await mkdir(join(packageDir, 'behaviors', 'workflows'), { recursive: true });
    await mkdir(join(packageDir, 'behaviors', 'prompts'), { recursive: true });
    await mkdir(join(packageDir, 'i18n'), { recursive: true });
    await writeFile(join(packageDir, 'behaviors', 'hooks.json'), JSON.stringify({
      hooks: [{ id: 'character-style', event: 'before_prompt', kind: 'prompt', prompt: 'Use character package guidance.' }],
    }), 'utf8');
    await writeFile(join(packageDir, 'behaviors', 'workflows', 'code-review.yml'), [
      'id: code-review',
      'name: Character Code Review',
      'description: Review code with the active character package.',
      'prompt: Review the current change.',
      'steps: []',
    ].join('\n'), 'utf8');
    await writeFile(join(packageDir, 'behaviors', 'prompts', 'system-prompt.md'), 'System prompt\n', 'utf8');
    await writeFile(join(packageDir, 'behaviors', 'prompts', 'plan-prompt.md'), 'Plan prompt\n', 'utf8');
    await writeFile(join(packageDir, 'behaviors', 'prompts', 'verification-prompt.md'), 'Verification prompt\n', 'utf8');
    await writeFile(join(packageDir, 'i18n', 'zh-CN.json'), JSON.stringify({
      name: '洛琪希老师',
      title: '谨慎的中文编程导师',
    }), 'utf8');

    const validation = await validateCharacterPackage(packageDir);
    assert.equal(validation.success, true);
    assert.equal(validation.errors.length, 0);

    const loaded = await loadCharacterFromDirectory(packageDir, 'project');
    assert.equal(loaded.extensions?.hooks, resolve(packageDir, 'behaviors', 'hooks.json'));
    assert.deepEqual(loaded.extensions?.workflows, [resolve(packageDir, 'behaviors', 'workflows', 'code-review.yml')]);
    assert.equal(loaded.extensions?.prompts?.systemPrompt, resolve(packageDir, 'behaviors', 'prompts', 'system-prompt.md'));
    assert.equal(loaded.i18n?.['zh-CN']?.name, '洛琪希老师');
    assert.equal(loaded.i18n?.['en-US']?.title, 'Careful Coding Teacher');

    const workflowResult = await new WorkflowLoader({
      cwd: root,
      builtin: false,
      directories: [],
      files: loaded.extensions?.workflows,
    }).load();
    assert.equal(workflowResult.workflows[0]?.id, 'code-review');

    const hookResult = await new HookLoader({
      cwd: root,
      config: structuredClone(DEFAULT_CONFIG),
      files: loaded.extensions?.hooks ? [loaded.extensions.hooks] : [],
    }).load();
    assert.equal(hookResult.hooks[0]?.id, 'character-style');

    const promptContext = await loadCharacterPromptContext(loaded, 'zh-CN');
    assert.match(promptContext ?? '', /System prompt/);
    assert.match(promptContext ?? '', /Plan prompt/);
    assert.match(promptContext ?? '', /Verification prompt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character extension sources reject paths that escape package roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-extension-source-escape-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, {
      characterPatch: {
        extensions: {
          hooks: '../outside/hooks.json',
        },
        i18n: {
          'zh-CN': '../outside/zh-CN.json',
        },
      },
    });

    const validation = await validateCharacterPackage(packageDir);
    assert.equal(validation.success, false);
    const errors = validation.errors.map(error => `${error.path}: ${error.message}`).join('\n');
    assert.match(errors, /character\.json#extensions\.hooks|Path must not contain \.\./);
    assert.match(errors, /character\.json#i18n\.zh-CN|Path must not contain \.\./);

    await assert.rejects(
      () => loadCharacterFromDirectory(packageDir, 'project'),
      /Path must not contain \.\.|Unsafe extension path/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('character manifest contributions reject paths that escape package roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'roxy-character-extension-manifest-escape-'));
  try {
    const packageDir = join(root, 'roxy-sensei');
    await writeCharacterPackageFixture(packageDir, {
      manifestPatch: {
        contributes: {
          hooks: '../outside/hooks.json',
        },
      },
    });

    const validation = await validateCharacterPackage(packageDir);
    assert.equal(validation.success, false);
    const errors = validation.errors.map(error => `${error.path}: ${error.message}`).join('\n');
    assert.match(errors, /manifest\.json#contributes\.hooks|Path must not contain \.\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
