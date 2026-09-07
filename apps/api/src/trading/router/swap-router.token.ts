/** DI token for the active SwapRouter implementation — see docs/TRADING.md#provider.
 *  Swapping providers means rebinding this token in trading.module.ts, never touching a
 *  consumer of it. Same pattern as REDIS_CLIENT in apps/api/src/redis/redis.module.ts. */
export const SWAP_ROUTER = Symbol('SWAP_ROUTER');
