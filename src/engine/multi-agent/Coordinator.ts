import type { LLMUsage } from '../../core/types/llm.js';
import { systemMessage, userMessage } from '../../core/types/message.js';
import { buildAgentSystemPrompt } from '../agent/prompts.js';
import type { CoordinatorCreatePlanInput, CoordinatorPlanResult, MultiAgentPlan, MultiAgentRuntimeOptions, MultiAgentTask, MultiAgentTaskRole } from './types.js';

const ZERO_USAGE: LLMUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

interface RawTask {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  role?: unknown;
  dependsOn?: unknown;
  fileScopes?: unknown;
  prompt?: unknown;
}

export class Coordinator {
  constructor(private readonly options: MultiAgentRuntimeOptions) {}

  async createPlan(input: CoordinatorCreatePlanInput): Promise<CoordinatorPlanResult> {
    const warnings: string[] = [];
    try {
      const result = await this.options.llmProvider.chat({
        messages: [
          systemMessage(buildAgentSystemPrompt({
            mode: 'ultimate',
            character: this.options.character,
            language: this.options.language,
            cwd: this.options.cwd,
            runtimeContext: input.runtimeContext ?? null,
          })),
          userMessage(buildCoordinatorPrompt(input.userInput, this.options.language, this.options.maxConcurrency)),
        ],
        signal: this.options.signal,
      });
      const parsed = parsePlanJson(result.text);
      if (parsed) {
        return {
          plan: normalizePlan({
            runId: input.runId,
            goal: input.userInput,
            language: this.options.language,
            maxConcurrency: this.options.maxConcurrency,
            source: 'llm',
            rawTasks: parsed.tasks,
            notes: parsed.notes,
          }),
          usage: result.usage,
          rawText: result.text,
          warnings,
        };
      }
      warnings.push(this.options.language === 'en-US'
        ? 'Coordinator did not return valid JSON. Falling back to the built-in Ultimate plan.'
        : 'Coordinator 未返回有效 JSON，已回退到内置 Ultimate 计划。');
    } catch (error) {
      warnings.push(this.options.language === 'en-US'
        ? `Coordinator planning failed: ${error instanceof Error ? error.message : String(error)}`
        : `Coordinator 规划失败：${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      plan: createFallbackPlan({
        runId: input.runId,
        goal: input.userInput,
        language: this.options.language,
        maxConcurrency: this.options.maxConcurrency,
      }),
      usage: { ...ZERO_USAGE },
      warnings,
    };
  }
}

function buildCoordinatorPrompt(userInput: string, language: 'zh-CN' | 'en-US', maxConcurrency: number): string {
  if (language === 'en-US') {
    return [
      'You are the coordinator for RoxyCode Ultimate mode.',
      `Split the user task into at most ${maxConcurrency} parallel sub-agent tasks.`,
      'Return JSON only. No markdown fences.',
      'Schema:',
      '{"tasks":[{"id":"t1","title":"...","description":"...","role":"architect|implementer|reviewer|verifier|researcher|custom","dependsOn":[],"fileScopes":["src/**"],"prompt":"..."}],"notes":["..."]}',
      'Rules:',
      '- Use dependencies when a task must wait for another task.',
      '- Use fileScopes for likely files or globs. Use ["*"] if unknown.',
      '- Sub-agents must analyze and propose; they must not directly modify files.',
      '- Include a verification task when the change may affect behavior.',
      '',
      `User task:\n${userInput}`,
    ].join('\n');
  }

  return [
    '你是 RoxyCode Ultimate 模式的 Coordinator。',
    `请把用户任务拆成最多 ${maxConcurrency} 个可并行的子 Agent 任务。`,
    '只返回 JSON，不要 Markdown 代码块。',
    'JSON 结构：',
    '{"tasks":[{"id":"t1","title":"...","description":"...","role":"architect|implementer|reviewer|verifier|researcher|custom","dependsOn":[],"fileScopes":["src/**"],"prompt":"..."}],"notes":["..."]}',
    '规则：',
    '- 必须等待其他任务结果时，用 dependsOn 表达依赖。',
    '- fileScopes 写可能影响的文件或 glob；不确定时用 ["*"]。',
    '- 子 Agent 只做分析、方案、风险和验证建议，不直接修改文件。',
    '- 可能影响行为的任务必须包含验证任务。',
    '',
    `用户任务：\n${userInput}`,
  ].join('\n');
}

function parsePlanJson(text: string): { tasks: RawTask[]; notes?: unknown } | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    extractJsonObject(trimmed),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { tasks?: unknown; notes?: unknown };
      if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        return { tasks: parsed.tasks as RawTask[], notes: parsed.notes };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizePlan(input: {
  runId: string;
  goal: string;
  language: 'zh-CN' | 'en-US';
  maxConcurrency: number;
  source: 'llm' | 'fallback';
  rawTasks: RawTask[];
  notes?: unknown;
}): MultiAgentPlan {
  const createdAt = new Date().toISOString();
  const tasks = input.rawTasks.slice(0, input.maxConcurrency).map((task, index) => normalizeTask(task, index, createdAt, input.language));
  return {
    id: `plan-${input.runId}`,
    runId: input.runId,
    goal: input.goal,
    createdAt,
    language: input.language,
    maxConcurrency: input.maxConcurrency,
    source: input.source,
    tasks,
    notes: Array.isArray(input.notes) ? input.notes.filter(isString).slice(0, 8) : undefined,
  };
}

function normalizeTask(raw: RawTask, index: number, createdAt: string, language: 'zh-CN' | 'en-US'): MultiAgentTask {
  const id = isString(raw.id) && raw.id.trim() ? safeTaskId(raw.id) : `task-${index + 1}`;
  const title = isString(raw.title) && raw.title.trim()
    ? raw.title.trim()
    : (language === 'en-US' ? `Subtask ${index + 1}` : `子任务 ${index + 1}`);
  const description = isString(raw.description) && raw.description.trim() ? raw.description.trim() : title;
  const role = normalizeRole(raw.role);
  const dependsOn = Array.isArray(raw.dependsOn) ? raw.dependsOn.filter(isString).map(safeTaskId) : [];
  const fileScopes = Array.isArray(raw.fileScopes) ? raw.fileScopes.filter(isString).filter(Boolean) : ['*'];
  const prompt = isString(raw.prompt) && raw.prompt.trim() ? raw.prompt.trim() : description;

  return {
    id,
    title,
    description,
    role,
    status: 'pending',
    dependsOn,
    fileScopes: fileScopes.length > 0 ? fileScopes : ['*'],
    prompt,
    createdAt,
  };
}

function createFallbackPlan(input: {
  runId: string;
  goal: string;
  language: 'zh-CN' | 'en-US';
  maxConcurrency: number;
}): MultiAgentPlan {
  const isZh = input.language !== 'en-US';
  const rawTasks: RawTask[] = isZh
    ? [
        {
          id: 'architect',
          title: '架构与风险分析',
          role: 'architect',
          dependsOn: [],
          fileScopes: ['*'],
          description: '识别项目结构、风险点、依赖关系和建议的实现顺序。',
          prompt: '从架构、模块边界、风险和安全约束角度分析任务，输出关键发现和建议。',
        },
        {
          id: 'implementer',
          title: '实现方案拆解',
          role: 'implementer',
          dependsOn: [],
          fileScopes: ['src/**'],
          description: '给出具体代码改动路线、可能涉及文件和执行步骤。',
          prompt: '从实现角度拆解任务，指出应修改的文件、代码路径和注意事项。不要直接修改文件。',
        },
        {
          id: 'verifier',
          title: '验证与冲突检查',
          role: 'verifier',
          dependsOn: ['architect', 'implementer'],
          fileScopes: ['package.json', 'tsconfig.json', 'src/**'],
          description: '设计验证方法，检查潜在冲突、测试缺口和回归风险。',
          prompt: '从测试、类型检查、构建和回归风险角度验证方案，输出必须执行的检查。',
        },
      ]
    : [
        {
          id: 'architect',
          title: 'Architecture and risk analysis',
          role: 'architect',
          dependsOn: [],
          fileScopes: ['*'],
          description: 'Identify structure, risks, dependencies, and recommended order.',
          prompt: 'Analyze architecture, module boundaries, risk, and safety constraints. Provide concise findings.',
        },
        {
          id: 'implementer',
          title: 'Implementation breakdown',
          role: 'implementer',
          dependsOn: [],
          fileScopes: ['src/**'],
          description: 'Suggest concrete code paths, files, and implementation steps.',
          prompt: 'Break down the implementation path and likely files. Do not modify files directly.',
        },
        {
          id: 'verifier',
          title: 'Verification and conflict check',
          role: 'verifier',
          dependsOn: ['architect', 'implementer'],
          fileScopes: ['package.json', 'tsconfig.json', 'src/**'],
          description: 'Design checks for conflicts, test gaps, and regressions.',
          prompt: 'Verify the plan from tests, type checks, build, and regression risk.',
        },
      ];

  return normalizePlan({
    runId: input.runId,
    goal: input.goal,
    language: input.language,
    maxConcurrency: input.maxConcurrency,
    source: 'fallback',
    rawTasks,
    notes: [isZh ? '内置 Ultimate 计划：子 Agent 只分析，真实工具执行仍由主 Agent 负责。' : 'Built-in Ultimate plan: sub-agents analyze only; main agent executes tools.'],
  });
}

function normalizeRole(value: unknown): MultiAgentTaskRole {
  if (
    value === 'architect' ||
    value === 'implementer' ||
    value === 'reviewer' ||
    value === 'verifier' ||
    value === 'researcher' ||
    value === 'custom'
  ) return value;
  return 'custom';
}

function safeTaskId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'task';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
