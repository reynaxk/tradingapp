import { z } from 'zod';

/**
 * A token contract on a specific chain.
 *
 * Fields whose true value can only come from the chain itself — symbol, name, decimals,
 * logo — are nullable. Phase 0 must never fabricate a plausible-looking value for one of
 * these; if the indexer hasn't confirmed it yet, it is null, not guessed.
 */
export const TokenSchema = z.object({
  id: z.string().uuid(),
  chainId: z.number().int().positive(),
  contractAddress: z.string().min(1),
  symbol: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  decimals: z.number().int().min(0).max(255).nullable(),
  logoUrl: z.string().url().nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Token = z.infer<typeof TokenSchema>;

export const CreateTokenInputSchema = TokenSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({ symbol: true, name: true, decimals: true, logoUrl: true, metadata: true });

export type CreateTokenInput = z.infer<typeof CreateTokenInputSchema>;
