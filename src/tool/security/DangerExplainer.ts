import type { CharacterId } from '../../aesthetic/character/types.js';
import type { ToolExecutionContext, ToolPermissionPrompt, ToolRiskLevel } from '../types.js';

export interface DangerPromptInput {
  title: string;
  action: string;
  reasons: string[];
  details: string[];
  riskLevel: ToolRiskLevel;
  secondConfirmation?: boolean;
}

export function buildDangerPrompt(input: DangerPromptInput, ctx: ToolExecutionContext): ToolPermissionPrompt {
  const isZh = ctx.language !== 'en-US';
  const characterId = ctx.characterId ?? ctx.config.character.current;
  const prefix = isZh ? characterPrefix(characterId) : 'Safety check:';
  const second = input.secondConfirmation
    ? (isZh ? '这是二次确认：该操作被判定为高危，只有你明确理解风险后才应继续。' : 'Second confirmation: this operation is high risk.')
    : '';
  return {
    title: input.title,
    message: isZh
      ? `${prefix}${input.action}${second ? ` ${second}` : ''}`
      : `${prefix} ${input.action}${second ? ` ${second}` : ''}`,
    details: [
      ...(input.reasons.length > 0 ? input.reasons.map(reason => `risk: ${reason}`) : []),
      ...input.details,
    ],
    riskLevel: input.riskLevel,
    requiresSecondConfirmation: input.secondConfirmation === true,
  };
}

export function explainDanger(action: string, reasons: string[], ctx: ToolExecutionContext): string {
  const isZh = ctx.language !== 'en-US';
  if (!isZh) return `${action} ${reasons.join(' ')}`;
  const characterId = ctx.characterId ?? ctx.config.character.current;
  return `${characterPrefix(characterId)}${action}${reasons.length > 0 ? ` 原因：${reasons.join('；')}` : ''}`;
}

function characterPrefix(characterId: CharacterId): string {
  switch (characterId) {
    case 'roxy':
      return '洛琪希提醒：';
    case 'eris':
      return '艾莉丝警告：';
    case 'rudeus':
      return '鲁迪乌斯提示：';
    case 'sylphiette':
      return '希露菲提醒：';
    case 'nanahoshi':
      return '七星分析：';
    default:
      return '安全提醒：';
  }
}
