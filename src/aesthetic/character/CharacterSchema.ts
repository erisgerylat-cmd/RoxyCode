import { z } from 'zod';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

const REVIEW_FOCUSES = ['correctness', 'security', 'performance', 'maintainability', 'testing', 'ux', 'learning'] as const;
const AGE_RATINGS = ['everyone', '13+', '16+', '18+'] as const;

export const RelativePackagePathSchema = z.string()
  .min(1)
  .refine(value => !/^[a-zA-Z]:[\\/]/.test(value), 'Path must be relative to the character package root')
  .refine(value => !value.startsWith('/') && !value.startsWith('\\'), 'Path must be relative to the character package root')
  .refine(value => !value.split(/[\\/]+/).includes('..'), 'Path must not contain .. segments')
  .refine(value => !/^https?:\/\//i.test(value), 'Path must be local to the character package');

export const GlobPackagePathSchema = RelativePackagePathSchema;
export const HexColorSchema = z.string().regex(HEX_COLOR, 'Color must be a #RRGGBB hex value');
export const TemplateStringSchema = z.string().min(1);
export const RuntimeStringRendererSchema = z.union([
  z.custom<(...args: unknown[]) => string>(value => typeof value === 'function', 'Renderer must be a function or template string'),
  TemplateStringSchema,
]);

export const AuthorSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  url: z.string().url().optional(),
});

export const RepositorySchema = z.object({
  type: z.string().min(1),
  url: z.string().url(),
});

export const ManifestSchema = z.object({
  $schema: z.string().url().optional(),
  name: z.string()
    .regex(KEBAB_CASE, 'Package name must be kebab-case')
    .min(3, 'Package name must be at least 3 characters')
    .max(50, 'Package name must be at most 50 characters'),
  version: z.string().regex(SEMVER, 'Version must be valid SemVer'),
  displayName: z.string().min(1).max(100),
  description: z.string().min(10).max(500),
  author: AuthorSchema,
  license: z.string().min(1).optional(),
  repository: RepositorySchema.optional(),
  keywords: z.array(z.string().min(1)).max(20).optional(),
  categories: z.array(z.string().min(1)).max(5).optional(),
  engines: z.object({
    roxycode: z.string().min(1),
  }).optional(),
  main: RelativePackagePathSchema.default('character.json'),
  contributes: z.object({
    character: RelativePackagePathSchema.optional(),
    workflows: z.array(GlobPackagePathSchema).optional(),
    hooks: RelativePackagePathSchema.optional(),
    themes: z.array(GlobPackagePathSchema).optional(),
  }).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  metadata: z.object({
    source: z.string().optional(),
    characterType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    ageRating: z.enum(AGE_RATINGS).optional(),
    preview: z.string().url().optional(),
  }).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export const CharacterThemeSchema = z.object({
  primary: HexColorSchema,
  secondary: HexColorSchema,
  accent: HexColorSchema,
  dim: HexColorSchema,
  error: HexColorSchema,
  success: HexColorSchema,
  tagline: z.string().min(1),
});

export const CharacterBehaviorSchema = z.object({
  explanationStyle: z.enum(['concise', 'structured', 'teaching', 'deep', 'playful']),
  reviewFocus: z.array(z.enum(REVIEW_FOCUSES)),
  riskPreference: z.enum(['conservative', 'balanced', 'bold']),
  preferredMode: z.enum(['lite', 'economic', 'standard', 'ultimate']),
  workflowBias: z.array(z.string()),
  responseRules: z.array(z.string()),
});

export const StatusTextSchema = z.object({
  thinking: z.string(),
  analyzing: z.string(),
  planning: z.string(),
  executing: z.string(),
  reading: RuntimeStringRendererSchema,
  writing: RuntimeStringRendererSchema,
  running: RuntimeStringRendererSchema,
  searching: z.string(),
  waiting: z.string(),
  done: z.string(),
  error: z.string(),
  step: RuntimeStringRendererSchema,
}).passthrough();

export const SplashSchema = z.object({
  asciiArt: z.array(z.string()).optional(),
  tagline: z.string(),
  welcome: z.string(),
  tips: z.array(z.string()).optional(),
});

export const EasterEggsSchema = z.object({
  startup: z.array(z.string()),
  success: z.array(z.string()),
  error: z.array(z.string()),
  idle: z.array(z.string()),
  special: z.record(z.string(), z.string()),
});

export const ErrorMessagesSchema = z.object({
  generic: z.string(),
  networkError: z.string(),
  tokenLimit: z.string(),
  toolFailed: RuntimeStringRendererSchema,
  permissionDenied: z.string(),
  rateLimit: z.string(),
  contextOverflow: z.string(),
}).passthrough();

export const CharacterCompanionSchema = z.object({
  name: z.string(),
  kind: z.string(),
  art: z.array(z.string()),
  idleLines: z.array(z.string()),
  thinkingLines: z.array(z.string()),
  successLines: z.array(z.string()),
  warningLines: z.array(z.string()),
});

export const CharacterPackageInfoSchema = z.object({
  packageName: z.string().regex(KEBAB_CASE, 'Package name must be kebab-case'),
  version: z.string().regex(SEMVER, 'Version must be valid SemVer'),
  author: AuthorSchema,
  license: z.string().optional(),
  repository: z.string().url().optional(),
  installPath: z.string().min(1),
  installedAt: z.string().datetime(),
});

export const CharacterAssetsSchema = z.object({
  icon: RelativePackagePathSchema.optional(),
  avatar: RelativePackagePathSchema.optional(),
  splashArt: z.array(RelativePackagePathSchema).optional(),
  sprites: z.object({
    idle: z.array(RelativePackagePathSchema).optional(),
    thinking: z.array(RelativePackagePathSchema).optional(),
    success: z.array(RelativePackagePathSchema).optional(),
    warning: z.array(RelativePackagePathSchema).optional(),
    error: z.array(RelativePackagePathSchema).optional(),
  }).optional(),
  sounds: z.object({
    notification: RelativePackagePathSchema.optional(),
    success: RelativePackagePathSchema.optional(),
    error: RelativePackagePathSchema.optional(),
  }).optional(),
}).optional();

export const CharacterExtensionsSchema = z.object({
  hooks: RelativePackagePathSchema.optional(),
  workflows: z.array(RelativePackagePathSchema).optional(),
  prompts: z.object({
    systemPrompt: RelativePackagePathSchema.optional(),
    planPrompt: RelativePackagePathSchema.optional(),
    verificationPrompt: RelativePackagePathSchema.optional(),
  }).optional(),
  tools: z.array(RelativePackagePathSchema).optional(),
}).optional();

export const CharacterI18nEntrySchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  personality: z.string().optional(),
  statusText: StatusTextSchema.partial().optional(),
  easterEggs: EasterEggsSchema.partial().optional(),
  errorMessages: ErrorMessagesSchema.partial().optional(),
}).passthrough();

export const CharacterI18nValueSchema = z.union([
  CharacterI18nEntrySchema,
  RelativePackagePathSchema,
]);

export const CharacterSchema = z.object({
  id: z.string().regex(KEBAB_CASE, 'Character id must be kebab-case'),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  personality: z.string().min(1),
  theme: CharacterThemeSchema,
  behavior: CharacterBehaviorSchema.optional(),
  statusText: StatusTextSchema,
  companion: CharacterCompanionSchema.optional(),
  splash: SplashSchema,
  easterEggs: EasterEggsSchema,
  errorMessages: ErrorMessagesSchema,
  systemPromptPersona: z.string().min(10),
  custom: z.boolean().optional(),
  source: z.enum(['builtin', 'global', 'project', 'marketplace']).optional(),
  packageInfo: CharacterPackageInfoSchema.optional(),
  assets: CharacterAssetsSchema,
  extensions: CharacterExtensionsSchema,
  i18n: z.record(z.string().regex(LOCALE, 'Locale must look like zh-CN or en-US'), CharacterI18nValueSchema).optional(),
  metadata: z.object({
    source: z.string().optional(),
    characterType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    ageRating: z.enum(AGE_RATINGS).optional(),
  }).optional(),
}).passthrough();

export type CharacterJson = z.infer<typeof CharacterSchema>;

export function validateManifest(value: unknown): Manifest {
  return ManifestSchema.parse(value);
}

export function validateCharacterJson(value: unknown): CharacterJson {
  return CharacterSchema.parse(value);
}
