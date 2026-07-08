import type { Character } from '../../aesthetic/character/types.js';
import type { MemoryType } from './types.js';

export interface CharacterMemoryProfile {
  preferredTypes: MemoryType[];
  guidance: string;
}

export function buildCharacterMemoryProfile(character: Character, language: 'zh-CN' | 'en-US'): CharacterMemoryProfile {
  const preferred = new Set<MemoryType>(['user']);
  const behavior = character.behavior;
  const metadataType = character.metadata?.characterType?.toLowerCase() ?? '';
  const tags = (character.metadata?.tags ?? []).map(tag => tag.toLowerCase());

  if (behavior?.explanationStyle === 'teaching' || behavior?.explanationStyle === 'deep' || behavior?.reviewFocus.includes('learning') || metadataType.includes('teacher')) {
    preferred.add('learning');
  }
  if (behavior?.reviewFocus.some(focus => ['correctness', 'security', 'performance', 'maintainability', 'testing'].includes(focus)) || tags.includes('review')) {
    preferred.add('feedback');
  }
  if ((behavior?.workflowBias.length ?? 0) > 0 || metadataType.includes('engineer') || behavior?.preferredMode === 'ultimate') {
    preferred.add('workflow');
    preferred.add('project');
  }
  if (behavior?.reviewFocus.includes('security') || metadataType.includes('research') || character.id === 'nanahoshi') {
    preferred.add('reference');
  }

  return {
    preferredTypes: Array.from(preferred),
    guidance: renderGuidance(character, Array.from(preferred), language),
  };
}

function renderGuidance(character: Character, preferredTypes: MemoryType[], language: 'zh-CN' | 'en-US'): string {
  const name = language === 'en-US' ? character.nameEn : character.name;
  const types = preferredTypes.join(', ');
  if (language === 'en-US') {
    return [
      `Current character memory profile: ${name}.`,
      `Prefer recalling these memory types when relevant: ${types}.`,
      'Use character memory bias only to choose what to emphasize; safety rules and current repository evidence still override memory.',
    ].join(' ');
  }
  return [
    `\u5f53\u524d\u89d2\u8272\u8bb0\u5fc6\u7b56\u7565\uff1a${name}\u3002`,
    `\u76f8\u5173\u65f6\u4f18\u5148\u53c2\u8003\u8fd9\u4e9b\u8bb0\u5fc6\u7c7b\u578b\uff1a${types}\u3002`,
    '\u89d2\u8272\u504f\u7f6e\u53ea\u5f71\u54cd\u5173\u6ce8\u91cd\u70b9\uff1b\u5b89\u5168\u89c4\u5219\u548c\u5f53\u524d\u4ed3\u5e93\u8bc1\u636e\u59cb\u7ec8\u4f18\u5148\u4e8e\u8bb0\u5fc6\u3002',
  ].join(' ');
}
