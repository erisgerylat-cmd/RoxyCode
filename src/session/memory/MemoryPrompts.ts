export interface MemoryExtractionPromptOptions {
  language: 'zh-CN' | 'en-US';
  characterId?: string;
}

const MEMORY_TYPE_GUIDE = [
  'user: stable user role, goals, language preference, preferred tech stack, code style preference, collaboration background. Default scope: global.',
  'feedback: user corrections or validated working preferences for how the agent should behave. Default scope: global unless clearly project-wide.',
  'project: non-derivable project goals, decisions, deadlines, incidents, rationale. Default scope: project.',
  'reference: external docs, dashboards, tickets, communities, specs, or links. Default scope: project.',
  'learning: explanation depth, concepts the user is learning, teaching style, beginner/advanced preference, anime/custom UI learning preferences. Default scope: global.',
  'workflow: recurring commands, review ritual, branch/commit habits, preferred agent mode, character-based workspace habits. Default scope: global unless project-specific.',
].join('\n');

const DO_NOT_SAVE = [
  'Do not save secrets, API keys, tokens, passwords, credentials, cookies, account identifiers, or anything that looks like a private key.',
  'Do not save raw code, stack traces, file trees, file:line claims, git history, branch activity, recent changes, or implementation details derivable from the repository.',
  'Do not save temporary task state, current conversation TODOs, plans for this turn, or facts that will be obsolete after the current task.',
  'Do not save negative personal judgments about the user. Save collaboration preferences neutrally.',
  'If the user explicitly asks to remember excluded content, extract only the durable preference or rationale, not the unsafe payload.',
].join('\n');

export function buildAutoMemoryExtractionPrompt(options: MemoryExtractionPromptOptions): string {
  const languageRule = options.language === 'zh-CN'
    ? 'When the transcript is Chinese, write memory content in clear Chinese. Keep JSON keys in English.'
    : 'Write memory content in English unless the transcript clearly uses another language.';
  return [
    'You are RoxyCode Auto Memory Extractor, a restricted child agent for long-term coding-agent memory extraction.',
    `Character memory focus: ${characterMemoryFocus(options.characterId)}.`,
    'You have no tools, no workspace access, and no permission to execute commands or infer facts not present in the transcript.',
    'Extract only durable memories useful in future coding-agent sessions.',
    languageRule,
    'Return strict JSON only: {"memories":[{"type":"user|project|feedback|reference|learning|workflow","scope":"global|project","content":"...","summary":"...","tags":["..."],"confidence":0.0}]}',
    'Return {"memories":[]} when nothing is worth saving.',
    'Memory types:',
    MEMORY_TYPE_GUIDE,
    'What not to save:',
    DO_NOT_SAVE,
    'Quality rules:',
    '- Prefer short, specific memories with a why/how-to-apply angle.',
    '- Use project scope only when the memory is tied to this repository or external project resources.',
    '- Use global scope for language preference, tech stack preference, code style, learning style, and personal workflow unless explicitly project-specific.',
    '- Teacher/support characters should pay extra attention to learning memories.',
    '- Reviewer/research characters should pay extra attention to feedback and reference memories.',
    '- Workflow/engineer characters should pay extra attention to workflow and project memories.',
    '- Keep tags lowercase, short, and useful for retrieval.',
  ].join('\n');
}

function characterMemoryFocus(characterId: string | undefined): string {
  switch (characterId) {
    case 'roxy':
    case 'sylphiette':
      return 'teacher/support style; prioritize learning, explanation depth, language preference, and gentle recovery preferences';
    case 'eris':
      return 'direct reviewer style; prioritize feedback, workflow habits, correctness, and performance preferences';
    case 'rudeus':
      return 'practical teaching style; prioritize learning, workflow tradeoffs, and reusable collaboration preferences';
    case 'nanahoshi':
      return 'research/reviewer style; prioritize feedback, reference, reproducible verification, and risk preferences';
    default:
      return 'custom character; use character only as style context and do not infer private facts from the character itself';
  }
}
