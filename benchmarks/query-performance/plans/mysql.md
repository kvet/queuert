# MySQL query plans

Plans of every statement each query-performance case runs, at scale 100, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun `pnpm start` after a query or index change and review the diff.

## getChains/default

1. `getChains`

```
-> Nested loop left join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (t.id = (select #2))
        -> Single-row index lookup on t using PRIMARY (id = (select #2))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getChains/lock

1. `getChainsLocked`

```
-> Nested loop left join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (t.id = (select #2))
        -> Single-row index lookup on t using PRIMARY (id = (select #2))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getChains/batch100

1. `getChains`

```
-> Nested loop left join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (t.id = (select #2))
        -> Single-row index lookup on t using PRIMARY (id = (select #2))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getChains/lockBatch100

1. `getChainsLocked`

```
-> Nested loop left join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (t.id = (select #2))
        -> Single-row index lookup on t using PRIMARY (id = (select #2))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getChainTails/default

1. `getChainTails`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (j.id = coalesce((select #2),h.id))
        -> Single-row index lookup on j using PRIMARY (id = coalesce((select #2),h.id))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getChainTails/lock

1. `getChainTailsLocked`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (j.id = coalesce((select #2),h.id))
        -> Single-row index lookup on j using PRIMARY (id = coalesce((select #2),h.id))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getChainTails/batch100

1. `getChainTails`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (j.id = coalesce((select #2),h.id))
        -> Single-row index lookup on j using PRIMARY (id = coalesce((select #2),h.id))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getChainTails/lockBatch100

1. `getChainTailsLocked`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (h.chain_index = 0)
            -> Single-row index lookup on h using PRIMARY (id = d.id)
    -> Filter: (j.id = coalesce((select #2),h.id))
        -> Single-row index lookup on j using PRIMARY (id = coalesce((select #2),h.id))
        -> Select #2 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getJobs/default

1. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## getJobs/lock

1. `getJobsLocked`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## getJobs/batch100

1. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## getJobs/lockBatch100

1. `getJobsLocked`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## getWorkers/default

1. `getWorkers`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on w using PRIMARY (id = d.id)
```

## getWorkers/lock

1. `getWorkersLocked`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on w using PRIMARY (id = d.id)
```

## getWorkers/batch100

1. `getWorkers`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on w using PRIMARY (id = d.id)
```

## getWorkers/lockBatch100

1. `getWorkersLocked`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on w using PRIMARY (id = d.id)
```

## createJobs/default

1. `createJobs`

```
-> Insert into queuert_job
    -> Materialize table function
```

2. `readCreatedJobs`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on h using PRIMARY (id = d.id)
```

## createJobs/deduplication

1. `findDeduplicatedChains`

```
-> Nested loop left join
    -> Nested loop inner join
        -> Materialize table function
        -> Filter: (h.id = (select #2))
            -> Single-row index lookup on h using PRIMARY (id = (select #2))
            -> Select #2 (subquery in condition; dependent)
                -> Limit: 1 row(s)
                    -> Sort: e.created_at DESC, e.id DESC, limit input to 1 row(s) per chunk
                        -> Filter: (((e.chain_status = 'running') and (d.scope = 'running')) or (d.scope = 'any'))
                            -> Index lookup on e using queuert_chain_deduplication_idx (chain_deduplication_key = d.deduplication_key, type_name = d.type_name, chain_index = 0)
    -> Filter: (t.id = (select #4))
        -> Single-row index lookup on t using PRIMARY (id = (select #4))
        -> Select #4 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

2. `createJobs`

```
-> Insert into queuert_job
    -> Materialize table function
```

3. `readCreatedJobs`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on h using PRIMARY (id = d.id)
```

## createJobs/batch100

1. `createJobs`

```
-> Insert into queuert_job
    -> Materialize table function
```

2. `readCreatedJobs`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on h using PRIMARY (id = d.id)
```

## createJobs/deduplicationBatch100

1. `findDeduplicatedChains`

```
-> Nested loop left join
    -> Nested loop inner join
        -> Materialize table function
        -> Filter: (h.id = (select #2))
            -> Single-row index lookup on h using PRIMARY (id = (select #2))
            -> Select #2 (subquery in condition; dependent)
                -> Limit: 1 row(s)
                    -> Sort: e.created_at DESC, e.id DESC, limit input to 1 row(s) per chunk
                        -> Filter: (((e.chain_status = 'running') and (d.scope = 'running')) or (d.scope = 'any'))
                            -> Index lookup on e using queuert_chain_deduplication_idx (chain_deduplication_key = d.deduplication_key, type_name = d.type_name, chain_index = 0)
    -> Filter: (t.id = (select #4))
        -> Single-row index lookup on t using PRIMARY (id = (select #4))
        -> Select #4 (subquery in condition; dependent)
            -> Limit: 1 row(s)
                -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                    -> Filter: (tail_lookup.chain_index > 0)
                        -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

2. `createJobs`

```
-> Insert into queuert_job
    -> Materialize table function
```

3. `readCreatedJobs`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on h using PRIMARY (id = d.id)
```

## continueJobs/default

1. `completeContinuedJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.continue_from_id is not null)
            -> Materialize table function
        -> Filter: ((j.`status` <> 'completed') and ((d.attempt_token is null) or ((j.attempt_token = d.attempt_token) and (j.`status` = 'running'))))
            -> Single-row index lookup on j using PRIMARY (id = d.continue_from_id)
```

2. `insertContinuations`

```
-> Insert into queuert_job
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop inner join
                -> Filter: (d.continue_from_id is not null)
                    -> Materialize table function
                -> Filter: (c.continued_to_id = d.new_id)
                    -> Single-row index lookup on c using PRIMARY (id = d.continue_from_id)
```

3. `readContinuedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Nested loop inner join
            -> Filter: ((d.continue_from_id is not null) and (d.new_id is not null))
                -> Materialize table function
            -> Filter: (j.continued_to_id = d.new_id)
                -> Single-row index lookup on j using PRIMARY (id = d.continue_from_id)
        -> Single-row index lookup on n using PRIMARY (id = d.new_id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## continueJobs/batch100

1. `completeContinuedJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.continue_from_id is not null)
            -> Materialize table function
        -> Filter: ((j.`status` <> 'completed') and ((d.attempt_token is null) or ((j.attempt_token = d.attempt_token) and (j.`status` = 'running'))))
            -> Single-row index lookup on j using PRIMARY (id = d.continue_from_id)
```

2. `insertContinuations`

```
-> Insert into queuert_job
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop inner join
                -> Filter: (d.continue_from_id is not null)
                    -> Materialize table function
                -> Filter: (c.continued_to_id = d.new_id)
                    -> Single-row index lookup on c using PRIMARY (id = d.continue_from_id)
```

3. `readContinuedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Nested loop inner join
            -> Filter: ((d.continue_from_id is not null) and (d.new_id is not null))
                -> Materialize table function
            -> Filter: (j.continued_to_id = d.new_id)
                -> Single-row index lookup on j using PRIMARY (id = d.continue_from_id)
        -> Single-row index lookup on n using PRIMARY (id = d.new_id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## addJobsBlockers/default

1. `lockBlockerHeads`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Filter: (h.chain_index = 0)
        -> Single-row index lookup on h using PRIMARY (id = d.id)
```

2. `flagBlockerHeads`

```
-> Update h (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on h using PRIMARY (id = d.id)
```

3. `insertJobBlockers`

```
-> Insert into queuert_job_blocker
    -> Materialize table function
```

4. `blockDependents`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (j.`status` in ('pending','blocked'))
            -> Single-row index lookup on j using PRIMARY (id = d.id)
```

5. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## addJobsBlockers/batch100

1. `lockBlockerHeads`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Filter: (h.chain_index = 0)
        -> Single-row index lookup on h using PRIMARY (id = d.id)
```

2. `insertJobBlockers`

```
-> Insert into queuert_job_blocker
    -> Materialize table function
```

3. `blockDependents`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (j.`status` in ('pending','blocked'))
            -> Single-row index lookup on j using PRIMARY (id = d.id)
```

4. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## getJobsBlockers/default

1. `getJobsBlockers`

```
-> Sort row IDs: b.job_id, b.`index`
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Nested loop inner join
                        -> Filter: (d.id is not null)
                            -> Materialize table function
                        -> Covering index lookup on b using PRIMARY (job_id = d.id)
                    -> Single-row index lookup on h using PRIMARY (id = b.blocked_by_chain_id)
                -> Filter: (t.id = (select #2))
                    -> Single-row index lookup on t using PRIMARY (id = (select #2))
                    -> Select #2 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getJobsBlockers/manyBlockers

1. `getJobsBlockers`

```
-> Sort row IDs: b.job_id, b.`index`
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Nested loop inner join
                        -> Filter: (d.id is not null)
                            -> Materialize table function
                        -> Covering index lookup on b using PRIMARY (job_id = d.id)
                    -> Single-row index lookup on h using PRIMARY (id = b.blocked_by_chain_id)
                -> Filter: (t.id = (select #2))
                    -> Single-row index lookup on t using PRIMARY (id = (select #2))
                    -> Select #2 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## getJobsBlockers/batch100

1. `getJobsBlockers`

```
-> Sort row IDs: b.job_id, b.`index`
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Nested loop inner join
                        -> Filter: (d.id is not null)
                            -> Materialize table function
                        -> Covering index lookup on b using PRIMARY (job_id = d.id)
                    -> Single-row index lookup on h using PRIMARY (id = b.blocked_by_chain_id)
                -> Filter: (t.id = (select #2))
                    -> Single-row index lookup on t using PRIMARY (id = (select #2))
                    -> Select #2 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## unblockJobs/default

1. `lockDependentBlockers`

```
-> Index lookup on jb using queuert_job_blocker_chain_idx (blocked_by_chain_id = '<uuid>')
```

2. `countDownDependents`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (j.`status` = 'blocked')
            -> Single-row index lookup on j using PRIMARY (id = d.id)
```

3. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## unblockJobs/batch100

1. `lockDependentBlockers`

```
-> Index lookup on jb using queuert_job_blocker_chain_idx (blocked_by_chain_id = '<uuid>')
```

2. `countDownDependents`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Filter: (j.`status` = 'blocked')
            -> Single-row index lookup on j using PRIMARY (id = d.id)
```

3. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## startWorker/default

1. `startWorker`

```
-> Insert into queuert_worker
    -> Rows fetched before execution
```

2. `getWorker`

```
-> Rows fetched before execution
```

## startWorker/batch100

1. `startWorker`

```
-> Insert into queuert_worker
    -> Rows fetched before execution
```

2. `getWorker`

```
-> Rows fetched before execution
```

## extendWorkerLease/default

1. `lockLiveWorkerForUpdate`

```
-> Rows fetched before execution
```

2. `extendWorkerLease`

```
-> Update queuert_worker (immediate)
    -> Rows fetched before execution
```

3. `getWorker`

```
-> Rows fetched before execution
```

## stopWorker/default

1. `lockStoppedWorker`

```
-> Rows fetched before execution
```

2. `stopWorker`

```
-> Delete from queuert_worker (immediate)
    -> Rows fetched before execution
```

## startJobAttempts/default

1. `lockLiveWorker`

```
-> Rows fetched before execution
```

2. `pickPendingJobBatches:1`

```
-> Rows fetched before execution
```

3. `claimJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
```

4. `readClaimedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
-> Select #2 (subquery in projection; dependent)
    -> Limit: 1 row(s)
        -> Covering index lookup on jb using PRIMARY (job_id = j.id)
```

## startJobAttempts/limit100

1. `lockLiveWorker`

```
-> Rows fetched before execution
```

2. `pickPendingJobBatches:1`

```
-> Filter: (ranked_jobs.batch_rank <= 100)
    -> Table scan on ranked_jobs
        -> Materialize
            -> Window aggregate: dense_rank() OVER (ORDER BY numbered_jobs.batch_index,numbered_jobs.type_name )
                -> Sort: numbered_jobs.batch_index, numbered_jobs.type_name
                    -> Table scan on numbered_jobs
                        -> Materialize
                            -> Window aggregate: row_number() OVER (PARTITION BY candidate_jobs.type_name ORDER BY candidate_jobs.picked_ts,candidate_jobs.id )
                                -> Sort: candidate_jobs.type_name, candidate_jobs.picked_ts, candidate_jobs.id
                                    -> Table scan on candidate_jobs
                                        -> Materialize
                                            -> Limit: 100 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:batch:start') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:batch:start' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
```

3. `claimJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
```

4. `readClaimedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
-> Select #2 (subquery in projection; dependent)
    -> Limit: 1 row(s)
        -> Covering index lookup on jb using PRIMARY (job_id = j.id)
```

## startJobAttempts/batchLimit10

1. `lockLiveWorker`

```
-> Rows fetched before execution
```

2. `pickPendingJobBatches:1`

```
-> Filter: (ranked_jobs.batch_rank <= 10)
    -> Table scan on ranked_jobs
        -> Materialize
            -> Window aggregate: dense_rank() OVER (ORDER BY numbered_jobs.batch_index,numbered_jobs.type_name )
                -> Sort: numbered_jobs.batch_index, numbered_jobs.type_name
                    -> Table scan on numbered_jobs
                        -> Materialize
                            -> Window aggregate: row_number() OVER (PARTITION BY candidate_jobs.type_name ORDER BY candidate_jobs.picked_ts,candidate_jobs.id )
                                -> Sort: candidate_jobs.type_name, candidate_jobs.picked_ts, candidate_jobs.id
                                    -> Table scan on candidate_jobs
                                        -> Materialize
                                            -> Limit: 100 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:batch:start-batches') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:batch:start-batches' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
```

3. `claimJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
```

4. `readClaimedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
-> Select #2 (subquery in projection; dependent)
    -> Limit: 1 row(s)
        -> Covering index lookup on jb using PRIMARY (job_id = j.id)
```

## startJobAttempts/batch100

1. `lockLiveWorker`

```
-> Rows fetched before execution
```

2. `pickPendingJobBatches:100`

```
-> Filter: (ranked_jobs.batch_rank <= 10)
    -> Table scan on ranked_jobs
        -> Materialize
            -> Window aggregate: dense_rank() OVER (ORDER BY numbered_jobs.batch_index,numbered_jobs.type_name )
                -> Sort: numbered_jobs.batch_index, numbered_jobs.type_name
                    -> Table scan on numbered_jobs
                        -> Materialize
                            -> Window aggregate: row_number() OVER (PARTITION BY candidate_jobs.type_name ORDER BY candidate_jobs.picked_ts,candidate_jobs.id )
                                -> Sort: candidate_jobs.type_name, candidate_jobs.picked_ts, candidate_jobs.id
                                    -> Table scan on candidate_jobs
                                        -> Union all materialize
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'seed:throwaway:pending') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'seed:throwaway:pending' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:0') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:0' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:1') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:1' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:2') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:2' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:3') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:3' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:4') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:4' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:5') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:5' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:6') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:6' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:7') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:7' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:8') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:8' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:9') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:9' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:10') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:10' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:11') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:11' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:12') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:12' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:13') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:13' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:14') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:14' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:15') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:15' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:16') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:16' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:17') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:17' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:18') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:18' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:19') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:19' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:20') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:20' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:21') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:21' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:22') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:22' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:23') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:23' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:24') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:24' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:25') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:25' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:26') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:26' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:27') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:27' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:28') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:28' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:29') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:29' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:30') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:30' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:31') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:31' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:32') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:32' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:33') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:33' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:34') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:34' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:35') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:35' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:36') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:36' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:37') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:37' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:38') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:38' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:39') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:39' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:40') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:40' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:41') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:41' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:42') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:42' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:43') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:43' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:44') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:44' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:45') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:45' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:46') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:46' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:47') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:47' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:48') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:48' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:49') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:49' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:50') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:50' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:51') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:51' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:52') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:52' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:53') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:53' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:54') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:54' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:55') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:55' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:56') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:56' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:57') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:57' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:58') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:58' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:59') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:59' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:60') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:60' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:61') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:61' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:62') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:62' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:63') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:63' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:64') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:64' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:65') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:65' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:66') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:66' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:67') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:67' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:68') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:68' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:69') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:69' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:70') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:70' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:71') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:71' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:72') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:72' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:73') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:73' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:74') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:74' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:75') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:75' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:76') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:76' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:77') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:77' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:78') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:78' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:79') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:79' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:80') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:80' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:81') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:81' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:82') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:82' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:83') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:83' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:84') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:84' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:85') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:85' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:86') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:86' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:87') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:87' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:88') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:88' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:89') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:89' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:90') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:90' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:91') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:91' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:92') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:92' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:93') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:93' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:94') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:94' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:95') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:95' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:96') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:96' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:97') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:97' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
                                            -> Limit: 10 row(s)
                                                -> Filter: ((queuert_job.`status` = 'pending') and (queuert_job.type_name = 'idx:type:98') and (queuert_job.status_ts <= <cache>(utc_timestamp(6))))
                                                    -> Covering index range scan on queuert_job using queuert_job_status_idx over (type_name = 'idx:type:98' AND status = 'pending' AND NULL < status_ts <= '<timestamp>')
```

3. `claimJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
```

4. `readClaimedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
-> Select #2 (subquery in projection; dependent)
    -> Limit: 1 row(s)
        -> Covering index lookup on jb using PRIMARY (job_id = j.id)
```

## completeJobs/default

1. `lockCompletedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `completeJobs`

```
-> Update j (buffered), h (buffered)
    -> Nested loop left join
        -> Nested loop inner join
            -> Filter: (d.job_id is not null)
                -> Materialize table function
            -> Single-row index lookup on j using PRIMARY (id = d.job_id)
        -> Filter: (j.chain_id <> d.job_id)
            -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## completeJobs/batch100

1. `lockCompletedJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `completeJobs`

```
-> Update j (buffered), h (buffered)
    -> Nested loop left join
        -> Nested loop inner join
            -> Filter: (d.job_id is not null)
                -> Materialize table function
            -> Single-row index lookup on j using PRIMARY (id = d.job_id)
        -> Filter: (j.chain_id <> d.job_id)
            -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## getStartAttemptDelayMs/default

No query plans.

## getStartAttemptDelayMs/batch100

No query plans.

## rescheduleJobs/default

1. `lockJobsForWrite`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on j using PRIMARY (id = d.id)
```

2. `rescheduleJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.job_id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.job_id)
```

3. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## rescheduleJobs/batch100

1. `lockJobsForWrite`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Single-row index lookup on j using PRIMARY (id = d.id)
```

2. `rescheduleJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.job_id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.job_id)
```

3. `getJobs`

```
-> Nested loop inner join
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
    -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## deleteChains/default

1. `lockDeletedChainHeads`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Filter: (h.chain_index = 0)
        -> Single-row index lookup on h using PRIMARY (id = d.id)
```

2. `lockDeletedChains`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Index lookup on j using queuert_chain_index_idx (chain_id = d.id)
```

3. `lockDeletedChainBlockers`

```
-> Table scan on <temporary>
    -> Temporary table with deduplication
        -> Nested loop inner join
            -> Filter: (d.id is not null)
                -> Materialize table function
            -> Covering index lookup on jb using PRIMARY (job_id = d.id)
```

4. `deleteChainJobs`

```
-> Delete from j (buffered), jb (buffered)
    -> Nested loop left join
        -> Nested loop inner join
            -> Filter: (d.id is not null)
                -> Materialize table function
            -> Single-row index lookup on j using PRIMARY (id = d.id)
        -> Index lookup on jb using PRIMARY (job_id = d.id)
```

## deleteChains/multiJob

1. `lockDeletedChainHeads`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Filter: (h.chain_index = 0)
        -> Single-row index lookup on h using PRIMARY (id = d.id)
```

2. `lockDeletedChains`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Index lookup on j using queuert_chain_index_idx (chain_id = d.id)
```

3. `lockDeletedChainBlockers`

```
-> Table scan on <temporary>
    -> Temporary table with deduplication
        -> Nested loop inner join
            -> Filter: (d.id is not null)
                -> Materialize table function
            -> Covering index lookup on jb using PRIMARY (job_id = d.id)
```

4. `deleteChainJobs`

```
-> Delete from j (buffered), jb (buffered)
    -> Nested loop left join
        -> Nested loop inner join
            -> Filter: (d.id is not null)
                -> Materialize table function
            -> Single-row index lookup on j using PRIMARY (id = d.id)
        -> Index lookup on jb using PRIMARY (job_id = d.id)
```

## deleteChains/batch100

1. `lockDeletedChainHeads`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Filter: (h.chain_index = 0)
        -> Single-row index lookup on h using PRIMARY (id = d.id)
```

2. `lockDeletedChains`

```
-> Nested loop inner join
    -> Filter: (d.id is not null)
        -> Materialize table function
    -> Index lookup on j using queuert_chain_index_idx (chain_id = d.id)
```

3. `lockDeletedChainBlockers`

```
-> Table scan on <temporary>
    -> Temporary table with deduplication
        -> Nested loop inner join
            -> Filter: (d.id is not null)
                -> Materialize table function
            -> Covering index lookup on jb using PRIMARY (job_id = d.id)
```

4. `deleteChainJobs`

```
-> Delete from j (buffered), jb (buffered)
    -> Nested loop left join
        -> Nested loop inner join
            -> Filter: (d.id is not null)
                -> Materialize table function
            -> Single-row index lookup on j using PRIMARY (id = d.id)
        -> Index lookup on jb using PRIMARY (job_id = d.id)
```

## getChainTypeNames/default

1. `getChainTypeNames`

```
-> Filter: (queuert_job.chain_index = 0)
    -> Covering index skip scan for deduplication on queuert_job using queuert_chain_idx
```

## getJobTypeNames/default

1. `getJobTypeNames`

```
-> Covering index skip scan for deduplication on queuert_job using queuert_chain_completed_idx
```

## countChainsByTypeName/default

1. `dynamic`

```
-> Append
    -> Stream results
        -> Rows fetched before execution
        -> Select #2 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:pending:order', chain_status = 'running')
        -> Select #4 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:pending:order', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #7 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:pending:payment', chain_status = 'running')
        -> Select #9 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:pending:payment', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #12 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:pending:notify', chain_status = 'running')
        -> Select #14 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:pending:notify', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #17 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:blocked:fanin:1', chain_status = 'running')
        -> Select #19 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:blocked:fanin:1', chain_status = 'completed')
```

## countChainsByTypeName/batch100

1. `dynamic`

```
-> Append
    -> Stream results
        -> Rows fetched before execution
        -> Select #2 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:throwaway:pending', chain_status = 'running')
        -> Select #4 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'seed:throwaway:pending', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #7 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:0', chain_status = 'running')
        -> Select #9 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:0', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #12 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:1', chain_status = 'running')
        -> Select #14 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:1', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #17 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:2', chain_status = 'running')
        -> Select #19 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:2', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #22 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:3', chain_status = 'running')
        -> Select #24 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:3', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #27 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:4', chain_status = 'running')
        -> Select #29 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:4', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #32 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:5', chain_status = 'running')
        -> Select #34 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:5', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #37 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:6', chain_status = 'running')
        -> Select #39 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:6', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #42 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:7', chain_status = 'running')
        -> Select #44 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:7', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #47 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:8', chain_status = 'running')
        -> Select #49 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:8', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #52 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:9', chain_status = 'running')
        -> Select #54 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:9', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #57 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:10', chain_status = 'running')
        -> Select #59 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:10', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #62 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:11', chain_status = 'running')
        -> Select #64 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:11', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #67 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:12', chain_status = 'running')
        -> Select #69 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:12', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #72 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:13', chain_status = 'running')
        -> Select #74 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:13', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #77 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:14', chain_status = 'running')
        -> Select #79 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:14', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #82 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:15', chain_status = 'running')
        -> Select #84 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:15', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #87 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:16', chain_status = 'running')
        -> Select #89 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:16', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #92 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:17', chain_status = 'running')
        -> Select #94 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:17', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #97 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:18', chain_status = 'running')
        -> Select #99 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:18', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #102 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:19', chain_status = 'running')
        -> Select #104 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:19', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #107 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:20', chain_status = 'running')
        -> Select #109 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:20', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #112 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:21', chain_status = 'running')
        -> Select #114 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:21', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #117 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:22', chain_status = 'running')
        -> Select #119 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:22', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #122 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:23', chain_status = 'running')
        -> Select #124 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:23', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #127 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:24', chain_status = 'running')
        -> Select #129 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:24', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #132 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:25', chain_status = 'running')
        -> Select #134 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:25', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #137 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:26', chain_status = 'running')
        -> Select #139 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:26', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #142 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:27', chain_status = 'running')
        -> Select #144 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:27', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #147 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:28', chain_status = 'running')
        -> Select #149 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:28', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #152 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:29', chain_status = 'running')
        -> Select #154 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:29', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #157 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:30', chain_status = 'running')
        -> Select #159 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:30', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #162 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:31', chain_status = 'running')
        -> Select #164 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:31', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #167 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:32', chain_status = 'running')
        -> Select #169 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:32', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #172 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:33', chain_status = 'running')
        -> Select #174 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:33', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #177 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:34', chain_status = 'running')
        -> Select #179 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:34', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #182 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:35', chain_status = 'running')
        -> Select #184 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:35', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #187 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:36', chain_status = 'running')
        -> Select #189 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:36', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #192 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:37', chain_status = 'running')
        -> Select #194 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:37', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #197 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:38', chain_status = 'running')
        -> Select #199 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:38', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #202 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:39', chain_status = 'running')
        -> Select #204 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:39', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #207 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:40', chain_status = 'running')
        -> Select #209 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:40', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #212 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:41', chain_status = 'running')
        -> Select #214 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:41', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #217 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:42', chain_status = 'running')
        -> Select #219 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:42', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #222 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:43', chain_status = 'running')
        -> Select #224 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:43', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #227 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:44', chain_status = 'running')
        -> Select #229 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:44', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #232 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:45', chain_status = 'running')
        -> Select #234 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:45', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #237 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:46', chain_status = 'running')
        -> Select #239 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:46', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #242 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:47', chain_status = 'running')
        -> Select #244 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:47', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #247 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:48', chain_status = 'running')
        -> Select #249 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:48', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #252 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:49', chain_status = 'running')
        -> Select #254 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:49', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #257 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:50', chain_status = 'running')
        -> Select #259 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:50', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #262 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:51', chain_status = 'running')
        -> Select #264 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:51', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #267 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:52', chain_status = 'running')
        -> Select #269 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:52', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #272 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:53', chain_status = 'running')
        -> Select #274 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:53', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #277 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:54', chain_status = 'running')
        -> Select #279 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:54', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #282 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:55', chain_status = 'running')
        -> Select #284 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:55', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #287 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:56', chain_status = 'running')
        -> Select #289 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:56', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #292 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:57', chain_status = 'running')
        -> Select #294 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:57', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #297 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:58', chain_status = 'running')
        -> Select #299 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:58', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #302 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:59', chain_status = 'running')
        -> Select #304 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:59', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #307 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:60', chain_status = 'running')
        -> Select #309 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:60', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #312 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:61', chain_status = 'running')
        -> Select #314 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:61', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #317 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:62', chain_status = 'running')
        -> Select #319 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:62', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #322 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:63', chain_status = 'running')
        -> Select #324 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:63', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #327 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:64', chain_status = 'running')
        -> Select #329 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:64', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #332 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:65', chain_status = 'running')
        -> Select #334 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:65', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #337 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:66', chain_status = 'running')
        -> Select #339 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:66', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #342 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:67', chain_status = 'running')
        -> Select #344 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:67', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #347 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:68', chain_status = 'running')
        -> Select #349 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:68', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #352 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:69', chain_status = 'running')
        -> Select #354 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:69', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #357 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:70', chain_status = 'running')
        -> Select #359 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:70', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #362 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:71', chain_status = 'running')
        -> Select #364 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:71', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #367 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:72', chain_status = 'running')
        -> Select #369 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:72', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #372 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:73', chain_status = 'running')
        -> Select #374 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:73', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #377 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:74', chain_status = 'running')
        -> Select #379 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:74', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #382 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:75', chain_status = 'running')
        -> Select #384 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:75', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #387 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:76', chain_status = 'running')
        -> Select #389 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:76', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #392 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:77', chain_status = 'running')
        -> Select #394 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:77', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #397 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:78', chain_status = 'running')
        -> Select #399 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:78', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #402 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:79', chain_status = 'running')
        -> Select #404 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:79', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #407 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:80', chain_status = 'running')
        -> Select #409 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:80', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #412 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:81', chain_status = 'running')
        -> Select #414 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:81', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #417 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:82', chain_status = 'running')
        -> Select #419 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:82', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #422 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:83', chain_status = 'running')
        -> Select #424 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:83', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #427 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:84', chain_status = 'running')
        -> Select #429 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:84', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #432 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:85', chain_status = 'running')
        -> Select #434 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:85', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #437 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:86', chain_status = 'running')
        -> Select #439 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:86', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #442 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:87', chain_status = 'running')
        -> Select #444 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:87', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #447 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:88', chain_status = 'running')
        -> Select #449 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:88', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #452 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:89', chain_status = 'running')
        -> Select #454 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:89', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #457 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:90', chain_status = 'running')
        -> Select #459 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:90', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #462 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:91', chain_status = 'running')
        -> Select #464 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:91', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #467 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:92', chain_status = 'running')
        -> Select #469 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:92', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #472 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:93', chain_status = 'running')
        -> Select #474 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:93', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #477 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:94', chain_status = 'running')
        -> Select #479 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:94', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #482 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:95', chain_status = 'running')
        -> Select #484 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:95', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #487 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:96', chain_status = 'running')
        -> Select #489 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:96', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #492 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:97', chain_status = 'running')
        -> Select #494 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:97', chain_status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #497 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:98', chain_status = 'running')
        -> Select #499 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_chain_running_idx (type_name = 'idx:type:98', chain_status = 'completed')
```

## countJobsByTypeName/default

1. `dynamic`

```
-> Append
    -> Stream results
        -> Rows fetched before execution
        -> Select #2 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:order', status = 'blocked')
        -> Select #4 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:order', status = 'pending')
        -> Select #6 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:order', status = 'running')
        -> Select #8 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:order', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #11 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:payment', status = 'blocked')
        -> Select #13 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:payment', status = 'pending')
        -> Select #15 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:payment', status = 'running')
        -> Select #17 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:payment', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #20 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:notify', status = 'blocked')
        -> Select #22 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:notify', status = 'pending')
        -> Select #24 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:notify', status = 'running')
        -> Select #26 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:pending:notify', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #29 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:blocked:fanin:1', status = 'blocked')
        -> Select #31 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:blocked:fanin:1', status = 'pending')
        -> Select #33 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:blocked:fanin:1', status = 'running')
        -> Select #35 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:blocked:fanin:1', status = 'completed')
```

## countJobsByTypeName/batch100

1. `dynamic`

```
-> Append
    -> Stream results
        -> Rows fetched before execution
        -> Select #2 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:throwaway:pending', status = 'blocked')
        -> Select #4 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:throwaway:pending', status = 'pending')
        -> Select #6 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:throwaway:pending', status = 'running')
        -> Select #8 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'seed:throwaway:pending', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #11 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:0', status = 'blocked')
        -> Select #13 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:0', status = 'pending')
        -> Select #15 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:0', status = 'running')
        -> Select #17 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:0', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #20 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:1', status = 'blocked')
        -> Select #22 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:1', status = 'pending')
        -> Select #24 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:1', status = 'running')
        -> Select #26 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:1', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #29 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:2', status = 'blocked')
        -> Select #31 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:2', status = 'pending')
        -> Select #33 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:2', status = 'running')
        -> Select #35 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:2', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #38 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:3', status = 'blocked')
        -> Select #40 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:3', status = 'pending')
        -> Select #42 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:3', status = 'running')
        -> Select #44 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:3', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #47 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:4', status = 'blocked')
        -> Select #49 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:4', status = 'pending')
        -> Select #51 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:4', status = 'running')
        -> Select #53 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:4', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #56 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:5', status = 'blocked')
        -> Select #58 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:5', status = 'pending')
        -> Select #60 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:5', status = 'running')
        -> Select #62 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:5', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #65 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:6', status = 'blocked')
        -> Select #67 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:6', status = 'pending')
        -> Select #69 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:6', status = 'running')
        -> Select #71 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:6', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #74 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:7', status = 'blocked')
        -> Select #76 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:7', status = 'pending')
        -> Select #78 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:7', status = 'running')
        -> Select #80 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:7', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #83 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:8', status = 'blocked')
        -> Select #85 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:8', status = 'pending')
        -> Select #87 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:8', status = 'running')
        -> Select #89 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:8', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #92 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:9', status = 'blocked')
        -> Select #94 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:9', status = 'pending')
        -> Select #96 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:9', status = 'running')
        -> Select #98 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:9', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #101 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:10', status = 'blocked')
        -> Select #103 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:10', status = 'pending')
        -> Select #105 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:10', status = 'running')
        -> Select #107 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:10', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #110 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:11', status = 'blocked')
        -> Select #112 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:11', status = 'pending')
        -> Select #114 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:11', status = 'running')
        -> Select #116 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:11', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #119 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:12', status = 'blocked')
        -> Select #121 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:12', status = 'pending')
        -> Select #123 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:12', status = 'running')
        -> Select #125 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:12', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #128 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:13', status = 'blocked')
        -> Select #130 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:13', status = 'pending')
        -> Select #132 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:13', status = 'running')
        -> Select #134 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:13', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #137 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:14', status = 'blocked')
        -> Select #139 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:14', status = 'pending')
        -> Select #141 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:14', status = 'running')
        -> Select #143 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:14', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #146 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:15', status = 'blocked')
        -> Select #148 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:15', status = 'pending')
        -> Select #150 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:15', status = 'running')
        -> Select #152 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:15', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #155 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:16', status = 'blocked')
        -> Select #157 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:16', status = 'pending')
        -> Select #159 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:16', status = 'running')
        -> Select #161 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:16', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #164 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:17', status = 'blocked')
        -> Select #166 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:17', status = 'pending')
        -> Select #168 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:17', status = 'running')
        -> Select #170 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:17', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #173 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:18', status = 'blocked')
        -> Select #175 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:18', status = 'pending')
        -> Select #177 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:18', status = 'running')
        -> Select #179 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:18', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #182 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:19', status = 'blocked')
        -> Select #184 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:19', status = 'pending')
        -> Select #186 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:19', status = 'running')
        -> Select #188 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:19', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #191 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:20', status = 'blocked')
        -> Select #193 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:20', status = 'pending')
        -> Select #195 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:20', status = 'running')
        -> Select #197 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:20', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #200 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:21', status = 'blocked')
        -> Select #202 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:21', status = 'pending')
        -> Select #204 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:21', status = 'running')
        -> Select #206 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:21', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #209 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:22', status = 'blocked')
        -> Select #211 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:22', status = 'pending')
        -> Select #213 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:22', status = 'running')
        -> Select #215 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:22', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #218 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:23', status = 'blocked')
        -> Select #220 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:23', status = 'pending')
        -> Select #222 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:23', status = 'running')
        -> Select #224 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:23', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #227 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:24', status = 'blocked')
        -> Select #229 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:24', status = 'pending')
        -> Select #231 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:24', status = 'running')
        -> Select #233 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:24', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #236 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:25', status = 'blocked')
        -> Select #238 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:25', status = 'pending')
        -> Select #240 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:25', status = 'running')
        -> Select #242 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:25', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #245 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:26', status = 'blocked')
        -> Select #247 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:26', status = 'pending')
        -> Select #249 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:26', status = 'running')
        -> Select #251 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:26', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #254 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:27', status = 'blocked')
        -> Select #256 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:27', status = 'pending')
        -> Select #258 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:27', status = 'running')
        -> Select #260 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:27', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #263 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:28', status = 'blocked')
        -> Select #265 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:28', status = 'pending')
        -> Select #267 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:28', status = 'running')
        -> Select #269 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:28', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #272 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:29', status = 'blocked')
        -> Select #274 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:29', status = 'pending')
        -> Select #276 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:29', status = 'running')
        -> Select #278 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:29', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #281 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:30', status = 'blocked')
        -> Select #283 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:30', status = 'pending')
        -> Select #285 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:30', status = 'running')
        -> Select #287 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:30', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #290 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:31', status = 'blocked')
        -> Select #292 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:31', status = 'pending')
        -> Select #294 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:31', status = 'running')
        -> Select #296 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:31', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #299 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:32', status = 'blocked')
        -> Select #301 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:32', status = 'pending')
        -> Select #303 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:32', status = 'running')
        -> Select #305 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:32', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #308 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:33', status = 'blocked')
        -> Select #310 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:33', status = 'pending')
        -> Select #312 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:33', status = 'running')
        -> Select #314 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:33', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #317 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:34', status = 'blocked')
        -> Select #319 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:34', status = 'pending')
        -> Select #321 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:34', status = 'running')
        -> Select #323 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:34', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #326 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:35', status = 'blocked')
        -> Select #328 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:35', status = 'pending')
        -> Select #330 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:35', status = 'running')
        -> Select #332 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:35', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #335 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:36', status = 'blocked')
        -> Select #337 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:36', status = 'pending')
        -> Select #339 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:36', status = 'running')
        -> Select #341 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:36', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #344 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:37', status = 'blocked')
        -> Select #346 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:37', status = 'pending')
        -> Select #348 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:37', status = 'running')
        -> Select #350 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:37', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #353 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:38', status = 'blocked')
        -> Select #355 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:38', status = 'pending')
        -> Select #357 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:38', status = 'running')
        -> Select #359 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:38', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #362 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:39', status = 'blocked')
        -> Select #364 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:39', status = 'pending')
        -> Select #366 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:39', status = 'running')
        -> Select #368 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:39', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #371 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:40', status = 'blocked')
        -> Select #373 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:40', status = 'pending')
        -> Select #375 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:40', status = 'running')
        -> Select #377 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:40', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #380 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:41', status = 'blocked')
        -> Select #382 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:41', status = 'pending')
        -> Select #384 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:41', status = 'running')
        -> Select #386 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:41', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #389 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:42', status = 'blocked')
        -> Select #391 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:42', status = 'pending')
        -> Select #393 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:42', status = 'running')
        -> Select #395 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:42', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #398 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:43', status = 'blocked')
        -> Select #400 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:43', status = 'pending')
        -> Select #402 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:43', status = 'running')
        -> Select #404 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:43', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #407 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:44', status = 'blocked')
        -> Select #409 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:44', status = 'pending')
        -> Select #411 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:44', status = 'running')
        -> Select #413 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:44', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #416 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:45', status = 'blocked')
        -> Select #418 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:45', status = 'pending')
        -> Select #420 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:45', status = 'running')
        -> Select #422 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:45', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #425 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:46', status = 'blocked')
        -> Select #427 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:46', status = 'pending')
        -> Select #429 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:46', status = 'running')
        -> Select #431 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:46', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #434 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:47', status = 'blocked')
        -> Select #436 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:47', status = 'pending')
        -> Select #438 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:47', status = 'running')
        -> Select #440 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:47', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #443 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:48', status = 'blocked')
        -> Select #445 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:48', status = 'pending')
        -> Select #447 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:48', status = 'running')
        -> Select #449 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:48', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #452 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:49', status = 'blocked')
        -> Select #454 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:49', status = 'pending')
        -> Select #456 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:49', status = 'running')
        -> Select #458 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:49', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #461 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:50', status = 'blocked')
        -> Select #463 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:50', status = 'pending')
        -> Select #465 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:50', status = 'running')
        -> Select #467 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:50', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #470 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:51', status = 'blocked')
        -> Select #472 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:51', status = 'pending')
        -> Select #474 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:51', status = 'running')
        -> Select #476 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:51', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #479 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:52', status = 'blocked')
        -> Select #481 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:52', status = 'pending')
        -> Select #483 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:52', status = 'running')
        -> Select #485 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:52', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #488 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:53', status = 'blocked')
        -> Select #490 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:53', status = 'pending')
        -> Select #492 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:53', status = 'running')
        -> Select #494 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:53', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #497 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:54', status = 'blocked')
        -> Select #499 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:54', status = 'pending')
        -> Select #501 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:54', status = 'running')
        -> Select #503 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:54', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #506 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:55', status = 'blocked')
        -> Select #508 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:55', status = 'pending')
        -> Select #510 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:55', status = 'running')
        -> Select #512 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:55', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #515 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:56', status = 'blocked')
        -> Select #517 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:56', status = 'pending')
        -> Select #519 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:56', status = 'running')
        -> Select #521 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:56', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #524 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:57', status = 'blocked')
        -> Select #526 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:57', status = 'pending')
        -> Select #528 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:57', status = 'running')
        -> Select #530 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:57', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #533 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:58', status = 'blocked')
        -> Select #535 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:58', status = 'pending')
        -> Select #537 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:58', status = 'running')
        -> Select #539 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:58', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #542 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:59', status = 'blocked')
        -> Select #544 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:59', status = 'pending')
        -> Select #546 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:59', status = 'running')
        -> Select #548 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:59', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #551 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:60', status = 'blocked')
        -> Select #553 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:60', status = 'pending')
        -> Select #555 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:60', status = 'running')
        -> Select #557 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:60', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #560 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:61', status = 'blocked')
        -> Select #562 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:61', status = 'pending')
        -> Select #564 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:61', status = 'running')
        -> Select #566 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:61', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #569 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:62', status = 'blocked')
        -> Select #571 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:62', status = 'pending')
        -> Select #573 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:62', status = 'running')
        -> Select #575 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:62', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #578 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:63', status = 'blocked')
        -> Select #580 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:63', status = 'pending')
        -> Select #582 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:63', status = 'running')
        -> Select #584 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:63', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #587 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:64', status = 'blocked')
        -> Select #589 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:64', status = 'pending')
        -> Select #591 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:64', status = 'running')
        -> Select #593 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:64', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #596 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:65', status = 'blocked')
        -> Select #598 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:65', status = 'pending')
        -> Select #600 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:65', status = 'running')
        -> Select #602 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:65', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #605 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:66', status = 'blocked')
        -> Select #607 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:66', status = 'pending')
        -> Select #609 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:66', status = 'running')
        -> Select #611 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:66', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #614 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:67', status = 'blocked')
        -> Select #616 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:67', status = 'pending')
        -> Select #618 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:67', status = 'running')
        -> Select #620 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:67', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #623 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:68', status = 'blocked')
        -> Select #625 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:68', status = 'pending')
        -> Select #627 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:68', status = 'running')
        -> Select #629 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:68', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #632 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:69', status = 'blocked')
        -> Select #634 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:69', status = 'pending')
        -> Select #636 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:69', status = 'running')
        -> Select #638 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:69', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #641 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:70', status = 'blocked')
        -> Select #643 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:70', status = 'pending')
        -> Select #645 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:70', status = 'running')
        -> Select #647 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:70', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #650 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:71', status = 'blocked')
        -> Select #652 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:71', status = 'pending')
        -> Select #654 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:71', status = 'running')
        -> Select #656 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:71', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #659 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:72', status = 'blocked')
        -> Select #661 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:72', status = 'pending')
        -> Select #663 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:72', status = 'running')
        -> Select #665 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:72', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #668 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:73', status = 'blocked')
        -> Select #670 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:73', status = 'pending')
        -> Select #672 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:73', status = 'running')
        -> Select #674 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:73', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #677 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:74', status = 'blocked')
        -> Select #679 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:74', status = 'pending')
        -> Select #681 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:74', status = 'running')
        -> Select #683 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:74', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #686 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:75', status = 'blocked')
        -> Select #688 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:75', status = 'pending')
        -> Select #690 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:75', status = 'running')
        -> Select #692 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:75', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #695 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:76', status = 'blocked')
        -> Select #697 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:76', status = 'pending')
        -> Select #699 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:76', status = 'running')
        -> Select #701 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:76', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #704 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:77', status = 'blocked')
        -> Select #706 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:77', status = 'pending')
        -> Select #708 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:77', status = 'running')
        -> Select #710 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:77', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #713 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:78', status = 'blocked')
        -> Select #715 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:78', status = 'pending')
        -> Select #717 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:78', status = 'running')
        -> Select #719 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:78', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #722 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:79', status = 'blocked')
        -> Select #724 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:79', status = 'pending')
        -> Select #726 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:79', status = 'running')
        -> Select #728 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:79', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #731 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:80', status = 'blocked')
        -> Select #733 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:80', status = 'pending')
        -> Select #735 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:80', status = 'running')
        -> Select #737 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:80', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #740 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:81', status = 'blocked')
        -> Select #742 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:81', status = 'pending')
        -> Select #744 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:81', status = 'running')
        -> Select #746 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:81', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #749 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:82', status = 'blocked')
        -> Select #751 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:82', status = 'pending')
        -> Select #753 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:82', status = 'running')
        -> Select #755 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:82', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #758 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:83', status = 'blocked')
        -> Select #760 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:83', status = 'pending')
        -> Select #762 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:83', status = 'running')
        -> Select #764 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:83', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #767 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:84', status = 'blocked')
        -> Select #769 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:84', status = 'pending')
        -> Select #771 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:84', status = 'running')
        -> Select #773 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:84', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #776 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:85', status = 'blocked')
        -> Select #778 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:85', status = 'pending')
        -> Select #780 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:85', status = 'running')
        -> Select #782 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:85', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #785 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:86', status = 'blocked')
        -> Select #787 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:86', status = 'pending')
        -> Select #789 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:86', status = 'running')
        -> Select #791 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:86', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #794 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:87', status = 'blocked')
        -> Select #796 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:87', status = 'pending')
        -> Select #798 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:87', status = 'running')
        -> Select #800 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:87', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #803 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:88', status = 'blocked')
        -> Select #805 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:88', status = 'pending')
        -> Select #807 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:88', status = 'running')
        -> Select #809 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:88', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #812 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:89', status = 'blocked')
        -> Select #814 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:89', status = 'pending')
        -> Select #816 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:89', status = 'running')
        -> Select #818 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:89', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #821 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:90', status = 'blocked')
        -> Select #823 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:90', status = 'pending')
        -> Select #825 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:90', status = 'running')
        -> Select #827 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:90', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #830 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:91', status = 'blocked')
        -> Select #832 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:91', status = 'pending')
        -> Select #834 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:91', status = 'running')
        -> Select #836 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:91', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #839 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:92', status = 'blocked')
        -> Select #841 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:92', status = 'pending')
        -> Select #843 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:92', status = 'running')
        -> Select #845 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:92', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #848 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:93', status = 'blocked')
        -> Select #850 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:93', status = 'pending')
        -> Select #852 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:93', status = 'running')
        -> Select #854 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:93', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #857 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:94', status = 'blocked')
        -> Select #859 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:94', status = 'pending')
        -> Select #861 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:94', status = 'running')
        -> Select #863 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:94', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #866 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:95', status = 'blocked')
        -> Select #868 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:95', status = 'pending')
        -> Select #870 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:95', status = 'running')
        -> Select #872 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:95', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #875 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:96', status = 'blocked')
        -> Select #877 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:96', status = 'pending')
        -> Select #879 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:96', status = 'running')
        -> Select #881 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:96', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #884 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:97', status = 'blocked')
        -> Select #886 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:97', status = 'pending')
        -> Select #888 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:97', status = 'running')
        -> Select #890 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:97', status = 'completed')
    -> Stream results
        -> Rows fetched before execution
        -> Select #893 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:98', status = 'blocked')
        -> Select #895 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:98', status = 'pending')
        -> Select #897 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:98', status = 'running')
        -> Select #899 (subquery in projection; run only once)
            -> Aggregate: count(0)
                -> Table scan on capped
                    -> Materialize
                        -> Limit: 10001 row(s)
                            -> Covering index lookup on queuert_job using queuert_job_status_idx (type_name = 'idx:type:98', status = 'completed')
```

## countWorkers/default

1. `countWorkers`

```
-> Aggregate: sum((queuert_worker.lease_until <= utc_timestamp(6))), sum((queuert_worker.lease_until > utc_timestamp(6)))
    -> Table scan on queuert_worker
```

## countWorkersByTypeName/default

1. `countWorkersByTypeName`

```
-> Sort: t.ord
    -> Stream results
        -> Left hash join (c.type_name = t.type_name)
            -> Materialize table function
            -> Hash
                -> Table scan on c
                    -> Materialize
                        -> Group aggregate: count(distinct tmp_field), count(distinct tmp_field)
                            -> Sort: wt.type_name
                                -> Stream results
                                    -> Nested loop inner join
                                        -> Table scan on w
                                        -> Materialize table function
```

## countWorkersByTypeName/batch100

1. `countWorkersByTypeName`

```
-> Sort: t.ord
    -> Stream results
        -> Left hash join (c.type_name = t.type_name)
            -> Materialize table function
            -> Hash
                -> Table scan on c
                    -> Materialize
                        -> Group aggregate: count(distinct tmp_field), count(distinct tmp_field)
                            -> Sort: wt.type_name
                                -> Stream results
                                    -> Nested loop inner join
                                        -> Table scan on w
                                        -> Materialize table function
```

## countRunningJobsByWorkerId/default

1. `countRunningJobsByWorkerId`

```
-> Sort: w.ord
    -> Table scan on <temporary>
        -> Aggregate using temporary table
            -> Nested loop left join
                -> Materialize table function
                -> Covering index lookup on j using queuert_job_attempt_by_idx (attempt_by = w.id, status = 'running')
```

## countRunningJobsByWorkerId/batch100

1. `countRunningJobsByWorkerId`

```
-> Sort: w.ord
    -> Table scan on <temporary>
        -> Aggregate using temporary table
            -> Nested loop left join
                -> Materialize table function
                -> Covering index lookup on j using queuert_job_attempt_by_idx (attempt_by = w.id, status = 'running')
```

## listJobs/noStatus/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_idx over (type_name = 'seed:pending:order') (reverse), with index condition: (j.type_name = 'seed:pending:order')
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/noStatus/fromTo

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_idx over (type_name = 'seed:pending:order' AND '<timestamp>' <= created_at <= '<timestamp>') (reverse), with index condition: ((j.type_name = 'seed:pending:order') and (j.created_at >= TIMESTAMP'<timestamp>') and (j.created_at <= TIMESTAMP'<timestamp>'))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/noStatus/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_idx over (type_name = 'seed:pending:order') (reverse), with index condition: (j.type_name = 'seed:pending:order')
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_idx over (type_name = 'seed:pending:order' AND created_at < '<timestamp>') OR (type_name = 'seed:pending:order' AND created_at = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((j.type_name = 'seed:pending:order') and ((j.created_at < TIMESTAMP'<timestamp>') or ((j.created_at = TIMESTAMP'<timestamp>') and (j.id < '<uuid>'))))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/pending/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:pending:order', status = 'pending') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/pending/fromTo

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_status_idx over (type_name = 'seed:pending:order' AND status = 'pending' AND '<timestamp>' <= status_ts <= '<timestamp>') (reverse), with index condition: ((j.`status` = 'pending') and (j.type_name = 'seed:pending:order') and (j.status_ts >= TIMESTAMP'<timestamp>') and (j.status_ts <= TIMESTAMP'<timestamp>'))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/pending/orderByCreatedAt

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Filter: (j.`status` = 'pending')
            -> Index range scan on j using queuert_job_idx over (type_name = 'seed:pending:order') (reverse), with index condition: (j.type_name = 'seed:pending:order')
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/pending/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:pending:order', status = 'pending') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_status_idx over (type_name = 'seed:pending:order' AND status = 'pending' AND NULL < status_ts < '<timestamp>') OR (type_name = 'seed:pending:order' AND status = 'pending' AND status_ts = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((j.`status` = 'pending') and (j.type_name = 'seed:pending:order') and ((j.status_ts < TIMESTAMP'<timestamp>') or ((j.status_ts = TIMESTAMP'<timestamp>') and (j.id < '<uuid>'))))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/blocked/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:blocked:fanin:1', status = 'blocked') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/blocked/fromTo

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_status_idx over (type_name = 'seed:blocked:fanin:1' AND status = 'blocked' AND '<timestamp>' <= status_ts <= '<timestamp>') (reverse), with index condition: ((j.`status` = 'blocked') and (j.type_name = 'seed:blocked:fanin:1') and (j.status_ts >= TIMESTAMP'<timestamp>') and (j.status_ts <= TIMESTAMP'<timestamp>'))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/blocked/orderByCreatedAt

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Filter: (j.`status` = 'blocked')
            -> Index lookup on j using queuert_job_idx (type_name = 'seed:blocked:fanin:1') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/blocked/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:blocked:fanin:1', status = 'blocked') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_status_idx over (type_name = 'seed:blocked:fanin:1' AND status = 'blocked' AND NULL < status_ts < '<timestamp>') OR (type_name = 'seed:blocked:fanin:1' AND status = 'blocked' AND status_ts = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((j.`status` = 'blocked') and (j.type_name = 'seed:blocked:fanin:1') and ((j.status_ts < TIMESTAMP'<timestamp>') or ((j.status_ts = TIMESTAMP'<timestamp>') and (j.id < '<uuid>'))))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/running/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:running:order', status = 'running') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/running/orderByCreatedAt

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Filter: (j.`status` = 'running')
            -> Index lookup on j using queuert_job_idx (type_name = 'seed:running:order') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/running/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:running:order', status = 'running') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_status_idx over (type_name = 'seed:running:order' AND status = 'running' AND NULL < status_ts < '<timestamp>') OR (type_name = 'seed:running:order' AND status = 'running' AND status_ts = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((j.`status` = 'running') and (j.type_name = 'seed:running:order') and ((j.status_ts < TIMESTAMP'<timestamp>') or ((j.status_ts = TIMESTAMP'<timestamp>') and (j.id < '<uuid>'))))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/completed/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:completed:order', status = 'completed') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/completed/orderByCreatedAt

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Filter: (j.`status` = 'completed')
            -> Index range scan on j using queuert_job_idx over (type_name = 'seed:completed:order') (reverse), with index condition: (j.type_name = 'seed:completed:order')
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listJobs/completed/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_status_idx (type_name = 'seed:completed:order', status = 'completed') (reverse)
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_status_idx over (type_name = 'seed:completed:order' AND status = 'completed' AND NULL < status_ts < '<timestamp>') OR (type_name = 'seed:completed:order' AND status = 'completed' AND status_ts = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((j.`status` = 'completed') and (j.type_name = 'seed:completed:order') and ((j.status_ts < TIMESTAMP'<timestamp>') or ((j.status_ts = TIMESTAMP'<timestamp>') and (j.id < '<uuid>'))))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listChains/noStatus/default

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Covering index lookup on h using queuert_chain_idx (type_name = 'seed:pending:order', chain_index = 0) (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/noStatus/nonBlocking

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.blocking = false)
                                    -> Index lookup on h using queuert_chain_idx (type_name = 'seed:pending:order', chain_index = 0) (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/noStatus/blocking

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Covering index lookup on h using queuert_chain_blocking_idx (type_name = 'seed:pending:order', blocking = true, chain_index = 0) (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/noStatus/fromTo

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: ((h.type_name = 'seed:pending:order') and (h.chain_index = 0) and (h.created_at >= TIMESTAMP'<timestamp>') and (h.created_at <= TIMESTAMP'<timestamp>'))
                                    -> Covering index range scan on h using queuert_chain_idx over (type_name = 'seed:pending:order' AND chain_index = 0 AND '<timestamp>' <= created_at <= '<timestamp>') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/noStatus/cursor

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 3 row(s)
                                -> Covering index lookup on h using queuert_chain_idx (type_name = 'seed:pending:order', chain_index = 0) (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

2. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: ((h.type_name = 'seed:pending:order') and (h.chain_index = 0) and ((h.created_at < TIMESTAMP'<timestamp>') or ((h.created_at = TIMESTAMP'<timestamp>') and (h.id < '<uuid>'))))
                                    -> Covering index range scan on h using queuert_chain_idx over (type_name = 'seed:pending:order' AND chain_index = 0 AND created_at < '<timestamp>') OR (type_name = 'seed:pending:order' AND chain_index = 0 AND created_at = '<timestamp>' AND id < '<uuid>') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/running/default

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_running_idx (type_name = 'seed:running:order', chain_status = 'running') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/running/nonBlocking

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: ((h.blocking = false) and (h.chain_index = 0))
                                    -> Index lookup on h using queuert_chain_running_idx (type_name = 'seed:running:order', chain_status = 'running') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/running/blocking

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_status = 'running')
                                    -> Index lookup on h using queuert_chain_blocking_idx (type_name = 'seed:running:order', blocking = true, chain_index = 0) (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/running/cursor

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 3 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_running_idx (type_name = 'seed:running:order', chain_status = 'running') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

2. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index range scan on h using queuert_chain_running_idx over (type_name = 'seed:running:order' AND chain_status = 'running' AND created_at < '<timestamp>') OR (type_name = 'seed:running:order' AND chain_status = 'running' AND created_at = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((h.chain_status = 'running') and (h.type_name = 'seed:running:order') and ((h.created_at < TIMESTAMP'<timestamp>') or ((h.created_at = TIMESTAMP'<timestamp>') and (h.id < '<uuid>'))))
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/default

1. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_completed_idx (type_name = 'seed:completed:order', chain_status = 'completed') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/nonBlocking

1. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: ((h.blocking = false) and (h.chain_index = 0))
                                    -> Index lookup on h using queuert_chain_completed_idx (type_name = 'seed:completed:order', chain_status = 'completed') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/blocking

1. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Sort: h.chain_completed_at DESC, h.id DESC, limit input to 21 row(s) per chunk
                                    -> Filter: (h.chain_status = 'completed')
                                        -> Index lookup on h using queuert_chain_blocking_idx (type_name = 'seed:completed:order', blocking = true, chain_index = 0)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/orderByCreatedAt

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_running_idx (type_name = 'seed:completed:order', chain_status = 'completed') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/orderByCompletedAt

1. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_completed_idx (type_name = 'seed:completed:order', chain_status = 'completed') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/cursor

1. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 3 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_completed_idx (type_name = 'seed:completed:order', chain_status = 'completed') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

2. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index range scan on h using queuert_chain_completed_idx over (type_name = 'seed:completed:order' AND chain_status = 'completed' AND NULL < chain_completed_at < '<timestamp>') OR (type_name = 'seed:completed:order' AND chain_status = 'completed' AND chain_completed_at = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((h.chain_status = 'completed') and (h.type_name = 'seed:completed:order') and ((h.chain_completed_at < TIMESTAMP'<timestamp>') or ((h.chain_completed_at = TIMESTAMP'<timestamp>') and (h.id < '<uuid>'))))
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/orderByCreatedAtCursor

1. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 3 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_running_idx (type_name = 'seed:completed:order', chain_status = 'completed') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

2. `dynamic`

```
-> Sort row IDs: h.created_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index range scan on h using queuert_chain_running_idx over (type_name = 'seed:completed:order' AND chain_status = 'completed' AND created_at < '<timestamp>') OR (type_name = 'seed:completed:order' AND chain_status = 'completed' AND created_at = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((h.chain_status = 'completed') and (h.type_name = 'seed:completed:order') and ((h.created_at < TIMESTAMP'<timestamp>') or ((h.created_at = TIMESTAMP'<timestamp>') and (h.id < '<uuid>'))))
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChains/completed/orderByCompletedAtCursor

1. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 3 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index lookup on h using queuert_chain_completed_idx (type_name = 'seed:completed:order', chain_status = 'completed') (reverse)
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

2. `dynamic`

```
-> Sort row IDs: h.chain_completed_at DESC, h.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop left join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Filter: (h.chain_index = 0)
                                    -> Index range scan on h using queuert_chain_completed_idx over (type_name = 'seed:completed:order' AND chain_status = 'completed' AND NULL < chain_completed_at < '<timestamp>') OR (type_name = 'seed:completed:order' AND chain_status = 'completed' AND chain_completed_at = '<timestamp>' AND id < '<uuid>') (reverse), with index condition: ((h.chain_status = 'completed') and (h.type_name = 'seed:completed:order') and ((h.chain_completed_at < TIMESTAMP'<timestamp>') or ((h.chain_completed_at = TIMESTAMP'<timestamp>') and (h.id < '<uuid>'))))
                    -> Single-row index lookup on h using PRIMARY (id = `page`.id)
                -> Filter: (t.id = (select #3))
                    -> Single-row index lookup on t using PRIMARY (id = (select #3))
                    -> Select #3 (subquery in condition; dependent)
                        -> Limit: 1 row(s)
                            -> Sort: tail_lookup.chain_index DESC, limit input to 1 row(s) per chunk
                                -> Filter: (tail_lookup.chain_index > 0)
                                    -> Covering index lookup on tail_lookup using queuert_chain_index_idx (chain_id = h.id)
```

## listChainJobs/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Index lookup on j using queuert_chain_index_idx (chain_id = '<uuid>')
```

## listChainJobs/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Index lookup on j using queuert_chain_index_idx (chain_id = '<uuid>')
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Filter: (j.chain_index > (select #2))
        -> Index range scan on j using queuert_chain_index_idx over (chain_id = '<uuid>' AND 1 < chain_index), with index condition: (j.chain_id = '<uuid>')
        -> Select #2 (subquery in condition; run only once)
            -> Rows fetched before execution
```

## listBlockedJobs/default

1. `dynamic`

```
-> Sort row IDs: j.created_at DESC, j.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop inner join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Sort: j.created_at DESC, j.id DESC, limit input to 21 row(s) per chunk
                                    -> Table scan on <temporary>
                                        -> Temporary table with deduplication
                                            -> Nested loop inner join
                                                -> Covering index lookup on jb using queuert_job_blocker_chain_idx (blocked_by_chain_id = '<uuid>')
                                                -> Single-row index lookup on j using PRIMARY (id = jb.job_id)
                    -> Single-row index lookup on j using PRIMARY (id = `page`.id)
                -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listBlockedJobs/cursor

1. `dynamic`

```
-> Sort row IDs: j.created_at DESC, j.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop inner join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 3 row(s)
                                -> Sort: j.created_at DESC, j.id DESC, limit input to 3 row(s) per chunk
                                    -> Table scan on <temporary>
                                        -> Temporary table with deduplication
                                            -> Nested loop inner join
                                                -> Covering index lookup on jb using queuert_job_blocker_chain_idx (blocked_by_chain_id = '<uuid>')
                                                -> Single-row index lookup on j using PRIMARY (id = jb.job_id)
                    -> Single-row index lookup on j using PRIMARY (id = `page`.id)
                -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `dynamic`

```
-> Sort row IDs: j.created_at DESC, j.id DESC
    -> Table scan on <temporary>
        -> Temporary table
            -> Nested loop inner join
                -> Nested loop inner join
                    -> Table scan on page
                        -> Materialize
                            -> Limit: 21 row(s)
                                -> Sort: j.created_at DESC, j.id DESC, limit input to 21 row(s) per chunk
                                    -> Table scan on <temporary>
                                        -> Temporary table with deduplication
                                            -> Nested loop inner join
                                                -> Covering index lookup on jb using queuert_job_blocker_chain_idx (blocked_by_chain_id = '<uuid>')
                                                -> Filter: ((j.created_at < TIMESTAMP'<timestamp>') or ((j.created_at = TIMESTAMP'<timestamp>') and (jb.job_id < '<uuid>')))
                                                    -> Single-row index lookup on j using PRIMARY (id = jb.job_id)
                    -> Single-row index lookup on j using PRIMARY (id = `page`.id)
                -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listWorkers/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Sort: w.started_at, w.id, limit input to 21 row(s) per chunk
        -> Table scan on w
```

## listWorkers/typeName

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Sort: w.started_at, w.id, limit input to 21 row(s) per chunk
        -> Filter: json_contains(w.type_names,<cache>(json_quote('seed:pending:order')))
            -> Table scan on w
```

## listWorkers/status

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Sort: w.started_at, w.id, limit input to 21 row(s) per chunk
        -> Filter: (w.lease_until <= <cache>(utc_timestamp(6)))
            -> Table scan on w
```

## listWorkers/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Index scan on w using queuert_worker_idx
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Sort: w.started_at, w.id, limit input to 21 row(s) per chunk
        -> Filter: ((w.started_at > TIMESTAMP'<timestamp>') or ((w.started_at = TIMESTAMP'<timestamp>') and (w.id > '<uuid>')))
            -> Table scan on w
```

## listWorkerJobs/default

1. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_attempt_by_idx (attempt_by = '<uuid>', status = 'running')
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

## listWorkerJobs/cursor

1. `dynamic`

```
-> Limit: 3 row(s)
    -> Nested loop inner join
        -> Index lookup on j using queuert_job_attempt_by_idx (attempt_by = '<uuid>', status = 'running')
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```

2. `dynamic`

```
-> Limit: 21 row(s)
    -> Nested loop inner join
        -> Index range scan on j using queuert_job_attempt_by_idx over (attempt_by = '<uuid>' AND status = 'running' AND attempt_at = '<timestamp>' AND '<uuid>' < id) OR (attempt_by = '<uuid>' AND status = 'running' AND '<timestamp>' < attempt_at), with index condition: ((j.attempt_by = '<uuid>') and (j.`status` = 'running') and ((j.attempt_at > TIMESTAMP'<timestamp>') or ((j.attempt_at = TIMESTAMP'<timestamp>') and (j.id > '<uuid>'))))
        -> Single-row index lookup on h using PRIMARY (id = j.chain_id)
```
