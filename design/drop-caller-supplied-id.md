# Drop caller-supplied job IDs

Remove the optional `id` from `createChain` / `createChains` / `continueWith`. `identity: { key,
scope }` covers every reason to pass one, so the collision semantics that `id` never specified stop
needing to be specified. Part of [chain-identity.md](chain-identity.md).

## Problem

`createChain` / `createChains` / `continueWith` accept an optional `id` for the job being created.
The documented contract is assignment only — the sole specified interaction with deduplication is
that dedup **wins** over a caller-supplied id (conformance: "dedup wins over caller-supplied id").
Nothing specifies what happens when the id already exists, and nothing tests it. The three adapters
each do something different, and none of them reports the collision:

- **PostgreSQL / SQLite** — the root insert carries
  `ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = job.id RETURNING *`. A chain root has
  `chain_id = id`, so a pre-existing id conflicts, the update is a no-op, and the **existing row is
  returned**. The caller's `typeName`, `input`, and `schedule` are discarded. Worse, the result flag
  is computed as `ij.id != ti.id` — for a root those are the same id, so `deduplicated` comes back
  **`false`**: the caller is told a fresh chain was created when none was.
- **In-process** — no conflict handling at all. `writeJob` does a plain `jobs.set(id, job)`, so the
  existing root is **overwritten in place** while continuation jobs on that chain keep pointing at
  the row that was replaced.
- **Intra-batch** (two entries in one `createChains` sharing a provided id) — PostgreSQL raises
  `ON CONFLICT DO UPDATE command cannot affect row a second time`; SQLite applies the no-op update
  and returns a row; in-process overwrites.

The obvious reading is that this needs a typed `DuplicateJobIdError` thrown from each adapter. But
three adapters diverging silently on a case nobody specified is a symptom: the option has no defined
job to do. Under [chain-identity.md](chain-identity.md) it has no job left at all.

## Why `id` has nothing left to do

`chain-identity.md` enumerates three needs that `deduplication` was conflating — idempotent enqueue,
singleton/recurrence, and correlation lookup. `identity` serves all three, and they are the same
three reasons anyone reaches for a caller-supplied `id`:

- **As an idempotency handle** — this is the conflation the identity design exists to remove. `id`
  is not a dedup handle; `identity.key` with `scope: "any"` is.
- **As a correlation handle** ("find the chain for this Stripe id") — `identity.key` again, via
  `getChain({ identity })`. It is also the better handle: `id` is typed by the adapter's `idType`,
  `uuid` by default on PostgreSQL, so `stripe:pi_…` does not fit without reconfiguring the column.
  `identity_key` is always `TEXT`, and it survives deletion and recurrence in a way a row id does
  not.
- **To pre-know the row id before inserting an FK into the caller's own table** — the only case
  identity does not directly replace, and it does not need replacing. `createChain` returns the
  chain inside the caller's transaction, so the caller's row can be written after the create call.
  Storing `identity.key` on that row instead is the more durable modelling anyway.

Nothing in the batch path needs a forward reference either: `blockers` is `BlockerChains<...>` —
resolved `Chain` objects from earlier calls, not ids — so no entry in a `createChains` batch can
refer to another entry's not-yet-assigned id.

The option also carries no weight in practice. No guide documents it, no example passes one (the
`ORD-001` ids in `state-postgres-multi-worker` are the caller's own order ids, passed as `input`),
and the only callers are the conformance and test suites.

## Solution

Delete `id` from `CreateChainEntry` and from the `continueWith` job shape, and delete the
state-adapter plumbing behind it. This removes, rather than specifies:

- the `DuplicateJobIdError` that the collision would otherwise need;
- per-adapter collision detection in all three adapters (PostgreSQL `(xmax = 0)` on the
  `inserted_jobs` CTE, a SQLite pre-`SELECT` inside the write transaction, an in-process
  `idx.jobs.has` check);
- intra-batch duplicate-id validation;
- the `source: "caller"` branch of `InvalidJobIdError`, which narrows to `"generator"`;
- the conformance cases "dedup wins over caller-supplied id" and "rejects caller-supplied id that
  fails validateId";
- the `id` versus `identity` disambiguation in `chain-identity.md` — two nearby words on one call
  with opposite collision behavior stop being a documentation problem when one of them is gone.

It also dissolves the sequencing constraint this document used to impose on the rest of the epic. A
PostgreSQL `ON CONFLICT` targets one constraint, so pointing it at the identity index drops the
`ON CONFLICT (chain_id, chain_index)` clause that currently swallows a colliding caller id. With no
caller-supplied id left, there is nothing for that rewrite to stop swallowing.

The adapter-level `generateId` / `validateId` / `idType` options are unaffected — they configure the
id column, not the call.

## Generated IDs can still collide

Dropping `id` shrinks the collision surface to one path rather than closing it. `generateId` is a
public adapter option. The default `randomUUID()` will not collide, but a user can configure a
counter, an under-provisioned `nanoid`, or — the realistic case — a deterministic
`generateId: () => hash(input)` written by someone reaching for idempotency. Once the create path
conflicts on the identity index, a duplicate primary key is not covered by that clause: PostgreSQL
raises `23505` and SQLite raises `SQLITE_CONSTRAINT_PRIMARYKEY`.

**Map the driver error; do not pre-check.** Catch the constraint violation on the create path and
rethrow a typed error naming `generateId` as the culprit, with the driver error as `cause`.

The pre-detection argument does not transfer from caller ids to generated ids. It rested on keeping
the caller's transaction usable so they could catch the error and continue — but with a broken
generator there is nothing to continue toward, since the next `createChain` in that transaction
draws from the same generator. Meanwhile the cost inverts: a pre-`SELECT` costs nothing today when
no ids are supplied, but covering generated ids means paying it on **every create**, permanently, to
guard against a misconfiguration that surfaces on the first call in development. Mapping lives in
the `catch`, so the happy path is free, and it fixes the actual defect — that a raw `23505` is
off-style against the package's typed error vocabulary, which has no constraint mapping anywhere
today.

Two consequences worth stating rather than hiding:

- **PostgreSQL's transaction stays poisoned.** Once `23505` fires the transaction is aborted
  regardless of what JS throws afterwards. Keeping it usable would need a `SAVEPOINT` around every
  insert — per-create overhead for a non-event. Rejected.
- **Only PostgreSQL has this problem.** SQLite does statement-level rollback on a constraint
  violation, so its transaction survives; in-process is unaffected. The "must detect in JS"
  requirement was always PostgreSQL-specific, and specific to collisions worth recovering from.

**Retry with a fresh id** was considered and rejected: it loops forever against a deterministic
generator, and in PostgreSQL it cannot work without the savepoint above. `generateId` documents a
uniqueness requirement instead, and the mapped error says so when it is violated.

## Decisions

- **Remove rather than fix.** Specifying collision behavior for `id` would preserve an option that
  duplicates `identity` and contradicts it (`id` collision errors, `identity.key` collision returns
  the existing chain).
- **No deprecation period.** The current major line is unreleased and the epic is breaking anyway,
  so this rides the same major at no extra release cost.
- **`generateId` stays.** Callers who need control over the id _format_ keep it; what goes is
  control over an individual call's id value.

## Dependencies

- **Requires** [chain-identity.md](chain-identity.md) — `identity` is the replacement, so the
  migration note has somewhere to point. Within the epic the two can land in either order (nothing
  breaks in the interim: until the create path is rewritten, the existing
  `ON CONFLICT (chain_id, chain_index)` clause is simply unreachable for caller ids). This no longer
  has to land _before_ the create-path rewrite — that constraint existed only while a
  caller-supplied id survived it.
- **Simplifies** [chain-identity.md](chain-identity.md) — its "`id` versus `identity`" section and
  the corresponding guide paragraph are deleted rather than written.
- Related failure mode, different cause: concurrent same-key creates ([#3](https://github.com/kvet/queuert/issues/3)), addressed by [chain-identity.md](chain-identity.md).

## Surface

- **Core** — `id` removed from `CreateChainEntry` and the `continueWith` job shape;
  `InvalidJobIdError`'s `source` narrows to `"generator"`; new typed error for a generated-id
  collision.
- **`StateAdapter`** — `id` removed from the `createChains` / `createContinuationJob` job inputs;
  constraint-violation mapping added on the create path.
- **Adapters** — PostgreSQL and SQLite map their constraint errors; all three stop threading a
  caller id.
- **Docs** — `advanced/adapters.md` gains the `generateId` uniqueness requirement and the mapped
  error, next to the existing `generateId` / `validateId` / `idType` documentation. The
  `createChain` / `createChains` / `continueWith` reference entries drop `id`.
- **Migration** — one note: replace a caller-supplied `id` with `identity.key`, or read the id off
  the `createChain` result.

## Tests

- Every adapter's create path with no `id` in the input shape (the type-level removal is the main
  guard; conformance cases that supplied one are deleted, not rewritten).
- A `generateId` that returns a constant produces the typed collision error, not a raw driver error,
  on `createChains` and on `createContinuationJob`.
- SQLite's transaction remains usable after that error; PostgreSQL's is documented as aborted.
- `InvalidJobIdError` still fires for a generator-produced id that fails `validateId`.

## Open questions

- **Name and shape of the collision error.** `JobIdCollisionError` mirroring `InvalidJobIdError`
  (carrying `id` and `cause`) reads consistently, but it is a distinctly different failure — a
  misconfigured adapter rather than a bad value — and might belong closer to the adapter's
  vocabulary than the client's.
- **Scope of the constraint mapping.** Only the create path raises this, but the package has no
  constraint mapping at all today; whether to introduce a general driver-error mapping layer or a
  single targeted `catch` is an implementation call worth making once rather than twice.
