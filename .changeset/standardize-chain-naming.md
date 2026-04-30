---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/redis": major
"@queuert/nats": major
"@queuert/otel": major
"@queuert/dashboard": major
---

Standardize chain naming across the public surface.

**Drop `Job` from `JobChain` everywhere.** The library has only two nouns (`Job` and `Chain`); the qualifier on `JobChain` was redundant. Type names, method names, error names, event names, file names, and prose updated.

**Drop `ById` suffix from `StateAdapter` methods.** When the parameter is already named `jobId`/`chainId`, the suffix earned nothing.

**Qualify ID parameters only where the id is a foreign-key reference.** Top-level methods where the id is the method's subject keep `{ id }` / `{ ids }`; methods where the id is a reference to another entity, and filter shapes where multiple id kinds appear, take qualified `chainId` / `jobId`.

### Renames

| Before                                                                                                                                   | After                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `JobChain`, `JobChainStatus`, `CompletedJobChain`, `ResolvedJobChain`, `JobChainData`                                                    | `Chain`, `ChainStatus`, `CompletedChain`, `ResolvedChain`, `ChainData`                                      |
| `JobChainNotFoundError`                                                                                                                  | `ChainNotFoundError`                                                                                        |
| `Client.startJobChain(s)`, `getJobChain`, `deleteJobChain(s)`, `completeJobChain`, `awaitJobChain`, `listJobChains`, `listJobChainJobs`  | `startChain(s)`, `getChain`, `deleteChain(s)`, `completeChain`, `awaitChain`, `listChains`, `listChainJobs` |
| `StateAdapter.getJobChainById`, `getJobById`, `listJobChains`, `listJobChainJobs`, `deleteJobChains`                                     | `getChain`, `getJob`, `listChains`, `listChainJobs`, `deleteChains`                                         |
| `NotifyAdapter.notifyJobChainCompleted`, `listenJobChainCompleted`                                                                       | `notifyChainCompleted`, `listenChainCompleted`                                                              |
| `ObservabilityAdapter.jobChainCreated`, `jobChainCompleted`, `jobChainDeleted`, `jobChainDuration`                                       | `chainCreated`, `chainCompleted`, `chainDeleted`, `chainDuration`                                           |
| `excludeJobChainIds` (`DeduplicationOptions`)                                                                                            | `excludeChainIds`                                                                                           |
| `listJobs.filter.{ jobChainId, jobChainTypeName }`                                                                                       | `listJobs.filter.{ chainId, chainTypeName }`                                                                |
| Log entry types: `"job_chain_created"`, `"job_chain_completed"`, `"job_chain_deleted"`                                                   | `"chain_created"`, `"chain_completed"`, `"chain_deleted"`                                                   |
| Log entry messages: `"Job chain created"`, `"Job chain completed"`, `"Job chain deleted"`                                                | `"Chain created"`, `"Chain completed"`, `"Chain deleted"`                                                   |
| Log entry data type `JobChainData`                                                                                                       | `ChainData`                                                                                                 |
| OTEL metric names: `queuert.job_chain.created`, `queuert.job_chain.completed`, `queuert.job_chain.deleted`, `queuert.job_chain.duration` | `queuert.chain.created`, `queuert.chain.completed`, `queuert.chain.deleted`, `queuert.chain.duration`       |

> **OTEL dashboards / alerts:** rename queries that reference the old `queuert.job_chain.*` metric names. The metric attributes (`chainTypeName`) are unchanged. The histogram description on `queuert.chain.duration` also changed from "Duration of job chain from creation to completion" to "Duration of chain from creation to completion".
>
> **Log consumers:** if you grep logs by entry `type` or by human-readable `message`, update the strings as shown above. The structured `data` payload shape is unchanged except for type aliases (`JobChainData` → `ChainData`).

### Parameter rule

Top-level methods where the id is the method's subject use `{ id }` / `{ ids }`. Methods where the id is a foreign-key reference (a chain id passed to a job-listing method, a job id passed to a blocker query, or a filter that takes both) use the qualified form.

Unchanged on the Client surface (already qualified):

- `client.listChainJobs({ chainId })` — chain id is a reference; result is jobs.
- `client.listBlockedJobs({ chainId })` — chain id is a reference; result is jobs.
- `client.getJobBlockers({ jobId })` — job id is a reference; result is chains.
- `client.listChains.filter.{ chainId, jobId }` and `client.listJobs.filter.{ jobId, chainId }`.

Renamed parameters on the Client surface:

| Before                                    | After                                  |
| ----------------------------------------- | -------------------------------------- |
| `client.listJobs.filter.jobChainId`       | `client.listJobs.filter.chainId`       |
| `client.listJobs.filter.jobChainTypeName` | `client.listJobs.filter.chainTypeName` |
| `client.listChainJobs({ jobChainId })`    | `client.listChainJobs({ chainId })`    |
| `client.listBlockedJobs({ jobChainId })`  | `client.listBlockedJobs({ chainId })`  |

`StateAdapter` parameters (`chainId`, `jobId`, `chainIds`, `jobIds`) and entity fields (`Job.chainId`, `StateJob.chainId`/`chainTypeName`) are unchanged.

### Migration

TypeScript will flag every wrong call site at compile time — there is no runtime fallback or deprecation period. Bulk-rename the symbols in the table above; for filter shapes, rename `jobChainId` → `chainId` and `jobChainTypeName` → `chainTypeName`. Top-level method params (`{ id }` / `{ ids }`) are unchanged in shape — only the surrounding method names changed.

### Schema migration

Existing PostgreSQL and SQLite databases get a new migration `20260430000000_rename_chain_indexes` that renames three chain-related indexes to drop the `job_` prefix:

| Before                                    | After                                 |
| ----------------------------------------- | ------------------------------------- |
| `{prefix}job_chain_index_idx`             | `{prefix}chain_index_idx`             |
| `{prefix}job_chain_listing_idx`           | `{prefix}chain_listing_idx`           |
| `{prefix}job_chain_listing_type_name_idx` | `{prefix}chain_listing_type_name_idx` |

Postgres uses `ALTER INDEX … RENAME TO`; SQLite has no `ALTER INDEX RENAME`, so the migration drops the old indexes and recreates them under the new names. Both forms run automatically via `migrateToLatest()`. Queries are unaffected — index selection is by definition, not by name.
