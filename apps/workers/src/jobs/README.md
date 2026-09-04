# jobs/

Empty in Phase 0. BullMQ queues and processors (notification fanout, aggregation rollups,
indexing backfills) land here starting Phase 1, backed by the same Redis connection this
app already establishes in `src/main.ts`.
