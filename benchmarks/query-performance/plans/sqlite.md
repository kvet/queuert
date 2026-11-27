# SQLite query plans

Plans of every statement each query-performance case runs, at scale 100, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun `pnpm start` after a query or index change and review the diff.

## getChains/default

1. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChains/lock

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChains/batch100

1. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChains/lockBatch100

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChainTails/default

1. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChainTails/lock

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChainTails/batch100

1. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChainTails/lockBatch100

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChainTails/lockBlockers

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getChainTails/lockBlockersBatch100

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getChains`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## getJobs/default

1. `getJobs`

```
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## getJobs/lock

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getJobs`

```
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## getJobs/batch100

1. `getJobs`

```
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## getJobs/lockBatch100

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getJobs`

```
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## getWorkers/default

1. `getWorkers`

```
SCAN queuert_worker
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
```

## getWorkers/lock

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getWorkers`

```
SCAN queuert_worker
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
```

## getWorkers/batch100

1. `getWorkers`

```
SCAN queuert_worker
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
```

## getWorkers/lockBatch100

1. `takeWriteLock`

```
SCAN queuert_write_lock
```

2. `getWorkers`

```
SCAN queuert_worker
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
```

## createJobs/default

1. `insertChains`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
```

## createJobs/deduplication

1. `findDeduplicatedJobs`

```
SCAN je VIRTUAL TABLE INDEX 1:
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 2
SEARCH h USING INDEX queuert_chain_deduplication_idx (chain_deduplication_key=?)
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 3
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `insertChains`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
```

## createJobs/batch100

1. `insertChains`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
```

## createJobs/deduplicationBatch100

1. `findDeduplicatedJobs`

```
SCAN je VIRTUAL TABLE INDEX 1:
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 2
SEARCH h USING INDEX queuert_chain_deduplication_idx (chain_deduplication_key=?)
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 3
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `insertChains`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
```

## continueJobs/default

1. `insertContinuations`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
SEARCH p USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
```

2. `completeContinuedJobs`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 3
SCAN queuert_schema_fence_v2
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN je VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
CORRELATED SCALAR SUBQUERY 4
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 5
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## continueJobs/batch100

1. `insertContinuations`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
SEARCH p USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
```

2. `completeContinuedJobs`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 3
SCAN queuert_schema_fence_v2
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN je VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
CORRELATED SCALAR SUBQUERY 4
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 5
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## addJobsBlockers/default

1. `insertJobBlockers`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
SEARCH h EXISTS USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `getBlockerChains`

```
SCAN je VIRTUAL TABLE INDEX 1:
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

3. `blockJobsAndFlagBlockerHeads`

```
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 3
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 4
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SCALAR SUBQUERY 5
SCAN queuert_schema_fence_v2
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
CORRELATED SCALAR SUBQUERY 6
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 11
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 12
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## addJobsBlockers/batch100

1. `insertJobBlockers`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
SEARCH h EXISTS USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `getBlockerChains`

```
SCAN je VIRTUAL TABLE INDEX 1:
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

3. `blockJobsAndFlagBlockerHeads`

```
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 3
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 4
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SCALAR SUBQUERY 5
SCAN queuert_schema_fence_v2
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
CREATE BLOOM FILTER
CORRELATED SCALAR SUBQUERY 6
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 11
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 12
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## getJobsBlockers/default

1. `getJobsBlockers`

```
SEARCH b USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

## getJobsBlockers/manyBlockers

1. `getJobsBlockers`

```
SEARCH b USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

## getJobsBlockers/batch100

1. `getJobsBlockers`

```
SEARCH b USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

## unblockJobs/default

1. `hasChainDependents`

```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SEARCH jb USING COVERING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
```

2. `scheduleBlockedJobs`

```
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
SCALAR SUBQUERY 3
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 2
SEARCH jb USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?) LEFT-JOIN
```

3. `getChainJobBlockersWithJobs`

```
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
```

## unblockJobs/batch100

1. `hasChainDependents`

```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SEARCH jb USING COVERING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
```

2. `scheduleBlockedJobs`

```
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
SCALAR SUBQUERY 3
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 2
SEARCH jb USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?) LEFT-JOIN
```

3. `getChainJobBlockersWithJobs`

```
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
USE TEMP B-TREE FOR ORDER BY
```

## startWorker/default

1. `startWorker`

```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN queuert_schema_fence_v2
```

## startWorker/batch100

1. `startWorker`

```
SCAN CONSTANT ROW
SCALAR SUBQUERY 1
SCAN queuert_schema_fence_v2
```

## extendWorkerLease/default

1. `extendWorkerLease`

```
SEARCH queuert_worker USING INDEX sqlite_autoindex_queuert_worker_1 (id=?)
SCALAR SUBQUERY 1
SCAN queuert_schema_fence_v2
```

## stopWorker/default

1. `stopWorker`

```
SEARCH queuert_worker USING INDEX sqlite_autoindex_queuert_worker_1 (id=?)
SCALAR SUBQUERY 1
SCAN queuert_schema_fence_v2
```

## startJobAttempts/default

1. `startJobAttempts`

```
SEARCH queuert_job USING COVERING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 5
MATERIALIZE candidate_jobs
CO-ROUTINE (subquery-15)
SCAN t VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED LIST SUBQUERY 1
SEARCH p USING INDEX queuert_job_pending_idx (type_name=? AND scheduled_at<?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-15)
MATERIALIZE acquired_batches
SCAN candidate_jobs
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
SCAN b
BLOOM FILTER ON c (batch_index=? AND type_name=?)
SEARCH c USING AUTOMATIC COVERING INDEX (batch_index=? AND type_name=?)
SCALAR SUBQUERY 4
SEARCH queuert_worker USING INDEX sqlite_autoindex_queuert_worker_1 (id=?)
SCALAR SUBQUERY 6
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 11
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 12
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 13
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 14
SEARCH jb USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
```

## startJobAttempts/limit100

1. `startJobAttempts`

```
SEARCH queuert_job USING COVERING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 5
MATERIALIZE candidate_jobs
CO-ROUTINE (subquery-15)
SCAN t VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED LIST SUBQUERY 1
SEARCH p USING INDEX queuert_job_pending_idx (type_name=? AND scheduled_at<?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-15)
MATERIALIZE acquired_batches
SCAN candidate_jobs
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
SCAN b
BLOOM FILTER ON c (batch_index=? AND type_name=?)
SEARCH c USING AUTOMATIC COVERING INDEX (batch_index=? AND type_name=?)
SCALAR SUBQUERY 4
SEARCH queuert_worker USING INDEX sqlite_autoindex_queuert_worker_1 (id=?)
SCALAR SUBQUERY 6
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 11
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 12
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 13
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 14
SEARCH jb USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
```

## startJobAttempts/batchLimit10

1. `startJobAttempts`

```
SEARCH queuert_job USING COVERING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 5
MATERIALIZE candidate_jobs
CO-ROUTINE (subquery-15)
SCAN t VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED LIST SUBQUERY 1
SEARCH p USING INDEX queuert_job_pending_idx (type_name=? AND scheduled_at<?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-15)
MATERIALIZE acquired_batches
SCAN candidate_jobs
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
SCAN b
BLOOM FILTER ON c (batch_index=? AND type_name=?)
SEARCH c USING AUTOMATIC COVERING INDEX (batch_index=? AND type_name=?)
SCALAR SUBQUERY 4
SEARCH queuert_worker USING INDEX sqlite_autoindex_queuert_worker_1 (id=?)
SCALAR SUBQUERY 6
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 11
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 12
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 13
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 14
SEARCH jb USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
```

## startJobAttempts/batch100

1. `startJobAttempts`

```
SEARCH queuert_job USING COVERING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 5
MATERIALIZE candidate_jobs
CO-ROUTINE (subquery-15)
SCAN t VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED LIST SUBQUERY 1
SEARCH p USING INDEX queuert_job_pending_idx (type_name=? AND scheduled_at<?)
USE TEMP B-TREE FOR ORDER BY
SCAN (subquery-15)
MATERIALIZE acquired_batches
SCAN candidate_jobs
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
SCAN b
BLOOM FILTER ON c (batch_index=? AND type_name=?)
SEARCH c USING AUTOMATIC COVERING INDEX (batch_index=? AND type_name=?)
SCALAR SUBQUERY 4
SEARCH queuert_worker USING INDEX sqlite_autoindex_queuert_worker_1 (id=?)
SCALAR SUBQUERY 6
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 10
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 11
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 12
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 13
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 14
SEARCH jb USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
```

## completeJobs/default

1. `completeJobs`

```
MATERIALIZE ids
MERGE (UNION)
LEFT
MATERIALIZE targets
SCAN je VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SCAN targets
SCALAR SUBQUERY 10
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
RIGHT
SCAN targets
SCALAR SUBQUERY 10
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
SCAN ids
SCALAR SUBQUERY 10
SCAN queuert_schema_fence_v2
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 4
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 3
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 6
BLOOM FILTER ON tg (chain_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (chain_id=?)
CORRELATED SCALAR SUBQUERY 6
BLOOM FILTER ON tg (chain_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (chain_id=?)
```

## completeJobs/batch100

1. `completeJobs`

```
MATERIALIZE ids
MERGE (UNION)
LEFT
MATERIALIZE targets
SCAN je VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SCAN targets
SCALAR SUBQUERY 10
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
RIGHT
SCAN targets
SCALAR SUBQUERY 10
SCAN queuert_schema_fence_v2
USE TEMP B-TREE FOR ORDER BY
SCAN ids
SCALAR SUBQUERY 10
SCAN queuert_schema_fence_v2
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 4
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 5
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 3
BLOOM FILTER ON tg (job_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (job_id=?)
CORRELATED SCALAR SUBQUERY 6
BLOOM FILTER ON tg (chain_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (chain_id=?)
CORRELATED SCALAR SUBQUERY 6
BLOOM FILTER ON tg (chain_id=?)
SEARCH tg USING AUTOMATIC COVERING INDEX (chain_id=?)
```

## getStartAttemptDelayMs/default

1. `getStartAttemptDelayMs`

```
SEARCH job USING COVERING INDEX queuert_job_pending_idx (type_name=?)
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR ORDER BY
```

## getStartAttemptDelayMs/batch100

1. `getStartAttemptDelayMs`

```
SEARCH job USING COVERING INDEX queuert_job_pending_idx (type_name=?)
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR ORDER BY
```

## rescheduleJobs/default

1. `rescheduleJobs`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 4
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 5
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## rescheduleJobs/batch100

1. `rescheduleJobs`

```
SCAN je VIRTUAL TABLE INDEX 1:
SCALAR SUBQUERY 2
SCAN queuert_schema_fence_v2
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 3
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 4
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 5
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 6
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 7
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 8
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
CORRELATED SCALAR SUBQUERY 9
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## deleteChains/default

1. `getChainsByChainIds`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `clearUnreferencedBlockerHeads`

```
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 5
SEARCH queuert_job_blocker USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 4
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
LIST SUBQUERY 6
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
CREATE BLOOM FILTER
SCALAR SUBQUERY 9
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 8
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
LIST SUBQUERY 7
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
CREATE BLOOM FILTER
```

3. `deleteBlockersByChainIds`

```
SEARCH queuert_job_blocker USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 3
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
SCALAR SUBQUERY 4
SCAN queuert_schema_fence_v2
```

4. `deleteChains`

```
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
SCALAR SUBQUERY 3
SCAN queuert_schema_fence_v2
```

## deleteChains/multiJob

1. `getChainsByChainIds`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `clearUnreferencedBlockerHeads`

```
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 5
SEARCH queuert_job_blocker USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 4
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
LIST SUBQUERY 6
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
CREATE BLOOM FILTER
SCALAR SUBQUERY 9
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 8
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
LIST SUBQUERY 7
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
CREATE BLOOM FILTER
```

3. `deleteBlockersByChainIds`

```
SEARCH queuert_job_blocker USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 3
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
SCALAR SUBQUERY 4
SCAN queuert_schema_fence_v2
```

4. `deleteChains`

```
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
SCALAR SUBQUERY 3
SCAN queuert_schema_fence_v2
```

## deleteChains/batch100

1. `getChainsByChainIds`

```
SEARCH head_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `clearUnreferencedBlockerHeads`

```
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 5
SEARCH queuert_job_blocker USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 4
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
LIST SUBQUERY 6
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
CREATE BLOOM FILTER
SCALAR SUBQUERY 9
SCAN queuert_schema_fence_v2
CORRELATED SCALAR SUBQUERY 8
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
LIST SUBQUERY 7
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
CREATE BLOOM FILTER
```

3. `deleteBlockersByChainIds`

```
SEARCH queuert_job_blocker USING COVERING INDEX sqlite_autoindex_queuert_job_blocker_1 (job_id=?)
LIST SUBQUERY 3
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
SCALAR SUBQUERY 4
SCAN queuert_schema_fence_v2
```

4. `deleteChains`

```
MULTI-INDEX OR
INDEX 1
LIST SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
LIST SUBQUERY 2
SCAN json_each VIRTUAL TABLE INDEX 1:
SEARCH queuert_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
SCALAR SUBQUERY 3
SCAN queuert_schema_fence_v2
```

## getChainTypeNames/default

1. `getChainTypeNames`

```
CO-ROUTINE types
SETUP
SEARCH queuert_job USING COVERING INDEX queuert_chain_idx
RECURSIVE STEP
SCAN types
CORRELATED SCALAR SUBQUERY 2
SEARCH queuert_job USING COVERING INDEX queuert_chain_idx (type_name>?)
SCAN types
```

## getJobTypeNames/default

1. `getJobTypeNames`

```
CO-ROUTINE types
SETUP
SEARCH queuert_job USING COVERING INDEX queuert_job_idx
RECURSIVE STEP
SCAN types
CORRELATED SCALAR SUBQUERY 2
SEARCH queuert_job USING COVERING INDEX queuert_job_idx (type_name>?)
SCAN types
```

## countChainsByTypeName/default

1. `countChainsByTypeName`

```
SCAN je VIRTUAL TABLE INDEX 1:
CORRELATED SCALAR SUBQUERY 2
CO-ROUTINE (subquery-1)
SEARCH queuert_job USING COVERING INDEX queuert_chain_running_idx (type_name=?)
SCAN (subquery-1)
CORRELATED SCALAR SUBQUERY 4
CO-ROUTINE (subquery-3)
SEARCH queuert_job USING COVERING INDEX queuert_chain_completed_idx (type_name=?)
SCAN (subquery-3)
```

## countChainsByTypeName/batch100

1. `countChainsByTypeName`

```
SCAN je VIRTUAL TABLE INDEX 1:
CORRELATED SCALAR SUBQUERY 2
CO-ROUTINE (subquery-1)
SEARCH queuert_job USING COVERING INDEX queuert_chain_running_idx (type_name=?)
SCAN (subquery-1)
CORRELATED SCALAR SUBQUERY 4
CO-ROUTINE (subquery-3)
SEARCH queuert_job USING COVERING INDEX queuert_chain_completed_idx (type_name=?)
SCAN (subquery-3)
```

## countJobsByTypeName/default

1. `countJobsByTypeName`

```
SCAN je VIRTUAL TABLE INDEX 1:
CORRELATED SCALAR SUBQUERY 2
CO-ROUTINE (subquery-1)
SEARCH queuert_job USING COVERING INDEX queuert_job_blocked_idx (type_name=?)
SCAN (subquery-1)
CORRELATED SCALAR SUBQUERY 4
CO-ROUTINE (subquery-3)
SEARCH queuert_job USING COVERING INDEX queuert_job_pending_idx (type_name=?)
SCAN (subquery-3)
CORRELATED SCALAR SUBQUERY 6
CO-ROUTINE (subquery-5)
SEARCH queuert_job USING COVERING INDEX queuert_job_running_idx (type_name=?)
SCAN (subquery-5)
CORRELATED SCALAR SUBQUERY 8
CO-ROUTINE (subquery-7)
SEARCH queuert_job USING COVERING INDEX queuert_job_completed_idx (type_name=?)
SCAN (subquery-7)
```

## countJobsByTypeName/batch100

1. `countJobsByTypeName`

```
SCAN je VIRTUAL TABLE INDEX 1:
CORRELATED SCALAR SUBQUERY 2
CO-ROUTINE (subquery-1)
SEARCH queuert_job USING COVERING INDEX queuert_job_blocked_idx (type_name=?)
SCAN (subquery-1)
CORRELATED SCALAR SUBQUERY 4
CO-ROUTINE (subquery-3)
SEARCH queuert_job USING COVERING INDEX queuert_job_pending_idx (type_name=?)
SCAN (subquery-3)
CORRELATED SCALAR SUBQUERY 6
CO-ROUTINE (subquery-5)
SEARCH queuert_job USING COVERING INDEX queuert_job_running_idx (type_name=?)
SCAN (subquery-5)
CORRELATED SCALAR SUBQUERY 8
CO-ROUTINE (subquery-7)
SEARCH queuert_job USING COVERING INDEX queuert_job_completed_idx (type_name=?)
SCAN (subquery-7)
```

## countWorkers/default

1. `countWorkers`

```
SCAN queuert_worker
```

## countWorkersByTypeName/default

1. `countWorkersByTypeName`

```
MATERIALIZE counts
SCAN w
SCAN wt VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR count(DISTINCT)
USE TEMP B-TREE FOR count(DISTINCT)
SCAN t VIRTUAL TABLE INDEX 1:
BLOOM FILTER ON c (type_name=?)
SEARCH c USING AUTOMATIC COVERING INDEX (type_name=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

## countWorkersByTypeName/batch100

1. `countWorkersByTypeName`

```
MATERIALIZE counts
SCAN w
SCAN wt VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR count(DISTINCT)
USE TEMP B-TREE FOR count(DISTINCT)
SCAN t VIRTUAL TABLE INDEX 1:
BLOOM FILTER ON c (type_name=?)
SEARCH c USING AUTOMATIC COVERING INDEX (type_name=?) LEFT-JOIN
USE TEMP B-TREE FOR ORDER BY
```

## countRunningJobsByWorkerId/default

1. `countRunningJobsByWorkerId`

```
SCAN w VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX queuert_job_attempt_by_idx (attempt_by=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
```

## countRunningJobsByWorkerId/batch100

1. `countRunningJobsByWorkerId`

```
SCAN w VIRTUAL TABLE INDEX 1:
SEARCH j USING INDEX queuert_job_attempt_by_idx (attempt_by=?) LEFT-JOIN
USE TEMP B-TREE FOR GROUP BY
```

## listJobs/noStatus/default

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/noStatus/fromTo

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=? AND created_at>? AND created_at<?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/noStatus/cursor

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/pending/default

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_pending_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/pending/fromTo

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_pending_idx (type_name=? AND scheduled_at>? AND scheduled_at<?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/pending/orderByCreatedAt

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/pending/cursor

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_pending_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_pending_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/blocked/default

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_blocked_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/blocked/fromTo

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_blocked_idx (type_name=? AND scheduled_at>? AND scheduled_at<?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/blocked/orderByCreatedAt

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/blocked/cursor

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_blocked_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_blocked_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/running/default

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_running_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/running/orderByCreatedAt

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/running/cursor

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_running_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_running_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/completed/default

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/completed/orderByCreatedAt

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listJobs/completed/cursor

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listChains/noStatus/default

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/noStatus/nonBlocking

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/noStatus/blocking

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_blocking_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/noStatus/fromTo

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=? AND created_at>? AND created_at<?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/noStatus/cursor

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/running/default

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_running_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/running/nonBlocking

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_running_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/running/blocking

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_blocking_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/running/cursor

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_running_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_running_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/default

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/nonBlocking

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/blocking

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_blocking_idx (type_name=?)
USE TEMP B-TREE FOR ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/orderByCreatedAt

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/orderByCompletedAt

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/cursor

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/orderByCreatedAtCursor

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChains/completed/orderByCompletedAtCursor

1. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

2. `dynamic`

```
CO-ROUTINE head_job
SEARCH head_job USING INDEX queuert_chain_completed_idx (type_name=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN head_job
SEARCH tail_job USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 2
SEARCH t USING COVERING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
```

## listChainJobs/default

1. `dynamic`

```
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
MULTI-INDEX OR
INDEX 1
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
SEARCH j USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
USE TEMP B-TREE FOR ORDER BY
```

## listChainJobs/cursor

1. `dynamic`

```
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
MULTI-INDEX OR
INDEX 1
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
SEARCH j USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
USE TEMP B-TREE FOR ORDER BY
```

2. `dynamic`

```
SEARCH c USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
MULTI-INDEX OR
INDEX 1
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
INDEX 2
SEARCH j USING INDEX queuert_chain_index_idx (chain_id=? AND chain_index>?)
USE TEMP B-TREE FOR ORDER BY
```

## listBlockedJobs/default

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listBlockedJobs/cursor

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
LIST SUBQUERY 1
SEARCH jb USING INDEX queuert_job_blocker_chain_idx (blocked_by_chain_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listWorkers/default

1. `dynamic`

```
SCAN w USING INDEX queuert_worker_idx
CORRELATED SCALAR SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

## listWorkers/typeName

1. `dynamic`

```
SCAN w USING INDEX queuert_worker_idx
CORRELATED SCALAR SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

## listWorkers/status

1. `dynamic`

```
SCAN w USING INDEX queuert_worker_idx
CORRELATED SCALAR SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

## listWorkers/cursor

1. `dynamic`

```
SCAN w USING INDEX queuert_worker_idx
CORRELATED SCALAR SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

2. `dynamic`

```
SCAN w USING INDEX queuert_worker_idx
CORRELATED SCALAR SUBQUERY 1
SCAN json_each VIRTUAL TABLE INDEX 1:
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

## listWorkerJobs/default

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_attempt_by_idx (attempt_by=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

## listWorkerJobs/cursor

1. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_attempt_by_idx (attempt_by=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```

2. `dynamic`

```
CO-ROUTINE j
SEARCH j USING INDEX queuert_job_attempt_by_idx (attempt_by=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
SCAN j
SEARCH h USING INDEX sqlite_autoindex_queuert_job_1 (id=?)
```
