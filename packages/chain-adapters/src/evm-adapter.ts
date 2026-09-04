import { createPublicClient, http, type PublicClient } from 'viem';
import { erc20MetadataAbi } from './erc20-abi';
import type { ChainDataProvider, ChainDescriptor, TokenMetadata } from './types';

export interface EvmChainConfig {
  chain: ChainDescriptor;
  /**
   * The resolved RPC endpoint. This package never reads environment variables itself —
   * the caller resolves the URL from config/secrets and hands it in, so a leaked adapter
   * instance can't be traced back to how the URL was sourced.
   */
  rpcUrl: string;
}

/** ChainDataProvider for EVM-compatible chains (Ethereum, Base, Arbitrum, ...). */
export class EvmChainDataProvider implements ChainDataProvider {
  readonly chain: ChainDescriptor;
  private readonly client: PublicClient;

  constructor(config: EvmChainConfig) {
    this.chain = config.chain;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  async getTokenMetadata(contractAddress: string): Promise<TokenMetadata> {
    const address = contractAddress as `0x${string}`;
    const [symbol, name, decimals] = await Promise.allSettled([
      this.client.readContract({ address, abi: erc20MetadataAbi, functionName: 'symbol' }),
      this.client.readContract({ address, abi: erc20MetadataAbi, functionName: 'name' }),
      this.client.readContract({ address, abi: erc20MetadataAbi, functionName: 'decimals' }),
    ]);

    return {
      symbol: symbol.status === 'fulfilled' ? symbol.value : null,
      name: name.status === 'fulfilled' ? name.value : null,
      decimals: decimals.status === 'fulfilled' ? Number(decimals.value) : null,
    };
  }
}
