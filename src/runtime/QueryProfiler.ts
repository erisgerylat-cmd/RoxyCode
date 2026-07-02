export type QueryProfileCheckpointName =
  | 'query_user_input_received'
  | 'query_context_loading_start'
  | 'query_context_loading_end'
  | 'query_hook_start'
  | 'query_hook_end'
  | 'query_setup_start'
  | 'query_setup_end'
  | 'query_model_request_start'
  | 'query_first_chunk_received'
  | 'query_model_request_end'
  | 'query_context_compaction_start'
  | 'query_context_compaction_end'
  | 'query_tool_execution_start'
  | 'query_tool_execution_end'
  | 'query_end'
  | 'query_error';

export interface QueryProfileCheckpoint {
  name: QueryProfileCheckpointName;
  at: number;
  elapsedMs: number;
  deltaMs: number;
  detail?: string;
  memory?: {
    rssMb: number;
    heapUsedMb: number;
  };
}

export interface QueryProfilePhase {
  name: string;
  durationMs: number;
  start: QueryProfileCheckpointName;
  end: QueryProfileCheckpointName;
}

export interface QueryProfileSummary {
  id: string;
  mode: string;
  startedAt: number;
  finishedAt?: number;
  totalMs: number;
  firstTokenMs?: number;
  preFirstTokenMs?: number;
  modelRequestCount: number;
  toolExecutionCount: number;
  contextCompactionCount: number;
  slowestPhase?: QueryProfilePhase;
  checkpoints: QueryProfileCheckpoint[];
  phases: QueryProfilePhase[];
}

const PHASES: Array<{ name: string; start: QueryProfileCheckpointName; end: QueryProfileCheckpointName }> = [
  { name: 'Context loading', start: 'query_context_loading_start', end: 'query_context_loading_end' },
  { name: 'Hooks', start: 'query_hook_start', end: 'query_hook_end' },
  { name: 'Setup', start: 'query_setup_start', end: 'query_setup_end' },
  { name: 'Model request', start: 'query_model_request_start', end: 'query_model_request_end' },
  { name: 'First token latency', start: 'query_model_request_start', end: 'query_first_chunk_received' },
  { name: 'Context compaction', start: 'query_context_compaction_start', end: 'query_context_compaction_end' },
  { name: 'Tool execution', start: 'query_tool_execution_start', end: 'query_tool_execution_end' },
];

let profileCounter = 0;

export class QueryProfiler {
  private readonly id: string;
  private readonly startedAt = Date.now();
  private checkpoints: QueryProfileCheckpoint[] = [];
  private finishedAt?: number;

  constructor(private readonly mode: string) {
    profileCounter += 1;
    this.id = `query-${profileCounter}`;
    this.mark('query_user_input_received');
  }

  mark(name: QueryProfileCheckpointName, detail?: string): void {
    const now = Date.now();
    const previous = this.checkpoints.at(-1);
    const elapsedMs = now - this.startedAt;
    const deltaMs = previous ? now - previous.at : 0;
    this.checkpoints.push({
      name,
      at: now,
      elapsedMs,
      deltaMs,
      detail,
      memory: memorySnapshot(),
    });
    if (name === 'query_end' || name === 'query_error') this.finishedAt = now;
  }

  snapshot(): QueryProfileSummary {
    const finishedAt = this.finishedAt ?? this.checkpoints.at(-1)?.at ?? Date.now();
    const phases = this.computePhases();
    const firstToken = this.find('query_first_chunk_received');
    const modelStart = this.find('query_model_request_start');
    const slowestPhase = phases.length
      ? phases.reduce((slowest, phase) => phase.durationMs > slowest.durationMs ? phase : slowest, phases[0])
      : undefined;

    return {
      id: this.id,
      mode: this.mode,
      startedAt: this.startedAt,
      finishedAt,
      totalMs: finishedAt - this.startedAt,
      firstTokenMs: firstToken?.elapsedMs,
      preFirstTokenMs: firstToken && modelStart ? modelStart.elapsedMs : undefined,
      modelRequestCount: this.count('query_model_request_start'),
      toolExecutionCount: this.count('query_tool_execution_start'),
      contextCompactionCount: this.count('query_context_compaction_start'),
      slowestPhase,
      checkpoints: this.checkpoints.map(checkpoint => ({ ...checkpoint, memory: checkpoint.memory ? { ...checkpoint.memory } : undefined })),
      phases,
    };
  }

  private computePhases(): QueryProfilePhase[] {
    const phases: QueryProfilePhase[] = [];
    for (const phase of PHASES) {
      const starts = this.checkpoints.filter(checkpoint => checkpoint.name === phase.start);
      const ends = this.checkpoints.filter(checkpoint => checkpoint.name === phase.end);
      const count = Math.min(starts.length, ends.length);
      for (let i = 0; i < count; i++) {
        const start = starts[i];
        const end = ends[i];
        if (!start || !end || end.at < start.at) continue;
        phases.push({ name: phase.name, start: phase.start, end: phase.end, durationMs: end.at - start.at });
      }
    }
    return phases.sort((a, b) => b.durationMs - a.durationMs);
  }

  private find(name: QueryProfileCheckpointName): QueryProfileCheckpoint | undefined {
    return this.checkpoints.find(checkpoint => checkpoint.name === name);
  }

  private count(name: QueryProfileCheckpointName): number {
    return this.checkpoints.filter(checkpoint => checkpoint.name === name).length;
  }
}

export function formatQueryProfile(summary: QueryProfileSummary, language: 'zh-CN' | 'en-US'): string[] {
  const isZh = language === 'zh-CN';
  const lines: string[] = [];
  lines.push(isZh ? 'Query Pipeline 性能剖析' : 'Query pipeline profile');
  lines.push(`${isZh ? '模式' : 'Mode'}: ${summary.mode} / total=${summary.totalMs}ms${summary.firstTokenMs !== undefined ? ` / TTFT=${summary.firstTokenMs}ms` : ''}`);
  if (summary.firstTokenMs !== undefined && summary.preFirstTokenMs !== undefined) {
    const waitMs = Math.max(0, summary.firstTokenMs - summary.preFirstTokenMs);
    lines.push(`${isZh ? '首 token 拆解' : 'First token split'}: ${isZh ? '请求前开销' : 'pre-request'}=${summary.preFirstTokenMs}ms / ${isZh ? '模型或网络等待' : 'model/network wait'}=${waitMs}ms`);
  }
  lines.push(`${isZh ? '模型请求' : 'Model requests'}: ${summary.modelRequestCount} / ${isZh ? '工具执行' : 'tool executions'}: ${summary.toolExecutionCount} / ${isZh ? '上下文压缩检查' : 'compaction checks'}: ${summary.contextCompactionCount}`);
  if (summary.slowestPhase) {
    lines.push(`${isZh ? '最慢阶段' : 'Slowest phase'}: ${phaseLabel(summary.slowestPhase.name, language)} ${summary.slowestPhase.durationMs}ms`);
  }
  if (summary.phases.length > 0) {
    lines.push(isZh ? '阶段耗时:' : 'Phase breakdown:');
    for (const phase of summary.phases.slice(0, 8)) {
      lines.push(`  - ${phaseLabel(phase.name, language)}: ${phase.durationMs}ms`);
    }
  }
  lines.push(isZh ? '检查点:' : 'Checkpoints:');
  for (const checkpoint of summary.checkpoints.slice(-12)) {
    const detail = checkpoint.detail ? ` - ${checkpoint.detail}` : '';
    lines.push(`  +${checkpoint.elapsedMs}ms (${checkpoint.deltaMs}ms) ${checkpointLabel(checkpoint.name, language)}${detail}`);
  }
  return lines;
}

function phaseLabel(name: string, language: 'zh-CN' | 'en-US'): string {
  if (language === 'en-US') return name;
  return {
    'Context loading': '\u4e0a\u4e0b\u6587\u52a0\u8f7d',
    Hooks: 'Hooks',
    Setup: '\u8bf7\u6c42\u51c6\u5907',
    'Model request': '\u6a21\u578b\u8bf7\u6c42',
    'First token latency': '\u9996 token \u5ef6\u8fdf',
    'Context compaction': '\u4e0a\u4e0b\u6587\u538b\u7f29',
    'Tool execution': '\u5de5\u5177\u6267\u884c',
  }[name] ?? name;
}

function checkpointLabel(name: QueryProfileCheckpointName, language: 'zh-CN' | 'en-US'): string {
  if (language === 'en-US') return name;
  return {
    query_user_input_received: '\u6536\u5230\u7528\u6237\u8f93\u5165',
    query_context_loading_start: '\u5f00\u59cb\u52a0\u8f7d\u4e0a\u4e0b\u6587',
    query_context_loading_end: '\u4e0a\u4e0b\u6587\u52a0\u8f7d\u5b8c\u6210',
    query_hook_start: 'Hook \u5f00\u59cb',
    query_hook_end: 'Hook \u5b8c\u6210',
    query_setup_start: '\u8bf7\u6c42\u51c6\u5907\u5f00\u59cb',
    query_setup_end: '\u8bf7\u6c42\u51c6\u5907\u5b8c\u6210',
    query_model_request_start: '\u6a21\u578b\u8bf7\u6c42\u5f00\u59cb',
    query_first_chunk_received: '\u6536\u5230\u9996\u4e2a\u6a21\u578b\u7247\u6bb5',
    query_model_request_end: '\u6a21\u578b\u8bf7\u6c42\u5b8c\u6210',
    query_context_compaction_start: '\u4e0a\u4e0b\u6587\u538b\u7f29\u5f00\u59cb',
    query_context_compaction_end: '\u4e0a\u4e0b\u6587\u538b\u7f29\u5b8c\u6210',
    query_tool_execution_start: '\u5de5\u5177\u6267\u884c\u5f00\u59cb',
    query_tool_execution_end: '\u5de5\u5177\u6267\u884c\u5b8c\u6210',
    query_end: 'Query \u7ed3\u675f',
    query_error: 'Query \u5931\u8d25',
  }[name];
}

function memorySnapshot(): QueryProfileCheckpoint['memory'] {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round(usage.rss / 1024 / 1024),
    heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
  };
}
