# MariaDB query plans

Plans of every statement each query-performance case runs, at scale 100, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun `pnpm start` after a query or index change and review the diff.

## getChains/default

1. `getChains`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
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
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getChains/batch100

1. `getChains`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getChains/lockBatch100

1. `lockChainHeads`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
```

2. `getChains`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getChainTails/default

1. `getChainTails`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getChainTails/lock

1. `getChainTailsLocked`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getChainTails/batch100

1. `getChainTails`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getChainTails/lockBatch100

1. `getChainTailsLocked`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getJobs/default

1. `getJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getJobs/lock

1. `getJobsLocked`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getJobs/batch100

1. `getJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getJobs/lockBatch100

1. `getJobsLocked`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getWorkers/default

1. `getWorkers`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=w  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

## getWorkers/lock

1. `getWorkersLocked`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=w  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

## getWorkers/batch100

1. `getWorkers`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=w  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

## getWorkers/lockBatch100

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
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

## createJobs/deduplication

1. `findDeduplicatedChains`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=4  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DEPENDENT SUBQUERY  table=e  type=ref  possible_keys=queuert_chain_deduplication_idx  key=queuert_chain_deduplication_idx  key_len=2049  ref=*any*.d.deduplication_key,*any*.d.type_name,const  Extra=Using index condition; Using where
id=3  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `createJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `readCreatedJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

## createJobs/batch100

1. `createJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `readCreatedJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

## createJobs/deduplicationBatch100

1. `findDeduplicatedChains`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=4  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
id=2  select_type=DEPENDENT SUBQUERY  table=e  type=ref  possible_keys=queuert_chain_deduplication_idx  key=queuert_chain_deduplication_idx  key_len=2049  ref=*any*.d.deduplication_key,*any*.d.type_name,const  Extra=Using index condition; Using where
id=3  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `createJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `readCreatedJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
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
id=1  select_type=PRIMARY  table=c  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.continue_from_id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `readContinuedJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY,queuert_chain_index_idx  key=PRIMARY  key_len=36  ref=*any*.d.continue_from_id  Extra=Using where
id=1  select_type=SIMPLE  table=n  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.new_id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## continueJobs/batch100

1. `completeContinuedJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.continue_from_id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `insertContinuations`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary
id=1  select_type=PRIMARY  table=c  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.continue_from_id  Extra=Using where
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
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## addJobsBlockers/batch100

1. `lockBlockerHeads`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `insertJobBlockers`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `blockDependents`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

4. `getJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## getJobsBlockers/default

1. `getJobsBlockers`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary; Using filesort
id=1  select_type=PRIMARY  table=b  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.b.blocked_by_chain_id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getJobsBlockers/manyBlockers

1. `getJobsBlockers`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary; Using filesort
id=1  select_type=PRIMARY  table=b  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.b.blocked_by_chain_id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## getJobsBlockers/batch100

1. `getJobsBlockers`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary; Using filesort
id=1  select_type=PRIMARY  table=b  type=ref  possible_keys=PRIMARY,queuert_job_blocker_chain_idx  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.b.blocked_by_chain_id  Extra=
id=1  select_type=PRIMARY  table=t  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=func  Extra=Using where
id=2  select_type=DEPENDENT SUBQUERY  table=tail_lookup  type=ref  possible_keys=queuert_chain_index_idx  key=queuert_chain_index_idx  key_len=36  ref=queuert_bench.h.id  Extra=Using where; Using index
```

## unblockJobs/default

1. `lockDependentBlockers`

```
id=1  select_type=PRIMARY  table=jb  type=ref  possible_keys=queuert_job_blocker_chain_idx  key=queuert_job_blocker_chain_idx  key_len=36  ref=const  Extra=Using index condition; Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `countDownDependents`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `getJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## unblockJobs/batch100

1. `lockDependentBlockers`

```
id=1  select_type=PRIMARY  table=jb  type=ref  possible_keys=queuert_job_blocker_chain_idx  key=queuert_job_blocker_chain_idx  key_len=36  ref=const  Extra=Using index condition; Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

2. `countDownDependents`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=Using where
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

3. `getJobs`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
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

## startWorker/batch100

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
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=DEPENDENT SUBQUERY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.id  Extra=
```

## startJobAttempts/limit100

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
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
id=2  select_type=DEPENDENT SUBQUERY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.id  Extra=
```

## startJobAttempts/batch100

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
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
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

## completeJobs/batch100

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

## getStartAttemptDelayMs/batch100

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
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
```

## rescheduleJobs/batch100

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
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=SIMPLE  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=SIMPLE  table=h  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=queuert_bench.j.chain_id  Extra=
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

3. `lockDeletedChainBlockers`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary
id=1  select_type=SIMPLE  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
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

3. `lockDeletedChainBlockers`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary
id=1  select_type=SIMPLE  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
```

4. `deleteChainJobs`

```
id=1  select_type=PRIMARY  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where
id=1  select_type=PRIMARY  table=j  type=eq_ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=1  select_type=PRIMARY  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
id=2  select_type=SUBQUERY  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=Impossible WHERE
```

## deleteChains/batch100

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

3. `lockDeletedChainBlockers`

```
id=1  select_type=SIMPLE  table=d  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using where; Using temporary
id=1  select_type=SIMPLE  table=jb  type=ref  possible_keys=PRIMARY  key=PRIMARY  key_len=36  ref=*any*.d.id  Extra=
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

## countChainsByTypeName/batch100

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
id=21  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=24  select_type=SUBQUERY  table=<derived25>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=25  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=22  select_type=SUBQUERY  table=<derived23>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=23  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=26  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=29  select_type=SUBQUERY  table=<derived30>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=30  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=27  select_type=SUBQUERY  table=<derived28>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=28  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=31  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=34  select_type=SUBQUERY  table=<derived35>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=35  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=32  select_type=SUBQUERY  table=<derived33>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=33  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=36  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=39  select_type=SUBQUERY  table=<derived40>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=40  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=37  select_type=SUBQUERY  table=<derived38>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=38  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=41  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=44  select_type=SUBQUERY  table=<derived45>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=45  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=42  select_type=SUBQUERY  table=<derived43>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=43  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=46  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=49  select_type=SUBQUERY  table=<derived50>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=50  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=47  select_type=SUBQUERY  table=<derived48>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=48  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=51  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=54  select_type=SUBQUERY  table=<derived55>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=55  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=52  select_type=SUBQUERY  table=<derived53>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=53  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=56  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=59  select_type=SUBQUERY  table=<derived60>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=60  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=57  select_type=SUBQUERY  table=<derived58>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=58  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=61  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=64  select_type=SUBQUERY  table=<derived65>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=65  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=62  select_type=SUBQUERY  table=<derived63>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=63  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=66  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=69  select_type=SUBQUERY  table=<derived70>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=70  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=67  select_type=SUBQUERY  table=<derived68>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=68  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=71  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=74  select_type=SUBQUERY  table=<derived75>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=75  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=72  select_type=SUBQUERY  table=<derived73>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=73  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=76  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=79  select_type=SUBQUERY  table=<derived80>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=80  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=77  select_type=SUBQUERY  table=<derived78>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=78  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=81  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=84  select_type=SUBQUERY  table=<derived85>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=85  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=82  select_type=SUBQUERY  table=<derived83>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=83  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=86  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=89  select_type=SUBQUERY  table=<derived90>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=90  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=87  select_type=SUBQUERY  table=<derived88>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=88  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=91  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=94  select_type=SUBQUERY  table=<derived95>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=95  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=92  select_type=SUBQUERY  table=<derived93>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=93  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=96  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=99  select_type=SUBQUERY  table=<derived100>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=100  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=97  select_type=SUBQUERY  table=<derived98>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=98  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=101  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=104  select_type=SUBQUERY  table=<derived105>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=105  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=102  select_type=SUBQUERY  table=<derived103>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=103  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=106  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=109  select_type=SUBQUERY  table=<derived110>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=110  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=107  select_type=SUBQUERY  table=<derived108>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=108  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=111  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=114  select_type=SUBQUERY  table=<derived115>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=115  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=112  select_type=SUBQUERY  table=<derived113>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=113  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=116  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=119  select_type=SUBQUERY  table=<derived120>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=120  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=117  select_type=SUBQUERY  table=<derived118>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=118  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=121  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=124  select_type=SUBQUERY  table=<derived125>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=125  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=122  select_type=SUBQUERY  table=<derived123>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=123  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=126  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=129  select_type=SUBQUERY  table=<derived130>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=130  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=127  select_type=SUBQUERY  table=<derived128>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=128  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=131  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=134  select_type=SUBQUERY  table=<derived135>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=135  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=132  select_type=SUBQUERY  table=<derived133>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=133  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=136  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=139  select_type=SUBQUERY  table=<derived140>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=140  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=137  select_type=SUBQUERY  table=<derived138>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=138  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=141  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=144  select_type=SUBQUERY  table=<derived145>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=145  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=142  select_type=SUBQUERY  table=<derived143>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=143  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=146  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=149  select_type=SUBQUERY  table=<derived150>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=150  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=147  select_type=SUBQUERY  table=<derived148>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=148  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=151  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=154  select_type=SUBQUERY  table=<derived155>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=155  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=152  select_type=SUBQUERY  table=<derived153>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=153  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=156  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=159  select_type=SUBQUERY  table=<derived160>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=160  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=157  select_type=SUBQUERY  table=<derived158>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=158  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=161  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=164  select_type=SUBQUERY  table=<derived165>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=165  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=162  select_type=SUBQUERY  table=<derived163>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=163  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=166  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=169  select_type=SUBQUERY  table=<derived170>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=170  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=167  select_type=SUBQUERY  table=<derived168>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=168  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=171  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=174  select_type=SUBQUERY  table=<derived175>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=175  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=172  select_type=SUBQUERY  table=<derived173>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=173  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=176  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=179  select_type=SUBQUERY  table=<derived180>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=180  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=177  select_type=SUBQUERY  table=<derived178>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=178  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=181  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=184  select_type=SUBQUERY  table=<derived185>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=185  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=182  select_type=SUBQUERY  table=<derived183>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=183  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=186  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=189  select_type=SUBQUERY  table=<derived190>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=190  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=187  select_type=SUBQUERY  table=<derived188>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=188  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=191  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=194  select_type=SUBQUERY  table=<derived195>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=195  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=192  select_type=SUBQUERY  table=<derived193>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=193  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=196  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=199  select_type=SUBQUERY  table=<derived200>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=200  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=197  select_type=SUBQUERY  table=<derived198>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=198  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=201  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=204  select_type=SUBQUERY  table=<derived205>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=205  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=202  select_type=SUBQUERY  table=<derived203>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=203  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=206  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=209  select_type=SUBQUERY  table=<derived210>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=210  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=207  select_type=SUBQUERY  table=<derived208>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=208  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=211  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=214  select_type=SUBQUERY  table=<derived215>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=215  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=212  select_type=SUBQUERY  table=<derived213>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=213  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=216  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=219  select_type=SUBQUERY  table=<derived220>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=220  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=217  select_type=SUBQUERY  table=<derived218>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=218  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=221  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=224  select_type=SUBQUERY  table=<derived225>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=225  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=222  select_type=SUBQUERY  table=<derived223>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=223  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=226  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=229  select_type=SUBQUERY  table=<derived230>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=230  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=227  select_type=SUBQUERY  table=<derived228>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=228  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=231  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=234  select_type=SUBQUERY  table=<derived235>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=235  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=232  select_type=SUBQUERY  table=<derived233>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=233  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=236  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=239  select_type=SUBQUERY  table=<derived240>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=240  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=237  select_type=SUBQUERY  table=<derived238>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=238  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=241  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=244  select_type=SUBQUERY  table=<derived245>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=245  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=242  select_type=SUBQUERY  table=<derived243>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=243  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=246  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=249  select_type=SUBQUERY  table=<derived250>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=250  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=247  select_type=SUBQUERY  table=<derived248>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=248  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=251  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=254  select_type=SUBQUERY  table=<derived255>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=255  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=252  select_type=SUBQUERY  table=<derived253>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=253  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=256  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=259  select_type=SUBQUERY  table=<derived260>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=260  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=257  select_type=SUBQUERY  table=<derived258>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=258  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=261  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=264  select_type=SUBQUERY  table=<derived265>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=265  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=262  select_type=SUBQUERY  table=<derived263>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=263  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=266  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=269  select_type=SUBQUERY  table=<derived270>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=270  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=267  select_type=SUBQUERY  table=<derived268>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=268  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=271  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=274  select_type=SUBQUERY  table=<derived275>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=275  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=272  select_type=SUBQUERY  table=<derived273>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=273  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=276  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=279  select_type=SUBQUERY  table=<derived280>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=280  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=277  select_type=SUBQUERY  table=<derived278>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=278  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=281  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=284  select_type=SUBQUERY  table=<derived285>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=285  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=282  select_type=SUBQUERY  table=<derived283>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=283  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=286  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=289  select_type=SUBQUERY  table=<derived290>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=290  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=287  select_type=SUBQUERY  table=<derived288>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=288  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=291  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=294  select_type=SUBQUERY  table=<derived295>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=295  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=292  select_type=SUBQUERY  table=<derived293>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=293  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=296  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=299  select_type=SUBQUERY  table=<derived300>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=300  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=297  select_type=SUBQUERY  table=<derived298>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=298  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=301  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=304  select_type=SUBQUERY  table=<derived305>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=305  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=302  select_type=SUBQUERY  table=<derived303>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=303  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=306  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=309  select_type=SUBQUERY  table=<derived310>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=310  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=307  select_type=SUBQUERY  table=<derived308>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=308  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=311  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=314  select_type=SUBQUERY  table=<derived315>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=315  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=312  select_type=SUBQUERY  table=<derived313>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=313  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=316  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=319  select_type=SUBQUERY  table=<derived320>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=320  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=317  select_type=SUBQUERY  table=<derived318>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=318  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=321  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=324  select_type=SUBQUERY  table=<derived325>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=325  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=322  select_type=SUBQUERY  table=<derived323>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=323  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=326  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=329  select_type=SUBQUERY  table=<derived330>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=330  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=327  select_type=SUBQUERY  table=<derived328>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=328  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=331  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=334  select_type=SUBQUERY  table=<derived335>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=335  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=332  select_type=SUBQUERY  table=<derived333>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=333  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=336  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=339  select_type=SUBQUERY  table=<derived340>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=340  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=337  select_type=SUBQUERY  table=<derived338>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=338  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=341  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=344  select_type=SUBQUERY  table=<derived345>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=345  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=342  select_type=SUBQUERY  table=<derived343>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=343  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=346  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=349  select_type=SUBQUERY  table=<derived350>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=350  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=347  select_type=SUBQUERY  table=<derived348>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=348  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=351  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=354  select_type=SUBQUERY  table=<derived355>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=355  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=352  select_type=SUBQUERY  table=<derived353>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=353  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=356  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=359  select_type=SUBQUERY  table=<derived360>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=360  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=357  select_type=SUBQUERY  table=<derived358>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=358  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=361  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=364  select_type=SUBQUERY  table=<derived365>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=365  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=362  select_type=SUBQUERY  table=<derived363>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=363  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=366  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=369  select_type=SUBQUERY  table=<derived370>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=370  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=367  select_type=SUBQUERY  table=<derived368>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=368  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=371  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=374  select_type=SUBQUERY  table=<derived375>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=375  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=372  select_type=SUBQUERY  table=<derived373>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=373  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=376  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=379  select_type=SUBQUERY  table=<derived380>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=380  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=377  select_type=SUBQUERY  table=<derived378>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=378  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=381  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=384  select_type=SUBQUERY  table=<derived385>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=385  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=382  select_type=SUBQUERY  table=<derived383>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=383  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=386  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=389  select_type=SUBQUERY  table=<derived390>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=390  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=387  select_type=SUBQUERY  table=<derived388>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=388  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=391  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=394  select_type=SUBQUERY  table=<derived395>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=395  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=392  select_type=SUBQUERY  table=<derived393>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=393  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=396  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=399  select_type=SUBQUERY  table=<derived400>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=400  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=397  select_type=SUBQUERY  table=<derived398>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=398  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=401  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=404  select_type=SUBQUERY  table=<derived405>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=405  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=402  select_type=SUBQUERY  table=<derived403>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=403  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=406  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=409  select_type=SUBQUERY  table=<derived410>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=410  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=407  select_type=SUBQUERY  table=<derived408>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=408  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=411  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=414  select_type=SUBQUERY  table=<derived415>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=415  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=412  select_type=SUBQUERY  table=<derived413>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=413  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=416  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=419  select_type=SUBQUERY  table=<derived420>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=420  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=417  select_type=SUBQUERY  table=<derived418>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=418  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=421  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=424  select_type=SUBQUERY  table=<derived425>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=425  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=422  select_type=SUBQUERY  table=<derived423>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=423  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=426  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=429  select_type=SUBQUERY  table=<derived430>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=430  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=427  select_type=SUBQUERY  table=<derived428>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=428  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=431  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=434  select_type=SUBQUERY  table=<derived435>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=435  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=432  select_type=SUBQUERY  table=<derived433>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=433  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=436  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=439  select_type=SUBQUERY  table=<derived440>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=440  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=437  select_type=SUBQUERY  table=<derived438>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=438  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=441  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=444  select_type=SUBQUERY  table=<derived445>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=445  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=442  select_type=SUBQUERY  table=<derived443>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=443  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=446  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=449  select_type=SUBQUERY  table=<derived450>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=450  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=447  select_type=SUBQUERY  table=<derived448>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=448  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=451  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=454  select_type=SUBQUERY  table=<derived455>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=455  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=452  select_type=SUBQUERY  table=<derived453>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=453  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=456  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=459  select_type=SUBQUERY  table=<derived460>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=460  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=457  select_type=SUBQUERY  table=<derived458>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=458  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=461  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=464  select_type=SUBQUERY  table=<derived465>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=465  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=462  select_type=SUBQUERY  table=<derived463>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=463  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=466  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=469  select_type=SUBQUERY  table=<derived470>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=470  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=467  select_type=SUBQUERY  table=<derived468>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=468  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=471  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=474  select_type=SUBQUERY  table=<derived475>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=475  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=472  select_type=SUBQUERY  table=<derived473>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=473  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=476  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=479  select_type=SUBQUERY  table=<derived480>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=480  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=477  select_type=SUBQUERY  table=<derived478>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=478  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=481  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=484  select_type=SUBQUERY  table=<derived485>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=485  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=482  select_type=SUBQUERY  table=<derived483>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=483  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=486  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=489  select_type=SUBQUERY  table=<derived490>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=490  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=487  select_type=SUBQUERY  table=<derived488>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=488  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=491  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=494  select_type=SUBQUERY  table=<derived495>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=495  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=492  select_type=SUBQUERY  table=<derived493>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=493  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=496  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=499  select_type=SUBQUERY  table=<derived500>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=500  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
id=497  select_type=SUBQUERY  table=<derived498>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=498  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_chain_running_idx  key=queuert_chain_running_idx  key_len=1041  ref=const,const  Extra=Using where; Using index
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

## countJobsByTypeName/batch100

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
id=37  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=44  select_type=SUBQUERY  table=<derived45>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=45  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=42  select_type=SUBQUERY  table=<derived43>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=43  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=40  select_type=SUBQUERY  table=<derived41>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=41  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=38  select_type=SUBQUERY  table=<derived39>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=39  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=46  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=53  select_type=SUBQUERY  table=<derived54>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=54  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=51  select_type=SUBQUERY  table=<derived52>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=52  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=49  select_type=SUBQUERY  table=<derived50>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=50  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=47  select_type=SUBQUERY  table=<derived48>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=48  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=55  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=62  select_type=SUBQUERY  table=<derived63>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=63  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=60  select_type=SUBQUERY  table=<derived61>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=61  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=58  select_type=SUBQUERY  table=<derived59>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=59  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=56  select_type=SUBQUERY  table=<derived57>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=57  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=64  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=71  select_type=SUBQUERY  table=<derived72>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=72  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=69  select_type=SUBQUERY  table=<derived70>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=70  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=67  select_type=SUBQUERY  table=<derived68>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=68  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=65  select_type=SUBQUERY  table=<derived66>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=66  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=73  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=80  select_type=SUBQUERY  table=<derived81>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=81  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=78  select_type=SUBQUERY  table=<derived79>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=79  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=76  select_type=SUBQUERY  table=<derived77>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=77  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=74  select_type=SUBQUERY  table=<derived75>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=75  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=82  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=89  select_type=SUBQUERY  table=<derived90>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=90  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=87  select_type=SUBQUERY  table=<derived88>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=88  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=85  select_type=SUBQUERY  table=<derived86>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=86  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=83  select_type=SUBQUERY  table=<derived84>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=84  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=91  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=98  select_type=SUBQUERY  table=<derived99>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=99  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=96  select_type=SUBQUERY  table=<derived97>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=97  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=94  select_type=SUBQUERY  table=<derived95>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=95  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=92  select_type=SUBQUERY  table=<derived93>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=93  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=100  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=107  select_type=SUBQUERY  table=<derived108>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=108  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=105  select_type=SUBQUERY  table=<derived106>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=106  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=103  select_type=SUBQUERY  table=<derived104>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=104  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=101  select_type=SUBQUERY  table=<derived102>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=102  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=109  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=116  select_type=SUBQUERY  table=<derived117>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=117  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=114  select_type=SUBQUERY  table=<derived115>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=115  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=112  select_type=SUBQUERY  table=<derived113>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=113  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=110  select_type=SUBQUERY  table=<derived111>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=111  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=118  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=125  select_type=SUBQUERY  table=<derived126>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=126  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=123  select_type=SUBQUERY  table=<derived124>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=124  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=121  select_type=SUBQUERY  table=<derived122>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=122  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=119  select_type=SUBQUERY  table=<derived120>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=120  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=127  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=134  select_type=SUBQUERY  table=<derived135>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=135  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=132  select_type=SUBQUERY  table=<derived133>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=133  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=130  select_type=SUBQUERY  table=<derived131>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=131  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=128  select_type=SUBQUERY  table=<derived129>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=129  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=136  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=143  select_type=SUBQUERY  table=<derived144>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=144  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=141  select_type=SUBQUERY  table=<derived142>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=142  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=139  select_type=SUBQUERY  table=<derived140>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=140  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=137  select_type=SUBQUERY  table=<derived138>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=138  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=145  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=152  select_type=SUBQUERY  table=<derived153>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=153  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=150  select_type=SUBQUERY  table=<derived151>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=151  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=148  select_type=SUBQUERY  table=<derived149>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=149  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=146  select_type=SUBQUERY  table=<derived147>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=147  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=154  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=161  select_type=SUBQUERY  table=<derived162>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=162  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=159  select_type=SUBQUERY  table=<derived160>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=160  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=157  select_type=SUBQUERY  table=<derived158>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=158  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=155  select_type=SUBQUERY  table=<derived156>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=156  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=163  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=170  select_type=SUBQUERY  table=<derived171>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=171  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=168  select_type=SUBQUERY  table=<derived169>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=169  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=166  select_type=SUBQUERY  table=<derived167>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=167  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=164  select_type=SUBQUERY  table=<derived165>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=165  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=172  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=179  select_type=SUBQUERY  table=<derived180>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=180  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=177  select_type=SUBQUERY  table=<derived178>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=178  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=175  select_type=SUBQUERY  table=<derived176>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=176  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=173  select_type=SUBQUERY  table=<derived174>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=174  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=181  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=188  select_type=SUBQUERY  table=<derived189>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=189  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=186  select_type=SUBQUERY  table=<derived187>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=187  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=184  select_type=SUBQUERY  table=<derived185>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=185  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=182  select_type=SUBQUERY  table=<derived183>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=183  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=190  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=197  select_type=SUBQUERY  table=<derived198>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=198  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=195  select_type=SUBQUERY  table=<derived196>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=196  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=193  select_type=SUBQUERY  table=<derived194>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=194  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=191  select_type=SUBQUERY  table=<derived192>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=192  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=199  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=206  select_type=SUBQUERY  table=<derived207>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=207  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=204  select_type=SUBQUERY  table=<derived205>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=205  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=202  select_type=SUBQUERY  table=<derived203>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=203  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=200  select_type=SUBQUERY  table=<derived201>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=201  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=208  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=215  select_type=SUBQUERY  table=<derived216>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=216  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=213  select_type=SUBQUERY  table=<derived214>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=214  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=211  select_type=SUBQUERY  table=<derived212>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=212  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=209  select_type=SUBQUERY  table=<derived210>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=210  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=217  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=224  select_type=SUBQUERY  table=<derived225>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=225  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=222  select_type=SUBQUERY  table=<derived223>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=223  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=220  select_type=SUBQUERY  table=<derived221>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=221  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=218  select_type=SUBQUERY  table=<derived219>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=219  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=226  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=233  select_type=SUBQUERY  table=<derived234>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=234  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=231  select_type=SUBQUERY  table=<derived232>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=232  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=229  select_type=SUBQUERY  table=<derived230>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=230  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=227  select_type=SUBQUERY  table=<derived228>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=228  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=235  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=242  select_type=SUBQUERY  table=<derived243>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=243  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=240  select_type=SUBQUERY  table=<derived241>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=241  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=238  select_type=SUBQUERY  table=<derived239>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=239  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=236  select_type=SUBQUERY  table=<derived237>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=237  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=244  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=251  select_type=SUBQUERY  table=<derived252>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=252  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=249  select_type=SUBQUERY  table=<derived250>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=250  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=247  select_type=SUBQUERY  table=<derived248>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=248  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=245  select_type=SUBQUERY  table=<derived246>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=246  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=253  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=260  select_type=SUBQUERY  table=<derived261>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=261  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=258  select_type=SUBQUERY  table=<derived259>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=259  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=256  select_type=SUBQUERY  table=<derived257>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=257  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=254  select_type=SUBQUERY  table=<derived255>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=255  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=262  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=269  select_type=SUBQUERY  table=<derived270>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=270  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=267  select_type=SUBQUERY  table=<derived268>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=268  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=265  select_type=SUBQUERY  table=<derived266>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=266  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=263  select_type=SUBQUERY  table=<derived264>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=264  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=271  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=278  select_type=SUBQUERY  table=<derived279>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=279  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=276  select_type=SUBQUERY  table=<derived277>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=277  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=274  select_type=SUBQUERY  table=<derived275>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=275  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=272  select_type=SUBQUERY  table=<derived273>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=273  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=280  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=287  select_type=SUBQUERY  table=<derived288>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=288  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=285  select_type=SUBQUERY  table=<derived286>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=286  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=283  select_type=SUBQUERY  table=<derived284>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=284  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=281  select_type=SUBQUERY  table=<derived282>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=282  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=289  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=296  select_type=SUBQUERY  table=<derived297>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=297  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=294  select_type=SUBQUERY  table=<derived295>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=295  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=292  select_type=SUBQUERY  table=<derived293>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=293  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=290  select_type=SUBQUERY  table=<derived291>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=291  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=298  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=305  select_type=SUBQUERY  table=<derived306>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=306  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=303  select_type=SUBQUERY  table=<derived304>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=304  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=301  select_type=SUBQUERY  table=<derived302>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=302  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=299  select_type=SUBQUERY  table=<derived300>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=300  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=307  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=314  select_type=SUBQUERY  table=<derived315>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=315  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=312  select_type=SUBQUERY  table=<derived313>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=313  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=310  select_type=SUBQUERY  table=<derived311>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=311  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=308  select_type=SUBQUERY  table=<derived309>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=309  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=316  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=323  select_type=SUBQUERY  table=<derived324>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=324  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=321  select_type=SUBQUERY  table=<derived322>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=322  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=319  select_type=SUBQUERY  table=<derived320>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=320  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=317  select_type=SUBQUERY  table=<derived318>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=318  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=325  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=332  select_type=SUBQUERY  table=<derived333>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=333  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=330  select_type=SUBQUERY  table=<derived331>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=331  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=328  select_type=SUBQUERY  table=<derived329>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=329  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=326  select_type=SUBQUERY  table=<derived327>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=327  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=334  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=341  select_type=SUBQUERY  table=<derived342>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=342  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=339  select_type=SUBQUERY  table=<derived340>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=340  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=337  select_type=SUBQUERY  table=<derived338>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=338  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=335  select_type=SUBQUERY  table=<derived336>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=336  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=343  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=350  select_type=SUBQUERY  table=<derived351>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=351  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=348  select_type=SUBQUERY  table=<derived349>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=349  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=346  select_type=SUBQUERY  table=<derived347>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=347  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=344  select_type=SUBQUERY  table=<derived345>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=345  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=352  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=359  select_type=SUBQUERY  table=<derived360>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=360  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=357  select_type=SUBQUERY  table=<derived358>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=358  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=355  select_type=SUBQUERY  table=<derived356>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=356  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=353  select_type=SUBQUERY  table=<derived354>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=354  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=361  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=368  select_type=SUBQUERY  table=<derived369>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=369  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=366  select_type=SUBQUERY  table=<derived367>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=367  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=364  select_type=SUBQUERY  table=<derived365>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=365  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=362  select_type=SUBQUERY  table=<derived363>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=363  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=370  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=377  select_type=SUBQUERY  table=<derived378>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=378  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=375  select_type=SUBQUERY  table=<derived376>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=376  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=373  select_type=SUBQUERY  table=<derived374>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=374  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=371  select_type=SUBQUERY  table=<derived372>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=372  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=379  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=386  select_type=SUBQUERY  table=<derived387>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=387  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=384  select_type=SUBQUERY  table=<derived385>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=385  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=382  select_type=SUBQUERY  table=<derived383>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=383  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=380  select_type=SUBQUERY  table=<derived381>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=381  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=388  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=395  select_type=SUBQUERY  table=<derived396>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=396  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=393  select_type=SUBQUERY  table=<derived394>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=394  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=391  select_type=SUBQUERY  table=<derived392>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=392  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=389  select_type=SUBQUERY  table=<derived390>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=390  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=397  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=404  select_type=SUBQUERY  table=<derived405>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=405  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=402  select_type=SUBQUERY  table=<derived403>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=403  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=400  select_type=SUBQUERY  table=<derived401>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=401  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=398  select_type=SUBQUERY  table=<derived399>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=399  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=406  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=413  select_type=SUBQUERY  table=<derived414>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=414  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=411  select_type=SUBQUERY  table=<derived412>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=412  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=409  select_type=SUBQUERY  table=<derived410>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=410  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=407  select_type=SUBQUERY  table=<derived408>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=408  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=415  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=422  select_type=SUBQUERY  table=<derived423>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=423  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=420  select_type=SUBQUERY  table=<derived421>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=421  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=418  select_type=SUBQUERY  table=<derived419>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=419  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=416  select_type=SUBQUERY  table=<derived417>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=417  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=424  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=431  select_type=SUBQUERY  table=<derived432>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=432  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=429  select_type=SUBQUERY  table=<derived430>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=430  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=427  select_type=SUBQUERY  table=<derived428>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=428  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=425  select_type=SUBQUERY  table=<derived426>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=426  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=433  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=440  select_type=SUBQUERY  table=<derived441>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=441  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=438  select_type=SUBQUERY  table=<derived439>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=439  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=436  select_type=SUBQUERY  table=<derived437>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=437  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=434  select_type=SUBQUERY  table=<derived435>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=435  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=442  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=449  select_type=SUBQUERY  table=<derived450>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=450  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=447  select_type=SUBQUERY  table=<derived448>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=448  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=445  select_type=SUBQUERY  table=<derived446>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=446  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=443  select_type=SUBQUERY  table=<derived444>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=444  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=451  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=458  select_type=SUBQUERY  table=<derived459>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=459  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=456  select_type=SUBQUERY  table=<derived457>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=457  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=454  select_type=SUBQUERY  table=<derived455>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=455  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=452  select_type=SUBQUERY  table=<derived453>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=453  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=460  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=467  select_type=SUBQUERY  table=<derived468>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=468  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=465  select_type=SUBQUERY  table=<derived466>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=466  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=463  select_type=SUBQUERY  table=<derived464>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=464  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=461  select_type=SUBQUERY  table=<derived462>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=462  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=469  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=476  select_type=SUBQUERY  table=<derived477>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=477  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=474  select_type=SUBQUERY  table=<derived475>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=475  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=472  select_type=SUBQUERY  table=<derived473>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=473  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=470  select_type=SUBQUERY  table=<derived471>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=471  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=478  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=485  select_type=SUBQUERY  table=<derived486>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=486  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=483  select_type=SUBQUERY  table=<derived484>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=484  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=481  select_type=SUBQUERY  table=<derived482>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=482  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=479  select_type=SUBQUERY  table=<derived480>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=480  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=487  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=494  select_type=SUBQUERY  table=<derived495>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=495  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=492  select_type=SUBQUERY  table=<derived493>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=493  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=490  select_type=SUBQUERY  table=<derived491>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=491  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=488  select_type=SUBQUERY  table=<derived489>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=489  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=496  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=503  select_type=SUBQUERY  table=<derived504>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=504  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=501  select_type=SUBQUERY  table=<derived502>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=502  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=499  select_type=SUBQUERY  table=<derived500>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=500  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=497  select_type=SUBQUERY  table=<derived498>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=498  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=505  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=512  select_type=SUBQUERY  table=<derived513>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=513  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=510  select_type=SUBQUERY  table=<derived511>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=511  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=508  select_type=SUBQUERY  table=<derived509>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=509  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=506  select_type=SUBQUERY  table=<derived507>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=507  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=514  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=521  select_type=SUBQUERY  table=<derived522>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=522  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=519  select_type=SUBQUERY  table=<derived520>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=520  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=517  select_type=SUBQUERY  table=<derived518>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=518  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=515  select_type=SUBQUERY  table=<derived516>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=516  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=523  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=530  select_type=SUBQUERY  table=<derived531>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=531  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=528  select_type=SUBQUERY  table=<derived529>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=529  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=526  select_type=SUBQUERY  table=<derived527>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=527  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=524  select_type=SUBQUERY  table=<derived525>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=525  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=532  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=539  select_type=SUBQUERY  table=<derived540>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=540  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=537  select_type=SUBQUERY  table=<derived538>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=538  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=535  select_type=SUBQUERY  table=<derived536>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=536  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=533  select_type=SUBQUERY  table=<derived534>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=534  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=541  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=548  select_type=SUBQUERY  table=<derived549>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=549  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=546  select_type=SUBQUERY  table=<derived547>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=547  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=544  select_type=SUBQUERY  table=<derived545>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=545  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=542  select_type=SUBQUERY  table=<derived543>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=543  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=550  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=557  select_type=SUBQUERY  table=<derived558>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=558  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=555  select_type=SUBQUERY  table=<derived556>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=556  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=553  select_type=SUBQUERY  table=<derived554>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=554  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=551  select_type=SUBQUERY  table=<derived552>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=552  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=559  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=566  select_type=SUBQUERY  table=<derived567>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=567  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=564  select_type=SUBQUERY  table=<derived565>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=565  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=562  select_type=SUBQUERY  table=<derived563>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=563  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=560  select_type=SUBQUERY  table=<derived561>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=561  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=568  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=575  select_type=SUBQUERY  table=<derived576>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=576  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=573  select_type=SUBQUERY  table=<derived574>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=574  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=571  select_type=SUBQUERY  table=<derived572>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=572  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=569  select_type=SUBQUERY  table=<derived570>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=570  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=577  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=584  select_type=SUBQUERY  table=<derived585>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=585  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=582  select_type=SUBQUERY  table=<derived583>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=583  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=580  select_type=SUBQUERY  table=<derived581>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=581  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=578  select_type=SUBQUERY  table=<derived579>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=579  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=586  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=593  select_type=SUBQUERY  table=<derived594>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=594  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=591  select_type=SUBQUERY  table=<derived592>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=592  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=589  select_type=SUBQUERY  table=<derived590>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=590  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=587  select_type=SUBQUERY  table=<derived588>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=588  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=595  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=602  select_type=SUBQUERY  table=<derived603>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=603  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=600  select_type=SUBQUERY  table=<derived601>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=601  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=598  select_type=SUBQUERY  table=<derived599>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=599  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=596  select_type=SUBQUERY  table=<derived597>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=597  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=604  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=611  select_type=SUBQUERY  table=<derived612>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=612  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=609  select_type=SUBQUERY  table=<derived610>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=610  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=607  select_type=SUBQUERY  table=<derived608>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=608  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=605  select_type=SUBQUERY  table=<derived606>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=606  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=613  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=620  select_type=SUBQUERY  table=<derived621>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=621  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=618  select_type=SUBQUERY  table=<derived619>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=619  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=616  select_type=SUBQUERY  table=<derived617>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=617  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=614  select_type=SUBQUERY  table=<derived615>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=615  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=622  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=629  select_type=SUBQUERY  table=<derived630>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=630  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=627  select_type=SUBQUERY  table=<derived628>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=628  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=625  select_type=SUBQUERY  table=<derived626>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=626  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=623  select_type=SUBQUERY  table=<derived624>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=624  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=631  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=638  select_type=SUBQUERY  table=<derived639>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=639  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=636  select_type=SUBQUERY  table=<derived637>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=637  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=634  select_type=SUBQUERY  table=<derived635>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=635  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=632  select_type=SUBQUERY  table=<derived633>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=633  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=640  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=647  select_type=SUBQUERY  table=<derived648>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=648  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=645  select_type=SUBQUERY  table=<derived646>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=646  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=643  select_type=SUBQUERY  table=<derived644>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=644  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=641  select_type=SUBQUERY  table=<derived642>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=642  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=649  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=656  select_type=SUBQUERY  table=<derived657>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=657  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=654  select_type=SUBQUERY  table=<derived655>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=655  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=652  select_type=SUBQUERY  table=<derived653>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=653  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=650  select_type=SUBQUERY  table=<derived651>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=651  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=658  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=665  select_type=SUBQUERY  table=<derived666>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=666  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=663  select_type=SUBQUERY  table=<derived664>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=664  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=661  select_type=SUBQUERY  table=<derived662>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=662  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=659  select_type=SUBQUERY  table=<derived660>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=660  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=667  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=674  select_type=SUBQUERY  table=<derived675>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=675  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=672  select_type=SUBQUERY  table=<derived673>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=673  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=670  select_type=SUBQUERY  table=<derived671>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=671  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=668  select_type=SUBQUERY  table=<derived669>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=669  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=676  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=683  select_type=SUBQUERY  table=<derived684>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=684  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=681  select_type=SUBQUERY  table=<derived682>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=682  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=679  select_type=SUBQUERY  table=<derived680>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=680  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=677  select_type=SUBQUERY  table=<derived678>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=678  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=685  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=692  select_type=SUBQUERY  table=<derived693>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=693  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=690  select_type=SUBQUERY  table=<derived691>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=691  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=688  select_type=SUBQUERY  table=<derived689>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=689  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=686  select_type=SUBQUERY  table=<derived687>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=687  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=694  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=701  select_type=SUBQUERY  table=<derived702>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=702  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=699  select_type=SUBQUERY  table=<derived700>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=700  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=697  select_type=SUBQUERY  table=<derived698>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=698  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=695  select_type=SUBQUERY  table=<derived696>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=696  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=703  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=710  select_type=SUBQUERY  table=<derived711>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=711  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=708  select_type=SUBQUERY  table=<derived709>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=709  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=706  select_type=SUBQUERY  table=<derived707>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=707  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=704  select_type=SUBQUERY  table=<derived705>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=705  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=712  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=719  select_type=SUBQUERY  table=<derived720>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=720  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=717  select_type=SUBQUERY  table=<derived718>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=718  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=715  select_type=SUBQUERY  table=<derived716>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=716  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=713  select_type=SUBQUERY  table=<derived714>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=714  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=721  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=728  select_type=SUBQUERY  table=<derived729>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=729  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=726  select_type=SUBQUERY  table=<derived727>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=727  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=724  select_type=SUBQUERY  table=<derived725>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=725  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=722  select_type=SUBQUERY  table=<derived723>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=723  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=730  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=737  select_type=SUBQUERY  table=<derived738>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=738  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=735  select_type=SUBQUERY  table=<derived736>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=736  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=733  select_type=SUBQUERY  table=<derived734>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=734  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=731  select_type=SUBQUERY  table=<derived732>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=732  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=739  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=746  select_type=SUBQUERY  table=<derived747>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=747  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=744  select_type=SUBQUERY  table=<derived745>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=745  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=742  select_type=SUBQUERY  table=<derived743>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=743  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=740  select_type=SUBQUERY  table=<derived741>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=741  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=748  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=755  select_type=SUBQUERY  table=<derived756>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=756  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=753  select_type=SUBQUERY  table=<derived754>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=754  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=751  select_type=SUBQUERY  table=<derived752>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=752  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=749  select_type=SUBQUERY  table=<derived750>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=750  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=757  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=764  select_type=SUBQUERY  table=<derived765>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=765  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=762  select_type=SUBQUERY  table=<derived763>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=763  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=760  select_type=SUBQUERY  table=<derived761>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=761  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=758  select_type=SUBQUERY  table=<derived759>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=759  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=766  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=773  select_type=SUBQUERY  table=<derived774>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=774  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=771  select_type=SUBQUERY  table=<derived772>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=772  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=769  select_type=SUBQUERY  table=<derived770>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=770  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=767  select_type=SUBQUERY  table=<derived768>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=768  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=775  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=782  select_type=SUBQUERY  table=<derived783>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=783  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=780  select_type=SUBQUERY  table=<derived781>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=781  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=778  select_type=SUBQUERY  table=<derived779>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=779  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=776  select_type=SUBQUERY  table=<derived777>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=777  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=784  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=791  select_type=SUBQUERY  table=<derived792>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=792  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=789  select_type=SUBQUERY  table=<derived790>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=790  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=787  select_type=SUBQUERY  table=<derived788>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=788  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=785  select_type=SUBQUERY  table=<derived786>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=786  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=793  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=800  select_type=SUBQUERY  table=<derived801>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=801  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=798  select_type=SUBQUERY  table=<derived799>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=799  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=796  select_type=SUBQUERY  table=<derived797>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=797  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=794  select_type=SUBQUERY  table=<derived795>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=795  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=802  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=809  select_type=SUBQUERY  table=<derived810>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=810  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=807  select_type=SUBQUERY  table=<derived808>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=808  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=805  select_type=SUBQUERY  table=<derived806>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=806  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=803  select_type=SUBQUERY  table=<derived804>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=804  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=811  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=818  select_type=SUBQUERY  table=<derived819>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=819  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=816  select_type=SUBQUERY  table=<derived817>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=817  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=814  select_type=SUBQUERY  table=<derived815>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=815  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=812  select_type=SUBQUERY  table=<derived813>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=813  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=820  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=827  select_type=SUBQUERY  table=<derived828>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=828  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=825  select_type=SUBQUERY  table=<derived826>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=826  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=823  select_type=SUBQUERY  table=<derived824>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=824  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=821  select_type=SUBQUERY  table=<derived822>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=822  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=829  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=836  select_type=SUBQUERY  table=<derived837>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=837  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=834  select_type=SUBQUERY  table=<derived835>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=835  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=832  select_type=SUBQUERY  table=<derived833>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=833  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=830  select_type=SUBQUERY  table=<derived831>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=831  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=838  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=845  select_type=SUBQUERY  table=<derived846>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=846  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=843  select_type=SUBQUERY  table=<derived844>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=844  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=841  select_type=SUBQUERY  table=<derived842>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=842  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=839  select_type=SUBQUERY  table=<derived840>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=840  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=847  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=854  select_type=SUBQUERY  table=<derived855>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=855  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=852  select_type=SUBQUERY  table=<derived853>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=853  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=850  select_type=SUBQUERY  table=<derived851>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=851  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=848  select_type=SUBQUERY  table=<derived849>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=849  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=856  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=863  select_type=SUBQUERY  table=<derived864>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=864  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=861  select_type=SUBQUERY  table=<derived862>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=862  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=859  select_type=SUBQUERY  table=<derived860>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=860  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=857  select_type=SUBQUERY  table=<derived858>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=858  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=865  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=872  select_type=SUBQUERY  table=<derived873>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=873  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=870  select_type=SUBQUERY  table=<derived871>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=871  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=868  select_type=SUBQUERY  table=<derived869>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=869  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=866  select_type=SUBQUERY  table=<derived867>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=867  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=874  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=881  select_type=SUBQUERY  table=<derived882>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=882  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=879  select_type=SUBQUERY  table=<derived880>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=880  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=877  select_type=SUBQUERY  table=<derived878>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=878  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=875  select_type=SUBQUERY  table=<derived876>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=876  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=883  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=890  select_type=SUBQUERY  table=<derived891>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=891  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=888  select_type=SUBQUERY  table=<derived889>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=889  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=886  select_type=SUBQUERY  table=<derived887>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=887  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=884  select_type=SUBQUERY  table=<derived885>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=885  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=892  select_type=UNION  table=null  type=null  possible_keys=null  key=null  key_len=null  ref=null  Extra=No tables used
id=899  select_type=SUBQUERY  table=<derived900>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=900  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=897  select_type=SUBQUERY  table=<derived898>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=898  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=895  select_type=SUBQUERY  table=<derived896>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=896  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
id=893  select_type=SUBQUERY  table=<derived894>  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
id=894  select_type=DERIVED  table=queuert_job  type=ref  possible_keys=queuert_job_status_idx  key=queuert_job_status_idx  key_len=1040  ref=const,const  Extra=Using where; Using index
```

## countWorkers/default

1. `countWorkers`

```
id=1  select_type=SIMPLE  table=queuert_worker  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=
```

## countWorkersByTypeName/default

1. `countWorkersByTypeName`

```
id=1  select_type=PRIMARY  table=t  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using filesort
id=1  select_type=PRIMARY  table=<derived2>  type=ref  possible_keys=key0  key=key0  key_len=1023  ref=*any*.t.type_name  Extra=Using where
id=2  select_type=DERIVED  table=w  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=2  select_type=DERIVED  table=wt  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
```

## countWorkersByTypeName/batch100

1. `countWorkersByTypeName`

```
id=1  select_type=PRIMARY  table=t  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using filesort
id=1  select_type=PRIMARY  table=<derived2>  type=ref  possible_keys=key0  key=key0  key_len=1023  ref=*any*.t.type_name  Extra=Using where
id=2  select_type=DERIVED  table=w  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Using temporary; Using filesort
id=2  select_type=DERIVED  table=wt  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table
```

## countRunningJobsByWorkerId/default

1. `countRunningJobsByWorkerId`

```
id=1  select_type=SIMPLE  table=w  type=ALL  possible_keys=null  key=null  key_len=null  ref=null  Extra=Table function: json_table; Using temporary; Using filesort
id=1  select_type=SIMPLE  table=j  type=ref  possible_keys=queuert_job_attempt_by_idx  key=queuert_job_attempt_by_idx  key_len=55  ref=*any*.w.id,const  Extra=Using where; Using index
```

## countRunningJobsByWorkerId/batch100

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
id=1  select_type=SIMPLE  table=w  type=range  possible_keys=PRIMARY,queuert_worker_idx  key=queuert_worker_idx  key_len=44  ref=null  Extra=Using index condition
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
