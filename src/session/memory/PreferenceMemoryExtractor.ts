import { messageToText } from '../store/SessionStore.js';
import type { Message } from '../../core/types/message.js';
import type { AddMemoryInput, MemoryType } from './types.js';

export interface PreferenceMemoryExtractionOptions {
  language: 'zh-CN' | 'en-US';
  sessionId?: string;
  characterId?: string;
}

const TECH_TERMS = [
  'Vue',
  'React',
  'TypeScript',
  'JavaScript',
  'Node',
  'Spring Boot',
  'Spring',
  'Java',
  'Python',
  'Go',
  'Rust',
  'Vite',
  'pnpm',
  'Element Plus',
  'Tailwind',
  'MySQL',
  'PostgreSQL',
  'Redis',
];

export function extractPreferenceMemoryCandidates(messages: Message[], options: PreferenceMemoryExtractionOptions): AddMemoryInput[] {
  const text = messages
    .filter(message => message.role === 'user')
    .slice(-6)
    .map(message => messageToText(message))
    .join('\n')
    .trim();
  if (!text || !hasExplicitPreferenceSignal(text)) return [];

  const candidates: AddMemoryInput[] = [];
  const isZh = options.language !== 'en-US';

  if (prefersChinese(text)) {
    candidates.push(candidate({
      type: 'user',
      content: isZh
        ? '\u7528\u6237\u504f\u597d\u4f7f\u7528\u4e2d\u6587\u8fdb\u884c RoxyCode \u4ea4\u4e92\u3001\u83dc\u5355\u548c\u6280\u672f\u89e3\u91ca\u3002'
        : 'User prefers Chinese for RoxyCode interaction, menus, and technical explanations.',
      summary: 'preferred language',
      tags: ['language', 'zh-cn'],
    }, options));
  } else if (prefersEnglish(text)) {
    candidates.push(candidate({
      type: 'user',
      content: isZh
        ? '\u7528\u6237\u504f\u597d\u4f7f\u7528\u82f1\u6587\u8fdb\u884c RoxyCode \u4ea4\u4e92\u548c\u6280\u672f\u89e3\u91ca\u3002'
        : 'User prefers English for RoxyCode interaction and technical explanations.',
      summary: 'preferred language',
      tags: ['language', 'en-us'],
    }, options));
  }

  const techStack = extractPreferredTechStack(text);
  if (techStack.length > 0) {
    candidates.push(candidate({
      type: 'user',
      content: isZh
        ? `\u7528\u6237\u5e38\u7528\u6216\u504f\u597d\u7684\u6280\u672f\u6808\uff1a${techStack.join(', ')}\u3002`
        : `User commonly uses or prefers this tech stack: ${techStack.join(', ')}.`,
      summary: 'preferred tech stack',
      tags: ['tech-stack', ...techStack.map(tagify)],
    }, options));
  }

  const depth = extractExplanationDepth(text);
  if (depth) {
    candidates.push(candidate({
      type: 'learning',
      content: depth === 'deep'
        ? (isZh
            ? '\u7528\u6237\u504f\u597d\u8f83\u8be6\u7ec6\u3001\u5206\u6b65\u9aa4\u7684\u89e3\u91ca\uff0c\u5e2e\u52a9\u7406\u89e3\u5de5\u7a0b\u601d\u8def\u548c\u53d6\u820d\u3002'
            : 'User prefers detailed, step-by-step explanations that explain engineering reasoning and tradeoffs.')
        : (isZh
            ? '\u7528\u6237\u504f\u597d\u7b80\u6d01\u76f4\u63a5\u7684\u89e3\u91ca\uff0c\u907f\u514d\u4e0d\u5fc5\u8981\u7684\u957f\u7bc7\u603b\u7ed3\u3002'
            : 'User prefers concise, direct explanations and avoids unnecessary long summaries.'),
      summary: 'explanation depth preference',
      tags: ['explanation-depth', depth],
    }, options));
  }

  const codeStyle = extractCodeStylePreference(text, isZh);
  if (codeStyle) {
    candidates.push(candidate({
      type: 'feedback',
      content: codeStyle,
      summary: 'code style preference',
      tags: ['code-style'],
    }, options));
  }

  return dedupeCandidates(candidates);
}

function candidate(input: Pick<AddMemoryInput, 'type' | 'content' | 'summary' | 'tags'>, options: PreferenceMemoryExtractionOptions): AddMemoryInput {
  return {
    ...input,
    scope: 'global',
    source: 'auto',
    sessionId: options.sessionId,
    characterId: options.characterId,
    confidence: 0.85,
    metadata: { extractor: 'preference-pattern' },
  };
}

function hasExplicitPreferenceSignal(text: string): boolean {
  return /\b(prefer|preference|i want|i like|usually use|default|always|concise|detailed)\b/i.test(text)
    || /(\u6211|\u7528\u6237).{0,12}(\u5e0c\u671b|\u559c\u6b22|\u504f\u597d|\u4e60\u60ef|\u5e38\u7528|\u9ed8\u8ba4|\u64c5\u957f|\u4e0d\u8981|\u522b)/.test(text)
    || /(\u4ee5\u540e|\u4e4b\u540e|\u6bcf\u6b21).{0,20}(\u7528|\u6309|\u89e3\u91ca|\u5199|\u8bf4)/.test(text);
}

function prefersChinese(text: string): boolean {
  return /(\u4e2d\u6587|zh-cn|chinese)/i.test(text)
    && /(\u7528|\u504f\u597d|\u559c\u6b22|\u5e0c\u671b|\u9ed8\u8ba4|prefer|language|menu|menus)/i.test(text);
}

function prefersEnglish(text: string): boolean {
  return /(\u82f1\u6587|en-us|english)/i.test(text)
    && /(\u7528|\u504f\u597d|\u559c\u6b22|\u5e0c\u671b|\u9ed8\u8ba4|prefer|language|menu|menus)/i.test(text);
}

function extractPreferredTechStack(text: string): string[] {
  if (!/(\u6211|\u504f\u597d|\u559c\u6b22|\u5e38\u7528|\u64c5\u957f|\u6280\u672f\u6808|prefer|usually use|tech stack|favorite)/i.test(text)) return [];
  return TECH_TERMS.filter(term => new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text));
}

function extractExplanationDepth(text: string): 'deep' | 'concise' | null {
  if (/(\u8be6\u7ec6|\u6df1\u5165|\u4e00\u6b65\u6b65|\u5206\u6b65|\u521d\u5b66|\u6559\u5b66|detailed|deep|step-by-step|beginner)/i.test(text)) {
    return 'deep';
  }
  if (/(\u7b80\u6d01|\u76f4\u63a5|\u5c11\u5e9f\u8bdd|\u522b\u592a\u957f|concise|brief|direct)/i.test(text)) {
    return 'concise';
  }
  return null;
}

function extractCodeStylePreference(text: string, isZh: boolean): string | null {
  if (!/(\u4ee3\u7801\u98ce\u683c|code style|\u547d\u540d|\u7f29\u8fdb|composition api|options api|functional|oop)/i.test(text)) return null;
  const snippet = compactSnippet(text);
  return isZh
    ? `\u7528\u6237\u8868\u8fbe\u4e86\u4ee3\u7801\u98ce\u683c\u504f\u597d\uff1a${snippet}\u3002\u540e\u7eed\u5199\u4ee3\u7801\u65f6\u5148\u6309\u8be5\u504f\u597d\u5bf9\u9f50\uff0c\u82e5\u4e0e\u9879\u76ee\u73b0\u6709\u89c4\u8303\u51b2\u7a81\u5219\u4ee5\u9879\u76ee\u89c4\u8303\u4e3a\u5148\u3002`
    : `User expressed this code style preference: ${snippet}. Align future code with it unless the current project convention conflicts.`;
}

function compactSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function tagify(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-');
}

function dedupeCandidates(candidates: AddMemoryInput[]): AddMemoryInput[] {
  const seen = new Set<string>();
  return candidates.filter(item => {
    const key = `${item.type}:${item.content.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
