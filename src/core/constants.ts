/**
 * 全局常量
 *
 * 集中定义项目级常量，避免魔法数字和硬编码字符串。
 */

// ═══════════════════════════════════════════════════════════════
// 应用信息
// ═══════════════════════════════════════════════════════════════

/** 应用名称 */
export const APP_NAME = 'RoxyCode';

/** 应用版本（从 package.json 读取） */
export const APP_VERSION = '0.1.0';

/** 应用描述 */
export const APP_DESCRIPTION = '洛琪希的魔法编程助手';

// ═══════════════════════════════════════════════════════════════
// Token 与上下文
// ═══════════════════════════════════════════════════════════════

/** 默认最大上下文 token 数（各 Provider 可覆盖） */
export const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;

/** 默认压缩阈值（80%） */
export const DEFAULT_COMPRESS_THRESHOLD = 0.8;

// ═══════════════════════════════════════════════════════════════
// 推理模式
// ═══════════════════════════════════════════════════════════════

/** 推理模式列表 */
export const MODES = ['lite', 'economic', 'standard', 'ultimate', 'plan'] as const;

/** 推理模式类型 */
export type Mode = typeof MODES[number];

// ═══════════════════════════════════════════════════════════════
// 配置路径
// ═══════════════════════════════════════════════════════════════

/** 全局配置目录名 */
export const CONFIG_DIR = '.roxycode';

/** 配置文件名 */
export const CONFIG_FILE = 'config.json';

/** 会话存储目录 */
export const SESSIONS_DIR = 'sessions';

/** Skill 目录 */
export const SKILLS_DIR = 'skills';

/** Hooks 目录 */
export const HOOKS_DIR = 'hooks';
