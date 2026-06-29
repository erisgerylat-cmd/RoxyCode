import type { ConfigManager } from '../../core/ConfigManager.js';
import { ALL_CHARACTERS, CHARACTER_ORDER, isBuiltInCharacterId } from './characters/index.js';
import { loadCustomCharacters, type CustomCharacterLoadError, type CustomCharacterPaths } from './custom/CustomCharacterLoader.js';
import type {
  BuiltInCharacterId,
  Character,
  CharacterId,
  CharacterPort,
  CharacterBehavior,
  CharacterSummary,
} from './types.js';

export class CharacterManager implements CharacterPort {
  private currentCharacter: Character;
  private listeners: Array<(character: Character) => void> = [];
  private readonly registry = new Map<CharacterId, Character>();
  private readonly order: CharacterId[] = [];
  private readonly customErrors: CustomCharacterLoadError[] = [];
  private customPaths?: CustomCharacterPaths;

  constructor(
    private readonly configManager: ConfigManager,
    private readonly cwd: string = process.cwd(),
  ) {
    this.registerBuiltIns();
    const savedId = configManager.get('character.current') as CharacterId | undefined;
    this.currentCharacter = this.registry.get(savedId || 'roxy') ?? this.registry.get('roxy')!;
  }

  async loadCustomCharacters(): Promise<void> {
    const result = await loadCustomCharacters(this.cwd);
    this.customPaths = result.paths;
    this.customErrors.length = 0;
    this.customErrors.push(...result.errors);

    for (const character of result.characters) {
      this.register(character);
    }

    const savedId = this.configManager.get('character.current') as CharacterId | undefined;
    this.currentCharacter = this.registry.get(savedId || this.currentCharacter.id) ?? this.registry.get('roxy')!;
  }

  getCurrentCharacter(): Character {
    return this.currentCharacter;
  }

  getCharacter(id: CharacterId): Character | undefined {
    return this.registry.get(id);
  }

  async switchCharacter(id: CharacterId): Promise<void> {
    const character = this.registry.get(id);
    if (!character) {
      throw new Error(`Character ${id} does not exist.`);
    }

    this.currentCharacter = character;
    await this.configManager.set('character.current', id);

    for (const listener of this.listeners) {
      listener(character);
    }
  }

  getCharacterList(): CharacterSummary[] {
    return this.order
      .map(id => this.registry.get(id))
      .filter((character): character is Character => Boolean(character))
      .map(c => ({
        id: c.id,
        name: c.name,
        title: c.title,
        description: c.description,
        primaryColor: c.theme.primary,
        isActive: c.id === this.currentCharacter.id,
        source: c.source ?? 'builtin',
        custom: c.custom === true,
        companion: c.companion?.name,
        behavior: c.behavior,
      }));
  }

  getCustomLoadErrors(): CustomCharacterLoadError[] {
    return [...this.customErrors];
  }

  getCustomCharacterPaths(): CustomCharacterPaths | undefined {
    return this.customPaths;
  }

  isBuiltIn(id: string): id is BuiltInCharacterId {
    return isBuiltInCharacterId(id);
  }

  onCharacterChanged(callback: (character: Character) => void): void {
    this.listeners.push(callback);
  }

  getRandomStartupQuote(): { text: string; character: Character } {
    const pool = this.currentCharacter.easterEggs.startup;
    const text = pool[Math.floor(Math.random() * pool.length)] ?? '';
    return { text, character: this.currentCharacter };
  }

  getRandomQuote(type: 'success' | 'error' | 'idle'): string {
    const pool = this.currentCharacter.easterEggs[type];
    return pool[Math.floor(Math.random() * pool.length)] ?? '';
  }

  getSpecialQuote(key: string): string | undefined {
    return this.currentCharacter.easterEggs.special[key];
  }

  isLateNight(): boolean {
    const hour = new Date().getHours();
    return hour >= 23 || hour < 5;
  }

  private registerBuiltIns(): void {
    for (const id of CHARACTER_ORDER) {
      const character = ALL_CHARACTERS.get(id)!;
      this.register({ ...character, behavior: character.behavior ?? defaultBuiltInBehavior(id), source: 'builtin', custom: false });
    }
  }

  private register(character: Character): void {
    const exists = this.registry.has(character.id);
    this.registry.set(character.id, character);
    if (!exists) this.order.push(character.id);
  }
}


function defaultBuiltInBehavior(id: BuiltInCharacterId): CharacterBehavior {
  switch (id) {
    case 'roxy':
      return {
        explanationStyle: 'teaching',
        reviewFocus: ['correctness', 'testing', 'learning'],
        riskPreference: 'conservative',
        preferredMode: 'standard',
        workflowBias: ['explain the plan before editing', 'verify after implementation', 'prefer beginner-friendly Chinese explanations'],
        responseRules: ['lead with the conclusion', 'explain tradeoffs clearly', 'keep safety rules strict'],
      };
    case 'eris':
      return {
        explanationStyle: 'structured',
        reviewFocus: ['correctness', 'performance', 'maintainability'],
        riskPreference: 'balanced',
        preferredMode: 'economic',
        workflowBias: ['act directly after a short plan', 'prefer concrete fixes', 'avoid over-explaining simple changes'],
        responseRules: ['be direct', 'call out obvious bugs quickly', 'still ask for permission on risky operations'],
      };
    case 'rudeus':
      return {
        explanationStyle: 'playful',
        reviewFocus: ['correctness', 'performance', 'learning'],
        riskPreference: 'balanced',
        preferredMode: 'standard',
        workflowBias: ['compare options before choosing', 'reuse practical patterns', 'summarize lessons learned'],
        responseRules: ['use light humor sparingly', 'separate inner-thought flavor from technical facts', 'verify assumptions with tools'],
      };
    case 'sylphiette':
      return {
        explanationStyle: 'teaching',
        reviewFocus: ['maintainability', 'testing', 'ux'],
        riskPreference: 'conservative',
        preferredMode: 'standard',
        workflowBias: ['make small safe changes', 'preserve user work carefully', 'include gentle recovery steps'],
        responseRules: ['be calm and supportive', 'avoid aggressive rewrites', 'surface remaining risks'],
      };
    case 'nanahoshi':
      return {
        explanationStyle: 'concise',
        reviewFocus: ['correctness', 'security', 'performance'],
        riskPreference: 'conservative',
        preferredMode: 'ultimate',
        workflowBias: ['inspect evidence first', 'prefer reproducible verification', 'separate facts from inference'],
        responseRules: ['be concise and evidence-driven', 'state uncertainty explicitly', 'prefer measured experiments'],
      };
  }
}
