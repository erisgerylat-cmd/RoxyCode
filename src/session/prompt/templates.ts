/**
 * 提示词优化 — 元提示模板
 *
 * 用于指导 LLM 分析用户输入并生成优化建议的 system/user prompt 模板。
 */

// ═══════════════════════════════════════════════════════════════
// 分析阶段 — System Prompt
// ═══════════════════════════════════════════════════════════════

/** 分析阶段的 system prompt */
export const ANALYZE_SYSTEM_PROMPT = `你是一个专业的提示词工程师。你的任务是分析用户输入的请求，识别关键要素并给出优化建议。

请分析用户输入，输出以下 JSON 格式（严格遵循，不要输出其他内容）：

{
  "goal": "识别出的核心任务目标（一句话）",
  "constraints": ["约束条件1", "约束条件2"],
  "expectedFormat": "期望的输出格式描述",
  "contextHints": ["上下文线索1（如代码片段、文件路径等）"],
  "ambiguityScore": 0.0,
  "recommendedStrategy": "structured",
  "missingInfo": ["建议补充的维度1"]
}

字段说明：
- goal: 用户真正想达成的目标，去除模糊表达
- constraints: 识别到的约束（如"不要用X"、"必须包含Y"等）
- expectedFormat: 用户期望的输出格式（如代码、列表、表格等）
- contextHints: 输入中隐含的上下文信息
- ambiguityScore: 0~1，0=非常清晰，1=非常模糊
- recommendedStrategy: 从 "structured"|"fewshot"|"cot"|"rolebased" 中选择最合适的
- missingInfo: 用户未提及但可能有帮助的维度

策略选择指南：
- structured: 通用任务，需要明确角色/任务/约束/格式
- fewshot: 格式化、转换、翻译类任务
- cot: 推理、分析、调试、数学类任务
- rolebased: 创意写作、对话、角色扮演类任务`;

// ═══════════════════════════════════════════════════════════════
// 分析阶段 — User Prompt 模板
// ═══════════════════════════════════════════════════════════════

/** 构建分析请求的 user prompt */
export function buildAnalyzePrompt(userInput: string): string {
  return `请分析以下用户输入：\n\n---\n${userInput}\n---\n\n请输出 JSON 分析结果。`;
}

// ═══════════════════════════════════════════════════════════════
// 重写阶段 — System Prompt
// ═══════════════════════════════════════════════════════════════

/** 重写阶段的 system prompt */
export const REWRITE_SYSTEM_PROMPT = `你是一个专业的提示词工程师。你的任务是根据分析结果，将用户的原始请求优化为更清晰、更结构化的提示词。

优化原则：
1. 保持原始意图不变，只改善表达方式
2. 补充缺失的上下文和约束
3. 明确期望的输出格式
4. 使用清晰的分段结构
5. 不要过度优化——如果原始请求已经足够清晰，只做最小改动

直接输出优化后的提示词，不要加任何解释或前言。`;

/** 构建重写请求的 user prompt */
export function buildRewritePrompt(
  userInput: string,
  analysisJson: string,
  strategyName: string,
): string {
  return `原始请求：\n---\n${userInput}\n---\n\n分析结果：\n${analysisJson}\n\n推荐策略：${strategyName}\n\n请输出优化后的提示词。`;
}
