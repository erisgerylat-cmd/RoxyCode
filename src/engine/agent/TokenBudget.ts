const COMPLETION_THRESHOLD = 0.9;
const DIMINISHING_THRESHOLD = 500;
const MAX_CONTINUATIONS = 3;

const SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/i;
const SHORTHAND_END_RE = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/i;
const VERBOSE_RE = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/i;
const VERBOSE_CN_RE = /(?:\u4f7f\u7528|\u6d88\u8017|\u82b1\u8d39)\s*(\d+(?:\.\d+)?)\s*(k|m|b|\u5343|\u4e07|\u767e\u4e07)\s*(?:token|tokens|\u4ee4\u724c)?/i;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  '\u5343': 1_000,
  '\u4e07': 10_000,
  '\u767e\u4e07': 1_000_000,
};

export interface BudgetTracker {
  continuationCount: number;
  lastDeltaTokens: number;
  lastGlobalTurnTokens: number;
  startedAt: number;
}

export interface ContinueDecision {
  action: 'continue';
  nudgeMessage: string;
  continuationCount: number;
  pct: number;
  turnTokens: number;
  budget: number;
}

export interface StopDecision {
  action: 'stop';
  completionEvent: {
    continuationCount: number;
    pct: number;
    turnTokens: number;
    budget: number;
    diminishingReturns: boolean;
    durationMs: number;
  } | null;
}

export type TokenBudgetDecision = ContinueDecision | StopDecision;

export function createBudgetTracker(): BudgetTracker {
  return {
    continuationCount: 0,
    lastDeltaTokens: 0,
    lastGlobalTurnTokens: 0,
    startedAt: Date.now(),
  };
}

export function parseTokenBudget(text: string): number | null {
  const startMatch = text.match(SHORTHAND_START_RE);
  if (startMatch) return parseBudgetMatch(startMatch[1], startMatch[2]);

  const endMatch = text.match(SHORTHAND_END_RE);
  if (endMatch) return parseBudgetMatch(endMatch[1], endMatch[2]);

  const verboseMatch = text.match(VERBOSE_RE);
  if (verboseMatch) return parseBudgetMatch(verboseMatch[1], verboseMatch[2]);

  const cnMatch = text.match(VERBOSE_CN_RE);
  if (cnMatch) return parseBudgetMatch(cnMatch[1], cnMatch[2]);

  return null;
}

export function stripTokenBudgetDirective(text: string): string {
  return text
    .replace(SHORTHAND_START_RE, '')
    .replace(SHORTHAND_END_RE, '')
    .replace(VERBOSE_RE, '')
    .replace(VERBOSE_CN_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .trim();
}

export function checkTokenBudget(
  tracker: BudgetTracker,
  budget: number | null,
  globalTurnTokens: number,
  language: 'zh-CN' | 'en-US' = 'zh-CN',
): TokenBudgetDecision {
  if (budget === null || budget <= 0 || globalTurnTokens <= 0) {
    return { action: 'stop', completionEvent: null };
  }

  const turnTokens = globalTurnTokens;
  const pct = Math.round((turnTokens / budget) * 100);
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens;
  const isDiminishing =
    tracker.continuationCount >= 2 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD;

  if (!isDiminishing && tracker.continuationCount < MAX_CONTINUATIONS && turnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount++;
    tracker.lastDeltaTokens = deltaSinceLastCheck;
    tracker.lastGlobalTurnTokens = globalTurnTokens;
    return {
      action: 'continue',
      nudgeMessage: getBudgetContinuationMessage(pct, turnTokens, budget, language),
      continuationCount: tracker.continuationCount,
      pct,
      turnTokens,
      budget,
    };
  }

  if (isDiminishing || tracker.continuationCount > 0) {
    return {
      action: 'stop',
      completionEvent: {
        continuationCount: tracker.continuationCount,
        pct,
        turnTokens,
        budget,
        diminishingReturns: isDiminishing,
        durationMs: Date.now() - tracker.startedAt,
      },
    };
  }

  return { action: 'stop', completionEvent: null };
}

function getBudgetContinuationMessage(pct: number, turnTokens: number, budget: number, language: 'zh-CN' | 'en-US'): string {
  const used = formatNumber(turnTokens);
  const target = formatNumber(budget);
  if (language === 'en-US') {
    return `Stopped at ${pct}% of token target (${used} / ${target}). Keep working on the original task. Do not summarize.`;
  }
  return `\u5f53\u524d\u53ea\u5b8c\u6210\u4e86 token \u76ee\u6807\u7684 ${pct}%\uff08${used} / ${target}\uff09\u3002\u8bf7\u7ee7\u7eed\u5b8c\u6210\u539f\u4efb\u52a1\uff0c\u4e0d\u8981\u603b\u7ed3\uff0c\u4e0d\u8981\u91cd\u590d\u5df2\u7ecf\u5b8c\u6210\u7684\u5185\u5bb9\u3002`;
}

function parseBudgetMatch(value: string | undefined, suffix: string | undefined): number | null {
  if (!value || !suffix) return null;
  const multiplier = MULTIPLIERS[suffix.toLowerCase()] ?? MULTIPLIERS[suffix];
  if (!multiplier) return null;
  return Math.round(parseFloat(value) * multiplier);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
