import { z } from 'zod';
import {
  AuthorSchema,
  RelativePackagePathSchema,
} from '../CharacterSchema.js';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/i;

const MarketplaceNameSchema = z.string()
  .min(1, 'Marketplace name cannot be empty')
  .max(80, 'Marketplace name must be at most 80 characters')
  .regex(KEBAB_CASE, 'Marketplace name must be kebab-case')
  .refine(name => !name.includes('/') && !name.includes('\\') && !name.includes('..'), {
    message: 'Marketplace name must not contain path separators or .. segments',
  })
  .refine(name => !isBlockedOfficialMarketplaceName(name), {
    message: 'Marketplace name looks like an official RoxyCode marketplace but is not reserved for trusted sources',
  });

const CharacterMarketplaceLocalSourceSchema = z.union([
  RelativePackagePathSchema,
  z.object({
    type: z.enum(['file', 'directory']),
    path: RelativePackagePathSchema,
  }),
]);

const CharacterMarketplaceRemoteSourceSchema = z.object({
  type: z.literal('url'),
  url: z.string().url(),
  sha256: z.string().regex(SHA256, 'sha256 must be a 64-character hex digest').optional(),
});

export const CharacterMarketplaceSourceSchema = z.union([
  CharacterMarketplaceLocalSourceSchema,
  CharacterMarketplaceRemoteSourceSchema,
]);

export const CharacterMarketplaceEntrySchema = z.object({
  name: z.string()
    .regex(KEBAB_CASE, 'Package name must be kebab-case')
    .min(3)
    .max(50),
  version: z.string().regex(SEMVER, 'Version must be valid SemVer'),
  displayName: z.string().min(1).max(100),
  description: z.string().min(10).max(500),
  source: CharacterMarketplaceSourceSchema,
  sha256: z.string().regex(SHA256, 'sha256 must be a 64-character hex digest').optional(),
  author: AuthorSchema.optional(),
  license: z.string().min(1).optional(),
  categories: z.array(z.string().min(1)).max(8).optional(),
  tags: z.array(z.string().min(1)).max(30).optional(),
  characterId: z.string().regex(KEBAB_CASE, 'Character id must be kebab-case').optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  metadata: z.object({
    source: z.string().optional(),
    characterType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    ageRating: z.enum(['everyone', '13+', '16+', '18+']).optional(),
    preview: z.string().url().optional(),
  }).optional(),
}).passthrough();

export const CharacterMarketplaceSchema = z.object({
  $schema: z.string().url().optional(),
  schemaVersion: z.literal(1).default(1),
  name: MarketplaceNameSchema,
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().min(10).max(500).optional(),
  owner: AuthorSchema,
  packages: z.array(CharacterMarketplaceEntrySchema),
  metadata: z.object({
    version: z.string().optional(),
    updatedAt: z.string().datetime().optional(),
    homepage: z.string().url().optional(),
    locale: z.string().optional(),
  }).optional(),
}).passthrough();

export type CharacterMarketplace = z.infer<typeof CharacterMarketplaceSchema>;
export type CharacterMarketplaceEntry = z.infer<typeof CharacterMarketplaceEntrySchema>;
export type CharacterMarketplaceSource = z.infer<typeof CharacterMarketplaceSourceSchema>;

function isBlockedOfficialMarketplaceName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized === 'roxycode-official' || normalized === 'roxycode-characters') return false;
  return /(?:official[^a-z0-9]*roxycode|roxycode[^a-z0-9]*(official|marketplace|characters))/i.test(name);
}
