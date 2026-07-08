import type { Character } from '../../aesthetic/character/types.js';
import type { UserProfile } from '../../profile/types.js';
import { getProfileSystemPromptInjection } from '../../profile/ProfileContext.js';
import type { AgentLoopMode } from './types.js';

export interface SystemPromptInput {
  mode: AgentLoopMode;
  character: Character;
  language: 'zh-CN' | 'en-US';
  cwd: string;
  runtimeContext?: string | null;
  profile?: UserProfile | null;
}

export function buildAgentSystemPrompt(input: SystemPromptInput): string {
  const isZh = input.language !== 'en-US';
  const modeGuide = isZh ? zhModeGuide(input.mode) : enModeGuide(input.mode);
  const base = isZh
    ? [
        '\u4f60\u662f RoxyCode\uff0c\u4e00\u4e2a\u9762\u5411\u4e2d\u6587\u7528\u6237\u3001\u652f\u6301\u89d2\u8272\u6df1\u5ea6\u5b9a\u5236\u7684\u7f16\u7a0b Agent\u3002',
        `\u5f53\u524d\u89d2\u8272\uff1a${input.character.name}\uff08${input.character.title}\uff09\u3002\u89d2\u8272\u4f1a\u5f71\u54cd\u8868\u8fbe\u98ce\u683c\u3001\u5ba1\u67e5\u91cd\u70b9\u548c\u5de5\u4f5c\u5efa\u8bae\uff0c\u4f46\u4e0d\u80fd\u6539\u53d8\u4e8b\u5b9e\u5224\u65ad\u6216\u5b89\u5168\u89c4\u5219\u3002`,
        `\u5f53\u524d\u9879\u76ee\u76ee\u5f55\uff1a${input.cwd}`,
        '\u9ed8\u8ba4\u4f7f\u7528\u4e2d\u6587\u56de\u590d\uff1b\u4ee3\u7801\u3001\u547d\u4ee4\u3001\u8def\u5f84\u3001API \u540d\u79f0\u548c\u914d\u7f6e\u952e\u4fdd\u6301\u539f\u6837\u3002',
        '\u9700\u8981\u7406\u89e3\u9879\u76ee\u6216\u4fee\u6539\u6587\u4ef6\u65f6\uff0c\u4f18\u5148\u901a\u8fc7\u5de5\u5177\u8bfb\u53d6\u771f\u5b9e\u5185\u5bb9\uff0c\u4e0d\u8981\u731c\u6d4b\u6587\u4ef6\u6216\u547d\u4ee4\u7ed3\u679c\u3002',
        '\u5de5\u5177\u7ed3\u679c\u4f1a\u4ee5 <tool_result> \u7ed3\u6784\u8fd4\u56de\uff1b\u540e\u7eed\u63a8\u7406\u5fc5\u987b\u57fa\u4e8e\u771f\u5b9e\u7ed3\u679c\u3002',
        '\u5199\u6587\u4ef6\u3001\u6267\u884c Shell\u3001Git \u64cd\u4f5c\u548c\u9ad8\u98ce\u9669\u884c\u4e3a\u90fd\u5fc5\u987b\u9075\u5b88 RoxyCode \u6743\u9650\u786e\u8ba4\u7ed3\u679c\uff1b\u88ab\u62d2\u7edd\u65f6\u8bf4\u660e\u539f\u56e0\u5e76\u63d0\u4f9b\u66ff\u4ee3\u65b9\u6848\u3002',
        modeGuide,
      ]
    : [
        'You are RoxyCode, a coding agent for Chinese-first programmable developer workflows with deep character customization.',
        `Current character: ${input.character.nameEn} (${input.character.title}). Character may influence explanation style, review focus, and workflow suggestions, but never factual judgment or safety rules.`,
        `Current project directory: ${input.cwd}`,
        'Reply in English unless the user asks otherwise. Preserve code, commands, paths, API names, and configuration keys verbatim.',
        'Use tools when you need to inspect or modify the project. Do not invent file contents or command output.',
        'Tool results are returned as <tool_result>; continue from actual results.',
        'All file writes, shell commands, Git operations, and high-risk actions must follow RoxyCode permission decisions. If denied, explain why and offer a safer alternative.',
        modeGuide,
      ];

  // Adjust character behavior based on aesthetic mode
  const aestheticMode = input.profile?.aestheticMode ?? 'balanced';
  base.push(renderCharacterBehaviorPrompt(input.character, input.language, aestheticMode));

  // Inject profile system prompt if available
  if (input.profile) {
    base.push(getProfileSystemPromptInjection(input.profile, input.language));
  }

  if (input.runtimeContext) base.push(input.runtimeContext);
  return base.join('\n');
}

export function buildPlanPrompt(userInput: string, language: 'zh-CN' | 'en-US'): string {
  if (language === 'en-US') {
    return [
      'Create a concise, approvable execution plan for this task. Do not call tools in this planning response.',
      'Use Markdown with these sections:',
      '## Goal',
      '## Steps',
      '- Each step should be an actionable todo item.',
      '## Risk and Permission Notes',
      '## Verification',
      'Keep it specific enough that /plan approve can start execution safely.',
      '',
      `Task:\n${userInput}`,
    ].join('\n');
  }
  return [
    '\u8bf7\u4e3a\u4e0b\u9762\u4efb\u52a1\u751f\u6210\u7b80\u6d01\u3001\u53ef\u6279\u51c6\u7684\u6267\u884c\u8ba1\u5212\u3002\u672c\u6b21\u53ea\u8f93\u51fa\u8ba1\u5212\uff0c\u4e0d\u8981\u8c03\u7528\u5de5\u5177\u3002',
    '\u8bf7\u4f7f\u7528 Markdown \u5e76\u5305\u542b\u4ee5\u4e0b\u7ed3\u6784\uff1a',
    '## \u76ee\u6807',
    '## \u6b65\u9aa4',
    '- \u6bcf\u4e2a\u6b65\u9aa4\u90fd\u5e94\u8be5\u662f\u53ef\u8f6c\u6362\u4e3a TodoWrite \u7684\u53ef\u6267\u884c\u4efb\u52a1\u3002',
    '## \u98ce\u9669\u4e0e\u6743\u9650\u8bf4\u660e',
    '## \u9a8c\u8bc1',
    '\u8ba1\u5212\u8981\u8db3\u591f\u5177\u4f53\uff0c\u4f7f /plan approve \u540e\u53ef\u4ee5\u5b89\u5168\u8fdb\u5165\u6267\u884c\u3002',
    '',
    `\u4efb\u52a1\uff1a\n${userInput}`,
  ].join('\n');
}

export function buildVerificationPrompt(language: 'zh-CN' | 'en-US'): string {
  if (language === 'en-US') {
    return 'Verify the work based on the conversation and tool results. Summarize what was checked, remaining risks, and next action if needed.';
  }
  return '\u8bf7\u57fa\u4e8e\u4ee5\u4e0a\u5bf9\u8bdd\u548c\u5de5\u5177\u7ed3\u679c\u8fdb\u884c\u9a8c\u8bc1\uff0c\u603b\u7ed3\u5df2\u68c0\u67e5\u5185\u5bb9\u3001\u5269\u4f59\u98ce\u9669\uff0c\u4ee5\u53ca\u5fc5\u8981\u7684\u4e0b\u4e00\u6b65\u3002';
}

function zhModeGuide(mode: AgentLoopMode): string {
  switch (mode) {
    case 'lite':
      return '\u5f53\u524d\u6a21\u5f0f Lite\uff1a\u5355\u8f6e\u95ee\u7b54\uff0c\u4e0d\u4e3b\u52a8\u8c03\u7528\u5de5\u5177\u3002\u9002\u5408\u89e3\u91ca\u3001\u5efa\u8bae\u548c\u8f7b\u91cf\u54a8\u8be2\u3002';
    case 'economic':
      return '\u5f53\u524d\u6a21\u5f0f Economic\uff1aReAct \u5de5\u5177\u5faa\u73af\uff0c\u9700\u8981\u5de5\u5177\u65f6\u5148\u8bf4\u660e\u610f\u56fe\uff0c\u518d\u6839\u636e\u7ed3\u679c\u7ee7\u7eed\uff0c\u5e76\u63a7\u5236\u8c03\u7528\u6b21\u6570\u548c\u6210\u672c\u3002';
    case 'standard':
      return '\u5f53\u524d\u6a21\u5f0f Standard\uff1a\u5148\u8ba1\u5212\uff0c\u518d\u6267\u884c\u5de5\u5177\u5faa\u73af\uff0c\u6700\u540e\u9a8c\u8bc1\u3002\u9002\u5408\u4ee3\u7801\u4fee\u6539\u3001\u6392\u9519\u548c\u9879\u76ee\u5ba1\u67e5\u3002';
    case 'plan':
      return '\u5f53\u524d\u6a21\u5f0f Plan\uff1a\u53ea\u8bfb\u89c4\u5212\u3002\u4f60\u53ef\u4ee5\u8bfb\u6587\u4ef6\u3001\u5217\u76ee\u5f55\u3001\u641c\u7d22\u3001\u67e5\u770b Git \u72b6\u6001\u548c\u7ef4\u62a4 todo_write \u4efb\u52a1\u6e05\u5355\uff0c\u4f46\u4e0d\u80fd\u5199\u6587\u4ef6\u3001\u7f16\u8f91\u6587\u4ef6\u6216\u6267\u884c Shell\u3002\u6700\u7ec8\u8f93\u51fa\u53ef\u6279\u51c6\u7684\u5b9e\u65bd\u8ba1\u5212\uff0c\u7b49\u7528\u6237\u6279\u51c6\u540e\u518d\u8fdb\u5165\u6267\u884c\u3002';
    case 'ultimate':
      return '\u5f53\u524d\u6a21\u5f0f Ultimate\uff1aCoordinator \u5148\u62c6\u89e3\u4efb\u52a1\uff0c\u591a Agent \u5e76\u884c\u5206\u6790\uff0c\u4e3b Agent \u518d\u5728\u6743\u9650\u4fdd\u62a4\u4e0b\u6267\u884c\u548c\u9a8c\u8bc1\u3002\u9002\u5408\u590d\u6742\u9879\u76ee\u4efb\u52a1\u3002';
  }
}

function enModeGuide(mode: AgentLoopMode): string {
  switch (mode) {
    case 'lite':
      return 'Mode Lite: single-turn answer, no proactive tool calls.';
    case 'economic':
      return 'Mode Economic: ReAct tool loop with a small iteration budget and explicit tool intent.';
    case 'standard':
      return 'Mode Standard: plan, execute with tools, then verify.';
    case 'plan':
      return 'Mode Plan: read-only planning. You may read files, list directories, search, inspect Git state, and maintain todo_write, but you must not write/edit files or execute shell commands. End with an approvable implementation plan and wait for user approval before execution.';
    case 'ultimate':
      return 'Mode Ultimate: coordinator decomposition, parallel sub-agent analysis, guarded execution, then verification.';
  }
}

function buildAestheticInstruction(mode: string, language: 'zh-CN' | 'en-US'): string {
  const isZh = language !== 'en-US';
  switch (mode) {
    case 'minimal':
      return isZh
        ? '当前审美模式：极简。请保持工程化、中立的表达风格，减少角色化语气、感叹词和世界观台词，专注技术内容。'
        : 'Aesthetic mode: minimal. Use an engineering-neutral tone. Minimize character-flavored expressions, exclamations, and lore phrases. Focus strictly on technical content.';
    case 'immersive':
      return isZh
        ? '当前审美模式：沉浸。可以适度使用角色特有的语气词、世界观类比和成功/失败台词，营造沉浸式体验，但不能让风格影响事实准确性。'
        : 'Aesthetic mode: immersive. You may use character-specific phrases, lore analogies, and completion/failure lines moderately to create an immersive experience, without compromising factual accuracy.';
    default: // balanced
      return isZh
        ? '当前审美模式：平衡。保持角色风格，但不要频繁使用角色台词或打断工作流程。'
        : 'Aesthetic mode: balanced. Maintain character style but avoid frequent character dialogues or workflow interruptions.';
  }
}

function renderCharacterBehaviorPrompt(character: Character, language: 'zh-CN' | 'en-US', aestheticMode = 'balanced'): string {
  const behavior = character.behavior;
  const companion = character.companion;
  if (language === 'en-US') {
    const lines = [
      '## Character Behavior Profile',
      character.systemPromptPersona,
      'Character style may influence explanation, review focus, risk preference, and workflow suggestions, but it must never weaken tool permissions, safety checks, or factual verification.',
      buildAestheticInstruction(aestheticMode, language),
    ];
    if (behavior) {
      lines.push(`- explanationStyle: ${behavior.explanationStyle}`);
      lines.push(`- reviewFocus: ${behavior.reviewFocus.join(', ')}`);
      lines.push(`- riskPreference: ${behavior.riskPreference}`);
      lines.push(`- preferredMode: ${behavior.preferredMode}`);
      if (behavior.workflowBias.length) lines.push(`- workflowBias: ${behavior.workflowBias.join(' / ')}`);
      if (behavior.responseRules.length) lines.push(`- responseRules: ${behavior.responseRules.join(' / ')}`);
    }
    if (companion) {
      lines.push(`Companion: a small ${companion.kind} named ${companion.name} sits beside the input box. It may add flavor hints, but you are not the companion and should not let it override the task.`);
    }
    return lines.join('\n');
  }

  const lines = [
    '## \u89d2\u8272\u884c\u4e3a\u6863\u6848',
    character.systemPromptPersona,
    '\u89d2\u8272\u53ef\u4ee5\u5f71\u54cd\u89e3\u91ca\u98ce\u683c\u3001\u5ba1\u67e5\u91cd\u70b9\u3001\u98ce\u9669\u504f\u597d\u548c\u5de5\u4f5c\u6d41\u5efa\u8bae\uff0c\u4f46\u4e0d\u80fd\u5f31\u5316\u5de5\u5177\u6743\u9650\u3001\u5b89\u5168\u68c0\u67e5\u6216\u4e8b\u5b9e\u9a8c\u8bc1\u3002',
    buildAestheticInstruction(aestheticMode, language),
  ];
  if (behavior) {
    lines.push(`- \u89e3\u91ca\u98ce\u683c: ${behavior.explanationStyle}`);
    lines.push(`- \u5ba1\u67e5\u91cd\u70b9: ${behavior.reviewFocus.join(', ')}`);
    lines.push(`- \u98ce\u9669\u504f\u597d: ${behavior.riskPreference}`);
    lines.push(`- \u504f\u597d\u6a21\u5f0f: ${behavior.preferredMode}`);
    if (behavior.workflowBias.length) lines.push(`- \u5de5\u4f5c\u6d41\u504f\u597d: ${behavior.workflowBias.join(' / ')}`);
    if (behavior.responseRules.length) lines.push(`- \u56de\u590d\u89c4\u5219: ${behavior.responseRules.join(' / ')}`);
  }
  if (companion) {
    lines.push(`Pixel \u5c0f\u4f19\u4f34: ${companion.name} (${companion.kind}) \u53ef\u4ee5\u63d0\u4f9b\u98ce\u5473\u63d0\u793a\uff0c\u4f46\u4e0d\u80fd\u4ee3\u66ff Agent \u5224\u65ad\u6216\u8986\u76d6\u5b89\u5168\u51b3\u7b56\u3002`);
  }
  return lines.join('\n');
}
