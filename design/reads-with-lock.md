# Locked reads (`lock`)

Add an opt-in `lock` flag to the read methods (`getChain`, `getChains`, `getJob`, `getJobs`)
so a caller can pessimistically lock the rows it reads for the duration of the enclosing
transaction, making read-modify-write against a chain or job race-free.

## Problem

The read methods return a snapshot. There is no way to read a row and then conditionally write
to it atomically: two transactions can both read the same chain, both decide to act, and clobber
each other (lost update). Every read-modify-write on a chain or job — reconcile, transition,
"update it if it looks like X" — has this hole today.

The concrete driver is the keyed-singleton-chain pattern (see
[builtin-cleanup.md](builtin-cleanup.md)): to upsert a schedule the caller must read the current
chain by key, compare its config, and delete-and-recreate it when it differs. Two application
instances booting at once, or a boot racing a redeploy, run that sequence concurrently and must
not both act. A snapshot read cannot express "hold this row until I finish."

`SELECT ... FOR UPDATE` is the standard answer, but it is not reachable through the client — the
read methods have no lock knob, and no adapter issues a locking read anywhere today.

## Solution

Add an optional `lock?: boolean` to `getChain`, `getChains`, `getJob`, and `getJobs`. When
set, the matched rows are locked against concurrent modification until the enclosing transaction
ends.

```ts
await stateProvider.withTransaction(async (txCtx) => {
  const chain = await client.getChain({
    ...txCtx,
    deduplication: { key: "__queuert/cleanup:main", scope: "running" },
    lock: true,
  });
  // no other transaction can update or delete `chain` until this one commits
  if (needsReplacement(chain)) {
    await client.deleteChain({ ...txCtx, transactionHooks, id: chain.id });
    await client.createChain({ ...txCtx, transactionHooks /* ... */ });
  }
});
```

### A lock needs a transaction

A row lock is held until the transaction that took it commits or rolls back, so `lock` is
meaningless without a transaction context. These methods accept an _optional_ `txCtx` today; when
`lock: true` the `txCtx` becomes **required**. Enforce it at the type level — the options are
a discriminated union so that `{ lock: true }` without a transaction context fails to
compile — and throw `TransactionContextRequiredError` at runtime as a backstop.

### The contract, and what it does not cover

Adapter-agnostic guarantee: within a transaction, `lock: true` guarantees that no other
transaction can update or delete the returned rows until this transaction completes.

The load-bearing limitation: **row locks only cover rows that exist.** A lookup that matches
nothing locks nothing, so `lock` does _not_ serialize a "create if absent" against a
concurrent create — there is no row to lock. That gap is closed elsewhere: the unique constraint
behind `createChain` deduplication rejects the second insert. Callers that both read-lock an
existing row _and_ create-when-absent (cleanup's scheduler is exactly this) rely on **both**
mechanisms — `lock` for the update/delete-an-existing-row race, dedup-on-create for the
absent race. This split is deliberate and must be spelled out wherever the primitive is used.

### Per-adapter semantics

The contract is uniform; the mechanism is not. Consult
[postgres-internals](../docs/src/content/docs/advanced/postgres-internals.md) and
[sqlite-internals](../docs/src/content/docs/advanced/sqlite-internals.md) before implementing.

- **PostgreSQL** — `SELECT ... FOR UPDATE`. True row-level lock; a concurrent locking read of the
  same rows blocks until the holder's transaction ends. Blocking wait only in v1 (no `NOWAIT` /
  `SKIP LOCKED` — `SKIP LOCKED` belongs to job dispatch, not to this).
- **SQLite** — no row-level `FOR UPDATE`. SQLite serializes writers at the database level, so the
  lock is realized by ensuring the transaction holds the write lock (`BEGIN IMMEDIATE` / reserved
  lock) before the caller's later write. Coarser than a row lock — it serializes _all_ writers —
  but SQLite has a single writer anyway, so the contract holds. In WAL mode, concurrent readers
  are unaffected; only writers serialize.
- **In-process** — a keyed async mutex acquired for the transaction's lifetime, matching the
  contract for the test/dev adapter.

### Surface

- **Client** — `getChain` / `getChains` / `getJob` / `getJobs` gain `lock?: boolean`, with the
  `txCtx`-required discriminated typing above.
- **`StateAdapter`** — the underlying `getChains` / `getJobs` gain a lock flag threaded to the
  driver-level query.
- **Adapters** — PostgreSQL, SQLite, in-process implement the flag per the semantics above.

## Non-goals

- Lock timeouts, `NOWAIT`, or `SKIP LOCKED` variants — blocking wait only for now, room to add.
- Locking absent rows / gap or predicate locks — out of scope; the create-if-absent race is a
  deduplication concern.
- Advisory / cross-row / distributed locks — this locks rows that exist, nothing more.

## Dependencies

Independent. Composes with [reads-by-deduplication.md](reads-by-deduplication.md) (a locked read
can look up by id or by deduplication key) but does not require it.

## Tests

- Two concurrent transactions: the second `getChain({ lock: true })` on the same row blocks
  until the first commits (PostgreSQL); the compare-and-swap does not lose an update.
- `lock: true` without a `txCtx` is a type error, and a runtime throw if the types are
  bypassed.
- SQLite: concurrent locked reads serialize their writers; readers are not blocked (WAL).
- In-process: concurrent locked reads of the same row serialize.
- Absent-row lookup with `lock: true` returns without blocking — it locks nothing (guards the
  contract against over-claiming).
- Plural (`getChains` / `getJobs`) locks every matched row.
