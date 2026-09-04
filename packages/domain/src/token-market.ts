import { z } from 'zod';

/**
 * A specific liquidity venue a token trades on (a pool/pair on a DEX).
 *
 * Price and liquidity belong here, not on `Token`, because a token can trade across several
 * pools and even several chains at once — collapsing that onto the token row is the modeling
 * mistake this schema deliberately avoids.
 */
export const TokenMarketSchema = z.object({
  id: z.string().uuid(),
  chainId: z.number().int().positive(),
  tokenId: z.string().uuid(),
  quoteTokenId: z.string().uuid(),
  dex: z.string().min(1).nullable(),
  pairAddress: z.string().min(1),
  liquidityUsd: z.number().nonnegative().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TokenMarket = z.infer<typeof TokenMarketSchema>;

export const CreateTokenMarketInputSchema = TokenMarketSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({ dex: true, liquidityUsd: true });

export type CreateTokenMarketInput = z.infer<typeof CreateTokenMarketInputSchema>;
