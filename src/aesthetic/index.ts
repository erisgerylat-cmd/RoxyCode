export {
  CharacterAssetsSchema,
  CharacterBehaviorSchema,
  CharacterCompanionSchema,
  CharacterExtensionsSchema,
  CharacterI18nEntrySchema,
  CharacterI18nValueSchema,
  CharacterPackageInfoSchema,
  CharacterPackageJsonSchema,
  CharacterSchema,
  CharacterThemeSchema,
  EasterEggsSchema,
  ErrorMessagesJsonSchema,
  ErrorMessagesSchema,
  HexColorSchema,
  ManifestSchema,
  RelativePackagePathSchema,
  SplashSchema,
  StatusTextJsonSchema,
  StatusTextSchema,
  validateCharacterJson,
  validateCharacterPackageJson,
  validateManifest,
} from './character/CharacterSchema.js';
export type { CharacterJson, CharacterPackageJson, Manifest } from './character/CharacterSchema.js';
export { CharacterManager } from './character/CharacterManager.js';
export {
  CharacterPackageManager,
  installCharacterPackage,
  readPackageManifest,
  uninstallCharacterPackage,
  updateCharacterPackage,
} from './character/custom/CharacterPackageManager.js';
export {
  assertSha256,
  computeCharacterPackageSha256,
  verifyCharacterPackageIntegrity,
  writeCharacterPackageSha256Sidecar,
} from './character/custom/CharacterPackageIntegrity.js';
export type {
  CharacterPackageIntegrityResult,
  CharacterPackageVerifyOptions,
  CharacterPackageVerifyResult,
} from './character/custom/CharacterPackageIntegrity.js';
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
  exportCharacterPackage,
} from './character/custom/CharacterPackageExporter.js';
export type {
  CharacterPackageExportOptions,
  CharacterPackageExportResult,
} from './character/custom/CharacterPackageExporter.js';
export {
  packCharacterPackage,
} from './character/custom/CharacterPackagePacker.js';
export type {
  CharacterPackagePackOptions,
  CharacterPackagePackResult,
} from './character/custom/CharacterPackagePacker.js';
export {
  characterToPackageJson,
  createCharacterPackageTemplate,
} from './character/custom/CharacterPackageTemplate.js';
export type {
  CharacterPackageTemplateOptions,
  CharacterPackageTemplateResult,
} from './character/custom/CharacterPackageTemplate.js';
export {
  validateCharacterPackage,
} from './character/custom/CharacterPackageValidator.js';
export type {
  CharacterPackageValidationIssue,
  CharacterPackageValidationResult,
  CharacterPackageValidationSeverity,
} from './character/custom/CharacterPackageValidator.js';
export {
  listCharacterMarketplacePackages,
  loadCharacterMarketplaceIndex,
  resolveMarketplacePackageSource,
  validateCharacterMarketplaceIndex,
} from './character/marketplace/CharacterMarketplaceIndex.js';
export type {
  CharacterMarketplaceIssue,
  CharacterMarketplaceIssueSeverity,
  CharacterMarketplaceListItem,
  CharacterMarketplaceValidationResult,
} from './character/marketplace/CharacterMarketplaceIndex.js';
export {
  CharacterMarketplaceEntrySchema,
  CharacterMarketplaceSchema,
  CharacterMarketplaceSourceSchema,
} from './character/marketplace/CharacterMarketplaceSchema.js';
export type {
  CharacterMarketplace,
  CharacterMarketplaceEntry,
  CharacterMarketplaceSource,
} from './character/marketplace/CharacterMarketplaceSchema.js';
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
