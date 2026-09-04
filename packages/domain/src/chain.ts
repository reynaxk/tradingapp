import { z } from 'zod';

/**
 * A blockchain network the platform knows about.
 *
 * `identifier` is the stable, human-referenceable id (CAIP-2 style, e.g. "eip155:8453" for
 * Base mainnet) used in URLs and logs. `id` is the internal numeric primary key used for
 * foreign keys and should never be exposed as a chain's public identity.
 */
export const ChainSchema = z.object({
  id: z.number().int().positive(),
  identifier: z.string().min(1),
  name: z.string().min(1),
  nativeSymbol: z.string().min(1),
  /**
   * Logical reference to this chain's RPC configuration (an env var key or provider config
   * name) — never a raw RPC URL or API key. The actual endpoint is resolved from environment
   * or secrets manager at runtime; it is never stored in the database.
   */
  rpcConfigKey: z.string().min(1),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Chain = z.infer<typeof ChainSchema>;

export const CreateChainInputSchema = ChainSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({ enabled: true });

export type CreateChainInput = z.infer<typeof CreateChainInputSchema>;
