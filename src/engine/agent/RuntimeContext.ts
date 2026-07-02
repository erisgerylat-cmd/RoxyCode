import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Language } from '../../i18n/index.js';
import { MemoryStore, renderMemoriesForPrompt, selectRelevantMemories, type MemoryRecord } from '../../session/memory/index.js';
import { WorkflowLoader, type WorkflowDefinition } from '../../workflow/index.js';

export interface RuntimeContextOptions {
  query?: string;
  workflows?: {
    builtin?: boolean;
    directories?: string[];
  };
}

export interface RuntimeContextSnapshot {
  roxyMd?: string;
  projectJson?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  memories?: MemoryRecord[];
  workflows?: WorkflowDefinition[];
}

export async function loadRuntimeContext(cwd: string = process.cwd(), options: RuntimeContextOptions = {}): Promise<RuntimeContextSnapshot> {
  const memoryStore = new MemoryStore({ cwd });
  const workflowLoader = new WorkflowLoader({
    cwd,
    builtin: options.workflows?.builtin ?? true,
    directories: options.workflows?.directories,
  });
  const [roxyMd, projectJson, profile, memories, workflowResult] = await Promise.all([
    readTextIfExists(join(cwd, 'ROXY.md'), 16_000),
    readJsonIfExists(join(cwd, '.roxycode', 'project.json')),
    readJsonIfExists(join(cwd, '.roxycode', 'profile.json')),
    memoryStore.list({ limit: 100 }),
    workflowLoader.load().catch(() => ({ workflows: [] as WorkflowDefinition[] })),
  ]);

  return {
    roxyMd,
    projectJson,
    profile,
    memories: options.query ? selectRelevantMemories(options.query, memories, { limit: 5 }) : memories.slice(0, 5),
    workflows: workflowResult.workflows,
  };
}

export function renderRuntimeContext(snapshot: RuntimeContextSnapshot, language: Language): string | null {
  const sections: string[] = [];
  const isZh = language !== 'en-US';

  if (snapshot.roxyMd?.trim()) {
    sections.push([
      isZh ? '\u0023\u0023 \u9879\u76ee\u6307\u4ee4 ROXY.md' : '## Project Instructions ROXY.md',
      snapshot.roxyMd.trim(),
    ].join('\n'));
  }

  if (snapshot.projectJson) {
    sections.push([
      isZh ? '\u0023\u0023 \u7ed3\u6784\u5316\u9879\u76ee\u753b\u50cf .roxycode/project.json' : '## Structured Project Profile .roxycode/project.json',
      summarizeProjectJson(snapshot.projectJson, language),
    ].join('\n'));
  }

  if (snapshot.profile) {
    sections.push([
      isZh ? '\u0023\u0023 \u7528\u6237\u4e2a\u4eba\u753b\u50cf .roxycode/profile.json' : '## User Profile .roxycode/profile.json',
      summarizeProfile(snapshot.profile, language),
    ].join('\n'));
  }

  const memoryContext = renderMemoriesForPrompt(snapshot.memories ?? [], language);
  if (memoryContext) sections.push(memoryContext);

  const workflowContext = renderWorkflowContext(snapshot.workflows ?? [], language);
  if (workflowContext) sections.push(workflowContext);

  if (sections.length === 0) return null;

  const lead = isZh
    ? '\u4ee5\u4e0b\u5185\u5bb9\u6765\u81ea RoxyCode \u7684\u9879\u76ee\u753b\u50cf\u3001\u4e2a\u4eba\u753b\u50cf\u548c\u957f\u671f\u8bb0\u5fc6\u3002\u9879\u76ee\u89c4\u5219\u4f18\u5148\u4e8e\u4e2a\u4eba\u504f\u597d\uff1b\u5b89\u5168\u89c4\u5219\u4f18\u5148\u4e8e\u4e8c\u8005\u3002\u8bb0\u5fc6\u53ef\u80fd\u8fc7\u671f\uff0c\u6d89\u53ca\u5f53\u524d\u4ee3\u7801\u72b6\u6001\u65f6\u5fc5\u987b\u5148\u6838\u9a8c\u3002'
    : 'The following comes from RoxyCode project/user profiles and long-term memory. Project rules override personal preferences; safety rules override both. Memories may be stale, so verify current code state before relying on them.';
  return [lead, ...sections].join('\n\n');
}

function renderWorkflowContext(workflows: WorkflowDefinition[], language: Language): string | null {
  if (workflows.length === 0) return null;
  const isZh = language !== 'en-US';
  const visible = workflows.slice(0, 12);
  const lines = visible.map(workflow => {
    const aliases = workflow.aliases?.length ? ` aliases=${workflow.aliases.join(',')}` : '';
    return `- ${workflow.id}: ${workflow.name} (${workflow.source}, ${workflow.mode})${aliases} - ${workflow.description}`;
  });
  const header = isZh
    ? '\u0023\u0023 \u53ef\u7528 RoxyCode \u5de5\u4f5c\u6d41'
    : '## Available RoxyCode Workflows';
  const note = isZh
    ? '\u7528\u6237\u8981\u6c42\u6309\u6d41\u7a0b\u5904\u7406\u4efb\u52a1\u65f6\uff0c\u4f18\u5148\u5efa\u8bae\u4f7f\u7528 /workflow run <id>\u3002\u5de5\u4f5c\u6d41\u53ea\u63d0\u4f9b\u8fc7\u7a0b\u7ea6\u675f\uff0c\u5de5\u5177\u548c\u6743\u9650\u4ecd\u7531 RoxyCode \u6267\u884c\u94fe\u63a7\u5236\u3002'
    : 'When the user asks for a process-oriented task, prefer suggesting /workflow run <id>. Workflows provide process constraints only; tools and permissions still run through RoxyCode.';
  const suffix = workflows.length > visible.length
    ? `\n- ... ${workflows.length - visible.length} more`
    : '';
  return [header, note, ...lines].join('\n') + suffix;
}
async function readTextIfExists(path: string, maxChars: number): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    const raw = await readFile(path, 'utf-8');
    return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n...[truncated]` : raw;
  } catch {
    return undefined;
  }
}

async function readJsonIfExists(path: string): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function summarizeProjectJson(project: Record<string, unknown>, language: Language): string {
  const lines: string[] = [];
  const isZh = language !== 'en-US';
  append(lines, isZh ? '\u9879\u76ee\u540d\u79f0' : 'Name', project.name);
  append(lines, isZh ? '\u5305\u7ba1\u7406\u5668' : 'Package manager', project.packageManager);
  append(lines, isZh ? '\u8bed\u8a00' : 'Languages', joinValue(project.languages));
  append(lines, isZh ? '\u6846\u67b6' : 'Frameworks', joinValue(project.frameworks));
  const scripts = isRecord(project.scripts) ? Object.keys(project.scripts).filter(Boolean).join(', ') : '';
  append(lines, isZh ? '\u53ef\u7528\u811a\u672c' : 'Scripts', scripts);
  const structure = isRecord(project.structure) ? project.structure : undefined;
  if (structure) {
    append(lines, isZh ? '\u6e90\u7801\u76ee\u5f55' : 'Source dirs', joinValue(structure.sourceDirs));
    append(lines, isZh ? '\u6d4b\u8bd5\u76ee\u5f55' : 'Test dirs', joinValue(structure.testDirs));
  }
  return lines.join('\n');
}

function summarizeProfile(profile: Record<string, unknown>, language: Language): string {
  const lines: string[] = [];
  const isZh = language !== 'en-US';
  append(lines, isZh ? '\u504f\u597d\u8bed\u8a00' : 'Preferred language', profile.language);
  append(lines, isZh ? '\u6280\u672f\u6808' : 'Tech stack', joinValue(profile.techStack));
  append(lines, isZh ? '\u89e3\u91ca\u6df1\u5ea6' : 'Explanation depth', profile.explanationDepth);
  append(lines, isZh ? '\u9ed8\u8ba4\u89d2\u8272' : 'Default character', profile.defaultCharacter);
  append(lines, isZh ? '\u6a21\u578b\u7b56\u7565' : 'Model strategy', profile.modelStrategy);
  append(lines, isZh ? '\u5ba1\u7f8e\u6a21\u5f0f' : 'Aesthetic mode', profile.aestheticMode);
  append(lines, isZh ? '\u5907\u6ce8' : 'Notes', joinValue(profile.notes));
  return lines.join('\n');
}

function append(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  lines.push(`- ${label}: ${String(value)}`);
}

function joinValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean).join(', ');
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}