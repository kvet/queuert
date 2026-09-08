# State model — implementation spec

Replaces `StateChainView` / `StateJobView`. `StateChain` and `StateJob` become the entities; `…Info` types are their column sets.

Schema is unchanged — no migration. Cascade deletion stays removed.

## Types

`packages/core/src/state-adapter/state-adapter.ts`

```ts
export type StateJobInfo = {
  id: string;
  typeName: string;
  chainId: string;
  blocked: boolean;
  createdAt: Date;
  input: unknown;
  scheduledAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  continuedToId: string | null;
  output: unknown;
  attempt: number;
  lastAttemptError: string | null;
  lastAttemptAt: Date | null;
  attemptAt: Date | null;
  attemptBy: string | null;
  attemptUntil: Date | null;
  traceContext: string | null;
};

export type StateChainInfo = {
  id: string;
  typeName: string;
  deduplicationKey: string | null;
  createdAt: Date;
  completedAt: Date | null;
  traceContext: string | null;
};

export type StateJobBlockerInfo = {
  jobId: string;
  blockedByChainId: string;
  index: number;
  traceContext: string | null;
};

export type StateChain = StateChainInfo & { head: StateJobInfo; tail: StateJobInfo | undefined };
export type StateJob = StateJobInfo & { chain: StateChainInfo };

/** A blocker row resolved towards the job that waits. */
export type StateBlockedJob = StateJobBlockerInfo & { job: StateJobInfo };

export type StateCount = { count: number; hasMore: boolean };
```

Delete `StateChainView`, `StateJobView`, and the `BlockerReference` import from `errors.js`.

## Vocabulary

A **blocker** is a chain a job waits on. A **blocked job** is the job that waits. Every name follows from those two words:

- `blockers`, `hasBlockers`, `getJobBlockers`, `addJobsBlockers` — looking from the job at the chains it waits on.
- `hasBlockedJobs`, `listBlockedJobs`, `StateBlockedJob` — looking from the chain at the jobs waiting on it.
- `blocked` — the job flag.

`hasBlocking` becomes `hasBlockedJobs`. `StateChainBlocked` is not used.

## Rules

1. **Composites never nest composites.** `chain.head` is a `StateJobInfo` with no `.chain`; `job.chain` is a `StateChainInfo` with no `.head`. `job.chain.head` must not type-check.
2. **`Info` is never the subject of a return.** Every method returns `StateChain` or `StateJob`, or a wrapper whose fields are. `Info` appears only as an embedded field, an attachment on a result (`continueChains`' `continuation`), or a parameter type.
3. **`Info` carries the foreign key; the composite adds the resolved entity.** `StateJob` has both `chainId` and `chain`; `StateBlockedJob` has both `jobId` and `job`.
4. **Batch results match their input.** `getChains`, `getJobs`, `createChains`, `continueChains`, `completeChains`, `rescheduleJobs`, `addJobsBlockers` and `deleteChains` return one entry per input item, in input order: `xxx({ ids: [3, 2] })` → `[{ id: 3 }, { id: 2 }]`. Methods that can miss return `undefined` in that position.

## Adapter interface

```ts
getChains:                (…) => Promise<(StateChain | undefined)[]>;
getJobs:                  (…) => Promise<(StateJob | undefined)[]>;
createChains:             (…) => Promise<(StateChain & { deduplicated: boolean })[]>;
continueChains:           (…) => Promise<(StateJob & { continuation: StateJobInfo })[]>;
completeChains:           (…) => Promise<(StateJob & { hasBlockedJobs: boolean })[]>;
rescheduleJobs:           (…) => Promise<(StateJob | undefined)[]>;
startJobAttempt:          (…) => Promise<(StateJob & { hasBlockers: boolean }) | undefined>;
extendJobAttempt:         (…) => Promise<StateJob>;
reclaimExpiredJobAttempt: (…) => Promise<StateJob | undefined>;

addJobsBlockers: (…) => Promise<(StateJob & { blockers: StateChainInfo[] })[]>;
getJobBlockers:  (params: { jobId: TJobId } & ReadTxContextParam<TTxContext>)
                    => Promise<StateChain[]>;
unblockJobs:     (params: { chainId: TJobId } & WriteTxContextParam<TTxContext>)
                    => Promise<StateBlockedJob[]>;

deleteChains:    (params: { chainIds: TJobId[] } & WriteTxContextParam<TTxContext>)
                    => Promise<(StateChain | StateBlockedJob[] | undefined)[]>;

listChains:      (…) => Promise<Page<StateChain>>;
listJobs:        (…) => Promise<Page<StateJob>>;
listChainJobs:   (…) => Promise<Page<StateJob>>;
listBlockedJobs: (…) => Promise<Page<StateJob>>;
```

Parameters not shown are unchanged; only the names change for `createJobs` → `createChains`, `continueJobs` → `continueChains` and `completeJobs` → `completeChains`.

`extendJobAttempt` now joins `chain_id` to the head row to populate `.chain`; it is a no-op when the job is its own head.

## Behavioural changes

**`rescheduleJobs`** returns the job in its input position once it is rescheduled, and `undefined` when it was not.

**`createChains`** returns the chain, not its head job: a deduplicated hit on a chain that has continued needs its `tail` to report the output. `create-state-jobs.ts` reads the head job's fields from `chain.head`.

**`addJobsBlockers`** returns one entry per `jobBlockers` input: the job after blocking (so `blocked` is current), with `blockers` holding the chain behind each `blockedByChainIds` position, in input order. The caller reads `completedAt` to tell running blockers from completed ones, and `traceContext` to link the blocker span; everything else about the blocker row it passed in itself. Revert the de-duplication introduced by the WIP commit: every input position is stored as its own `job_blocker` row (the key includes `index`), repeated chain ids included, and the `deleteReplacedJobBlockers` statement goes. In `create-state-jobs.ts`, delete the `lastMentionOf` map and start one blocker span per input position again. Still throws `ChainNotFoundError` for a `blockedByChainIds` entry that does not name a chain head.

**`getJobBlockers`** keeps its singular `jobId`. It returns the job's blocker chains as full `StateChain`s, in `index` order; `[]` when the job has no blockers or does not exist. `job-process.ts` maps them through `mapStateChainToChain` for `runningJob.blockers`, and `client.getJobBlockers` returns them.

**`unblockJobs`** keeps a single chain: `chainId` is the chain that just completed. It unblocks every job whose blockers are now all complete, and returns one `StateBlockedJob` per `job_blocker` row pointing at `chainId`, ordered by `jobId`, then `index`. Each `job` reflects its state after the call, so `job.blocked === false` marks a job this call unblocked. Because every row comes back — not only rows of jobs that unblocked — the caller still completes each blocker span when its blocker chain completes.

**`deleteChains`** returns a verdict per input chain. See below.

## `deleteChains` contract

One entry per input chain, in input order:

| entry               | meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `StateChain`        | deleted; nothing outside the set held it                    |
| `StateBlockedJob[]` | refused; every job outside the set that waits on this chain |
| `undefined`         | no such chain                                               |

**If any entry is a refusal, nothing was deleted.** The call is all-or-nothing; pg keeps its `NOT EXISTS (SELECT 1 FROM _external_refs)` gate. The refusal list is not capped.

Do not make deletion partial within a call. The reference check is relative to the whole input set (`j.chain_id != ALL($1)`), so deleting some members while refusing others leaves `job_blocker` rows pointing at deleted chains.

The client maps refusals onto `BlockerReferenceError`: each `StateBlockedJob` becomes `{ chainId: blockedByChainId, referencedByJobId: jobId }`. `client.deleteChains` still returns only the deleted chains, skipping missing ids.

## Call-site changes

| file                                                                           | change                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities/chain.ts`                                                            | `mapStateChainViewToChain({ chain, head, tail })` → `mapStateChainToChain(chain)`; `head.input` → `chain.head.input`; `(tail ?? head).output` → `(chain.tail ?? chain.head).output`                                                     |
| `observability-adapter/observability-helper.ts`                                | mappers take `StateJob` and are named for it; `view.job.x` → `job.x`, `view.chain.id` → `job.chain.id`; `deriveStatus(job)`; chain params become `StateChainInfo`                                                                       |
| `implementation/attempt-outcome.ts`                                            | `FinishResult` → `{ job: StateJob; continuation: StateJobInfo \| null }`                                                                                                                                                                |
| `implementation/complete-job.ts`, `complete-chain.ts`                          | `completeChains`; `hasBlockedJobs`; `unblockJobs({ chainId })`; complete a blocker span per returned row; notify and emit `jobUnblocked` for rows whose `job.blocked === false`                                                         |
| `implementation/create-state-jobs.ts`, `continue-chain.ts`, `create-chains.ts` | `createChains` / `continueChains`; drop `lastMentionOf`; `fromView` → `fromJob`                                                                                                                                                         |
| `worker/job-process.ts`                                                        | `finished.job.job.output` → `finished.job.output`; `mapStateChainViewToChain` → `mapStateChainToChain` for blockers                                                                                                                     |
| `client.ts`                                                                    | `classified` / `chainPair` → `chain`; `stateJobView` / `view` → `job`; `deleteChains` verdicts; `rescheduleJobs` `undefined` entries                                                                                                    |
| `state-adapter/state-adapter.in-process.ts`                                    | rewrite mappers and methods                                                                                                                                                                                                             |
| postgres / sqlite adapters                                                     | `mapDbJobRowToStateJobView` → `mapDbJobRowToStateJob` (spread `…Info` + `chain`); same for chain rows; renamed methods; `getJobBlockers`, `unblockJobs`, `addJobsBlockers`, `rescheduleJobs` and `deleteChains` per the contracts above |
| logging wrapper, spy and in-process spec helpers                               | renamed methods                                                                                                                                                                                                                         |
| `conformance/state-adapter-cases/*`                                            | `const [{ job: x }]` → `const [x]`; `result.job.y` → `result.y`; rename `create-jobs.ts` / `continue-jobs.ts` / `complete-jobs.ts` groups; cases for input order, `undefined` positions and the verdicts                                |
| `.changeset/head-row-chain-model.md`                                           | describe `StateChain` / `StateJob`, the renames and the new contracts instead of the views                                                                                                                                              |

Remove the `TODO!!!` comments this work resolves.

## Open

- `jobUnblocked` needs the unblocked job's `chainTypeName`, but `StateBlockedJob.job` is a `StateJobInfo` with no chain. Either `unblockJobs` returns `job: StateJob` for this one method, or the observability event drops the chain type.
- `Info` vs `Fields` as the fragment suffix.
