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
} from './CharacterSchema.js';
export type { CharacterJson, CharacterPackageJson, Manifest } from './CharacterSchema.js';
export { CharacterManager } from './CharacterManager.js';
export {
  CharacterPackageManager,
  installCharacterPackage,
  readPackageManifest,
  uninstallCharacterPackage,
  updateCharacterPackage,
} from './custom/CharacterPackageManager.js';
export {
  assertSha256,
  computeCharacterPackageSha256,
  verifyCharacterPackageIntegrity,
  writeCharacterPackageSha256Sidecar,
} from './custom/CharacterPackageIntegrity.js';
export type {
  CharacterPackageIntegrityResult,
  CharacterPackageVerifyOptions,
  CharacterPackageVerifyResult,
} from './custom/CharacterPackageIntegrity.js';
export {
  getInstallMetadataPath,
  readCharacterPackageInstallMetadata,
  writeCharacterPackageInstallMetadata,
} from './custom/CharacterPackageInstallMetadata.js';
export type {
  CharacterPackageInstallMetadata,
} from './custom/CharacterPackageInstallMetadata.js';
export {
  checkRoxyCodeVersionCompatibility,
  getCurrentRoxyCodeVersion,
  satisfiesRange,
} from './custom/VersionCompatibility.js';
export type {
  VersionCompatibilityResult,
} from './custom/VersionCompatibility.js';
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
export {
  listCharacterMarketplacePackages,
  loadCharacterMarketplaceIndex,
  resolveMarketplacePackageSource,
  validateCharacterMarketplaceIndex,
} from './marketplace/CharacterMarketplaceIndex.js';
export type {
  CharacterMarketplaceIssue,
  CharacterMarketplaceIssueSeverity,
  CharacterMarketplaceListItem,
  CharacterMarketplaceValidationResult,
} from './marketplace/CharacterMarketplaceIndex.js';
export {
  CharacterMarketplaceEntrySchema,
  CharacterMarketplaceSchema,
  CharacterMarketplaceSourceSchema,
} from './marketplace/CharacterMarketplaceSchema.js';
export type {
  CharacterMarketplace,
  CharacterMarketplaceEntry,
  CharacterMarketplaceSource,
} from './marketplace/CharacterMarketplaceSchema.js';
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
