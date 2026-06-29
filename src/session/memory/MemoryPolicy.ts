import type { AddMemoryInput, MemoryType } from './types.js';

export type MemoryPolicySeverity = 'allow' | 'warn' | 'block';

export interface MemoryPolicyEvaluation {
  severity: MemoryPolicySeverity;
  allowed: boolean;
  reasons: string[];
  suggestions: string[];
}

export class MemoryPolicyError extends Error {
  readonly evaluation: MemoryPolicyEvaluation;

  constructor(evaluation: MemoryPolicyEvaluation) {
    super(evaluation.reasons.join('; ') || 'Memory rejected by policy');
    this.name = 'MemoryPolicyError';
    this.evaluation = evaluation;
  }
}

type MemoryPolicyInput = Pick<AddMemoryInput, 'type' | 'content' | 'scope' | 'source' | 'tags'>;

const SECRET_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|secret|access[_-]?token|refresh[_-]?token|password|passwd|pwd|private[_-]?key)\b\s*[:=]/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i,
];

const FILE_PATH_PATTERNS: RegExp[] = [
  /\b[A-Za-z]:[\\/][^\s]+/,
  /(^|\s)(?:\.{1,2}[\\/]|\/)[^\s]+/,
  /\b(?:src|app|lib|packages|components|pages|server|client|test|tests|docs|dist)[\\/][^\s]+\.(?:ts|tsx|js|jsx|vue|json|md|yml|yaml|java|go|py|rs|css|scss)\b/i,
  /\b[\w.-]+\.(?:ts|tsx|js|jsx|vue|json|md|yml|yaml|java|go|py|rs|css|scss):\d+\b/i,
];

const GIT_OR_ACTIVITY_PATTERNS: RegExp[] = [
  /\b[0-9a-f]{7,40}\b/i,
  /\b(git log|git blame|recent changes|activity log|who-changed-what|merged PR|merged pull request|PR #\d+|pull request #\d+|commit [0-9a-f]{7,40})\b/i,
  /(\\u6700\\u8fd1|\\u4eca\\u5929|\\u6628\\u5929).{0,20}(PR|\\u63d0\\u4ea4|\\u5206\\u652f|\\u5408\\u5e76|\\u53d8\\u66f4\\u8bb0\\u5f55|\\u6d3b\\u52a8\\u65e5\\u5fd7)/,
];

const EPHEMERAL_PATTERNS: RegExp[] = [
  /\b(currently|right now|just fixed|just changed|this conversation|this session|in-progress|temporary|todo for this turn)\b/i,
  /(\u5f53\u524d\u6b63\u5728|\u521a\u4fee\u590d|\u521a\u4fee\u6539|\u8fd9\u8f6e\u5bf9\u8bdd|\u672c\u6b21\u4f1a\u8bdd|\u4e34\u65f6|\u8fdb\u884c\u4e2d|\u5f85\u4f1a\u513f|\u4e0b\u4e00\u6b65\u5148).{0,40}/,
];

const CODE_FACT_PATTERNS: RegExp[] = [
  /\b(function|class|interface|component|module|method|\u53d8\u91cf|\u51fd\u6570|\u7c7b|\u7ec4\u4ef6|\u6a21\u5757)\s+[`"']?[\w$.-]+[`"']?\s+(?:is|lives|located|defined|\u5728|\u4f4d\u4e8e|\u5b9a\u4e49\u5728)/i,
  /\b(project|repo|codebase|\u4ed3\u5e93|\u9879\u76ee)\s+(?:uses|contains|has|\u4f7f\u7528|\u5305\u542b|\u91c7\u7528).{0,60}\b(?:src|app|lib|package|module|\u67b6\u6784|\u76ee\u5f55|\u6587\u4ef6)\b/i,
  /\b(?:import|export|const|let|var|function|class|interface|type)\s+[\w$]/,
];

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/;
const STACK_TRACE_PATTERN = /\b(?:Error|Exception|Traceback|at\s+[\w.$<>]+\s*\(|^\s+at\s+)/m;
const URL_PATTERN = /\bhttps?:\/\/\S+/i;

export function evaluateMemoryCandidate(input: MemoryPolicyInput): MemoryPolicyEvaluation {
  const content = input.content.trim();
  const reasons: string[] = [];
  const suggestions = new Set<string>();

  if (!content) {
    reasons.push('memory content is empty');
  }

  if (content.length > 2_000) {
    reasons.push('memory is too long for durable recall');
    suggestions.add('summarize the stable preference, rationale, and how it should apply later');
  }

  if (matchesAny(SECRET_PATTERNS, content)) {
    reasons.push('memory appears to contain a secret, token, password, or API key');
    suggestions.add('store credentials in a secret manager or environment variable, not long-term memory');
  }

  if (CODE_BLOCK_PATTERN.test(content) || STACK_TRACE_PATTERN.test(content)) {
    reasons.push('memory looks like raw code or a stack trace');
    suggestions.add('keep fixes in code, tests, commits, or session history instead of memory');
  }

  if (input.type !== 'reference' && matchesAny(FILE_PATH_PATTERNS, content)) {
    reasons.push('memory names file paths or file:line claims that should be verified from the repo');
    suggestions.add('use memory for durable intent or preference, not file structure snapshots');
  }

  if (input.type === 'reference' && matchesAny(FILE_PATH_PATTERNS, content) && !URL_PATTERN.test(content)) {
    reasons.push('reference memory should point to external docs, dashboards, tickets, or communities');
    suggestions.add('for project files, read the current repository instead of saving their paths');
  }

  if (matchesAny(EPHEMERAL_PATTERNS, content)) {
    reasons.push('memory looks like temporary task state from the current conversation');
    suggestions.add('use session history, plans, or workflow steps for current work; reserve memory for future sessions');
  }

  if (matchesAny(GIT_OR_ACTIVITY_PATTERNS, content)) {
    reasons.push('memory looks like git history, branch activity, recent changes, or an activity log');
    suggestions.add('use git/session logs for chronology; save only surprising rationale that affects future decisions');
  }

  if (matchesAny(CODE_FACT_PATTERNS, content)) {
    reasons.push('memory looks like code architecture, conventions, symbols, or project structure');
    suggestions.add('derive code facts by reading files or searching the repo when needed');
  }

  if (input.type === 'learning') {
    validateLearningMemory(content, suggestions);
  }

  if (input.type === 'workflow') {
    validateWorkflowMemory(content, reasons, suggestions);
  }

  const blocked = reasons.length > 0;
  const warningReasons = blocked ? [] : warningsFor(input.type);
  for (const suggestion of defaultSuggestions(input.type)) suggestions.add(suggestion);

  const severity: MemoryPolicySeverity = blocked ? 'block' : warningReasons.length > 0 ? 'warn' : 'allow';
  return {
    severity,
    allowed: !blocked,
    reasons: blocked ? reasons : warningReasons,
    suggestions: Array.from(suggestions),
  };
}

export function assertMemoryPolicy(input: MemoryPolicyInput): MemoryPolicyEvaluation {
  const evaluation = evaluateMemoryCandidate(input);
  if (!evaluation.allowed) throw new MemoryPolicyError(evaluation);
  return evaluation;
}

function validateLearningMemory(content: string, suggestions: Set<string>): void {
  const hasLearningSignal = /(explain|teach|learn|study|concept|example|depth|beginner|advanced|\u89e3\u91ca|\u6559\u5b66|\u5b66\u4e60|\u6982\u5ff5|\u4f8b\u5b50|\u6df1\u5ea6|\u521d\u5b66|\u8fdb\u9636|\u7c7b\u6bd4)/i.test(content);
  if (!hasLearningSignal) {
    suggestions.add('learning memories work best when they describe explanation depth, concepts, examples, or study style');
  }
}

function validateWorkflowMemory(content: string, reasons: string[], suggestions: Set<string>): void {
  const destructiveCommand = /\b(rm\s+-rf|del\s+\/[sfq]|Remove-Item\b.*-Recurse|git\s+reset\s+--hard|git\s+clean\s+-fd|format\s+[A-Za-z]:)\b/i;
  if (destructiveCommand.test(content)) {
    reasons.push('workflow memory includes a destructive command pattern');
    suggestions.add('dangerous commands should go through the tool permission system each time, not become a remembered habit');
  }
  const hasWorkflowSignal = /(before|after|always|review|test|build|commit|branch|workflow|\u6bcf\u6b21|\u4e4b\u524d|\u4e4b\u540e|\u603b\u662f|\u68c0\u67e5|\u6784\u5efa|\u6d4b\u8bd5|\u63d0\u4ea4|\u5206\u652f|\u6d41\u7a0b|\u4e60\u60ef)/i.test(content);
  if (!hasWorkflowSignal) {
    suggestions.add('workflow memories should describe a repeated habit, review ritual, command, or agent mode preference');
  }
}

function warningsFor(type: MemoryType): string[] {
  if (type === 'project') {
    return ['project memories decay faster than user preferences; verify current project state before relying on them'];
  }
  return [];
}

function defaultSuggestions(type: MemoryType): string[] {
  if (type === 'feedback' || type === 'project') {
    return ['include why it matters and how to apply it in future sessions'];
  }
  if (type === 'learning') {
    return ['prefer stable teaching preferences over one-off questions'];
  }
  if (type === 'workflow') {
    return ['keep workflow memories about repeated routines, not one-time task progress'];
  }
  return [];
}

function matchesAny(patterns: RegExp[], content: string): boolean {
  return patterns.some(pattern => pattern.test(content));
}