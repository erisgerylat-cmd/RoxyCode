import type { MultiAgentConflict, MultiAgentRunResult, MultiAgentTaskResult } from './types.js';

export class ConflictMerger {
  constructor(private readonly language: 'zh-CN' | 'en-US') {}

  merge(result: Omit<MultiAgentRunResult, 'mergeReport'>): string {
    const isZh = this.language !== 'en-US';
    const lines: string[] = [];
    lines.push(isZh ? '# Ultimate 多 Agent 汇总' : '# Ultimate Multi-Agent Summary');
    lines.push('');
    lines.push(isZh
      ? `运行 ID：${result.runId}，计划来源：${result.plan.source}，任务数：${result.plan.tasks.length}。`
      : `Run ID: ${result.runId}. Plan source: ${result.plan.source}. Tasks: ${result.plan.tasks.length}.`);

    if (result.plan.notes?.length) {
      lines.push('');
      lines.push(isZh ? '## Coordinator 备注' : '## Coordinator Notes');
      for (const note of result.plan.notes) lines.push(`- ${note}`);
    }

    lines.push('');
    lines.push(isZh ? '## 子 Agent 结果' : '## Sub-Agent Results');
    for (const item of sortResults(result.results)) {
      lines.push(formatTaskResult(item, this.language));
    }

    if (result.conflicts.length > 0) {
      lines.push('');
      lines.push(isZh ? '## 冲突与串行化处理' : '## Conflicts And Serialization');
      for (const conflict of result.conflicts) lines.push(formatConflict(conflict, this.language));
    }

    lines.push('');
    lines.push(isZh ? '## 给主 Agent 的执行建议' : '## Execution Guidance For Main Agent');
    lines.push(isZh
      ? '以上子 Agent 结果只作为分析上下文。真实文件修改、命令执行和 Git 操作仍必须由主 Agent 通过 ToolRegistry -> PermissionGuard -> Executor -> AuditLog 统一执行。'
      : 'The sub-agent results are analysis context only. Real file writes, commands, and Git operations must still go through the main ToolRegistry -> PermissionGuard -> Executor -> AuditLog path.');

    return lines.join('\n');
  }
}

function sortResults(results: MultiAgentTaskResult[]): MultiAgentTaskResult[] {
  return [...results].sort((a, b) => a.taskId.localeCompare(b.taskId));
}

function formatTaskResult(result: MultiAgentTaskResult, language: 'zh-CN' | 'en-US'): string {
  const isZh = language !== 'en-US';
  const status = result.status === 'done'
    ? (isZh ? '完成' : 'done')
    : result.status === 'conflict'
      ? (isZh ? '冲突' : 'conflict')
      : (isZh ? '失败' : 'failed');
  const scopes = result.fileScopes.length ? result.fileScopes.join(', ') : '*';
  return [
    `### ${result.agentId} / ${result.title}`,
    isZh
      ? `- 状态：${status}；角色：${result.role}；文件范围：${scopes}；耗时：${result.duration}ms`
      : `- Status: ${status}; role: ${result.role}; file scopes: ${scopes}; duration: ${result.duration}ms`,
    result.error ? `- ${isZh ? '错误' : 'Error'}: ${result.error}` : '',
    '',
    result.text.trim(),
    '',
  ].filter(Boolean).join('\n');
}

function formatConflict(conflict: MultiAgentConflict, language: 'zh-CN' | 'en-US'): string {
  const isZh = language !== 'en-US';
  const holder = conflict.holder && 'agentId' in conflict.holder
    ? `${conflict.holder.agentId}${'taskId' in conflict.holder ? `/${conflict.holder.taskId}` : ''}`
    : (isZh ? '未知持有者' : 'unknown holder');
  return isZh
    ? `- ${conflict.message} 处理方式：${conflict.resolution}；持有者：${holder}`
    : `- ${conflict.message} Resolution: ${conflict.resolution}; holder: ${holder}`;
}
