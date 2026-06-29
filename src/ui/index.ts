/**
 * ui/ 界面层 barrel export
 */

// 渲染器
export { StatusBar } from './renderers/StatusBar.js';
export { ThemeRenderer } from './renderers/ThemeRenderer.js';
export { MagicProgressBar } from './renderers/MagicProgressBar.js';
export { EventRenderer } from './renderers/EventRenderer.js';
export { InteractionRenderer } from './renderers/InteractionRenderer.js';
export { renderMarkdown } from './renderers/MarkdownRenderer.js';
export { renderQuestion } from './renderers/QuestionRenderer.js';

// 启动画面
export { showSplash, renderSplash } from './splash/SplashRenderer.js';

// 命令系统

// 彩蛋
export { EasterEggEngine } from './easter-eggs/EasterEggEngine.js';
export { DemonEyeMode } from './easter-eggs/DemonEyeMode.js';
export { TelepathyMode } from './easter-eggs/TelepathyMode.js';

// REPL
export { REPL } from './repl/REPL.js';

// 国际化
export { t, normalizeLanguage, languageLabel } from '../i18n/index.js';
export type { Language } from '../i18n/index.js';
