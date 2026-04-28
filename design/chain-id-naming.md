# Standardize chain naming across the public surface

Drop `jobChain` / `JobChain` in favor of `chain` / `Chain` everywhere — type names, method names, variable names, parameter keys, error classes, and documentation. Settle the chain-id parameter inconsistency at the same time. Single breaking pass. Addresses the chain-ID naming item in [TODO.md](../TODO.md) and supersedes the "Prefer `jobChain` over `chain`" rule in [code-style.md](../code-style.md#L39-L51).

## Problem

There are two related inconsistencies at the public surface today, and they reinforce each other.

### 1. Four spellings for "an id"

| Method                                                               | Param shape                         | Spelling                                          |
| -------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| `getJobChain`, `deleteJobChain`, `completeJobChain`, `awaitJobChain` | `{ id }`                            | `id` (chain)                                      |
| `triggerJob`, `getJob`                                               | `{ id }`                            | `id` (job)                                        |
| `deleteJobChains`, `triggerJobs`                                     | `{ ids }`                           | `ids` (chain ids vs. job ids — depends on method) |
| `listJobChainJobs`, `listBlockedJobs`                                | `{ jobChainId }`                    | `jobChainId`                                      |
| `getJobBlockers`                                                     | `{ jobId }`                         | `jobId`                                           |
| `listJobChains`                                                      | `{ filter: { id, jobId, … } }`      | `id` (chain) + `jobId` (job-in-chain)             |
| `listJobs`                                                           | `{ filter: { id, jobChainId, … } }` | `id` (job) + `jobChainId` (containing chain)      |

Users have to memorize per-method spellings. Autocomplete cannot disambiguate `id` — inside `listJobChains({ filter: { id } })` it means "chain id"; inside `listJobs({ filter: { id } })` it means "job id"; in `getJobChain({ id })` it's a chain id; in `triggerJob({ id })` it's a job id. The IDE shows `id: string` in all of them.

### 2. The `Job`-prefix-on-`JobChain` is doing no work

The internal contract already disagrees with the public name. `StateAdapter` uses `chainId` (not `jobChainId`); `Job.chainId` is the entity field. The client maps `jobChainId → chainId` in three places today purely to bridge the public and internal names ([client.ts:1008](../packages/core/src/client.ts#L1008), [:1052](../packages/core/src/client.ts#L1052), [:1136](../packages/core/src/client.ts#L1136)).

The current style rule ([code-style.md:39-51](../code-style.md#L39-L51)) says `jobChain` is preferred over `chain` "to be explicit about what's being referenced." But the reference is not actually ambiguous: in a library called Queuert whose only nouns are `Job` and `JobChain`, "chain" can only mean one thing. The rule preserves an `Job` prefix for an unambiguous concept, costs four characters everywhere it appears, and forces the awkward `jobChainId` → `chainId` rebinding inside `Client`.

The two problems are the same problem at different scales: the public API is over-qualified relative to the entity model and the internal contract.

## Proposed

**Drop `Job` from `JobChain` entirely. Apply two simple parameter rules. One breaking pass.**

### Rename rule

Across the codebase, `jobChain` → `chain` and `JobChain` → `Chain`. This applies to:

- Type names: `JobChain`, `CompletedJobChain`, `ResolvedJobChain` → `Chain`, `CompletedChain`, `ResolvedChain`.
- Method names: `getJobChain`, `startJobChain(s)`, `deleteJobChain(s)`, `completeJobChain`, `awaitJobChain`, `listJobChains`, `listJobChainJobs` → `getChain`, `startChain(s)`, `deleteChain(s)`, `completeChain`, `awaitChain`, `listChains`, `listChainJobs`.
- Error classes: `JobChainNotFoundError` → `ChainNotFoundError`.
- Variable / field names: every `jobChain` local, every `jobChainTypeName` filter key, etc.
- Documentation, examples, README, package READMEs, comments.

`Job` stays. The rename is one-directional: the _job_ concept is unaffected, only the _chain_ concept loses its qualifier.

### Parameter rule (post-rename)

After the rename, every chain-id parameter is spelled `chainId` and every job-id parameter is spelled `jobId`. Always. No bare `id` on `Client` methods.

```ts
client.getChain({ chainId });
client.deleteChain({ chainId });
client.completeChain({ chainId, typeName, complete });
client.awaitChain({ chainId }, { timeoutMs });
client.deleteChains({ chainIds });

client.triggerJob({ jobId });
client.getJob({ jobId });
client.triggerJobs({ jobIds });

client.listChainJobs({ chainId });
client.listBlockedJobs({ chainId });
client.getJobBlockers({ jobId });

client.listChains({ filter: { chainId, jobId, status } });
client.listJobs({ filter: { jobId, chainId, status } });
```

The case for "always qualify" over the more REST-conventional `{ id }`-on-the-subject:

1. **The argument that justifies Rule 2 is the same argument at the top level.** A literal `{ id: "..." }` in isolation tells you nothing; an IDE tooltip showing `id: string` tells you nothing; a developer reading a one-line PR diff can't tell if it's a chain or a job. The only thing that makes the bare-`id` form readable is the surrounding method name, which a reader has to keep in their head. Qualifying eliminates the head-juggling.
2. **It matches the entity model.** `Job.chainId` is the field name. `client.getChain({ chainId: job.chainId })` reads as the same word twice, not as a coercion between two conventions.
3. **It matches the internal contract.** `StateAdapter` uses `chainId` / `jobId` everywhere ([state-adapter.ts:70](../packages/core/src/state-adapter/state-adapter.ts#L70), [:193](../packages/core/src/state-adapter/state-adapter.ts#L193)). Removing the `{ id }` aberration on `Client` removes the only place the names disagreed.
4. **One rule replaces two.** Easier to teach, easier to enforce in review, easier for users to predict the spelling without reading docs.

The cost is verbosity — `client.getChain({ chainId })` is six characters longer than `client.getChain({ id })`. That cost lands on every call site. We accept it: the legibility win at every read site outweighs the keystroke cost at every write site, and the keystroke cost is mostly absorbed by autocomplete.

## What changes in `code-style.md`

The "Prefer `jobChain` over `chain`" rule ([code-style.md:39-51](../code-style.md#L39-L51)) is replaced with the inverse:

> ### Use `chain`, not `jobChain`
>
> In variable names, type names, method names, and documentation, use `chain` (not `jobChain`). The library's only nouns are `Job` and `Chain`; the qualifier `Job` adds no information. This applies to the entire public surface — `Chain`, `getChain`, `startChain`, `client.listChainJobs`, etc.
>
> Internal references on entities (`Job.chainId`, `StateAdapter.chainId`) already follow this rule.

## Concrete change list

### `packages/core`

- [client.ts](../packages/core/src/client.ts): rename `Client` methods (`startJobChain` → `startChain`, etc.); rename every `id` / `ids` parameter on chain methods to `chainId` / `chainIds`, every `id` / `ids` on job methods to `jobId` / `jobIds`; drop the `jobChainId → chainId` rebindings at [:1037](../packages/core/src/client.ts#L1037), [:1115](../packages/core/src/client.ts#L1115), and the `chainId: filter?.jobChainId` mapping at [:1008](../packages/core/src/client.ts#L1008). Filter shapes update to qualified names.
- [entities/job-chain.types.ts](../packages/core/src/entities/job-chain.types.ts): `JobChain` → `Chain`, `CompletedJobChain` → `CompletedChain`. File renames to `entities/chain.types.ts`.
- [entities/job-chain.ts](../packages/core/src/entities/job-chain.ts) → `entities/chain.ts`. `mapStateJobPairToJobChain` → `mapStatePairToChain`.
- [entities/job-types.resolvers.ts](../packages/core/src/entities/job-types.resolvers.ts): `ResolvedJobChain` → `ResolvedChain`.
- `errors.ts`: `JobChainNotFoundError` → `ChainNotFoundError`.
- All internal call sites in `implementation/`, `worker/`, `notify-adapter/`, `observability-adapter/`, `setup-helpers.ts`.
- `index.ts` exports update to the new names. No deprecation re-exports — see migration.
- All test suites in `suites/` (~25 call sites in `client-queries.test-suite.ts` alone).

### `packages/postgres`, `packages/sqlite`, `packages/redis`, `packages/nats`, `packages/otel`

- No state-adapter contract changes (already uses `chainId` internally).
- Update spec files that touch renamed types/methods.

### `packages/dashboard`

- API routes that pass `jobChainId` to `listJobs` filter ([routes/jobs.ts:26](../packages/dashboard/src/api/routes/jobs.ts#L26), [:54](../packages/dashboard/src/api/routes/jobs.ts#L54), [routes/chains.ts:46](../packages/dashboard/src/api/routes/chains.ts#L46), [:105](../packages/dashboard/src/api/routes/chains.ts#L105)) — rename to `chainId`.
- UI strings/components: keep current user-facing copy ("Job Chain") if that wording is preferred for end users; the rename is about the API surface, not the UI labels. Confirm during implementation.

### `examples/`

- All examples that call renamed methods or destructure renamed types — `showcase-queries`, every `state-*` and `notify-*` example.
- Variable name conventions in examples shift from `jobChain` to `chain`.

### `docs/`

- All `docs/src/content/docs/` pages — guides, advanced reference, API reference. Bulk find-replace on `jobChain` → `chain`, `JobChain` → `Chain`, plus prose updates for cases where "job chain" was written out (e.g. "a job chain represents…" → "a chain represents…").
- Update [code-style.md](../code-style.md) per the rule replacement above.
- Update package READMEs.
- Update the migration section of the upgrade docs with a before/after table covering both the rename and the parameter changes.

## Migration

This is a typed breaking change on a public surface. TypeScript will flag every wrong call site at compile time — no runtime fallback or deprecation period is needed.

- Single PR, single major-version bump (`@queuert/core` and every adapter package, since types from core flow through).
- Changeset entry tagged as breaking, with a complete rename table.
- No accept-both shim. The cost of a two-name accept-both is exactly the cost the rename is meant to remove (users see two ways to spell the same thing); the typecheck error is the better migration aid.
- Provide a codemod or a `sed` recipe in the changeset notes covering the mechanical renames (`JobChain` → `Chain`, `getJobChain` → `getChain`, etc.) — the rename is purely textual on the surface, so a 10-line script handles 95% of user code.

## Alternatives considered

1. **Status quo.** Four id spellings + over-qualified type names. Costs every user, every time.
2. **Just rename parameters, keep `JobChain` type and method names.** Resolves the parameter inconsistency but leaves `client.getJobChain({ chainId }).chainId` reading with a redundant `Job` qualifier on the method name and not on the field. Half-measure.
3. **Two-rule scheme: bare `{ id }` on top-level methods, qualified ids in filter contexts.** Preserves REST-conventional `{ id }` for the common case. Rejected because the disambiguation argument is no weaker at the top level — `client.getChain({ id })` in a one-line PR diff is exactly as opaque as `filter: { id }`. A single always-qualified rule is easier to teach and removes the only seam where users have to think about which form a method wants.
4. **Rename `Job.chainId` to `Job.id` (chain becomes the implicit subject).** Tempting — `chain.id` is even shorter. But `id` already means "the row's primary key" on every entity; reusing it for "the chain this job belongs to" overloads it. Reject.
5. **Two-phase rollout: parameter rename first, type rename later.** Splits the breaking change into two majors; users pay migration tax twice. Land both together.

## Open questions

- **Dashboard UI copy.** Should "Job Chain" stay in the rendered UI as a more descriptive label for end users, or follow the API rename to "Chain"? The design doc assumes API surface only and defers the UI question to implementation. Default to following the rename unless usability testing pushes back.
- **Codemod scope.** Does the changeset notes block ship with a `sed`/`jscodeshift` snippet, or only a rename table? Lean toward the snippet — the renames are mechanical and scriptable.
- **`Job` prefix elsewhere.** Are there other `Job`-prefixed names that should be reconsidered under the same logic (`JobType`, `JobTypeDefinitions`)? Out of scope for this pass — `Job` is load-bearing on those (it distinguishes job types from, say, an entry-handler type system) and there's no internal/external mismatch driving the change. Revisit only if a follow-up surfaces friction.
