import chalk from 'chalk';
import type { Character, CharacterId } from '../../aesthetic/character/types.js';
import type { ToolPermissionPrompt, ToolRiskLevel } from '../../tool/index.js';
import type { Language } from '../../i18n/index.js';

export interface PermissionConfirmPanelOptions {
  prompt: ToolPermissionPrompt;
  second: boolean;
  character: Character;
  language: Language;
}

type PermissionChoice = {
  label: string;
  description: string;
  allow: boolean;
};

export function buildPermissionChoices(language: Language, second: boolean): PermissionChoice[] {
  const isZh = language !== 'en-US';
  if (second) {
    return isZh
      ? [
          { label: '我理解风险，继续执行', description: '执行这个高风险操作，并写入审计日志。', allow: true },
          { label: '取消', description: '拒绝本次工具调用，保持项目不变。', allow: false },
        ]
      : [
          { label: 'I understand, continue', description: 'Run this high-risk action and record it in the audit log.', allow: true },
          { label: 'Cancel', description: 'Reject this tool call and keep the project unchanged.', allow: false },
        ];
  }

  return isZh
    ? [
        { label: '允许一次', description: '只批准当前这一次工具调用。', allow: true },
        { label: '拒绝', description: '不运行该工具，并把拒绝结果返回给 Agent。', allow: false },
      ]
    : [
        { label: 'Allow once', description: 'Approve only this tool call.', allow: true },
        { label: 'Deny', description: 'Do not run this tool and return the denial to the agent.', allow: false },
      ];
}

export async function requestPermissionConfirmation(options: PermissionConfirmPanelOptions): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const choices = buildPermissionChoices(options.language, options.second);
  let selected = options.second ? 1 : 0;
  let renderedLines = 0;

  return new Promise<boolean>((resolve) => {
    const stdin = process.stdin as typeof process.stdin & { isRaw?: boolean };
    const previousRaw = Boolean(stdin.isRaw);

    const cleanup = (allow: boolean): void => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      resolve(allow);
    };

    const redraw = (): void => {
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A`);
        for (let i = 0; i < renderedLines; i++) {
          process.stdout.write('\x1b[2K');
          if (i < renderedLines - 1) process.stdout.write('\x1b[1B');
        }
        process.stdout.write(`\x1b[${Math.max(0, renderedLines - 1)}A\r`);
      }

      const lines = renderPermissionPanel(options, choices, selected);
      renderedLines = lines.length;
      process.stdout.write(lines.join('\n') + '\n');
    };

    const onData = (data: Buffer): void => {
      const text = data.toString('utf8');
      if (text.includes('\x1b[A')) {
        selected = Math.max(0, selected - 1);
        redraw();
        return;
      }
      if (text.includes('\x1b[B')) {
        selected = Math.min(choices.length - 1, selected + 1);
        redraw();
        return;
      }

      for (const byte of data) {
        if (byte === 0x03 || byte === 0x1b) {
          cleanup(false);
          return;
        }
        if (byte === 0x0d || byte === 0x0a) {
          cleanup(choices[selected]?.allow === true);
          return;
        }
        if (byte === 0x31 || byte === 0x32) {
          selected = byte === 0x31 ? 0 : 1;
          redraw();
          return;
        }
      }
    };

    process.stdin.on('data', onData);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    redraw();
  });
}

export function renderPermissionPanel(
  options: PermissionConfirmPanelOptions,
  choices: PermissionChoice[],
  selected: number,
): string[] {
  const { prompt, second, character, language } = options;
  const isZh = language !== 'en-US';
  const theme = character.theme;
  const border = chalk.hex(theme.primary);
  const accent = chalk.hex(theme.accent);
  const danger = chalk.hex(theme.error);
  const success = chalk.hex(theme.success);
  const dim = chalk.hex(theme.dim);
  const width = Math.min(Math.max(68, process.stdout.columns ? process.stdout.columns - 8 : 74), 96);
  const innerWidth = width - 4;
  const title = second ? (isZh ? '二次确认' : 'Second Confirmation') : (isZh ? '权限确认' : 'Permission Request');
  const risk = riskLabel(prompt.riskLevel, language);
  const header = ` ${title} - ${prompt.title} `;
  const lines: string[] = [''];

  lines.push(border(`  +${padCenter(header, width - 2, '-')}+`));
  lines.push(border('  |') + fitLine(`${character.name} / ${character.nameEn} - ${risk}`, innerWidth, accent) + border('|'));
  lines.push(border('  +' + '-'.repeat(width - 2) + '+'));

  for (const line of wrapText(characterSafetyLine(character.id, language, second), innerWidth)) {
    lines.push(border('  |') + fitLine(line, innerWidth, accent) + border('|'));
  }

  for (const line of wrapText(prompt.message, innerWidth)) {
    lines.push(border('  |') + fitLine(line, innerWidth, danger) + border('|'));
  }

  if (prompt.details.length > 0) {
    lines.push(border('  |') + fitLine('', innerWidth, dim) + border('|'));
    for (const detail of prompt.details.slice(0, 8)) {
      for (const line of wrapText(`- ${detail}`, innerWidth)) {
        lines.push(border('  |') + fitLine(line, innerWidth, dim) + border('|'));
      }
    }
    if (prompt.details.length > 8) {
      const moreText = isZh ? `... 还有 ${prompt.details.length - 8} 项` : `... ${prompt.details.length - 8} more`;
      lines.push(border('  |') + fitLine(moreText, innerWidth, dim) + border('|'));
    }
  }

  lines.push(border('  +' + '-'.repeat(width - 2) + '+'));
  choices.forEach((choice, index) => {
    const active = index === selected;
    const marker = active ? '>' : ' ';
    const hotkey = `${index + 1}.`;
    const color = active ? (choice.allow ? success : danger) : dim;
    lines.push(border('  |') + fitLine(`${marker} ${hotkey} ${choice.label}`, innerWidth, color.bold) + border('|'));
    lines.push(border('  |') + fitLine(`    ${choice.description}`, innerWidth, dim) + border('|'));
  });

  const hint = isZh
    ? '方向键选择 - 1/2 快捷键 - Enter 确认 - Esc/Ctrl+C 拒绝'
    : 'Arrow keys select - 1/2 shortcuts - Enter confirm - Esc/Ctrl+C deny';
  lines.push(border('  +' + '-'.repeat(width - 2) + '+'));
  lines.push(border('  |') + fitLine(hint, innerWidth, dim) + border('|'));
  lines.push(border(`  +${'-'.repeat(width - 2)}+`));
  return lines;
}

function characterSafetyLine(characterId: CharacterId, language: Language, second: boolean): string {
  const en = language === 'en-US';
  if (en) {
    return second
      ? 'Character safety note: this action needs explicit second confirmation before it can continue.'
      : 'Character safety note: review the impact before allowing this tool call.';
  }

  const suffix = second
    ? '这是高风险动作，需要你再次确认后才会继续。'
    : '请先确认这个工具调用是否符合你的意图。';
  switch (characterId) {
    case 'roxy':
      return `洛琪希会提醒你：${suffix}`;
    case 'eris':
      return `艾莉丝会直接拦住危险动作：${suffix}`;
    case 'rudeus':
      return `鲁迪会先权衡收益和代价：${suffix}`;
    case 'sylphiette':
      return `希露菲会温和地提醒：${suffix}`;
    case 'nanahoshi':
      return `七星会按实验风险检查：${suffix}`;
    default:
      return `安全提示：${suffix}`;
  }
}

function riskLabel(risk: ToolRiskLevel, language: Language): string {
  if (language === 'en-US') {
    return risk === 'high' ? 'High risk' : risk === 'medium' ? 'Medium risk' : 'Low risk';
  }
  return risk === 'high' ? '高风险' : risk === 'medium' ? '中风险' : '低风险';
}

function wrapText(text: string, width: number): string[] {
  const normalized = text.replace(/\r/g, '').split('\n');
  const lines: string[] = [];
  for (const part of normalized) {
    if (visibleLen(part) <= width) {
      lines.push(part);
      continue;
    }
    let current = '';
    for (const char of [...part]) {
      if (visibleLen(current + char) > width) {
        lines.push(current);
        current = char;
      } else {
        current += char;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function fitLine(text: string, width: number, color: (text: string) => string): string {
  const clipped = visibleLen(text) > width ? clipVisible(text, width - 1) + '…' : text;
  return color(' ' + clipped + ' '.repeat(Math.max(0, width - visibleLen(clipped) - 1)));
}

function padCenter(text: string, width: number, fill: string): string {
  const pad = Math.max(0, width - visibleLen(text));
  const left = Math.floor(pad / 2);
  return fill.repeat(left) + text + fill.repeat(pad - left);
}

function clipVisible(text: string, width: number): string {
  let out = '';
  for (const char of [...text]) {
    if (visibleLen(out + char) > width) break;
    out += char;
  }
  return out;
}

function visibleLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}