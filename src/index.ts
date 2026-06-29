#!/usr/bin/env node

/**
 * RoxyCode CLI composition root.
 * Wires core, engine, session, and UI modules.
 */

import { CharacterManager } from './aesthetic/character/CharacterManager.js';
import { ConfigManager } from './core/ConfigManager.js';
import { APP_VERSION } from './core/constants.js';
import { LLMFactory } from './engine/llm/LLMFactory.js';
import { normalizeLanguage } from './i18n/index.js';
import { ContextManager } from './session/context/ContextManager.js';
import { SummaryStrategy } from './session/context/strategies/SummaryStrategy.js';
import { TruncationStrategy } from './session/context/strategies/TruncationStrategy.js';
import { REPL } from './ui/repl/REPL.js';
import { showSplash } from './ui/splash/SplashRenderer.js';

async function main() {
  const configManager = new ConfigManager();
  await configManager.load();
  const language = normalizeLanguage(configManager.get('ui.language'));

  const characterManager = new CharacterManager(configManager);
  await characterManager.loadCustomCharacters();
  const character = characterManager.getCurrentCharacter();

  const llmProvider = LLMFactory.create(configManager);

  const contextManager = new ContextManager({ configManager, llmProvider });
  contextManager.registerStrategy(new SummaryStrategy({ llmProvider, language }));
  contextManager.registerStrategy(new TruncationStrategy());

  const showQuote = (configManager.get('character.showStartupQuote') as boolean | undefined) ?? true;
  let startupQuote: string | undefined;
  if (showQuote) {
    const quote = characterManager.getRandomStartupQuote();
    startupQuote = quote.text;
  }

  if (characterManager.isLateNight()) {
    const lateNightQuote = characterManager.getSpecialQuote('lateNight');
    if (lateNightQuote) startupQuote = lateNightQuote;
  }

  showSplash({
    version: APP_VERSION,
    model: `${llmProvider.name} / ${configManager.get('llm.model') || llmProvider.id}`,
    provider: llmProvider.name,
    character,
    startupQuote: language === 'zh-CN' ? startupQuote : undefined,
    language,
  });

  const repl = new REPL({
    characterManager,
    configManager,
    contextManager,
    llmProvider,
  });
  await repl.start();
}

main().catch((err) => {
  console.error('RoxyCode startup failed:', err);
  process.exit(1);
});
