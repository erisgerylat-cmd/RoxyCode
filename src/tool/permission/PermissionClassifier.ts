import type { PermissionClassification, Tool, ToolExecutionContext, ToolRiskLevel } from '../types.js';
import { checkProjectBoundary, inspectDangerousPaths } from '../security/SecurityPolicy.js';
import { classifyShellCommand } from '../security/ShellSafety.js';

export class PermissionClassifier {
  classify(tool: Tool, args: Record<string, unknown>, ctx: ToolExecutionContext): PermissionClassification {
    const language = ctx.language ?? 'zh-CN';
    const permissionMode = ctx.permissionMode ?? 'strict';

    if (ctx.config.tools.disabled.includes(tool.definition.name)) {
      return {
        behavior: 'deny',
        source: 'disabled-tool',
        riskLevel: 'high',
        hardDeny: true,
        reasons: [text(language, `工具已被配置禁用：${tool.definition.name}`, `Tool is disabled by configuration: ${tool.definition.name}`)],
        details: [`tool: ${tool.definition.name}`],
      };
    }

    if (permissionMode === 'read-only' && !tool.isReadOnly) {
      return {
        behavior: 'deny',
        source: 'permission-mode',
        riskLevel: 'high',
        hardDeny: true,
        reasons: [text(language, '当前是只读模式，不能执行写文件、编辑文件或命令执行类工具。', 'Read-only mode blocks write, edit, and command tools.')],
        details: [`mode: ${permissionMode}`, `tool: ${tool.definition.name}`],
      };
    }

    const affectedPaths = tool.getAffectedPaths?.(args, ctx) ?? [];
    const pathClassification = classifyPaths(tool, affectedPaths, ctx);
    if (pathClassification) return pathClassification;

    if (tool.definition.name === 'execute_command') {
      return classifyShell(args, ctx);
    }

    if (permissionMode === 'auto-approve') {
      return {
        behavior: 'allow',
        source: 'permission-mode',
        riskLevel: tool.riskLevel,
        reasons: [text(language, '当前处于自动批准模式，且没有命中路径或命令高危规则。', 'Auto-approve mode allows this tool because no path or shell risk rule matched.')],
        details: [`mode: ${permissionMode}`, `tool: ${tool.definition.name}`],
        affectedPaths,
      };
    }

    if (tool.isReadOnly && tool.riskLevel === 'low') {
      return {
        behavior: 'allow',
        source: 'tool-risk',
        riskLevel: 'low',
        reasons: [text(language, '低风险只读工具可以直接执行。', 'Low-risk read-only tools can run without confirmation.')],
        details: [`tool: ${tool.definition.name}`],
        affectedPaths,
      };
    }

    return {
      behavior: 'ask',
      source: 'tool-risk',
      riskLevel: tool.riskLevel,
      reasons: [text(language, '该工具可能改变项目内容或运行环境，需要用户确认。', 'This tool may change project files or runtime state and needs confirmation.')],
      details: [`tool: ${tool.definition.name}`, `risk: ${tool.riskLevel}`, ...affectedPaths.map(path => `path: ${path}`)],
      requiresSecondConfirmation: tool.riskLevel === 'high' && ctx.config.security.highRisk.requireSecondConfirmation,
      affectedPaths,
    };
  }
}

function classifyPaths(tool: Tool, affectedPaths: string[], ctx: ToolExecutionContext): PermissionClassification | null {
  const language = ctx.language ?? 'zh-CN';
  if (affectedPaths.length === 0) return null;

  if (ctx.config.security.fileAccess.mode === 'project-only') {
    for (const path of affectedPaths) {
      const boundary = checkProjectBoundary(ctx.cwd, path);
      if (!boundary.allowed) {
        return {
          behavior: 'deny',
          source: 'path-boundary',
          riskLevel: 'high',
          hardDeny: true,
          reasons: [
            text(language, '默认路径策略只允许访问当前项目目录，不能越界读写。', 'The default path policy only allows access inside the current project.'),
            boundary.reason ?? text(language, '路径越过项目边界。', 'Path is outside the project boundary.'),
          ],
          details: [`tool: ${tool.definition.name}`, `path: ${boundary.resolvedPath}`],
          requiresSecondConfirmation: true,
          affectedPaths: [boundary.resolvedPath],
        };
      }
    }
  }

  const dangerous = inspectDangerousPaths(ctx.cwd, affectedPaths);
  if (!dangerous.dangerous) return null;

  const riskLevel: ToolRiskLevel = tool.isReadOnly ? 'medium' : 'high';
  return {
    behavior: 'ask',
    source: 'sensitive-path',
    riskLevel,
    reasons: [
      text(language, '操作命中了敏感路径，需要确认是否符合你的真实意图。', 'The operation touches sensitive paths and needs confirmation.'),
      ...dangerous.reasons,
    ],
    details: [`tool: ${tool.definition.name}`, ...dangerous.paths.map(path => `path: ${path}`)],
    requiresSecondConfirmation: riskLevel === 'high' && ctx.config.security.highRisk.requireSecondConfirmation,
    affectedPaths: dangerous.paths,
  };
}

function classifyShell(args: Record<string, unknown>, ctx: ToolExecutionContext): PermissionClassification {
  const language = ctx.language ?? 'zh-CN';
  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) {
    return {
      behavior: 'deny',
      source: 'shell-safety',
      riskLevel: 'high',
      hardDeny: true,
      reasons: [text(language, '空命令没有明确意图，不能执行。', 'Empty shell commands have no clear intent and cannot run.')],
      details: ['command: (empty)'],
      shellLevel: 'dangerous',
    };
  }

  const shell = classifyShellCommand(command, ctx.config.security.shell.whitelist);
  if (ctx.config.security.shell.mode === 'unrestricted' && shell.level !== 'dangerous') {
    return {
      behavior: 'allow',
      source: 'permission-mode',
      riskLevel: shell.level === 'allow' ? 'low' : 'medium',
      reasons: [text(language, 'Shell 处于非限制模式，且命令没有命中高危规则。', 'Shell unrestricted mode allows this non-dangerous command.')],
      details: [`command: ${command}`],
      matchedRule: shell.matchedRule,
      shellLevel: shell.level,
    };
  }

  if (shell.level === 'allow' && !ctx.config.security.shell.requireConfirmation) {
    return {
      behavior: 'allow',
      source: 'shell-safety',
      riskLevel: 'low',
      reasons: [text(language, '命令匹配只读白名单，可以直接执行。', 'Command matches the read-only whitelist.')],
      details: [`command: ${command}`, shell.matchedRule ? `matched rule: ${shell.matchedRule}` : 'matched rule: none'],
      matchedRule: shell.matchedRule,
      shellLevel: shell.level,
    };
  }

  const dangerous = shell.level === 'dangerous';
  return {
    behavior: 'ask',
    source: 'shell-safety',
    riskLevel: dangerous ? 'high' : 'medium',
    reasons: [
      dangerous
        ? text(language, '命令命中高危 Shell 规则，继续前需要明确确认。', 'Command matched dangerous shell rules and requires explicit confirmation.')
        : text(language, '命令不在可自动放行范围内，需要确认。', 'Command is not safe enough for automatic approval and needs confirmation.'),
      ...shell.reasons,
    ],
    details: [`command: ${command}`, shell.matchedRule ? `matched rule: ${shell.matchedRule}` : 'matched rule: none'],
    requiresSecondConfirmation: shell.requiresSecondConfirmation && ctx.config.security.highRisk.requireSecondConfirmation,
    matchedRule: shell.matchedRule,
    shellLevel: shell.level,
  };
}

function text(language: ToolExecutionContext['language'], zh: string, en: string): string {
  return language === 'en-US' ? en : zh;
}