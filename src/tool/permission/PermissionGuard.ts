import type { Tool, ToolExecutionContext, ToolPermissionDecision, ToolPermissionPrompt, ToolRiskLevel } from '../types.js';
import { buildDangerPrompt } from '../security/DangerExplainer.js';
import { checkProjectBoundary, inspectDangerousPaths } from '../security/SecurityPolicy.js';
import { classifyShellCommand } from '../security/ShellSafety.js';

export class PermissionGuard {
  async check(tool: Tool, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolPermissionDecision> {
    if (ctx.config.tools.disabled.includes(tool.definition.name)) {
      return { behavior: 'deny', reason: `Tool disabled: ${tool.definition.name}` };
    }

    if (ctx.permissionMode === 'read-only' && !tool.isReadOnly) {
      return { behavior: 'deny', reason: 'Read-only permission mode blocks write or command tools.' };
    }

    const affectedPaths = tool.getAffectedPaths?.(args, ctx) ?? [];
    const pathDecision = await this.checkPaths(tool, affectedPaths, ctx);
    if (pathDecision.behavior !== 'allow') return pathDecision;

    if (tool.definition.name === 'execute_command') {
      const command = typeof args.command === 'string' ? args.command : '';
      const shellDecision = await this.checkShell(command, ctx);
      if (shellDecision.behavior !== 'allow') return shellDecision;
    }

    const prompt = tool.getPermissionPrompt?.(args, ctx) ?? defaultPrompt(tool.definition.name, tool.riskLevel, ctx);
    const requiresAsk = ctx.permissionMode !== 'auto-approve' && (!tool.isReadOnly || tool.riskLevel !== 'low');
    if (!requiresAsk) return { behavior: 'allow', reason: 'Read-only low-risk tool allowed.' };

    const accepted = await ctx.confirm?.(prompt);
    if (!accepted) return { behavior: 'deny', reason: 'User denied permission.', prompt };

    const requiresSecond = prompt.requiresSecondConfirmation === true
      || (tool.riskLevel === 'high' && ctx.config.security.highRisk.requireSecondConfirmation);
    if (requiresSecond) {
      const secondPrompt = { ...prompt, requiresSecondConfirmation: true };
      const secondAccepted = await ctx.confirmSecond?.(secondPrompt);
      if (!secondAccepted) return { behavior: 'deny', reason: 'User denied second confirmation.', prompt: secondPrompt };
    }

    return { behavior: 'allow', reason: 'User approved permission.', prompt };
  }

  private async checkPaths(tool: Tool, paths: string[], ctx: ToolExecutionContext): Promise<ToolPermissionDecision> {
    if (paths.length === 0) return { behavior: 'allow', reason: 'No affected paths.' };

    if (ctx.config.security.fileAccess.mode === 'project-only') {
      for (const path of paths) {
        const boundary = checkProjectBoundary(ctx.cwd, path);
        if (!boundary.allowed) {
          const prompt = buildDangerPrompt({
            title: ctx.language === 'en-US' ? 'Path outside project' : '路径超出当前项目',
            action: ctx.language === 'en-US' ? 'This tool would access a path outside the current project.' : '该工具将访问当前项目之外的路径。',
            reasons: [boundary.reason ?? 'Path boundary check failed.'],
            details: [`tool: ${tool.definition.name}`, `path: ${boundary.resolvedPath}`],
            riskLevel: 'high',
            secondConfirmation: true,
          }, ctx);
          return { behavior: 'deny', reason: boundary.reason ?? 'Path outside project.', prompt };
        }
      }
    }

    const dangerous = inspectDangerousPaths(ctx.cwd, paths);
    if (!dangerous.dangerous) return { behavior: 'allow', reason: 'Affected paths allowed.' };

    const riskLevel: ToolRiskLevel = tool.isReadOnly ? 'medium' : 'high';
    const prompt = buildDangerPrompt({
      title: ctx.language === 'en-US' ? 'Sensitive path confirmation' : '敏感路径确认',
      action: ctx.language === 'en-US' ? 'This operation touches sensitive project paths.' : '该操作会触及敏感项目路径。',
      reasons: dangerous.reasons,
      details: [`tool: ${tool.definition.name}`, ...dangerous.paths.map(path => `path: ${path}`)],
      riskLevel,
      secondConfirmation: riskLevel === 'high' && ctx.config.security.highRisk.requireSecondConfirmation,
    }, ctx);

    if (ctx.permissionMode === 'auto-approve' || (tool.isReadOnly && ctx.permissionMode !== 'strict')) {
      return { behavior: 'allow', reason: 'Sensitive read allowed by current permission mode.', prompt };
    }

    const accepted = await ctx.confirm?.(prompt);
    if (!accepted) return { behavior: 'deny', reason: 'User denied sensitive path access.', prompt };
    if (prompt.requiresSecondConfirmation) {
      const secondAccepted = await ctx.confirmSecond?.(prompt);
      if (!secondAccepted) return { behavior: 'deny', reason: 'User denied second confirmation for sensitive path.', prompt };
    }
    return { behavior: 'allow', reason: 'User approved sensitive path access.', prompt };
  }

  private async checkShell(command: string, ctx: ToolExecutionContext): Promise<ToolPermissionDecision> {
    if (!command.trim()) return { behavior: 'deny', reason: 'Empty shell command.' };
    const shell = classifyShellCommand(command, ctx.config.security.shell.whitelist);
    if (ctx.config.security.shell.mode === 'unrestricted' && shell.level !== 'dangerous') {
      return { behavior: 'allow', reason: 'Shell unrestricted mode allows command.' };
    }
    if (shell.level === 'allow' && !ctx.config.security.shell.requireConfirmation) {
      return { behavior: 'allow', reason: `Shell command allowed by whitelist: ${shell.matchedRule ?? command}` };
    }

    const prompt = buildDangerPrompt({
      title: ctx.language === 'en-US' ? 'Confirm shell command' : '确认执行 Shell 命令',
      action: ctx.language === 'en-US' ? 'Shell commands can modify files or system state.' : 'Shell 命令可能修改文件或系统状态。',
      reasons: shell.reasons,
      details: [`command: ${command}`, shell.matchedRule ? `matched rule: ${shell.matchedRule}` : 'matched rule: none'],
      riskLevel: shell.level === 'dangerous' ? 'high' : 'medium',
      secondConfirmation: shell.requiresSecondConfirmation && ctx.config.security.highRisk.requireSecondConfirmation,
    }, ctx);

    if (ctx.permissionMode === 'auto-approve' && shell.level !== 'dangerous') {
      return { behavior: 'allow', reason: 'Auto-approve mode allows non-dangerous shell command.', prompt };
    }

    const accepted = await ctx.confirm?.(prompt);
    if (!accepted) return { behavior: 'deny', reason: 'User denied shell command.', prompt };
    if (prompt.requiresSecondConfirmation) {
      const secondAccepted = await ctx.confirmSecond?.(prompt);
      if (!secondAccepted) return { behavior: 'deny', reason: 'User denied second confirmation for shell command.', prompt };
    }
    return { behavior: 'allow', reason: 'User approved shell command.', prompt };
  }
}

function defaultPrompt(toolName: string, riskLevel: ToolRiskLevel, ctx: ToolExecutionContext): ToolPermissionPrompt {
  return {
    title: ctx.language === 'en-US' ? 'Confirm tool execution' : '确认执行工具',
    message: ctx.language === 'en-US' ? `Run tool ${toolName}?` : `是否执行工具 ${toolName}？`,
    details: [`tool: ${toolName}`],
    riskLevel,
  };
}
