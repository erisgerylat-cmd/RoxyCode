import chalk from 'chalk';

export interface PlanCommandOptions {
  language: 'zh-CN' | 'en-US';
  runPlanPrompt?: (prompt: string) => Promise<void>;
  approvePlan?: () => Promise<void>;
  rejectPlan?: (reason?: string) => Promise<void>;
  editPlan?: (text: string) => Promise<void>;
  showPlan?: () => Promise<void>;
}

export async function handlePlanCommand(args: string[], options: PlanCommandOptions): Promise<void> {
  const action = args[0]?.toLowerCase();
  const zh = options.language === 'zh-CN';

  if (!action) {
    printPlanUsage(zh);
    return;
  }

  if (action === 'approve') {
    if (!options.approvePlan) return printUnavailable(zh);
    await options.approvePlan();
    return;
  }

  if (action === 'reject') {
    if (!options.rejectPlan) return printUnavailable(zh);
    await options.rejectPlan(args.slice(1).join(' ').trim() || undefined);
    return;
  }

  if (action === 'edit') {
    if (!options.editPlan) return printUnavailable(zh);
    const text = args.slice(1).join(' ').trim();
    if (!text) {
      console.log(chalk.yellow(zh ? '  \u7528\u6cd5: /plan edit <\u65b0\u8ba1\u5212\u6587\u672c>' : '  Usage: /plan edit <new plan text>'));
      return;
    }
    await options.editPlan(text);
    return;
  }

  if (action === 'status' || action === 'show' || action === 'current') {
    if (!options.showPlan) return printUnavailable(zh);
    await options.showPlan();
    return;
  }

  if (!options.runPlanPrompt) return printUnavailable(zh);
  await options.runPlanPrompt(args.join(' ').trim());
}

export function printPlanUsage(zh: boolean): void {
  console.log('');
  console.log(chalk.bold(zh ? '  /plan \u8ba1\u5212\u6a21\u5f0f' : '  /plan Plan Mode'));
  console.log(chalk.dim(zh
    ? '  \u5bf9\u7167 Claude Code: \u5148\u8fdb\u5165\u53ea\u8bfb\u89c4\u5212\uff0c\u518d\u901a\u8fc7\u6279\u51c6\u8fb9\u754c\u6267\u884c\u5199\u5165\u64cd\u4f5c\u3002'
    : '  Claude Code reference: read-only planning first, explicit approval before writes.'));
  console.log(`  ${zh ? '\u751f\u6210\u8ba1\u5212' : 'Create plan'}: /plan <task>`);
  console.log(`  ${zh ? '\u67e5\u770b\u5f53\u524d\u8ba1\u5212' : 'Show current plan'}: /plan status`);
  console.log(`  ${zh ? '\u6279\u51c6\u6267\u884c' : 'Approve execution'}: /plan approve`);
  console.log(`  ${zh ? '\u62d2\u7edd\u8ba1\u5212' : 'Reject plan'}: /plan reject [reason]`);
  console.log(`  ${zh ? '\u7f16\u8f91\u8ba1\u5212' : 'Edit plan'}: /plan edit <new plan text>`);
  console.log('');
}

function printUnavailable(zh: boolean): void {
  console.log(chalk.red(zh ? '  \u5f53\u524d\u8fd0\u884c\u73af\u5883\u4e0d\u652f\u6301 /plan \u72b6\u6001\u64cd\u4f5c\u3002' : '  /plan state actions are not available in this runtime.'));
}
