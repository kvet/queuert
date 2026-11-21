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
                -> Nested loop inner join
                    -> Filter: (d.continue_from_id is not null)
                        -> Materialize table function
                    -> Filter: (c.continued_to_id is not null)
                        -> Single-row index lookup on c using PRIMARY (id = d.continue_from_id)
                -> Materialize table function
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

## getJobBlockers/default

1. `getJobBlockers`

```
-> Nested loop left join
    -> Nested loop inner join
        -> Sort: b.`index`
            -> Covering index lookup on b using PRIMARY (job_id = '<uuid>')
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

2. `claimJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
```

3. `readClaimedJobs`

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

## startJobAttempts/limit10

1. `lockLiveWorker`

```
-> Rows fetched before execution
```

2. `claimJobs`

```
-> Update j (buffered)
    -> Nested loop inner join
        -> Filter: (d.id is not null)
            -> Materialize table function
        -> Single-row index lookup on j using PRIMARY (id = d.id)
```

3. `readClaimedJobs`

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

## getStartAttemptDelayMs/default

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
    -> Table scan on <temporary>
        -> Aggregate using temporary table
            -> Left hash join (no condition), extra conditions: json_contains(w.type_names,json_quote(t.type_name))
                -> Materialize table function
                -> Hash
                    -> Table scan on w
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
