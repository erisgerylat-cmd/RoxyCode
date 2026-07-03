import { resolve } from 'node:path';
import type { Character } from '../types.js';
import { packCharacterPackage } from './CharacterPackagePacker.js';
import { createCharacterPackageTemplate, type CharacterPackageTemplateResult } from './CharacterPackageTemplate.js';

export interface CharacterPackageExportOptions {
  outDir: string;
  force?: boolean;
  roxychar?: boolean;
}

export interface CharacterPackageExportResult {
  packageDir: string;
  archivePath?: string;
  sha256?: string;
  sha256Path?: string;
  template: CharacterPackageTemplateResult;
}

export async function exportCharacterPackage(
  character: Character,
  options: CharacterPackageExportOptions,
): Promise<CharacterPackageExportResult> {
  const exportCharacter = withExportMetadata(character);
  const packageDir = resolve(options.outDir, String(character.id));
  const template = await createCharacterPackageTemplate({
    id: String(character.id),
    directory: packageDir,
    character: exportCharacter,
    force: options.force,
  });

  if (!options.roxychar) {
    return { packageDir, template };
  }

  const packed = await packCharacterPackage(packageDir, {
    outDir: options.outDir,
    force: options.force,
  });
  return {
    packageDir,
    archivePath: packed.packagePath,
    sha256: packed.sha256,
    sha256Path: packed.sha256Path,
    template,
  };
}

function withExportMetadata(character: Character): Character {
  if (character.source !== 'builtin') return character;
  return {
    ...character,
    metadata: {
      source: builtinSource(character),
      characterType: builtinType(character),
      ageRating: 'everyone',
      ...character.metadata,
      tags: mergeTags(builtinTags(character), character.metadata?.tags),
    },
  };
}

function builtinSource(character: Character): string {
  if (character.id === 'roxy' || character.id === 'rudeus' || character.id === 'eris' || character.id === 'sylphiette' || character.id === 'nanahoshi') {
    return 'Mushoku Tensei';
  }
  return 'RoxyCode Built-in';
}

function builtinType(character: Character): string {
  switch (character.id) {
    case 'roxy':
      return 'teacher';
    case 'eris':
      return 'warrior-reviewer';
    case 'rudeus':
      return 'engineer';
    case 'sylphiette':
      return 'supportive-reviewer';
    case 'nanahoshi':
      return 'researcher';
    default:
      return 'companion';
  }
}

function builtinTags(character: Character): string[] {
  const base = ['roxycode', 'builtin', 'anime'];
  switch (character.id) {
    case 'roxy':
      return [...base, 'teacher', 'magic', 'beginner-friendly'];
    case 'eris':
      return [...base, 'review', 'direct', 'performance'];
    case 'rudeus':
      return [...base, 'engineering', 'learning', 'practical'];
    case 'sylphiette':
      return [...base, 'safe-change', 'maintainability', 'testing'];
    case 'nanahoshi':
      return [...base, 'research', 'security', 'evidence-driven'];
    default:
      return base;
  }
}

function mergeTags(base: string[], existing?: string[]): string[] {
  return [...new Set([...base, ...(existing ?? [])])];
}
