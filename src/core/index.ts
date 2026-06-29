/**
 * core/ 共享内核 barrel export
 *
 * 其他模块导入 core 时统一使用此入口：
 *   import { ConfigManager, CharacterManager } from './core/index.js';
 *   import type { Message, LLMProvider } from './core/index.js';
 */

// ── 类型（从 types/ 统一导出） ──
export * from './types/index.js';

// ── 角色系统 ──
export { CharacterManager } from '../aesthetic/character/CharacterManager.js';
export type { Character, CharacterId, CharacterPort, CharacterSummary } from '../aesthetic/character/types.js';
export type { CharacterTheme, StatusTextMap, SplashConfig, EasterEggPool, ErrorMessages } from '../aesthetic/character/types.js';
export { ALL_CHARACTERS, CHARACTER_ORDER, getCharacter, getCharacterList } from '../aesthetic/character/characters/index.js';
export { roxy, rudeus, eris, sylphiette, nanahoshi } from '../aesthetic/character/characters/index.js';

// ── 配置管理 ──
export { ConfigManager } from './ConfigManager.js';

// ── 常量 ──
export {
  APP_NAME, APP_VERSION, APP_DESCRIPTION,
  DEFAULT_MAX_CONTEXT_TOKENS, DEFAULT_COMPRESS_THRESHOLD,
  MODES,
  CONFIG_DIR, CONFIG_FILE, SESSIONS_DIR, SKILLS_DIR, HOOKS_DIR,
} from './constants.js';
export type { Mode } from './constants.js';

// ── 端口接口 ──
export type { VectorStorePort, VectorEntry, VectorSearchResult } from './interfaces/vector-store.js';
export type { CompressorStrategy, CompressorLayer, CompressRequest, CompressResult } from './interfaces/compressor.js';
export type { ModeRouterPort, ModeRouteContext, ResolvedMode } from './interfaces/mode-router.js';
