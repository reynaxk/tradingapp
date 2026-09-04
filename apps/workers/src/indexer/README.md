# indexer/

Phase 1's actual indexing pipeline lives in `../market/` (`ingestion.ts`) rather than
here — it's specifically the market-data indexer (Uniswap-V3-style Swap events → prices,
liquidity, candles), and naming it after the domain it indexes keeps room for this
directory to hold a differently-shaped indexer later (wallet activity, transactions) that
wouldn't belong under `market/`. This directory stays empty until that need is real.
