/pnpm run build# Status Bar 设计（Claude Code 风格）

## 核心格式

用 `·` 分隔的状态行，实时刷新：

```
· Churning… (2m 35s · ↓ 5.5k tokens)
```

## 各状态显示

```
LLM 推理中：
  · Churning… (3s · ↓ 0 tokens)
  · Churning… (8s · ↓ 0 tokens)

文本生成中：
  · Churning… (5s · ↓ 2.1k · ↑ 320 tokens)
  · Churning… (12s · ↓ 2.1k · ↑ 1.5k tokens)

工具执行中：
  · Reading src/app.ts… (0.8s · ↓ 1.2k tokens)
  · Writing src/app.ts… (0.2s · ↓ 2.1k · ↑ 800 tokens)
  · Running npm install… (3.2s · ↓ 2.1k tokens)
  · Running git commit… (1.1s · ↓ 1.8k tokens)

Standard 模式步骤：
  · Step [1/7] Creating DataSource interface… (3s · ↓ 2.3k tokens)
  · Step [2/7] Implementing MySQL datasource… (8s · ↓ 4.1k tokens)

等待确认：
  · Waiting for confirmation…

完成（无费用配置）：
  · Done (12s · ↓ 5.5k · ↑ 1.2k tokens)

完成（有费用配置）：
  · Done (12s · ↓ 5.5k · ↑ 1.2k tokens · $0.03)

错误：
  · Error: read_file failed (2s · ↓ 2.1k tokens)
```

## 实现

```typescript
class StatusBar {
  private startTime: number = 0;
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private currentLabel: string = 'Churning';
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    this.startTime = Date.now();
    this.timer = setInterval(() => this.refresh(), 100);
    this.refresh();
  }

  updateTokens(input: number, output: number): void {
    this.inputTokens = input;
    this.outputTokens = output;
  }

  setLabel(label: string): void {
    this.currentLabel = label;
  }

  onToolStart(tool: string, args: any): void {
    const labels: Record<string, (a: any) => string> = {
      read_file: (a) => `Reading ${basename(a.path)}`,
      write_file: (a) => `Writing ${basename(a.path)}`,
      edit_file: (a) => `Editing ${basename(a.path)}`,
      execute_command: (a) => `Running ${a.command.split(' ')[0]}`,
      grep_search: () => 'Searching',
      git_commit: () => 'Committing',
    };
    this.setLabel((labels[tool] || (() => tool))(args));
  }

  onToolEnd(): void {
    this.setLabel('Churning');
  }

  private refresh(): void {
    const elapsed = this.formatElapsed(Date.now() - this.startTime);
    const tokens = this.formatTokens();
    const line = `· ${this.currentLabel}… (${elapsed} · ${tokens})`;
    process.stdout.write(`\r\x1b[K${line}`);
  }

  end(cost?: string): void {
    if (this.timer) clearInterval(this.timer);
    const elapsed = this.formatElapsed(Date.now() - this.startTime);
    const tokens = this.formatTokens();
    const costStr = cost ? ` · ${cost}` : '';
    console.log(`\r\x1b[K· Done (${elapsed} · ${tokens}${costStr})`);
  }

  private formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  private formatTokens(): string {
    const fmt = (n: number) => n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
    if (this.outputTokens === 0) return `↓ ${fmt(this.inputTokens)} tokens`;
    return `↓ ${fmt(this.inputTokens)} · ↑ ${fmt(this.outputTokens)} tokens`;
  }
}
```

## 与 Async Generator 集成

```typescript
for await (const event of economicLoop(task, ctx)) {
  switch (event.type) {
    case 'status':
      if (event.status === 'thinking') statusBar.start();
      break;
    case 'text_chunk':
      statusBar.updateTokens(event.tokens.input, event.tokens.output);
      renderer.write(event.text);
      break;
    case 'tool_start':
      statusBar.onToolStart(event.tool, event.args);
      break;
    case 'tool_end':
      statusBar.onToolEnd();
      break;
    case 'stats':
      const cost = calculateCost(event.stats, ctx.costConfig);
      statusBar.end(cost);
      break;
  }
}
```

## 费用显示规则

```
未配置价格：
  · Done (12s · ↓ 5.5k · ↑ 1.2k tokens)

配置了 Token 价格：
  · Done (12s · ↓ 5.5k · ↑ 1.2k tokens · $0.03)

配置了 Coding Plan（套餐内）：
  · Done (12s · ↓ 5.5k · ↑ 1.2k tokens · Plan: 12.3% used)

配置了 Coding Plan（超出）：
  · Done (12s · ↓ 5.5k · ↑ 1.2k tokens · $0.02 overage)
```
