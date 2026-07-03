export {
  CharacterAssetsSchema,
  CharacterBehaviorSchema,
  CharacterCompanionSchema,
  CharacterExtensionsSchema,
  CharacterI18nEntrySchema,
  CharacterI18nValueSchema,
  CharacterPackageInfoSchema,
  CharacterSchema,
  CharacterThemeSchema,
  EasterEggsSchema,
  ErrorMessagesSchema,
  HexColorSchema,
  ManifestSchema,
  RelativePackagePathSchema,
  SplashSchema,
  StatusTextSchema,
  validateCharacterJson,
  validateManifest,
} from './character/CharacterSchema.js';
export type { CharacterJson, Manifest } from './character/CharacterSchema.js';
export { CharacterManager } from './character/CharacterManager.js';
export {
  CharacterPackageManager,
  installCharacterPackage,
  readPackageManifest,
  uninstallCharacterPackage,
  updateCharacterPackage,
} from './character/custom/CharacterPackageManager.js';
export type {
  InstallOptions,
  InstallResult,
  InstalledCharacterPackage,
  CharacterPackageInstallPaths,
  UninstallOptions,
  UninstallResult,
  UpdateOptions,
  UpdateResult,
} from './character/custom/CharacterPackageManager.js';
export {
  validateCharacterPackage,
} from './character/custom/CharacterPackageValidator.js';
export type {
  CharacterPackageValidationIssue,
  CharacterPackageValidationResult,
  CharacterPackageValidationSeverity,
} from './character/custom/CharacterPackageValidator.js';
export type {
  Character,
  CharacterId,
  CharacterAgeRating,
  CharacterAssets,
  CharacterExtensions,
  CharacterI18n,
  CharacterMetadata,
  CharacterPackageInfo,
  CharacterPort,
  CharacterSummary,
  CharacterTheme,
  EasterEggPool,
  ErrorMessages,
  SplashConfig,
  StatusTextMap,
} from './character/types.js';
export {
  ALL_CHARACTERS,
  CHARACTER_ORDER,
  eris,
  getCharacter,
  getCharacterList,
  nanahoshi,
  roxy,
  rudeus,
  sylphiette,
} from './character/characters/index.js';
