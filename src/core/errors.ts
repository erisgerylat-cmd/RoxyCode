export type RoxyErrorCategory =
  | 'abort'
  | 'config'
  | 'filesystem'
  | 'hook'
  | 'llm'
  | 'network'
  | 'permission'
  | 'shell'
  | 'tool'
  | 'validation'
  | 'unknown';

export type RoxyRecoveryAction =
  | 'check_config'
  | 'fix_input'
  | 'inspect_logs'
  | 'reduce_scope'
  | 'request_permission'
  | 'retry'
  | 'stop'
  | 'none';

export interface RoxyErrorOptions {
  category?: RoxyErrorCategory;
  code?: string;
  telemetryMessage?: string;
  recoverable?: boolean;
  recoveryAction?: RoxyRecoveryAction;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export interface ValidationIssue {
  path: Array<string | number>;
  code: 'missing_required' | 'invalid_type' | 'invalid_enum' | 'unrecognized_key' | 'custom';
  message?: string;
  expected?: string;
  received?: string;
  options?: string[];
}

export interface ErrorDescriptor {
  name: string;
  message: string;
  category: RoxyErrorCategory;
  code?: string;
  telemetryMessage: string;
  recoverable: boolean;
  recoveryAction: RoxyRecoveryAction;
  details?: Record<string, unknown>;
}

export class RoxyError extends Error {
  readonly category: RoxyErrorCategory;
  readonly code?: string;
  readonly telemetryMessage: string;
  readonly recoverable: boolean;
  readonly recoveryAction: RoxyRecoveryAction;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: RoxyErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category ?? 'unknown';
    this.code = options.code;
    this.telemetryMessage = options.telemetryMessage ?? defaultTelemetryMessage(this.category, options.code);
    this.recoverable = options.recoverable ?? true;
    this.recoveryAction = options.recoveryAction ?? defaultRecoveryAction(this.category);
    this.details = options.details;
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        configurable: true,
        writable: true,
      });
    }
  }
}

export class TelemetrySafeError extends RoxyError {
  constructor(message: string, telemetryMessage?: string, options: Omit<RoxyErrorOptions, 'telemetryMessage'> = {}) {
    super(message, {
      category: options.category ?? 'unknown',
      ...options,
      telemetryMessage: telemetryMessage ?? message,
    });
    this.name = 'TelemetrySafeError';
  }
}

export class AbortExecutionError extends RoxyError {
  constructor(message = 'Request aborted', options: Omit<RoxyErrorOptions, 'category' | 'recoveryAction'> = {}) {
    super(message, {
      ...options,
      category: 'abort',
      code: options.code ?? 'ABORTED',
      recoverable: false,
      recoveryAction: 'stop',
      telemetryMessage: options.telemetryMessage ?? 'Request aborted',
    });
  }
}

export class ToolExecutionError extends RoxyError {
  constructor(message: string, options: Omit<RoxyErrorOptions, 'category'> = {}) {
    super(message, {
      ...options,
      category: 'tool',
      code: options.code ?? 'TOOL_EXECUTION_ERROR',
      recoveryAction: options.recoveryAction ?? 'inspect_logs',
    });
  }
}

export class ToolInputValidationError extends RoxyError {
  readonly toolName: string;
  readonly issues: ValidationIssue[];

  constructor(toolName: string, issues: ValidationIssue[], message?: string) {
    super(message ?? formatValidationIssues(toolName, issues, 'en-US'), {
      category: 'validation',
      code: 'TOOL_INPUT_VALIDATION_ERROR',
      telemetryMessage: 'Tool input validation failed',
      recoveryAction: 'fix_input',
      details: { toolName, issues },
    });
    this.toolName = toolName;
    this.issues = issues;
  }
}

export class PermissionDeniedError extends RoxyError {
  constructor(message: string, options: Omit<RoxyErrorOptions, 'category' | 'recoveryAction'> = {}) {
    super(message, {
      ...options,
      category: 'permission',
      code: options.code ?? 'PERMISSION_DENIED',
      telemetryMessage: options.telemetryMessage ?? 'Permission denied',
      recoveryAction: 'request_permission',
    });
  }
}

export class HookBlockedError extends RoxyError {
  constructor(message: string, options: Omit<RoxyErrorOptions, 'category' | 'recoveryAction'> = {}) {
    super(message, {
      ...options,
      category: 'hook',
      code: options.code ?? 'HOOK_BLOCKED',
      telemetryMessage: options.telemetryMessage ?? 'Hook blocked execution',
      recoveryAction: 'inspect_logs',
    });
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getErrnoCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof AbortExecutionError
    || (error instanceof Error && error.name === 'AbortError')
    || getRoxyErrorDescriptor(error).category === 'abort';
}

export function classifyError(error: unknown): string {
  if (error instanceof RoxyError) {
    const suffix = error.code ? `:${error.code}` : '';
    return `${error.category}${suffix}`;
  }
  const errno = getErrnoCode(error);
  if (errno) return `filesystem:${errno}`;
  if (error instanceof Error) {
    if (error.name && error.name !== 'Error' && error.name.length > 3) return error.name.slice(0, 80);
    return 'Error';
  }
  return 'UnknownError';
}

export function classifyToolError(error: unknown): string {
  if (error instanceof RoxyError) return error.telemetryMessage.slice(0, 200);
  const errno = getErrnoCode(error);
  if (errno) return `Error:${errno}`;
  if (error instanceof Error && error.name && error.name !== 'Error' && error.name.length > 3) {
    return error.name.slice(0, 60);
  }
  return error instanceof Error ? 'Error' : 'UnknownError';
}

export function getRoxyErrorDescriptor(error: unknown): ErrorDescriptor {
  if (error instanceof RoxyError) {
    return {
      name: error.name,
      message: error.message,
      category: error.category,
      code: error.code,
      telemetryMessage: error.telemetryMessage,
      recoverable: error.recoverable,
      recoveryAction: error.recoveryAction,
      details: error.details,
    };
  }

  const message = errorMessage(error);
  const errno = getErrnoCode(error);
  const category = errno ? 'filesystem' : inferCategory(error);
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message,
    category,
    code: errno,
    telemetryMessage: errno ? `Filesystem error: ${errno}` : classifyToolError(error),
    recoverable: category !== 'abort',
    recoveryAction: defaultRecoveryAction(category),
  };
}

export function formatValidationIssues(
  toolName: string,
  issues: ValidationIssue[],
  language: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const zh = language !== 'en-US';
  if (issues.length === 0) {
    return zh ? `${toolName} \u53c2\u6570\u6821\u9a8c\u5931\u8d25\u3002` : `${toolName} failed input validation.`;
  }

  const header = zh
    ? `${toolName} \u53c2\u6570\u6821\u9a8c\u5931\u8d25\uff0c\u5171 ${issues.length} \u4e2a\u95ee\u9898\uff1a`
    : `${toolName} failed input validation with ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}:`;
  const lines = issues.map(issue => `- ${formatValidationIssue(issue, language)}`);
  return [header, ...lines].join('\n');
}

export function formatErrorForDisplay(error: unknown, language: 'zh-CN' | 'en-US' = 'zh-CN'): string {
  const descriptor = getRoxyErrorDescriptor(error);
  if (error instanceof ToolInputValidationError) return formatValidationIssues(error.toolName, error.issues, language);

  const zh = language !== 'en-US';
  const action = recoveryActionLabel(descriptor.recoveryAction, language);
  if (!action) return descriptor.message;
  return zh
    ? `${descriptor.message}\n\u5efa\u8bae\u5904\u7406\uff1a${action}`
    : `${descriptor.message}\nSuggested recovery: ${action}`;
}

export function truncateErrorText(text: string, maxChars = 10_000): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n\n... [${text.length - maxChars} characters truncated] ...\n\n${text.slice(-half)}`;
}

function formatValidationIssue(issue: ValidationIssue, language: 'zh-CN' | 'en-US'): string {
  const zh = language !== 'en-US';
  const path = formatValidationPath(issue.path);
  if (issue.message) return issue.message;

  switch (issue.code) {
    case 'missing_required':
      return zh ? `\u7f3a\u5c11\u5fc5\u586b\u53c2\u6570 \`${path}\`` : `The required parameter \`${path}\` is missing`;
    case 'invalid_type':
      return zh
        ? `\u53c2\u6570 \`${path}\` \u7c7b\u578b\u5e94\u4e3a \`${issue.expected ?? 'unknown'}\`\uff0c\u5b9e\u9645\u4e3a \`${issue.received ?? 'unknown'}\``
        : `The parameter \`${path}\` type is expected as \`${issue.expected ?? 'unknown'}\` but provided as \`${issue.received ?? 'unknown'}\``;
    case 'invalid_enum':
      return zh
        ? `\u53c2\u6570 \`${path}\` \u5fc5\u987b\u662f\u4ee5\u4e0b\u503c\u4e4b\u4e00\uff1a${issue.options?.join(', ') ?? '(empty)'}`
        : `The parameter \`${path}\` must be one of: ${issue.options?.join(', ') ?? '(empty)'}`;
    case 'unrecognized_key':
      return zh ? `\u4e0d\u652f\u6301\u7684\u53c2\u6570 \`${path}\`` : `An unexpected parameter \`${path}\` was provided`;
    case 'custom':
    default:
      return zh ? `\u53c2\u6570 \`${path}\` \u6821\u9a8c\u5931\u8d25` : `The parameter \`${path}\` failed validation`;
  }
}

function formatValidationPath(path: Array<string | number>): string {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((acc, segment, index) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return index === 0 ? segment : `${acc}.${segment}`;
  }, '');
}

function defaultTelemetryMessage(category: RoxyErrorCategory, code?: string): string {
  return code ? `${category}:${code}` : category;
}

function defaultRecoveryAction(category: RoxyErrorCategory): RoxyRecoveryAction {
  switch (category) {
    case 'validation':
      return 'fix_input';
    case 'permission':
      return 'request_permission';
    case 'config':
    case 'llm':
      return 'check_config';
    case 'filesystem':
      return 'reduce_scope';
    case 'network':
      return 'retry';
    case 'hook':
    case 'shell':
    case 'tool':
      return 'inspect_logs';
    case 'abort':
      return 'stop';
    case 'unknown':
    default:
      return 'inspect_logs';
  }
}

function inferCategory(error: unknown): RoxyErrorCategory {
  if (error instanceof Error && error.name === 'AbortError') return 'abort';
  const errno = getErrnoCode(error);
  if (errno) return 'filesystem';
  return 'unknown';
}

function recoveryActionLabel(action: RoxyRecoveryAction, language: 'zh-CN' | 'en-US'): string {
  const zh = language !== 'en-US';
  if (!zh) {
    switch (action) {
      case 'check_config': return 'check model/provider configuration';
      case 'fix_input': return 'adjust tool arguments and retry';
      case 'inspect_logs': return 'inspect runtime status or audit logs';
      case 'reduce_scope': return 'keep the operation inside the current project';
      case 'request_permission': return 'request or approve permission explicitly';
      case 'retry': return 'retry after the transient failure clears';
      case 'stop':
      case 'none':
      default: return '';
    }
  }

  switch (action) {
    case 'check_config': return '\u68c0\u67e5\u6a21\u578b\u6216 Provider \u914d\u7f6e';
    case 'fix_input': return '\u4fee\u6b63\u5de5\u5177\u53c2\u6570\u540e\u91cd\u8bd5';
    case 'inspect_logs': return '\u67e5\u770b /status\u3001/diagnostics \u6216\u5ba1\u8ba1\u65e5\u5fd7';
    case 'reduce_scope': return '\u5c06\u64cd\u4f5c\u8303\u56f4\u9650\u5236\u5728\u5f53\u524d\u9879\u76ee\u5185';
    case 'request_permission': return '\u660e\u786e\u8bf7\u6c42\u6216\u901a\u8fc7\u6743\u9650\u786e\u8ba4';
    case 'retry': return '\u7a0d\u540e\u91cd\u8bd5\u8be5\u64cd\u4f5c';
    case 'stop':
    case 'none':
    default:
      return '';
  }
}
