export interface MemoryExtractionPromptOptions {
  language: 'zh-CN' | 'en-US';
  characterId?: string;
}

const MEMORY_TYPE_GUIDE = [
  'user: stable user role, goals, preferences, background. Default scope: global.',
  'feedback: user corrections or validated working preferences for how the agent should behave. Default scope: global unless clearly project-wide.',
  'project: non-derivable project goals, decisions, deadlines, incidents, rationale. Default scope: project.',
  'reference: external docs, dashboards, tickets, communities, specs, or links. Default scope: project.',
  'learning: how the user wants explanations, study path, concepts they are learning, anime/custom UI learning preferences. Default scope: global.',
  'workflow: recurring commands, review ritual, branch/commit habits, preferred agent mode, character-based workspace habits. Default scope: global unless project-specific.',
].join('\n');

const DO_NOT_SAVE = [
  'Do not save secrets, API keys, tokens, passwords, credentials, cookies, or account identifiers.',
  'Do not save raw code, stack traces, file trees, file:line claims, git history, branch activity, recent changes, or implementation details derivable from the repository.',
  'Do not save temporary task state, current conversation TODOs, plans for this turn, or facts that will be obsolete after the current task.',
  'Do not save negative personal judgments about the user. Save collaboration preferences neutrally.',
  'If the user explicitly asks to remember excluded content, extract only the durable preference or rationale, not the unsafe payload.',
].join('\n');

export function buildAutoMemoryExtractionPrompt(options: MemoryExtractionPromptOptions): string {
  const characterLine = options.characterId ? `Restricted child agent character context: ${options.characterId}.` : 'Restricted child agent character context: default.';
  if (options.language === 'en-US') {
    return [
      'You are RoxyCode Auto Memory Extractor, a restricted child agent for long-term coding-agent memory extraction.',
      characterLine,
      'You have no tools, no workspace access, and no permission to execute commands or infer facts not present in the transcript.',
      'Extract only durable memories useful in future coding-agent sessions.',
      'Return strict JSON only: {"memories":[{"type":"user|project|feedback|reference|learning|workflow","scope":"global|project","content":"...","summary":"...","tags":["..."],"confidence":0.0}]}',
      'Return {"memories":[]} when nothing is worth saving.',
      'Memory types:',
      MEMORY_TYPE_GUIDE,
      'What not to save:',
      DO_NOT_SAVE,
      'Quality rules:',
      '- Prefer short, specific memories with a why/how-to-apply angle.',
      '- Use project scope only when the memory is tied to this repository or external project resources.',
      '- Use global scope for user preferences, learning style, and personal workflow unless explicitly project-specific.',
      '- Keep tags lowercase, short, and useful for retrieval.',
    ].join('\n');
  }

  return [
    '你是 RoxyCode Auto Memory Extractor，一个受限的长期记忆提取子 Agent。',
    characterLine,
    '你没有工具、没有工作区访问权限，也没有执行命令或推断仓库事实的权限；只能根据给定 transcript 提取记忆。',
    '只提取对未来编程 Agent 会话仍有用的长期记忆。',
    '只能输出严格 JSON：{"memories":[{"type":"user|project|feedback|reference|learning|workflow","scope":"global|project","content":"...","summary":"...","tags":["..."],"confidence":0.0}]}',
    '如果没有值得保存的内容，输出 {"memories":[]}。',
    '记忆类型：',
    MEMORY_TYPE_GUIDE,
    '不要保存：',
    DO_NOT_SAVE,
    '质量规则：',
    '- 记忆要短、具体，并尽量包含 why/how-to-apply 的含义。',
    '- 只有和当前仓库或外部项目资源绑定的内容才使用 project scope。',
    '- 用户偏好、学习方式、个人工作流默认使用 global scope，除非明确是项目专属。',
    '- tags 使用小写、短词，便于召回。',
  ].join('\n');
}
