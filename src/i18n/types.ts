/**
 * 国际化类型定义
 */

export interface I18n {
  /**
   * 翻译键
   */
  t(key: string, params?: Record<string, any>): string;

  /**
   * 当前语言
   */
  language: 'zh-CN' | 'en-US';
}
