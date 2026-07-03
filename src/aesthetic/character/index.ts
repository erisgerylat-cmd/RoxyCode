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
} from './CharacterSchema.js';
export type { CharacterJson, Manifest } from './CharacterSchema.js';
export { CharacterManager } from './CharacterManager.js';
export {
  CharacterPackageManager,
  installCharacterPackage,
  readPackageManifest,
  uninstallCharacterPackage,
  updateCharacterPackage,
} from './custom/CharacterPackageManager.js';
export type {
  InstallOptions,
  InstallResult,
  InstalledCharacterPackage,
  CharacterPackageInstallPaths,
  UninstallOptions,
  UninstallResult,
  UpdateOptions,
  UpdateResult,
} from './custom/CharacterPackageManager.js';
export {
  exportCharacterPackage,
} from './custom/CharacterPackageExporter.js';
export type {
  CharacterPackageExportOptions,
  CharacterPackageExportResult,
} from './custom/CharacterPackageExporter.js';
export {
  packCharacterPackage,
} from './custom/CharacterPackagePacker.js';
export type {
  CharacterPackagePackOptions,
  CharacterPackagePackResult,
} from './custom/CharacterPackagePacker.js';
export {
  characterToPackageJson,
  createCharacterPackageTemplate,
} from './custom/CharacterPackageTemplate.js';
export type {
  CharacterPackageTemplateOptions,
  CharacterPackageTemplateResult,
} from './custom/CharacterPackageTemplate.js';
export {
  validateCharacterPackage,
} from './custom/CharacterPackageValidator.js';
export type {
  CharacterPackageValidationIssue,
  CharacterPackageValidationResult,
  CharacterPackageValidationSeverity,
} from './custom/CharacterPackageValidator.js';
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
} from './types.js';
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
} from './characters/index.js';
