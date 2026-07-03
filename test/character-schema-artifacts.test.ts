import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

test('generated character package json schemas are parseable and editor-ready', async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), 'schemas', 'manifest.v1.json'), 'utf-8')) as Record<string, any>;
  const character = JSON.parse(await readFile(join(process.cwd(), 'schemas', 'character.v1.json'), 'utf-8')) as Record<string, any>;

  assert.equal(manifest.$id, 'https://roxycode.dev/schemas/manifest.v1.json');
  assert.equal(character.$id, 'https://roxycode.dev/schemas/character.v1.json');
  assert.equal(manifest.properties.name.pattern, '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  assert.equal(manifest.properties.main.default, 'character.json');

  const statusText = character.properties.statusText;
  assert.equal(statusText.properties.reading.type, 'string');
  assert.equal(statusText.properties.step.type, 'string');
  assert.equal(JSON.stringify(character).includes('function'), false);
});
