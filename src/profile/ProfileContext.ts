import type { Language } from '../i18n/index.js';
import type { UserProfile } from './types.js';

export interface ProfileContextOptions {
  profile: UserProfile;
  language: Language;
}

export function buildProfileContext(options: ProfileContextOptions): string {
  const { profile, language } = options;
  const isZh = language === 'zh-CN';

  const sections: string[] = [];

  // Header
  sections.push(isZh ? '# 用户画像' : '# User Profile');
  sections.push('');

  // Tech Stack
  if (profile.techStack.length > 0) {
    sections.push(isZh ? '## 技术栈' : '## Tech Stack');
    sections.push(profile.techStack.join(', '));
    sections.push('');
  }

  // Explanation Depth
  const depthLabels = {
    concise: isZh ? '简洁（只给结论）' : 'Concise (conclusions only)',
    balanced: isZh ? '平衡（适度解释）' : 'Balanced (moderate explanation)',
    teaching: isZh ? '教学（详细解释原理）' : 'Teaching (explain principles)',
    deep: isZh ? '深入（包含底层实现和边界情况）' : 'Deep (include implementation details and edge cases)',
  };
  sections.push(isZh ? '## 解释深度偏好' : '## Explanation Depth Preference');
  sections.push(depthLabels[profile.explanationDepth]);
  sections.push('');

  // Model Strategy
  const strategyLabels = {
    auto: isZh ? '自动（根据任务复杂度选择）' : 'Auto (choose based on task complexity)',
    fast: isZh ? '快速（优先速度）' : 'Fast (prioritize speed)',
    balanced: isZh ? '平衡（速度与质量）' : 'Balanced (speed and quality)',
    quality: isZh ? '质量（优先准确性）' : 'Quality (prioritize accuracy)',
    budget: isZh ? '经济（优先成本控制）' : 'Budget (prioritize cost control)',
  };
  sections.push(isZh ? '## 模型策略' : '## Model Strategy');
  sections.push(strategyLabels[profile.modelStrategy]);
  sections.push('');

  // Aesthetic Mode
  const aestheticLabels = {
    minimal: isZh ? '极简（工程优先，最少角色元素）' : 'Minimal (engineering first, minimal character elements)',
    balanced: isZh ? '平衡（保持角色风格但不打断工作）' : 'Balanced (maintain character style without interrupting work)',
    immersive: isZh ? '沉浸（完整角色体验）' : 'Immersive (full character experience)',
  };
  sections.push(isZh ? '## 审美模式' : '## Aesthetic Mode');
  sections.push(aestheticLabels[profile.aestheticMode]);
  sections.push('');

  // Notes
  if (profile.notes.length > 0) {
    sections.push(isZh ? '## 个人备注' : '## Personal Notes');
    for (const note of profile.notes) {
      sections.push(`- ${note}`);
    }
    sections.push('');
  }

  // Guidance
  sections.push(isZh ? '## 指导原则' : '## Guidance');
  if (isZh) {
    sections.push('- 遵循用户的解释深度偏好调整回答详细程度');
    sections.push('- 技术栈相关问题时优先使用用户熟悉的技术');
    sections.push('- 根据审美模式调整角色化表达的频率和强度');
  } else {
    sections.push('- Adjust response detail level according to user explanation depth preference');
    sections.push('- Prioritize technologies the user is familiar with for tech stack questions');
    sections.push('- Adjust frequency and intensity of character expression based on aesthetic mode');
  }

  return sections.join('\n');
}

export function getProfileSystemPromptInjection(profile: UserProfile, language: Language): string {
  const isZh = language === 'zh-CN';

  const depthInstructions = {
    concise: isZh
      ? '用户偏好简洁回答。给出结论和关键步骤即可，避免过多解释。'
      : 'User prefers concise answers. Provide conclusions and key steps, avoid excessive explanation.',
    balanced: isZh
      ? '用户偏好平衡的解释。提供必要的背景和理由，但保持简洁。'
      : 'User prefers balanced explanation. Provide necessary background and reasoning, but stay concise.',
    teaching: isZh
      ? '用户偏好教学式详细解释。说明原理、为什么这样做、有哪些替代方案。'
      : 'User prefers teaching-style detailed explanation. Explain principles, why, and alternatives.',
    deep: isZh
      ? '用户偏好深入解释。包含底层实现细节、边界情况、性能考虑和最佳实践。'
      : 'User prefers deep explanation. Include implementation details, edge cases, performance considerations, and best practices.',
  };

  const aestheticInstructions = {
    minimal: isZh
      ? '用户选择了极简审美模式。保持工程化风格，最小化角色化表达，专注技术内容。'
      : 'User selected minimal aesthetic mode. Maintain engineering style, minimize character expression, focus on technical content.',
    balanced: isZh
      ? '用户选择了平衡审美模式。可以保持角色风格，但不要频繁使用角色台词或打断工作流程。'
      : 'User selected balanced aesthetic mode. Maintain character style, but avoid frequent character dialogues or workflow interruption.',
    immersive: isZh
      ? '用户选择了沉浸审美模式。可以适度使用角色化表达和台词，营造沉浸式体验。'
      : 'User selected immersive aesthetic mode. Use character expressions and dialogues moderately for immersive experience.',
  };

  const parts: string[] = [];

  parts.push(depthInstructions[profile.explanationDepth]);
  parts.push(aestheticInstructions[profile.aestheticMode]);

  if (profile.techStack.length > 0) {
    const techList = profile.techStack.join(', ');
    parts.push(
      isZh
        ? `用户的技术栈：${techList}。在提供技术建议时优先考虑这些技术。`
        : `User's tech stack: ${techList}. Prioritize these technologies when providing technical suggestions.`
    );
  }

  return parts.join('\n\n');
}
