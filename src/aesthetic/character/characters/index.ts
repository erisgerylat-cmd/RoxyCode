import type { BuiltInCharacterId, Character, CharacterId } from '../types.js';
import { roxy } from './roxy.js';
import { rudeus } from './rudeus.js';
import { eris } from './eris.js';
import { sylphiette } from './sylphiette.js';
import { nanahoshi } from './nanahoshi.js';

export const ALL_CHARACTERS: ReadonlyMap<BuiltInCharacterId, Character> = new Map<BuiltInCharacterId, Character>([
  ['roxy', roxy],
  ['rudeus', rudeus],
  ['eris', eris],
  ['sylphiette', sylphiette],
  ['nanahoshi', nanahoshi],
]);

export const CHARACTER_ORDER: BuiltInCharacterId[] = [
  'roxy',
  'rudeus',
  'eris',
  'sylphiette',
  'nanahoshi',
];

export function isBuiltInCharacterId(id: string): id is BuiltInCharacterId {
  return CHARACTER_ORDER.includes(id as BuiltInCharacterId);
}

export function getCharacter(id: CharacterId): Character | undefined {
  return isBuiltInCharacterId(String(id)) ? ALL_CHARACTERS.get(id as BuiltInCharacterId) : undefined;
}

export function getCharacterList(): Character[] {
  return CHARACTER_ORDER.map(id => ALL_CHARACTERS.get(id)!);
}

export { roxy, rudeus, eris, sylphiette, nanahoshi };
