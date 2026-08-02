# Caller-supplied job ID collisions

Make a colliding caller-supplied `id` a typed error instead of three different silent outcomes.
`id` assigns an identity; it is **not** a deduplication handle and must not behave like one.

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

The `ON CONFLICT` clause reads like idempotency but only ever functioned as a duplicate-key guard.
On `createContinuationJob` the same clause **is** meaningful — the conflicting row there has a
different id, so `ij.id != $1` correctly reports the existing continuation — which is why the clause
must be narrowed rather than removed wholesale.

## Why not just drop `ON CONFLICT`

Letting the constraint fire surfaces a raw driver error (PG `23505`, SQLite
`SQLITE_CONSTRAINT_PRIMARYKEY`). The package has no constraint-error mapping anywhere, so this is
off-style against its typed error vocabulary (`InvalidJobIdError`, `JobTypeMismatchError`, …). More
importantly, in PostgreSQL a `23505` **aborts the enclosing transaction**: the user's
`withTransactionHooks` block becomes dead, so they cannot catch the error and do anything else in
that transaction. A collision is a caller bug, but poisoning an otherwise-healthy transaction is a
harsh way to report one.

Detecting the collision and throwing from JS keeps the transaction usable.

## Approach

Add `DuplicateJobIdError` (id, and the chain/job type it was requested for) to `packages/core/src/errors.ts`,
thrown from the state-adapter boundary by all three adapters:

- **PostgreSQL** — keep the `ON CONFLICT`, add `(xmax = 0) AS inserted` to the `inserted_jobs` CTE,
  and throw when a row for a caller-supplied id returns `inserted = false`.
- **SQLite** — pre-`SELECT` the caller-supplied ids inside the write transaction and throw on a hit.
  Writes are serialized per transaction, so this is race-free, and it costs nothing when no ids are
  supplied.
- **In-process** — check `idx.jobs.has(id)` before `writeJob`, which also closes the overwrite hole.

Intra-batch duplicates are validated upfront in the same pass that runs `validateId`, so all three
adapters agree without each re-deriving it from their storage.

`createContinuationJob` gets the same treatment for a provided id colliding with an unrelated job
(that hits the primary key, not `(chain_id, chain_index)`, and raises raw today) while keeping its
existing continuation-race `ON CONFLICT` behavior intact.

## Open questions

- **Identical-row exemption.** Should a collision where the existing row has the same type and chain
  type still throw? Strict "always throw" is simpler to specify and reason about. A same-shape
  exemption would make retrying a failed create with a fixed id succeed, but that is deduplication's
  job — leaning strict.
- **Severity of the break.** Code relying on the current silent-return would start throwing.
  Probably `major`; worth confirming nothing internal depends on the swallow.

## Dependencies

Independent of [chain-identity.md](chain-identity.md) in mechanism, but coupled in sequencing. That
design rewrites the create path around `ON CONFLICT` on the identity index, and a PostgreSQL
`ON CONFLICT` targets a single constraint — so the `ON CONFLICT (chain_id, chain_index)` clause that
today silently swallows a colliding `id` goes away. If chain identity lands first, id collisions
start raising a raw `23505` and aborting the caller's transaction, which is the regression this
document exists to prevent. Land this with or before that create-path rewrite, and expect the
PostgreSQL detection below to be re-derived against the new SQL.

The `id` vs `identity` contrast is also documented jointly: an `id` collision is an error, an
`identity.key` collision returns the existing chain.

## Surface

- **Core** — new `DuplicateJobIdError`; doc `id` on `CreateChainEntry` / `continueWith` as
  assign-only, collisions throw.
- **Adapters** — PostgreSQL, SQLite, in-process detection as above.
- **Conformance** — cross-call collision and intra-batch collision, on both `createChains` and
  `createContinuationJob`.
