import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TodoItem, TodoPriority } from '../../tool/builtin/todoWrite.js';

export type PlanStatus = 'draft' | 'approved' | 'rejected' | 'executed';
export type PlanRiskLevel = 'low' | 'medium' | 'high';
export type PlanSource = 'plan-command' | 'session' | 'api';

export interface PlanRiskAssessment {
  level: PlanRiskLevel;
  reasons: string[];
}

export interface PlanRecord {
  id: string;
  task: string;
  text: string;
  status: PlanStatus;
  riskLevel: PlanRiskLevel;
  riskReasons: string[];
  todoItems: TodoItem[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  executedAt?: string;
  sessionId?: string;
  source: PlanSource;
}

export interface CreatePlanInput {
  task: string;
  text: string;
  sessionId?: string;
  source?: PlanSource;
  language?: 'zh-CN' | 'en-US';
}

export interface EditPlanInput {
  text: string;
  language?: 'zh-CN' | 'en-US';
}

interface CurrentPlanPointer {
  currentPlanId: string;
  updatedAt: string;
}

export class PlanStore {
  readonly cwd: string;
  readonly dir: string;
  readonly currentPath: string;

  constructor(options: { cwd?: string } = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.dir = join(this.cwd, '.roxycode', 'plans');
    this.currentPath = join(this.dir, 'current.json');
  }

  getPlanPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async createPlan(input: CreatePlanInput): Promise<PlanRecord> {
    const now = new Date().toISOString();
    const risk = classifyPlanRisk(input.text);
    const record: PlanRecord = {
      id: createPlanId(),
      task: input.task.trim(),
      text: input.text.trim(),
      status: 'draft',
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      todoItems: extractTodosFromPlan(input.text, input.language),
      createdAt: now,
      updatedAt: now,
      sessionId: input.sessionId,
      source: input.source ?? 'plan-command',
    };
    await this.saveRecord(record);
    await this.setCurrentPlan(record.id);
    return record;
  }

  async getCurrentPlan(): Promise<PlanRecord | null> {
    const pointer = await this.readCurrentPointer();
    if (pointer) {
      const pointed = await this.readPlan(pointer.currentPlanId);
      if (pointed) return pointed;
    }
    const plans = await this.listPlans();
    return plans[0] ?? null;
  }

  async listPlans(): Promise<PlanRecord[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter(file => file.endsWith('.json') && file !== 'current.json');
    const records = await Promise.all(files.map(file => this.readPlan(file.slice(0, -'.json'.length))));
    return records
      .filter((record): record is PlanRecord => record !== null)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async readPlan(id: string): Promise<PlanRecord | null> {
    const path = this.getPlanPath(id);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    return normalizePlanRecord(JSON.parse(raw));
  }

  async approveCurrentPlan(): Promise<PlanRecord> {
    const plan = await this.requireCurrentPlan();
    if (plan.status === 'rejected') {
      throw new Error('Plan was rejected. Edit it or create a new plan before approval.');
    }
    const now = new Date().toISOString();
    const next: PlanRecord = {
      ...plan,
      status: 'approved',
      approvedAt: plan.approvedAt ?? now,
      updatedAt: now,
    };
    await this.saveRecord(next);
    await this.setCurrentPlan(next.id);
    return next;
  }

  async rejectCurrentPlan(reason?: string): Promise<PlanRecord> {
    const plan = await this.requireCurrentPlan();
    const now = new Date().toISOString();
    const rejectionNote = reason?.trim();
    const next: PlanRecord = {
      ...plan,
      status: 'rejected',
      rejectedAt: now,
      updatedAt: now,
      riskReasons: rejectionNote ? [...plan.riskReasons, `Rejected: ${rejectionNote}`] : plan.riskReasons,
    };
    await this.saveRecord(next);
    await this.setCurrentPlan(next.id);
    return next;
  }

  async editCurrentPlan(input: EditPlanInput): Promise<PlanRecord> {
    const plan = await this.requireCurrentPlan();
    const text = input.text.trim();
    if (!text) throw new Error('Plan text cannot be empty.');
    const risk = classifyPlanRisk(text);
    const next: PlanRecord = {
      ...plan,
      text,
      status: 'draft',
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      todoItems: extractTodosFromPlan(text, input.language),
      approvedAt: undefined,
      rejectedAt: undefined,
      executedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    await this.saveRecord(next);
    await this.setCurrentPlan(next.id);
    return next;
  }

  async markExecuted(id: string): Promise<PlanRecord> {
    const plan = await this.readPlan(id);
    if (!plan) throw new Error(`Plan not found: ${id}`);
    const now = new Date().toISOString();
    const next: PlanRecord = {
      ...plan,
      status: 'executed',
      executedAt: now,
      updatedAt: now,
    };
    await this.saveRecord(next);
    await this.setCurrentPlan(next.id);
    return next;
  }

  private async requireCurrentPlan(): Promise<PlanRecord> {
    const plan = await this.getCurrentPlan();
    if (!plan) throw new Error('No current plan found.');
    return plan;
  }

  private async saveRecord(record: PlanRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.getPlanPath(record.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }

  private async setCurrentPlan(id: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const pointer: CurrentPlanPointer = { currentPlanId: id, updatedAt: new Date().toISOString() };
    await writeFile(this.currentPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
  }

  private async readCurrentPointer(): Promise<CurrentPlanPointer | null> {
    if (!existsSync(this.currentPath)) return null;
    try {
      const raw = await readFile(this.currentPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CurrentPlanPointer>;
      if (typeof parsed.currentPlanId !== 'string' || !parsed.currentPlanId) return null;
      return { currentPlanId: parsed.currentPlanId, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString() };
    } catch {
      return null;
    }
  }
}

export function classifyPlanRisk(text: string): PlanRiskAssessment {
  const normalized = text.toLowerCase();
  const reasons: string[] = [];

  const highRiskTerms: Array<[RegExp, string]> = [
    [/\brm\s+-rf\b/, 'recursive delete command'],
    [/\bgit\s+reset\s+--hard\b/, 'hard git reset'],
    [/\bgit\s+clean\s+-fd\b/, 'force git clean'],
    [/\bdrop\s+table\b/, 'database drop table'],
    [/\btruncate\s+table\b/, 'database truncate table'],
    [/\bformat\b/, 'format operation'],
    [/\bsystem32\b/, 'system directory'],
    [/\bregistry\b/, 'registry operation'],
    [/\bproduction\b|\bprod\b/, 'production environment'],
    [/\bsecret\b|\btoken\b|\bapi[_-]?key\b/, 'secret or token handling'],
    [/remove-item\s+.*-recurse/i, 'recursive PowerShell delete'],
    [/\u5220\u9664|\u6e05\u7a7a|\u683c\u5f0f\u5316|\u5168\u91cf\u8986\u76d6/, 'destructive file operation'],
    [/\u751f\u4ea7\u73af\u5883|\u7ebf\u4e0a|\u6570\u636e\u5e93\u8fc1\u79fb/, 'production or database operation'],
    [/\u5bc6\u94a5|\u4ee4\u724c|\u5bc6\u7801/, 'credential handling'],
  ];
  for (const [pattern, reason] of highRiskTerms) {
    if (pattern.test(normalized)) reasons.push(reason);
  }
  if (reasons.length > 0) return { level: 'high', reasons: unique(reasons).slice(0, 6) };

  const mediumRiskTerms: Array<[RegExp, string]> = [
    [/\bwrite\b|\bedit\b|\bmodify\b|\bcreate\b/, 'file modification'],
    [/\bshell\b|\bcommand\b|\bbash\b|\bpowershell\b/, 'shell execution'],
    [/\bgit\b/, 'git operation'],
    [/\binstall\b|\bnpm\b|\bpnpm\b|\byarn\b/, 'dependency or package operation'],
    [/\bmigration\b|\bdocker\b/, 'runtime or migration operation'],
    [/\u4fee\u6539|\u5199\u5165|\u65b0\u589e|\u521b\u5efa/, 'file modification'],
    [/\u8fd0\u884c\u547d\u4ee4|\u6267\u884c|\u5b89\u88c5|\u4f9d\u8d56/, 'command or dependency operation'],
    [/\u63d0\u4ea4|\u5206\u652f|\u8fc1\u79fb/, 'git or migration operation'],
  ];
  for (const [pattern, reason] of mediumRiskTerms) {
    if (pattern.test(normalized)) reasons.push(reason);
  }
  if (reasons.length > 0) return { level: 'medium', reasons: unique(reasons).slice(0, 6) };

  return { level: 'low', reasons: [] };
}

export function extractTodosFromPlan(text: string, language: 'zh-CN' | 'en-US' = 'zh-CN'): TodoItem[] {
  const candidates: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)(.+)$/);
    if (!match) continue;
    const cleaned = cleanTodoContent(match[1]);
    if (cleaned.length >= 4 && !isMetaTodoLine(cleaned)) candidates.push(cleaned);
  }

  const uniqueCandidates = unique(candidates).slice(0, 12);
  const source = uniqueCandidates.length > 0 ? uniqueCandidates : fallbackTodos(language);
  return source.map((content, index) => ({
    id: `plan-${index + 1}`,
    content,
    status: 'pending',
    priority: inferPriority(content, index),
  }));
}

function normalizePlanRecord(value: unknown): PlanRecord {
  const record = value as Partial<PlanRecord>;
  if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
    throw new Error('Invalid plan record.');
  }
  const risk = classifyPlanRisk(record.text ?? '');
  return {
    id: record.id,
    task: typeof record.task === 'string' ? record.task : '',
    text: typeof record.text === 'string' ? record.text : '',
    status: isPlanStatus(record.status) ? record.status : 'draft',
    riskLevel: isPlanRiskLevel(record.riskLevel) ? record.riskLevel : risk.level,
    riskReasons: Array.isArray(record.riskReasons) ? record.riskReasons.filter(isString) : risk.reasons,
    todoItems: Array.isArray(record.todoItems) ? record.todoItems.filter(isTodoItem).map(item => ({ ...item })) : extractTodosFromPlan(record.text ?? ''),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
    approvedAt: typeof record.approvedAt === 'string' ? record.approvedAt : undefined,
    rejectedAt: typeof record.rejectedAt === 'string' ? record.rejectedAt : undefined,
    executedAt: typeof record.executedAt === 'string' ? record.executedAt : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    source: record.source === 'session' || record.source === 'api' || record.source === 'plan-command' ? record.source : 'plan-command',
  };
}

function createPlanId(): string {
  return `plan-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function cleanTodoContent(value: string): string {
  return value
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^\*\*(.+?)\*\*:?\s*/, '$1: ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[。；;,.，]$/, '')
    .trim();
}

function isMetaTodoLine(value: string): boolean {
  return /^(risk|risks|note|notes|warning|warnings|objective|goal)\b/i.test(value)
    || /^(风险|注意|目标|说明)[:：]/.test(value);
}

function inferPriority(content: string, index: number): TodoPriority {
  const lower = content.toLowerCase();
  if (index === 0) return 'high';
  if (/\btests?\b|\bverify\b|\bvalidate\b|\bpermission\b|\brisk\b/.test(lower)) return 'high';
  if (/\u6d4b\u8bd5|\u9a8c\u8bc1|\u6821\u9a8c|\u6743\u9650|\u98ce\u9669/.test(content)) return 'high';
  if (/\bdocs?\b|\breadme\b/.test(lower) || /\u6587\u6863|\u8bf4\u660e/.test(content)) return 'low';
  return 'medium';
}

function fallbackTodos(language: 'zh-CN' | 'en-US'): string[] {
  if (language === 'en-US') {
    return [
      'Inspect the current implementation and constraints',
      'Apply the approved changes',
      'Run verification and summarize the result',
    ];
  }
  return [
    '\u68b3\u7406\u5f53\u524d\u5b9e\u73b0\u548c\u7ea6\u675f',
    '\u6309\u5df2\u6279\u51c6\u8ba1\u5212\u4fee\u6539\u4ee3\u7801',
    '\u8fd0\u884c\u9a8c\u8bc1\u5e76\u603b\u7ed3\u7ed3\u679c',
  ];
}

function isPlanStatus(value: unknown): value is PlanStatus {
  return value === 'draft' || value === 'approved' || value === 'rejected' || value === 'executed';
}

function isPlanRiskLevel(value: unknown): value is PlanRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<TodoItem>;
  return typeof item.id === 'string'
    && typeof item.content === 'string'
    && (item.status === 'pending' || item.status === 'in_progress' || item.status === 'completed')
    && (item.priority === 'high' || item.priority === 'medium' || item.priority === 'low');
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}
