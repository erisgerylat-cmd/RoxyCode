export type ShellSafetyLevel = 'allow' | 'ask' | 'dangerous';

export interface ShellSafetyResult {
  level: ShellSafetyLevel;
  reasons: string[];
  matchedRule?: string;
  requiresSecondConfirmation: boolean;
}

const DEFAULT_READONLY_WHITELIST = [
  'pwd',
  'ls',
  'dir',
  'type',
  'cat',
  'echo',
  'git status',
  'git diff',
  'git log',
  'git branch',
  'Get-Location',
  'Get-ChildItem',
  'Get-Content',
  'Select-String',
];

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+.*-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/i, reason: '包含递归强制删除，可能一次性删除大量项目文件。' },
  { pattern: /\bRemove-Item\b[\s\S]*\b-Recurse\b[\s\S]*\b-Force\b/i, reason: '包含 PowerShell 递归强制删除，恢复成本很高。' },
  { pattern: /\b(del|erase|rd|rmdir)\b/i, reason: '包含 Windows 删除命令，可能移除文件或目录。' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: '会丢弃未提交修改，可能覆盖当前工作成果。' },
  { pattern: /\bgit\s+clean\s+-[^\n]*[fd]/i, reason: '会删除未跟踪文件，可能清掉新建代码、文档或资源。' },
  { pattern: /\bgit\s+push\b[\s\S]*(--force|-f)\b/i, reason: '强制推送会改写远端历史，影响协作者。' },
  { pattern: /\b(format|shutdown|reboot|poweroff)\b/i, reason: '包含系统级命令，可能影响当前机器状态。' },
  { pattern: /\breg\s+(add|delete|import)\b/i, reason: '会修改 Windows 注册表，影响范围超出项目。' },
  { pattern: /\bSet-ExecutionPolicy\b/i, reason: '会修改 PowerShell 执行策略，影响系统安全配置。' },
  { pattern: /\b(chmod|chown|icacls)\b/i, reason: '会修改权限或所有者，可能导致文件不可读写或权限扩大。' },
];

const ASK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[^>])>(?!>)|>>/i, reason: '包含输出重定向，可能覆盖或追加写入文件。' },
  { pattern: /\b(mv|move|ren|rename|cp|copy|New-Item|Set-Content|Add-Content|Out-File)\b/i, reason: '包含文件创建、复制、移动或写入操作。' },
  { pattern: /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update)\b/i, reason: '会修改依赖或锁文件，可能影响项目运行环境。' },
  { pattern: /\b(pip|uv|poetry|cargo|go)\s+(install|add|get|mod|update)\b/i, reason: '会修改依赖或下载代码，可能影响项目运行环境。' },
  { pattern: /\b(cd|pushd|popd)\b/i, reason: '会改变命令执行目录，后续子命令的影响范围需要确认。' },
];

export function classifyShellCommand(command: string, whitelist: string[] = DEFAULT_READONLY_WHITELIST): ShellSafetyResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { level: 'ask', reasons: ['空命令没有明确意图，需要确认。'], requiresSecondConfirmation: false };
  }

  const dangerousReasons = DANGEROUS_PATTERNS
    .filter(item => item.pattern.test(trimmed))
    .map(item => item.reason);
  if (dangerousReasons.length > 0) {
    return {
      level: 'dangerous',
      reasons: [...new Set(dangerousReasons)],
      requiresSecondConfirmation: true,
    };
  }

  const askReasons = ASK_PATTERNS
    .filter(item => item.pattern.test(trimmed))
    .map(item => item.reason);
  if (askReasons.length > 0) {
    return {
      level: 'ask',
      reasons: [...new Set(askReasons)],
      requiresSecondConfirmation: false,
    };
  }

  const matchedRule = whitelist.find(rule => matchesCommandPrefix(trimmed, rule));
  if (matchedRule) {
    return {
      level: 'allow',
      reasons: [`命令匹配只读白名单规则: ${matchedRule}`],
      matchedRule,
      requiresSecondConfirmation: false,
    };
  }

  return {
    level: 'ask',
    reasons: ['命令不在只读白名单内，RoxyCode 无法证明它只读取信息。'],
    requiresSecondConfirmation: false,
  };
}

export function getDefaultShellWhitelist(): string[] {
  return [...DEFAULT_READONLY_WHITELIST];
}

function matchesCommandPrefix(command: string, rule: string): boolean {
  const normalizedCommand = command.toLowerCase();
  const normalizedRule = rule.toLowerCase();
  return normalizedCommand === normalizedRule || normalizedCommand.startsWith(`${normalizedRule} `);
}
