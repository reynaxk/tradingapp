# indexer/

Empty in Phase 0. This is where the near-real-time and reconciliation lanes described in
`/docs/SOURCE_OF_TRUTH.md` land in Phase 1 — one `ChainDataProvider`-backed listener per
chain, normalizing chain events into idempotent upserts against `@fomo/db`.
