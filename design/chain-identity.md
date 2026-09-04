# Chain identity

Replace `DeduplicationOptions` with `identity: { key, scope }`, persist `scope` on the chain instead
of evaluating it per query, and give the key a read surface.

## Problem

### One name for three needs

`deduplication` describes three unrelated things, and only two of them work:

- **Idempotent enqueue** — "this request creates a chain once, ever" (`scope: "any"`). What makes
  `createChain` safe from a retried API handler.
- **Singleton / recurrence** — "at most one chain under this name is running" (`scope: "running"`).
- **Correlation lookup** — "find the chain for this external thing". A webhook arrives carrying a
  Stripe id, not a chain id. **Not supported at all**: the key is persisted on the root row but
  `mapStateJobToJob` drops it, so it never reaches the public entity and no read accepts it.

The name says "collapse duplicate writes", so the third use has no vocabulary to be expressed in.

### `scope` is a query parameter, so nothing can enforce it

`createChains` runs a `SELECT` whose predicate is built per call, then inserts what it did not match.
Under READ COMMITTED both CTEs share one snapshot, so two concurrent same-key creates both match
nothing and both insert ([#3](https://github.com/kvet/queuert/issues/3)). A conditional predicate
cannot become a unique index, so nothing at the storage layer can enforce it either.

## API

One nested option object, reused verbatim across write and read:

```ts
type ChainIdentity = {
  /** Caller-owned key. Unique within its scope. */
  key: string;
  /** How long the key is held. Persisted on the chain. */
  scope: "any" | "running";
};

client.createChain({ ...txCtx, typeName, input,
  identity: { key: `sync:user:${userId}`, scope: "running" } });

client.getChain({ identity: { key, scope: "running" } });
client.getChains({ identities: [...] });
client.listChains({ identity: { key, scope: "running" } });
```

- `scope` becomes a persisted column, backed by two static partial unique indexes — one per scope.
- `createChain` returns `created: boolean` instead of `deduplicated: boolean`.
- `identityKey` / `identityScope` reach the public `Chain` / `Job` entities.
- The caller-supplied `id` is kept but collisions become a hard `DuplicateJobIdError` — see
  [drop-caller-supplied-id.md](drop-caller-supplied-id.md).

Reads are point lookups. At most one row matches a `(key, scope)` pair:

| scope       | `getChain({ identity })`          | `listChains({ identity })`     |
| ----------- | --------------------------------- | ------------------------------ |
| `"any"`     | the one chain, ever               | — (there is only one)          |
| `"running"` | the running chain, or `undefined` | every occurrence, newest first |

`typeName` is **optional** on the by-identity read, exactly as on the by-id read: keys are globally
unique, so the key identifies a chain on its own and `typeName` merely asserts (throwing
`ChainTypeMismatchError`).

## Reasoning

**Why persist `scope`.** It turns a per-call predicate into a static one, so the database enforces
uniqueness instead of the create path racing to. It also removes the need for a lock-based fix — the
whole option space of bucketed advisory locks vs. a `dedup_lock` table, with its write amplification,
vacuum debt, and REPEATABLE READ caveat, exists only because the predicate was conditional. Creating
becomes an insert that conflicts; deduplicating costs one extra read of the winner.

**Why `identity` rather than a better `deduplication`.** A chain has a caller-owned identity.
Creating a second chain under a taken identity returns the holder; looking one up by identity finds
it. Write behavior and read behavior become the same fact stated twice, which is what
`deduplication` never managed to convey — and it gives correlation lookup a name.

**Why global keys, not per-type.** Per-type keys force `typeName` to be required and part of the
match on reads, so the same parameter would behave differently on the by-id and by-identity forms of
one method. Keys are already namespaced in practice (`__queuert/cleanup:main`, `stripe:pi_…`), and a
bare key colliding across chain types is far more likely a bug than an intent.

**Why `created`, not `deduplicated`.** `deduplicated: true` means "already enqueued" under one scope
and "already running" under the other. `created: false` is accurate for both and reads correctly at
the call site (`if (!created) return existing`).

**Why recurrence stays imperative.** A first-class `recurrence: { intervalMs }` buys one deleted
field and hands back a whole method family (`rescheduleRecurrence`, `cancelRecurrence`,
`reconfigureRecurrence`), and takes the per-run decision away from the handler, which today decides
whether to continue at all. Everything it would offer is already expressible: schedule the next run
with `createChain({ schedule, identity })` after `finish`, stop by not creating one, cancel with
`getChain({ identity })` + `deleteChain`, reconfigure under `lock: true`. A cron-like `schedule`
table remains available later if users ask; nothing here forecloses it.

**Chain completion has to be on the root row.** It is derived today from the terminal job, but a
partial index on the root needs it there — so the `running`-scope index requires denormalizing it.
That is the one genuinely new invariant this design introduces.
