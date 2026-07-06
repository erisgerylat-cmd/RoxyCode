import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import {
  CharacterPackageJsonSchema,
  ManifestSchema,
} from '../src/aesthetic/character/CharacterSchema.js';

/**
 * 契约对齐测试。
 *
 * 唯一真相源是 RoxyCode 的 Zod Schema（CharacterSchema.ts）。RoxyStore 的
 * contracts/schemas/*.v1.schema.json 必须与之保持一致。本测试用一组"契约不变量"
 * 锁定关键约束，任一侧漂移都会失败。
 *
 * 若同级存在 ../RoxyStore/contracts/schemas，则额外做跨仓库字段级校验；
 * 否则跳过跨仓库部分（保证本仓库测试自包含、可独立运行）。
 */

const CONTRACT_INVARIANTS = {
  character: {
    personalityType: 'string',
    explanationStyle: ['concise', 'structured', 'teaching', 'deep', 'playful'],
    riskPreference: ['conservative', 'balanced', 'bold'],
    preferredMode: ['lite', 'economic', 'standard', 'ultimate'],
    reviewFocus: ['correctness', 'security', 'performance', 'maintainability', 'testing', 'ux', 'learning'],
    ageRating: ['everyone', '13+', '16+', '18+'],
    required: ['id', 'name', 'nameEn', 'title', 'description', 'personality', 'theme', 'statusText', 'splash', 'easterEggs', 'errorMessages', 'systemPromptPersona'],
  },
  manifest: {
    namePattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    required: ['name', 'version', 'displayName', 'description', 'author'],
  },
} as const;

test('RoxyCode Zod character schema matches contract invariants', () => {
  const schema = z.toJSONSchema(CharacterPackageJsonSchema, { name: 'RoxyCodeCharacterV1' }) as any;
  const props = schema.properties;

  assert.equal(props.personality.type, CONTRACT_INVARIANTS.character.personalityType,
    'personality 必须是 string（契约），不能是 object（旧后端宽松版）');

  assert.deepEqual(
    props.behavior.properties.explanationStyle.enum,
    CONTRACT_INVARIANTS.character.explanationStyle,
    'explanationStyle 枚举必须与契约一致（不含 detailed）',
  );
  assert.deepEqual(props.behavior.properties.riskPreference.enum, CONTRACT_INVARIANTS.character.riskPreference);
  assert.deepEqual(props.behavior.properties.preferredMode.enum, CONTRACT_INVARIANTS.character.preferredMode);

  for (const field of CONTRACT_INVARIANTS.character.required) {
    assert.ok(schema.required.includes(field), `character 必填字段缺失: ${field}`);
  }
});

test('RoxyCode Zod manifest schema matches contract invariants', () => {
  const schema = z.toJSONSchema(ManifestSchema, { name: 'RoxyCodeCharacterManifestV1' }) as any;
  assert.equal(schema.properties.name.pattern, CONTRACT_INVARIANTS.manifest.namePattern);
  for (const field of CONTRACT_INVARIANTS.manifest.required) {
    assert.ok(schema.required.includes(field), `manifest 必填字段缺失: ${field}`);
  }
});

test('generated schemas/character.v1.json satisfies contract invariants', async () => {
  const generated = JSON.parse(await readFile(join(process.cwd(), 'schemas', 'character.v1.json'), 'utf-8')) as any;
  assert.equal(generated.properties.personality.type, 'string');
  assert.deepEqual(
    generated.properties.behavior.properties.explanationStyle.enum,
    CONTRACT_INVARIANTS.character.explanationStyle,
  );
});

test('cross-repo: RoxyStore contracts align with RoxyCode (skipped if RoxyStore absent)', async (t) => {
  const contractsDir = join(process.cwd(), '..', 'RoxyStore', 'contracts', 'schemas');
  const characterContract = join(contractsDir, 'character.v1.schema.json');
  const manifestContract = join(contractsDir, 'manifest.v1.schema.json');

  if (!existsSync(characterContract) || !existsSync(manifestContract)) {
    t.skip('未找到 ../RoxyStore/contracts/schemas，跳过跨仓库校验');
    return;
  }

  const character = JSON.parse(await readFile(characterContract, 'utf-8')) as any;
  const manifest = JSON.parse(await readFile(manifestContract, 'utf-8')) as any;

  // personality 必须是 string
  assert.equal(character.properties.personality.type, 'string',
    'RoxyStore contracts character.personality 必须与 RoxyCode 一致为 string');

  // behavior 枚举一致
  assert.deepEqual(
    character.definitions.behavior.properties.explanationStyle.enum,
    CONTRACT_INVARIANTS.character.explanationStyle,
  );
  assert.deepEqual(
    character.definitions.behavior.properties.riskPreference.enum,
    CONTRACT_INVARIANTS.character.riskPreference,
  );
  assert.deepEqual(
    character.definitions.behavior.properties.preferredMode.enum,
    CONTRACT_INVARIANTS.character.preferredMode,
  );

  // required 一致
  for (const field of CONTRACT_INVARIANTS.character.required) {
    assert.ok(character.required.includes(field), `RoxyStore contract character 缺少必填字段: ${field}`);
  }

  // manifest 对齐
  assert.equal(manifest.properties.name.pattern, CONTRACT_INVARIANTS.manifest.namePattern);
  for (const field of CONTRACT_INVARIANTS.manifest.required) {
    assert.ok(manifest.required.includes(field), `RoxyStore contract manifest 缺少必填字段: ${field}`);
  }
});
