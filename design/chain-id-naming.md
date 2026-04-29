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

The internal contract already disagrees with the public name. `StateAdapter` parameters use `chainId` (not `jobChainId`); `Job.chainId` is the entity field. The client maps `jobChainId → chainId` in three places today purely to bridge the public and internal names ([client.ts:1008](../packages/core/src/client.ts#L1008), [:1052](../packages/core/src/client.ts#L1052), [:1136](../packages/core/src/client.ts#L1136)). The drift is already visible in code: [`ResolvedChainJobs`](../packages/core/src/entities/job-types.resolvers.ts#L239) and [`WaitChainTimeoutError`](../packages/core/src/errors.ts) already drop the `Job` qualifier, the existing style rule notwithstanding.

The current style rule ([code-style.md:39-51](../code-style.md#L39-L51)) says `jobChain` is preferred over `chain` "to be explicit about what's being referenced." But the reference is not actually ambiguous: in a library called Queuert whose only nouns are `Job` and `JobChain`, "chain" can only mean one thing. The rule preserves a `Job` prefix for an unambiguous concept, costs four characters everywhere it appears, and forces the awkward `jobChainId` → `chainId` rebinding inside `Client`.

The two problems are the same problem at different scales: the public API is over-qualified relative to the entity model and the internal contract.

## Proposed

**Drop `Job` from `JobChain` entirely. Apply two simple parameter rules. One breaking pass.**

### Rename rule

Across the codebase, `jobChain` → `chain` and `JobChain` → `Chain`. This applies to:

- Type names: `JobChain`, `CompletedJobChain`, `ResolvedJobChain`, `JobChainData`, `JobChainStatus` → `Chain`, `CompletedChain`, `ResolvedChain`, `ChainData`, `ChainStatus`.
- `Client` method names: `getJobChain`, `startJobChain(s)`, `deleteJobChain(s)`, `completeJobChain`, `awaitJobChain`, `listJobChains`, `listJobChainJobs` → `getChain`, `startChain(s)`, `deleteChain(s)`, `completeChain`, `awaitChain`, `listChains`, `listChainJobs`.
- `StateAdapter` method names: `getJobChainById`, `listJobChains`, `listJobChainJobs`, `deleteJobChains` → `getChainById`, `listChains`, `listChainJobs`, `deleteChains`.
- `NotifyAdapter` method names: `notifyJobChainCompleted`, `listenJobChainCompleted` → `notifyChainCompleted`, `listenChainCompleted`.
- `ObservabilityAdapter` event names: `jobChainCreated`, `jobChainCompleted`, `jobChainDeleted`, `jobChainDuration` → `chainCreated`, `chainCompleted`, `chainDeleted`, `chainDuration`.
- Error classes: `JobChainNotFoundError` → `ChainNotFoundError`.
- Field / option names on the public surface: `jobChainTypeName` filter key, `excludeJobChainIds` on `DeduplicationOptions`, every `jobChain` local — all become `chain*`.
- Documentation, examples, README, package READMEs, comments.

`Job` stays. The rename is one-directional: the _job_ concept is unaffected, only the _chain_ concept loses its qualifier. Note that `chainTypeName` (a chain-typed namespace, not the noun "chain" itself) is unaffected — it is already the disambiguated form and stays as-is.

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
2. **It matches the foreign-key shape on `Job`.** `Job.chainId` is the field that points at a chain. `client.getChain({ chainId: job.chainId })` reads as the same word twice. The chain's _own_ primary key is still `Chain.id` (per Alt #4 below — `id` always means "this row's PK"), so when the chain is already in hand you write `client.getChain({ chainId: chain.id })`. That asymmetry is intentional: cross-entity references qualify, intra-entity identity does not.
3. **It matches the internal contract.** `StateAdapter` parameters use `chainId` / `jobId` everywhere ([state-adapter.ts:78](../packages/core/src/state-adapter/state-adapter.ts#L78), [:91](../packages/core/src/state-adapter/state-adapter.ts#L91)). Removing the `{ id }` aberration on `Client` removes the only place the names disagreed.
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
- [state-adapter/state-adapter.ts](../packages/core/src/state-adapter/state-adapter.ts): rename `getJobChainById`, `listJobChains`, `listJobChainJobs`, `deleteJobChains` (parameters already correct).
- [notify-adapter/notify-adapter.ts](../packages/core/src/notify-adapter/notify-adapter.ts): rename `notifyJobChainCompleted`, `listenJobChainCompleted` ([:32-34](../packages/core/src/notify-adapter/notify-adapter.ts#L32-L34)). All wrappers under `notify-adapter/` and the in-process implementation update accordingly.
- [observability-adapter/observability-adapter.ts](../packages/core/src/observability-adapter/observability-adapter.ts): rename `JobChainData` and the `jobChain*` event methods ([:175-193](../packages/core/src/observability-adapter/observability-adapter.ts#L175-L193)).
- [entities/job-chain.types.ts](../packages/core/src/entities/job-chain.types.ts): `JobChain`, `CompletedJobChain`, `JobChainStatus` → `Chain`, `CompletedChain`, `ChainStatus`. File renames to `entities/chain.types.ts`.
- [entities/job-chain.ts](../packages/core/src/entities/job-chain.ts) → `entities/chain.ts`. `mapStateJobPairToJobChain` → `mapStatePairToChain`.
- [entities/job-types.resolvers.ts](../packages/core/src/entities/job-types.resolvers.ts): `ResolvedJobChain` → `ResolvedChain`.
- [entities/deduplication.ts](../packages/core/src/entities/deduplication.ts): `excludeJobChainIds` → `excludeChainIds` (also threads through `state-adapter.ts:110` and the in-process adapter).
- `errors.ts`: `JobChainNotFoundError` → `ChainNotFoundError`.
- All internal call sites: `implementation/`, `worker/`, `helpers/notify-hooks.ts`, `helpers/observability-hooks.ts`, `setup-helpers.ts`.
- `index.ts` exports update to the new names. No deprecation re-exports — see migration.
- All test suites in `suites/` (~25 call sites in `client-queries.test-suite.ts` alone) and `conformance/` cases.

### `packages/postgres`, `packages/sqlite`, `packages/redis`, `packages/nats`, `packages/otel`, `packages/dashboard`

- State adapter implementations (`postgres`, `sqlite`, in-process) update method names to match the renamed `StateAdapter` contract — parameter names are already correct.
- Notify adapter implementations (`postgres`, `redis`, `nats`) update method names to match the renamed `NotifyAdapter` contract.
- `@queuert/otel` updates `ObservabilityAdapter` event names and the `JobChainData` import.
- `packages/dashboard` API routes pass `jobChainId` to `listJobs` filter at [routes/jobs.ts:26](../packages/dashboard/src/api/routes/jobs.ts#L26), [:54](../packages/dashboard/src/api/routes/jobs.ts#L54), [routes/chains.ts:46](../packages/dashboard/src/api/routes/chains.ts#L46), [:105](../packages/dashboard/src/api/routes/chains.ts#L105) — rename to `chainId`. Method calls (`getJobChain`, `listJobChainJobs`, `deleteJobChains`) rename per `Client`.
- Spec files that touch renamed types/methods update across all packages.

### Dashboard UI copy

The rename is API-surface only. End-user-facing UI labels in `packages/dashboard` keep "Job Chain" as the rendered string — the disambiguation argument that justifies dropping the `Job` qualifier on the API side ("the only nouns are `Job` and `Chain`") doesn't transfer to a non-developer reader looking at a dashboard, who benefits from the more descriptive label. Internal component / variable names follow the rename; rendered strings do not.

### `examples/`

- All examples that call renamed methods or destructure renamed types — `showcase-queries`, every `state-*` and `notify-*` example.
- Variable name conventions in examples shift from `jobChain` to `chain`.

### `docs/`

- All `docs/src/content/docs/` pages — guides, advanced reference, API reference. Bulk find-replace on `jobChain` → `chain`, `JobChain` → `Chain`, plus prose updates for cases where "job chain" was written out (e.g. "a job chain represents…" → "a chain represents…").
- Update [code-style.md](../code-style.md) per the rule replacement above.
- Update package READMEs.
- Update the migration section of the upgrade docs with a before/after table covering both the rename and the parameter changes.

## Migration

This is a typed breaking change on a public surface. TypeScript will flag every wrong call site at compile time — no runtime fallback or deprecation period is needed. Premise: Queuert is pre-1.0; we accept the migration tax this generation in exchange for a coherent surface for everything that comes after.

- Single PR, single coordinated major-version bump across `@queuert/core`, `@queuert/postgres`, `@queuert/sqlite`, `@queuert/redis`, `@queuert/nats`, `@queuert/otel`, `@queuert/dashboard`. Adapter contracts (state, notify, observability) all change, so every adapter package needs the bump even if its only diff is method names.
- Changeset entry tagged as breaking, with a complete rename table covering type names, `Client` methods, adapter contract methods, error class, and field/option renames.
- No accept-both shim. The cost of a two-name accept-both is exactly the cost the rename is meant to remove (users see two ways to spell the same thing); the typecheck error is the better migration aid.
- Ship a `jscodeshift` transform (not a raw `sed` recipe) scoped to imports from `queuert*` packages and the known renamed identifiers. A naive `s/JobChain/Chain/g` would mangle user code that legitimately contains the substring `JobChain` in unrelated identifiers; a scoped transform is worth the additional setup cost given how visible the surface is.

## Alternatives considered

1. **Status quo.** Four id spellings + over-qualified type names. Costs every user, every time.
2. **Just rename parameters, keep `JobChain` type and method names.** Resolves the parameter inconsistency but leaves `client.getJobChain({ chainId }).chainId` reading with a redundant `Job` qualifier on the method name and not on the field. Half-measure.
3. **Two-rule scheme: bare `{ id }` on top-level methods, qualified ids in filter contexts.** Preserves REST-conventional `{ id }` for the common case. Rejected because the disambiguation argument is no weaker at the top level — `client.getChain({ id })` in a one-line PR diff is exactly as opaque as `filter: { id }`. A single always-qualified rule is easier to teach and removes the only seam where users have to think about which form a method wants.
4. **Rename `Job.chainId` to `Job.id` (chain becomes the implicit subject).** Tempting — `chain.id` is even shorter. But `id` already means "the row's primary key" on every entity; reusing it for "the chain this job belongs to" overloads it. Reject.
5. **Two-phase rollout: parameter rename first, type rename later.** Splits the breaking change into two majors; users pay migration tax twice. Land both together.

## Open questions

- **`Job` prefix elsewhere.** Are there other `Job`-prefixed names that should be reconsidered under the same logic (`JobType`, `JobTypeDefinitions`)? Out of scope for this pass — `Job` is load-bearing on those (it distinguishes job types from, say, an entry-handler type system) and there's no internal/external mismatch driving the change. Revisit only if a follow-up surfaces friction.
