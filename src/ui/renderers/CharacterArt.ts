import chalk from 'chalk';
import type { BuiltInCharacterId, CharacterId } from '../../aesthetic/character/types.js';

interface CharacterArtData {
  nameArt: string[];
  symbol: string;
  titleLine: string;
}

const ROXY_ART: CharacterArtData = {
  nameArt: [
    '  RRR    OOO   X   X  Y   Y',
    '  R  R  O   O   X X    Y Y ',
    '  RRR   O   O    X      Y  ',
    '  R R   O   O   X X     Y  ',
    '  R  R   OOO   X   X    Y  ',
  ],
  symbol: '*',
  titleLine: 'Water King Mage / Coding Mentor',
};

const RUDEUS_ART: CharacterArtData = {
  nameArt: [
    '  RRR   U   U  DDDD   EEEEE  U   U  SSS ',
    '  R  R  U   U  D   D  E      U   U  S   ',
    '  RRR   U   U  D   D  EEEE   U   U  SSS ',
    '  R R   U   U  D   D  E      U   U    S ',
    '  R  R   UUU   DDDD   EEEEE   UUU   SSS ',
  ],
  symbol: '+',
  titleLine: 'Pragmatic Rebuilder / Full-stack Adapter',
};

const ERIS_ART: CharacterArtData = {
  nameArt: [
    '  EEEEE  RRR    III   SSS ',
    '  E      R  R    I   S    ',
    '  EEEE   RRR     I    SSS ',
    '  E      R R     I      S ',
    '  EEEEE  R  R   III  SSS  ',
  ],
  symbol: '!',
  titleLine: 'Direct Reviewer / Action-first Partner',
};

const SYLPHIETTE_ART: CharacterArtData = {
  nameArt: [
    '  SSS   Y   Y  L      PPP   H   H  Y   Y',
    ' S       Y Y   L      P  P  H   H   Y Y ',
    '  SSS     Y    L      PPP   HHHHH    Y  ',
    '    S     Y    L      P     H   H    Y  ',
    ' SSS      Y    LLLLL  P     H   H    Y  ',
  ],
  symbol: '~',
  titleLine: 'Gentle Implementer / Low-risk Maintainer',
};

const NANAHOSHI_ART: CharacterArtData = {
  nameArt: [
    '  N   N   AAA   N   N   AAA   H   H   OOO   SSS   H   H  III',
    '  NN  N  A   A  NN  N  A   A  H   H  O   O S      H   H   I ',
    '  N N N  AAAAA  N N N  AAAAA  HHHHH  O   O  SSS   HHHHH   I ',
    '  N  NN  A   A  N  NN  A   A  H   H  O   O     S  H   H   I ',
    '  N   N  A   A  N   N  A   A  H   H   OOO   SSS   H   H  III',
  ],
  symbol: '#',
  titleLine: 'Experiment-driven Analyst / Evidence-first Engineer',
};

const CHARACTER_ARTS: Record<BuiltInCharacterId, CharacterArtData> = {
  roxy: ROXY_ART,
  rudeus: RUDEUS_ART,
  eris: ERIS_ART,
  sylphiette: SYLPHIETTE_ART,
  nanahoshi: NANAHOSHI_ART,
};

export function renderCharacterSwitch(
  characterId: CharacterId,
  themeColors: { primary: string; secondary: string; accent: string; tagline: string },
  quote: string,
  characterName: string,
  characterNameEn: string,
  customAsciiArt?: string[],
): string {
  const art = CHARACTER_ARTS[characterId as BuiltInCharacterId];
  if (!art && customAsciiArt?.length) {
    return renderCustomCharacterSwitch(customAsciiArt, themeColors, quote, characterName, characterNameEn);
  }
  if (!art) {
    return chalk.hex(themeColors.primary)(`  Character switched to: ${characterName} / ${characterNameEn}`);
  }

  const primary = chalk.hex(themeColors.primary);
  const secondary = chalk.hex(themeColors.secondary);
  const accent = chalk.hex(themeColors.accent);
  const tagline = chalk.hex(themeColors.tagline);
  const lines: string[] = [];

  lines.push('');
  lines.push(primary('  +--------------------------------------------------+'));
  for (const artLine of art.nameArt) {
    lines.push(primary('  |') + secondary(artLine.padEnd(50)) + primary('|'));
  }
  lines.push(primary('  +--------------------------------------------------+'));
  lines.push(accent(`  ${art.symbol} ${art.titleLine}`));
  if (quote) lines.push(tagline(`  "${quote}"`));
  lines.push(chalk.dim('  - theme, status text, and system prompt updated'));
  lines.push('');

  return lines.join('\n');
}

export function getCharacterArt(characterId: CharacterId): CharacterArtData | undefined {
  return CHARACTER_ARTS[characterId as BuiltInCharacterId];
}

function renderCustomCharacterSwitch(
  asciiArt: string[],
  themeColors: { primary: string; secondary: string; accent: string; tagline: string },
  quote: string,
  characterName: string,
  characterNameEn: string,
): string {
  const primary = chalk.hex(themeColors.primary);
  const secondary = chalk.hex(themeColors.secondary);
  const accent = chalk.hex(themeColors.accent);
  const tagline = chalk.hex(themeColors.tagline);
  const lines: string[] = [];

  lines.push('');
  lines.push(primary('  +-- RoxyCode Custom Character --+'));
  for (const artLine of asciiArt.slice(0, 12)) {
    lines.push(secondary(`  ${artLine}`));
  }
  lines.push(accent(`  ${characterName} / ${characterNameEn}`));
  if (quote) lines.push(tagline(`  "${quote}"`));
  lines.push(chalk.dim('  - theme, status text, companion, and behavior profile loaded'));
  lines.push('');
  return lines.join('\n');
}
