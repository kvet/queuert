# MariaDB query plans

Plans of every statement each query-performance case runs, at scale 100, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun `pnpm start` after a query or index change and review the diff.

## getChains/default

1. `getChains`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=Using where; End temporary
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getChains/lock

1. `lockChainHeads`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
```

2. `getChains`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=Using where; End temporary
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getJobs/default

1. `getJobs`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=End temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getJobs/lock

1. `getJobsLocked`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getWorkers/default

1. `getWorkers`

```
id=1  select_type=PRIMARY  table=w  type=ALL  possible_keys=PRIMARY  key=null  key_len=null  ref=null  Extra=
id=1  select_type=PRIMARY  table=<subquery2>  type=eq_ref  possible_keys=distinct_key  key=distinct_key  key_len=36  ref=func  Extra=
id=2  select_type=MATERIALIZED  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
```

## getWorkers/lock

1. `getWorkersLocked`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=w  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

## createJobs/default

1. `createJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `readCreatedJobs`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=End temporary
```

## createJobs/deduplication

1. `findDeduplicatedChains`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=4  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DEPENDENT SUBQUERY  table=e  type=ref  possible_keys=queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_deduplication_idx,queuert_chain_blocking_idx  key=queuert_chain_idx  key_len=1026  ref=*any*.d.type_name,const  Extra=Using index condition; Using where
id=3  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `createJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `readCreatedJobs`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=End temporary
```

## continueJobs/default

1. `completeContinuedJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.continue_from_id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `insertContinuations`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary
id=1  select_type=PRIMARY  table=c  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.continue_from_id  Extra=
id=1  select_type=PRIMARY  table=completed_by_batch  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using join buffer (flat, BNL join)
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `readContinuedJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=*any*.d.continue_from_id  Extra=Using where
id=1  select_type=SIMPLE  table=n  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.new_id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## addJobsBlockers/default

1. `lockBlockerHeads`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `flagBlockerHeads`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `insertJobBlockers`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

4. `blockDependents`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

5. `getJobs`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=End temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getJobBlockers/default

1. `getJobBlockers`

```
id=1  select_type=PRIMARY  table=b  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=PRIMARY  key_len=36  ref=const  Extra=Using where; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.b.blocked_by_chain_id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## unblockJobs/default

1. `findDependents`

```
id=1  select_type=PRIMARY  table=queuert_job_blocker  type=ref  possible_keys=queuert_job_blocker_chain_idx  key=queuert_job_blocker_chain_idx  key_len=36  ref=const  Extra=Using where; Using index
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `lockBlockedDependents`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
```

3. `findReleasedDependents`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=2  select_type=DEPENDENT SUBQUERY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=
id=2  select_type=DEPENDENT SUBQUERY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.jb.blocked_by_chain_id  Extra=Using where
```

4. `readDependents`

```
id=1  select_type=SIMPLE  table=jb  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=queuert_job_blocker_chain_idx  key_len=36  ref=const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=queuert_bench.jb.job_id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## startWorker/default

1. `startWorker`

```
id=1  select_type=PRIMARY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `getWorker`

```
id=1  select_type=SIMPLE  table=w  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
```

## extendWorkerLease/default

1. `lockLiveWorkerForUpdate`

```
id=1  select_type=PRIMARY  table=queuert_worker  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `extendWorkerLease`

```
id=1  select_type=PRIMARY  table=queuert_worker  type=range  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=null  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `getWorker`

```
id=1  select_type=SIMPLE  table=w  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
```

## stopWorker/default

1. `lockStoppedWorker`

```
id=1  select_type=SIMPLE  table=w  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
```

2. `stopWorker`

```
id=1  select_type=PRIMARY  table=queuert_worker  type=range  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=null  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

## startJobAttempts/default

1. `lockLiveWorker`

```
id=1  select_type=PRIMARY  table=queuert_worker  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `claimJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `readClaimedJobs`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=End temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=DEPENDENT SUBQUERY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.id  Extra=
```

## startJobAttempts/limit10

1. `lockLiveWorker`

```
id=1  select_type=PRIMARY  table=queuert_worker  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `claimJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `readClaimedJobs`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=End temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=DEPENDENT SUBQUERY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.id  Extra=
```

## completeJobs/default

1. `lockCompletedJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `completeJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.job_id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

## getStartAttemptDelayMs/default

No query plans.

## rescheduleJobs/default

1. `lockJobsForWrite`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `rescheduleJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.job_id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `getJobs`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=End temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## deleteChains/default

1. `lockDeletedChainHeads`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
```

2. `lockDeletedChains`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=*any*.d.id  Extra=
```

3. `getChains`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=Using where; End temporary
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

4. `deleteChainJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

## deleteChains/multiJob

1. `lockDeletedChainHeads`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
```

2. `lockDeletedChains`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=*any*.d.id  Extra=
```

3. `getChains`

```
id=1  select_type=PRIMARY  table=id_list  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Start temporary
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.id_list.id  Extra=Using where; End temporary
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

4. `deleteChainJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

## getChainTypeNames/default

1. `getChainTypeNames`

```
id=1  select_type=SIMPLE  table=queuert_job  type=range  possible_keys=null  key=queuert_chain_idx  key_len=1026  ref=null  Extra=Using where; Using index for group-by
```

## getJobTypeNames/default

1. `getJobTypeNames`

```
id=1  select_type=SIMPLE  table=queuert_job  type=range  possible_keys=null  key=queuert_chain_idx  key_len=1022  ref=null  Extra=Using index for group-by
```

## countChainsByTypeName/default

1. `dynamic`

```
id=1  select_type=PRIMARY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=4  select_type=SUBQUERY  table=<derived5>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=5  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=2  select_type=SUBQUERY  table=<derived3>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=3  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=6  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=9  select_type=SUBQUERY  table=<derived10>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=10  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=7  select_type=SUBQUERY  table=<derived8>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=8  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=11  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=14  select_type=SUBQUERY  table=<derived15>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=15  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=12  select_type=SUBQUERY  table=<derived13>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=13  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=16  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=19  select_type=SUBQUERY  table=<derived20>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=20  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=17  select_type=SUBQUERY  table=<derived18>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=18  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
```

## countJobsByTypeName/default

1. `dynamic`

```
id=1  select_type=PRIMARY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=8  select_type=SUBQUERY  table=<derived9>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=9  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=6  select_type=SUBQUERY  table=<derived7>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=7  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=4  select_type=SUBQUERY  table=<derived5>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=5  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=2  select_type=SUBQUERY  table=<derived3>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=3  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=10  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=17  select_type=SUBQUERY  table=<derived18>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=18  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=15  select_type=SUBQUERY  table=<derived16>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=16  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=13  select_type=SUBQUERY  table=<derived14>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=14  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=11  select_type=SUBQUERY  table=<derived12>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=12  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=19  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=26  select_type=SUBQUERY  table=<derived27>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=27  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=24  select_type=SUBQUERY  table=<derived25>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=25  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=22  select_type=SUBQUERY  table=<derived23>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=23  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=20  select_type=SUBQUERY  table=<derived21>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=21  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=28  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=35  select_type=SUBQUERY  table=<derived36>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=36  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=33  select_type=SUBQUERY  table=<derived34>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=34  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=31  select_type=SUBQUERY  table=<derived32>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=32  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=29  select_type=SUBQUERY  table=<derived30>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=30  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
```

## countWorkers/default

1. `countWorkers`

```
id=1  select_type=SIMPLE  table=queuert_worker  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
```

## countWorkersByTypeName/default

1. `countWorkersByTypeName`

```
id=1  select_type=SIMPLE  table=t  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using temporary; Using filesort
id=1  select_type=SIMPLE  table=w  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using where; Using join buffer (flat, BNL join)
```

## countRunningJobsByWorkerId/default

1. `countRunningJobsByWorkerId`

```
id=1  select_type=SIMPLE  table=w  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using temporary; Using filesort
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_attempt_by_idx  key=queuert_job_attempt_by_idx  key_len=55  ref=*any*.w.id,const  Extra=Using where; Using index
```

## listJobs/noStatus/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1022  ref=null  Extra=Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/noStatus/fromTo

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1030  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/noStatus/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1022  ref=null  Extra=Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

2. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=PRIMARY,queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1066  ref=null  Extra=Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/pending/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/pending/fromTo

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1049  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/pending/orderByCreatedAt

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1022  ref=null  Extra=Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/pending/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

2. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1085  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/blocked/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/blocked/fromTo

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1049  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/blocked/orderByCreatedAt

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1022  ref=const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/blocked/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

2. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1085  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/running/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/running/orderByCreatedAt

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1022  ref=null  Extra=Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/running/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

2. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1085  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/completed/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/completed/orderByCreatedAt

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_chain_index_idx,queuert_job_status_idx,queuert_job_idx,queuert_chain_idx,queuert_chain_running_idx,queuert_chain_completed_idx,queuert_chain_blocking_idx  key=queuert_job_idx  key_len=1022  ref=null  Extra=Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listJobs/completed/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

2. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1085  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listChains/noStatus/default

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_idx  key=queuert_chain_idx  key_len=1026  ref=const,const  Extra=Using where; Using index
```

## listChains/noStatus/nonBlocking

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_idx  key=queuert_chain_idx  key_len=1026  ref=const,const  Extra=Using index condition; Using where
```

## listChains/noStatus/blocking

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_blocking_idx  key=queuert_chain_blocking_idx  key_len=1027  ref=const,const,const  Extra=Using where; Using index
```

## listChains/noStatus/fromTo

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=range  possible_keys=queuert_chain_idx  key=queuert_chain_idx  key_len=1034  ref=null  Extra=Using where; Using index
```

## listChains/noStatus/cursor

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_idx  key=queuert_chain_idx  key_len=1026  ref=const,const  Extra=Using where; Using index
```

2. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=range  possible_keys=queuert_chain_idx  key=queuert_chain_idx  key_len=1070  ref=null  Extra=Using where; Using index
```

## listChains/running/default

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

## listChains/running/nonBlocking

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

## listChains/running/blocking

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_blocking_idx  key=queuert_chain_blocking_idx  key_len=1027  ref=const,const,const  Extra=Using index condition; Using where
```

## listChains/running/cursor

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

2. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=range  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1085  ref=null  Extra=Using index condition; Using where
```

## listChains/completed/default

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_completed_idx  key=queuert_chain_completed_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

## listChains/completed/nonBlocking

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_completed_idx  key=queuert_chain_completed_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

## listChains/completed/blocking

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_blocking_idx  key=queuert_chain_blocking_idx  key_len=1027  ref=const,const,const  Extra=Using index condition; Using where; Using filesort
```

## listChains/completed/orderByCreatedAt

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

## listChains/completed/orderByCompletedAt

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_completed_idx  key=queuert_chain_completed_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

## listChains/completed/cursor

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_completed_idx  key=queuert_chain_completed_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

2. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=range  possible_keys=queuert_chain_completed_idx  key=queuert_chain_completed_idx  key_len=1086  ref=null  Extra=Using index condition; Using where
```

## listChains/completed/orderByCreatedAtCursor

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

2. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=range  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1085  ref=null  Extra=Using index condition; Using where
```

## listChains/completed/orderByCompletedAtCursor

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=ref  possible_keys=queuert_chain_completed_idx  key=queuert_chain_completed_idx  key_len=1041  ref=const,const  Extra=Using index condition; Using where
```

2. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=3  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DERIVED  table=h  type=range  possible_keys=queuert_chain_completed_idx  key=queuert_chain_completed_idx  key_len=1086  ref=null  Extra=Using index condition; Using where
```

## listChainJobs/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=h  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=const  Extra=Using index condition; Using where; Using filesort
```

## listChainJobs/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=h  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=const  Extra=Using index condition; Using where; Using filesort
```

2. `dynamic`

```
id=1  select_type=PRIMARY  table=h  type=const  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=const  Extra=
id=1  select_type=PRIMARY  table=j  type=range  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=40  ref=null  Extra=Using index condition; Using where; Using filesort
id=2  select_type=SUBQUERY  table=c  type=const  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=const  Extra=
```

## listBlockedJobs/default

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=DERIVED  table=jb  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=queuert_job_blocker_chain_idx  key_len=36  ref=const  Extra=Using where; Using index; Using temporary; Using filesort
id=2  select_type=DERIVED  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.jb.job_id  Extra=
```

## listBlockedJobs/cursor

1. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=DERIVED  table=jb  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=queuert_job_blocker_chain_idx  key_len=36  ref=const  Extra=Using where; Using index; Using temporary; Using filesort
id=2  select_type=DERIVED  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.jb.job_id  Extra=
```

2. `dynamic`

```
id=1  select_type=PRIMARY  table=<derived2>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=page.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=DERIVED  table=jb  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=queuert_job_blocker_chain_idx  key_len=36  ref=const  Extra=Using where; Using index; Using temporary; Using filesort
id=2  select_type=DERIVED  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.jb.job_id  Extra=Using where
```

## listWorkers/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=w  type=index  possible_keys=null  key=queuert_worker_idx  key_len=8  ref=null  Extra=
```

## listWorkers/typeName

1. `dynamic`

```
id=1  select_type=SIMPLE  table=w  type=index  possible_keys=null  key=queuert_worker_idx  key_len=8  ref=null  Extra=Using where
```

## listWorkers/status

1. `dynamic`

```
id=1  select_type=SIMPLE  table=w  type=index  possible_keys=null  key=queuert_worker_idx  key_len=8  ref=null  Extra=Using where
```

## listWorkers/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=w  type=index  possible_keys=null  key=queuert_worker_idx  key_len=8  ref=null  Extra=
```

2. `dynamic`

```
id=1  select_type=SIMPLE  table=w  type=range  possible_keys=PRIMARY,queuert_worker_idx  key=queuert_worker_idx  key_len=44  ref=null  Extra=Using where
```

## listWorkerJobs/default

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_chain_index_idx,queuert_job_attempt_by_idx  key=queuert_job_attempt_by_idx  key_len=55  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## listWorkerJobs/cursor

1. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_chain_index_idx,queuert_job_attempt_by_idx  key=queuert_job_attempt_by_idx  key_len=55  ref=const,const  Extra=Using index condition; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

2. `dynamic`

```
id=1  select_type=SIMPLE  table=j  type=range  possible_keys=PRIMARY,queuert_chain_index_idx,queuert_job_attempt_by_idx  key=queuert_job_attempt_by_idx  key_len=100  ref=null  Extra=Using index condition
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```
