import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { prisma } from '@fomo/db';
import { DISCOVERY_RANKING } from '@fomo/domain';
import { SafetyService } from './safety.service';

jest.mock('@fomo/db', () => ({
  prisma: {
    tokenMarket: {
      findFirst: jest.fn(),
    },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

function baseMarket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'market-1',
    liquidityUsd: DISCOVERY_RANKING.minLiquidityUsd + 1,
    lastPriceUpdateAt: new Date(),
    priceUsd: '1.5',
    token: { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: 18 },
    quoteToken: { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'WETH', decimals: 18 },
    ...overrides,
  };
}

describe('SafetyService', () => {
  const safety = new SafetyService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the market when liquidity, decimals, and price freshness all pass', async () => {
    const market = baseMarket();
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(market);

    const result = await safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(result).toBe(market);
  });

  it('rejects a token address with no tracked market', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(safety.assertTradable('0xcccccccccccccccccccccccccccccccccccccccc')).rejects.toThrow(NotFoundException);
  });

  it('rejects a market whose token decimals are unknown', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(
      baseMarket({ token: { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: null } }),
    );

    await expect(safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a market with no tracked liquidity at all', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(baseMarket({ liquidityUsd: null }));

    await expect(safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a market below the minimum liquidity gate', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(
      baseMarket({ liquidityUsd: DISCOVERY_RANKING.minLiquidityUsd - 1 }),
    );

    await expect(safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a market with a stale price snapshot', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(
      baseMarket({ lastPriceUpdateAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    );

    await expect(safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toThrow(UnprocessableEntityException);
  });

  it('looks up the market by base-token address case-insensitively', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(baseMarket());

    await safety.assertTradable('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    expect(mockedPrisma.tokenMarket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: { contractAddress: { equals: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mode: 'insensitive' } } },
      }),
    );
  });
});
