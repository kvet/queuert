---
"@queuert/postgres": patch
---

State providers state READ COMMITTED explicitly when they open a transaction, so a server or role whose `default_transaction_isolation` is higher can no longer raise the level of Queuert's own transactions.

- `PgStateProvider.withTransaction` documents the requirement; the reference providers in the examples pass the level through their client (`BEGIN ISOLATION LEVEL READ COMMITTED`, or the client's isolation-level option).
- `pgStateProviderConformanceCases` gains a case that checks `withTransaction` opens transactions at READ COMMITTED.
