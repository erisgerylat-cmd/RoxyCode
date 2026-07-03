import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CharacterPackageJsonSchema,
  ManifestSchema,
} from '../src/aesthetic/character/CharacterSchema.js';

type JsonSchema = Record<string, unknown>;

const SCHEMA_DIR = join(process.cwd(), 'schemas');

async function main(): Promise<void> {
  await mkdir(SCHEMA_DIR, { recursive: true });

  await writeSchema('manifest.v1.json', enrichSchema(
    z.toJSONSchema(ManifestSchema, { name: 'RoxyCodeCharacterManifestV1' }) as JsonSchema,
    {
      id: 'https://roxycode.dev/schemas/manifest.v1.json',
      title: 'RoxyCode Character Package Manifest v1',
      description: 'Manifest schema for installable RoxyCode character packages.',
    },
  ));

  await writeSchema('character.v1.json', enrichSchema(
    z.toJSONSchema(CharacterPackageJsonSchema, { name: 'RoxyCodeCharacterV1' }) as JsonSchema,
    {
      id: 'https://roxycode.dev/schemas/character.v1.json',
      title: 'RoxyCode Character Definition v1',
      description: 'JSON-only character definition schema for RoxyCode character packages.',
    },
  ));
}

function enrichSchema(
  schema: JsonSchema,
  metadata: { id: string; title: string; description: string },
): JsonSchema {
  return {
    $id: metadata.id,
    title: metadata.title,
    description: metadata.description,
    ...schema,
  };
}

async function writeSchema(fileName: string, schema: JsonSchema): Promise<void> {
  await writeFile(join(SCHEMA_DIR, fileName), `${JSON.stringify(schema, null, 2)}\n`, 'utf-8');
}

await main();
