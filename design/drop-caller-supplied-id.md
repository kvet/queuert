# Caller-supplied job IDs: keep, but error on collision

Keep the optional `id` on `createChain` / `createChains` / `continueWith` as a caller-owned handle
(correlation, pre-known FK, external reference). Make collisions a hard error instead of the current
silent divergence. Deduplication stays exclusively with `identity`.

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

The caller-supplied `id` is a useful feature — correlation handles, pre-known FKs, external
references — but it must not silently swallow or corrupt data on collision. The fix is to make `id`
an assignment-only option with a hard error on conflict, leaving deduplication to `identity`.

## Why not remove `id` entirely

[chain-identity.md](chain-identity.md) covers most reasons to pass a caller-supplied `id`, but not
all of them:

- **Pre-known FK** — inserting a reference to the chain in the caller's own table, within the same
  transaction, before `createChain` returns. `createChain` does return the chain, so the caller
  _could_ write the FK after the create call, but "know the id first, insert in any order" is a
  legitimate pattern that `identity.key` does not replace (the key is a lookup handle, not a row
  id).
- **Correlation with an external system** — the caller wants the row id to be the external system's
  id (a Stripe payment intent id, an order number). `identity.key` serves the lookup, but some
  callers want the id itself to be the external handle so that raw database queries and logs are
  immediately readable without joining through the identity index.
- **Deterministic test ids** — tests that assert on specific id values are easier to read and debug
  than tests that capture a generated id and compare. This is minor but real.

The option also carries no weight in _abuse_: no guide documents collision-as-dedup, no example
passes an id expecting upsert behavior, and the conformance suite explicitly tests that dedup wins
over a caller-supplied id. The problem is not that callers misuse `id` — it is that the adapters
handle a misuse in three incompatible ways instead of rejecting it.

## Solution

Keep `id` as an optional assignment field. Make collisions stop being silent. This gives the option
a clear contract:

1. If provided, `id` becomes the row's primary key.
2. If it collides with an existing row, the create fails — the constraint fires.
3. If `identity` matches (dedup), the existing chain is returned and `id` is ignored — identity
   wins, same as today.
4. If not provided, `generateId()` produces the id — same as today.

### No typed collision error

A caller-supplied id collision is a caller bug; a generated id collision is a broken `generateId`.
Neither is a runtime scenario worth catching and branching on. Wrapping the raw driver error in a
typed `DuplicateJobIdError` would require per-adapter constraint mapping — catching `23505` on
PostgreSQL, `SQLITE_CONSTRAINT_PRIMARYKEY` on SQLite, and a `has` check on in-process — three
targeted catches that look similar but aren't, each a maintenance surface when driver libraries
change error shapes. The codebase has no constraint-mapping precedent today; introducing one for a
caller bug is not worth the cost.

The raw driver error surfaces. That is acceptable:

- **A caller-supplied id collision is a bug in the caller's code.** The caller passed an id they
  thought was unique but wasn't. The fix is in their code, not in a `catch` block — and the raw
  error will point them at the constraint that fired, which is more diagnostic than a typed wrapper.
- **A generated id collision is a misconfigured adapter.** It surfaces on the first call in
  development. Same reasoning — the raw error from the driver is the most useful thing to see.

What changes is that the adapters **stop silently swallowing** collisions:

### Adapter changes

**PostgreSQL / SQLite:**

The `ON CONFLICT (chain_id, chain_index) DO UPDATE SET id = job.id` clause currently turns a
collision into a silent no-op return. Remove the `DO UPDATE` fallback — let the constraint reject
the insert. The `ON CONFLICT` clause will be reworked as part of the identity epic anyway (to target
the identity index instead of `(chain_id, chain_index)`); once it targets identity, a caller-supplied
id collision is no longer caught by that clause and falls through to the primary key constraint
naturally.

**In-process:**

Add a `jobs.has(id)` check before `writeJob`. If the id exists and was not matched by dedup, throw
an error. This is cheap (single-threaded, no race) and prevents the current silent overwrite.

**Intra-batch (all adapters):**

Before executing the insert, scan the batch for duplicate caller-supplied ids. If two entries in one
`createChains` call share a caller-supplied id, throw before reaching the database. This is pure
input validation — no concurrency involved — and avoids PostgreSQL's
`ON CONFLICT DO UPDATE command cannot affect row a second time` error leaking.

### `InvalidJobIdError` source

`InvalidJobIdError`'s `source` field keeps both values (`"caller"` and `"generator"`). A
caller-supplied id that fails `validateId` still throws `InvalidJobIdError` with
`source: "caller"` — no change from today.

## Generated IDs can still collide

`generateId` is a public adapter option. The default `randomUUID()` will not collide, but a user can
configure a counter, an under-provisioned `nanoid`, or a deterministic
`generateId: () => hash(input)` written by someone reaching for idempotency. A collision from a
broken generator hits the same constraint as a caller-supplied collision and surfaces the same raw
driver error. This is fine — it is a misconfiguration, not a runtime scenario, and the driver error
points directly at the problem.

## Interaction with `identity`

The precedence is unchanged from today:

1. If `identity` is provided and matches an existing chain, the existing chain is returned with
   `created: false` (currently `deduplicated: true`). The caller's `id`, if any, is ignored.
2. If `identity` is provided and does not match, the chain is created with the caller's `id` (or a
   generated one). The `id` collision check applies normally.
3. If `identity` is not provided, the chain is created with the caller's `id` (or a generated one).
   The `id` collision check applies normally.

`identity` and `id` serve different purposes and do not interact beyond this precedence: `identity`
is the deduplication/lookup handle, `id` is the row's primary key. A caller who wants both
idempotency and a specific id passes both; if identity deduplicates, the `id` is silently unused
(not an error — the chain already exists).

## Decisions

- **Keep and harden, not remove.** The option has legitimate uses (pre-known FK, external
  correlation, deterministic test ids). The problem is undefined collision behavior, not the option
  itself.
- **Hard error, not silent swallow.** A collision is a caller bug (passing a non-unique id) or a
  generator bug (broken `generateId`). Both should fail loudly.
- **Raw driver error, not typed wrapper.** Per-adapter constraint mapping has no precedent in the
  codebase, and the raw error is more diagnostic for what is always a bug. The in-process adapter
  and intra-batch validation throw plain errors since there is no driver involved.
- **No deprecation period.** The current major line is unreleased and the epic is breaking anyway,
  so this rides the same major at no extra release cost.
- **`generateId` stays.** Callers who need control over the id _format_ keep it; this change only
  stops collisions from being silent.

## Dependencies

- **Requires** [chain-identity.md](chain-identity.md) — the identity rework changes the
  `ON CONFLICT` target from `(chain_id, chain_index)` to the identity index; the collision detection
  for caller-supplied ids lands naturally in that rewrite.
- **Simplifies** [chain-identity.md](chain-identity.md) — its "`id` versus `identity`" section
  becomes straightforward: `id` is a primary key assignment, `identity` is a dedup/lookup handle,
  collisions on the former are errors, collisions on the latter are intentional returns.
- Related failure mode, different cause: concurrent same-key creates
  ([#3](https://github.com/kvet/queuert/issues/3)), addressed by
  [chain-identity.md](chain-identity.md).

## Surface

- **Core** — `InvalidJobIdError` unchanged; no new error types.
- **`StateAdapter`** — `id` stays on the `createChains` / `createContinuationJob` job inputs;
  silent collision swallowing removed.
- **Adapters** — PostgreSQL and SQLite drop the `DO UPDATE` fallback on the `ON CONFLICT` clause;
  in-process adds a `has` check; all three validate intra-batch uniqueness of caller-supplied ids.
- **Docs** — `advanced/adapters.md` gains the `generateId` uniqueness requirement, next to the
  existing `generateId` / `validateId` / `idType` docs. The `createChain` / `createChains` /
  `continueWith` reference entries document `id` as assignment-only (collisions are errors, not
  upserts).
- **Migration** — one note for callers relying on the silent upsert: the same `id` passed twice now
  errors instead of silently returning the existing row. Use `identity` for idempotent enqueue.

## Tests

### Conformance (state adapter)

These run against all three adapters (PostgreSQL, SQLite, in-process):

- **Uses caller-supplied id when provided** — existing case, unchanged. A caller-supplied `id`
  becomes the row's primary key and `chainId`.
- **Rejects caller-supplied id that fails `validateId`** — existing case, unchanged. Throws
  `InvalidJobIdError` with `source: "caller"`.
- **Identity wins over caller-supplied id** — existing case (currently "dedup wins over
  caller-supplied id"), renamed to match the identity vocabulary. When both `identity` and `id` are
  supplied and identity matches, the existing chain is returned with `created: false`; the caller's
  `id` is not used.
- **Caller-supplied id collision on `createChains` errors** — create a chain with a caller-supplied
  `id`, then create another chain with the same `id`. The second call throws (raw driver error on
  SQL adapters, plain error on in-process). The first chain is unaffected.
- **Caller-supplied id collision on `createContinuationJob` errors** — same pattern via the
  continuation path.
- **Intra-batch duplicate caller-supplied id errors** — a single `createChains` call with two
  entries sharing a caller-supplied `id` throws before reaching the database. No rows are inserted
  (the batch is atomic).
- **Generated id collision errors** — configure `generateId` to return a constant. The first
  `createChains` call succeeds; the second throws.
- **`InvalidJobIdError` still fires for generator-produced id** — a `generateId` that returns a
  value failing `validateId` throws `InvalidJobIdError` with `source: "generator"`.

### Client-level

- **`createChain` with duplicate id errors** — the error propagates through the client without
  wrapping or swallowing.
- **`createChains` with intra-batch duplicate id errors** — same.
- **`continueWith` outcome with duplicate id errors** — a `continueWith` whose continuation job has
  a caller-supplied `id` that collides with an existing job throws.

### Adapter-specific edge cases

- **In-process: existing row is not overwritten** — after a collision, the original row's
  `typeName`, `input`, and `schedule` are unchanged. Regression guard for the current
  `jobs.set(id, job)` behavior.

## Open questions

- **Batch atomicity on intra-batch collision.** The current proposal rejects the entire batch. An
  alternative is to reject only the colliding entry and insert the rest, but partial success on a
  batch create is a new concept the package does not have today, and the simple "fix your input"
  error is easier to reason about.
