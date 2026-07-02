import type {
  PermissionClassification,
  Tool,
  ToolExecutionContext,
  ToolPermissionDecision,
  ToolPermissionPrompt,
  ToolRiskLevel,
} from '../types.js';
import { buildDangerPrompt } from '../security/DangerExplainer.js';
import { PermissionClassifier } from './PermissionClassifier.js';
import {
  createDenialTrackingState,
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
  type DenialTrackingState,
} from './DenialTracking.js';

export class PermissionGuard {
  private readonly classifier = new PermissionClassifier();
  private readonly denialBySession = new Map<string, DenialTrackingState>();

  async check(tool: Tool, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolPermissionDecision> {
    const classification = this.classifier.classify(tool, args, ctx);

    if (classification.behavior === 'allow') {
      return this.finish(ctx, {
        behavior: 'allow',
        reason: firstReason(classification, text(ctx, '分类器判定为可安全执行。', 'Classifier allowed this tool call.')),
        decisionReason: {
          type: 'classifier',
          classifier: classification.source,
          reason: firstReason(classification, 'allowed'),
        },
        updatedInput: args,
        classifier: classification,
      });
    }

    const prompt = buildPromptFromClassification(tool, args, ctx, classification);

    if (classification.behavior === 'deny' && classification.hardDeny) {
      return this.finish(ctx, {
        behavior: 'deny',
        reason: firstReason(classification, text(ctx, '权限分类器拒绝了该操作。', 'Permission classifier denied this operation.')),
        prompt,
        decisionReason: {
          type: 'classifier',
          classifier: classification.source,
          reason: firstReason(classification, 'denied'),
        },
        classifier: withDenialState(classification, this.getState(ctx)),
      });
    }

    const state = this.getState(ctx);
    const askBecauseRepeatedDenials = classification.behavior === 'deny' && shouldFallbackToPrompting(state);
    if (classification.behavior === 'deny' && !askBecauseRepeatedDenials) {
      return this.finish(ctx, {
        behavior: 'deny',
        reason: firstReason(classification, text(ctx, '权限分类器拒绝了该操作。', 'Permission classifier denied this operation.')),
        prompt,
        decisionReason: {
          type: 'classifier',
          classifier: classification.source,
          reason: firstReason(classification, 'denied'),
        },
        classifier: withDenialState(classification, state),
      });
    }

    const accepted = await ctx.confirm?.(prompt);
    if (!accepted) {
      return this.finish(ctx, {
        behavior: 'deny',
        reason: text(ctx, '用户拒绝了本次工具调用。', 'User denied this tool call.'),
        prompt,
        decisionReason: { type: 'user', choice: 'deny', reason: 'permission_prompt' },
        classifier: withDenialState(classification, state),
      });
    }

    if (prompt.requiresSecondConfirmation) {
      const secondAccepted = await ctx.confirmSecond?.(prompt);
      if (!secondAccepted) {
        return this.finish(ctx, {
          behavior: 'deny',
          reason: text(ctx, '用户拒绝了高风险二次确认。', 'User denied the second high-risk confirmation.'),
          prompt,
          decisionReason: { type: 'user', choice: 'deny', reason: 'second_confirmation' },
          classifier: withDenialState(classification, state),
        });
      }
    }

    return this.finish(ctx, {
      behavior: 'allow',
      reason: text(ctx, '用户批准了本次工具调用。', 'User approved this tool call.'),
      prompt,
      decisionReason: { type: 'user', choice: 'allow', reason: 'permission_prompt' },
      updatedInput: args,
      classifier: classification,
    });
  }

  private finish(ctx: ToolExecutionContext, decision: ToolPermissionDecision): ToolPermissionDecision {
    const key = trackingKey(ctx);
    const current = this.getState(ctx);
    const next = decision.behavior === 'deny' ? recordDenial(current) : recordSuccess(current);
    this.denialBySession.set(key, next);
    if (decision.classifier) {
      decision.classifier = withDenialState(decision.classifier, next);
    }
    return decision;
  }

  private getState(ctx: ToolExecutionContext): DenialTrackingState {
    const key = trackingKey(ctx);
    const existing = this.denialBySession.get(key);
    if (existing) return existing;
    const created = createDenialTrackingState();
    this.denialBySession.set(key, created);
    return created;
  }
}

function buildPromptFromClassification(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  classification: PermissionClassification,
): ToolPermissionPrompt {
  const base = tool.getPermissionPrompt?.(args, ctx);
  const title = titleFor(classification, ctx);
  const action = actionFor(tool, classification, ctx);
  const details = [...classification.details];
  if (base?.details?.length) details.push(...base.details);

  const prompt = buildDangerPrompt({
    title,
    action,
    reasons: classification.reasons,
    details: unique(details),
    riskLevel: maxRisk(classification.riskLevel, base?.riskLevel),
    secondConfirmation: classification.requiresSecondConfirmation === true,
  }, ctx);

  if (base && !classification.requiresSecondConfirmation) {
    return {
      ...prompt,
      title: base.title || prompt.title,
      riskLevel: maxRisk(prompt.riskLevel, base.riskLevel),
    };
  }
  return prompt;
}

function titleFor(classification: PermissionClassification, ctx: ToolExecutionContext): string {
  const isZh = ctx.language !== 'en-US';
  switch (classification.source) {
    case 'disabled-tool':
      return isZh ? '工具已禁用' : 'Tool Disabled';
    case 'permission-mode':
      return isZh ? '权限模式限制' : 'Permission Mode Limit';
    case 'path-boundary':
      return isZh ? '路径越界拦截' : 'Path Boundary Block';
    case 'sensitive-path':
      return isZh ? '敏感路径确认' : 'Sensitive Path Confirmation';
    case 'shell-safety':
      return isZh ? 'Shell 命令确认' : 'Shell Command Confirmation';
    case 'tool-risk':
      return isZh ? '工具权限确认' : 'Tool Permission Confirmation';
    default:
      return isZh ? '权限确认' : 'Permission Confirmation';
  }
}

function actionFor(tool: Tool, classification: PermissionClassification, ctx: ToolExecutionContext): string {
  const isZh = ctx.language !== 'en-US';
  const toolName = tool.definition.name;
  switch (classification.source) {
    case 'path-boundary':
      return isZh
        ? `工具 ${toolName} 试图访问当前项目之外的路径。RoxyCode 默认只保护当前工作区，避免误改用户其它文件。`
        : `Tool ${toolName} would access a path outside the current project. RoxyCode protects the current workspace by default.`;
    case 'sensitive-path':
      return isZh
        ? `工具 ${toolName} 将触碰配置、权限或版本控制相关路径。`
        : `Tool ${toolName} touches configuration, permission, or version-control paths.`;
    case 'shell-safety':
      return isZh
        ? `工具 ${toolName} 将执行本地 Shell 命令，可能修改文件、依赖或系统状态。`
        : `Tool ${toolName} will run a local shell command that may change files, dependencies, or system state.`;
    case 'permission-mode':
      return isZh
        ? `当前权限模式不允许工具 ${toolName} 直接执行。`
        : `The current permission mode does not allow tool ${toolName} to run directly.`;
    case 'disabled-tool':
      return isZh
        ? `工具 ${toolName} 已被配置禁用。`
        : `Tool ${toolName} is disabled by configuration.`;
    default:
      return isZh
        ? `工具 ${toolName} 需要你确认后再执行。`
        : `Tool ${toolName} needs your confirmation before execution.`;
  }
}

function firstReason(classification: PermissionClassification, fallback: string): string {
  return classification.reasons[0] ?? fallback;
}

function maxRisk(a: ToolRiskLevel, b?: ToolRiskLevel): ToolRiskLevel {
  if (a === 'high' || b === 'high') return 'high';
  if (a === 'medium' || b === 'medium') return 'medium';
  return 'low';
}

function withDenialState(classification: PermissionClassification, state: DenialTrackingState): PermissionClassification {
  return {
    ...classification,
    details: unique([
      ...classification.details,
      `permission_denials_consecutive: ${state.consecutiveDenials}`,
      `permission_denials_total: ${state.totalDenials}`,
    ]),
  };
}

function trackingKey(ctx: ToolExecutionContext): string {
  return ctx.sessionId || ctx.cwd;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function text(ctx: ToolExecutionContext, zh: string, en: string): string {
  return ctx.language === 'en-US' ? en : zh;
}