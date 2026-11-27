# PostgreSQL query plans

Plans of every statement each query-performance case runs, at scale 100, without cost and row estimates, and with IDs and timestamps replaced by placeholders. Rerun `pnpm start` after a query or index change and review the diff.

## getChains/default

1. `getChains`

```
Nested Loop Left Join
  ->  Index Scan using queuert_job_pkey on queuert_job head_job
        Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
        Filter: (chain_index = 0)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## getChains/lock

1. `getChainsLocked`

```
LockRows
  ->  Nested Loop Left Join
        ->  Index Scan using queuert_job_pkey on queuert_job head_job
              Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
              Filter: (chain_index = 0)
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                          Index Cond: (chain_id = head_job.id)
```

## getChains/batch100

1. `getChains`

```
Nested Loop Left Join
  ->  Bitmap Heap Scan on queuert_job head_job
        Recheck Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
        Filter: (chain_index = 0)
        ->  Bitmap Index Scan on queuert_job_pkey
              Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## getChains/lockBatch100

1. `getChainsLocked`

```
LockRows
  ->  Nested Loop Left Join
        ->  Index Scan using queuert_job_pkey on queuert_job head_job
              Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
              Filter: (chain_index = 0)
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                          Index Cond: (chain_id = head_job.id)
```

## getChainTails/default

1. `getChainTails`

```
Nested Loop Left Join
  ->  Index Scan using queuert_job_pkey on queuert_job head_job
        Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
        Filter: (chain_index = 0)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## getChainTails/lock

1. `getChainTailsLocked`

```
Result
  One-Time Filter: ((InitPlan 2).col1 > 0)
  CTE head_job
    ->  LockRows
          ->  Index Scan using queuert_job_pkey on queuert_job queuert_job_1
                Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
                Filter: (chain_index = 0)
  InitPlan 2
    ->  Aggregate
          ->  CTE Scan on head_job head_job_1
  ->  Nested Loop Left Join
        ->  CTE Scan on head_job
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  LockRows
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: ((chain_id = head_job.id) AND (chain_index > 0))
```

## getChainTails/batch100

1. `getChainTails`

```
Nested Loop Left Join
  ->  Bitmap Heap Scan on queuert_job head_job
        Recheck Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
        Filter: (chain_index = 0)
        ->  Bitmap Index Scan on queuert_job_pkey
              Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## getChainTails/lockBatch100

1. `getChainTailsLocked`

```
Result
  One-Time Filter: ((InitPlan 2).col1 > 0)
  CTE head_job
    ->  LockRows
          ->  Sort
                Sort Key: queuert_job_1.id
                ->  Bitmap Heap Scan on queuert_job queuert_job_1
                      Recheck Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                      Filter: (chain_index = 0)
                      ->  Bitmap Index Scan on queuert_job_pkey
                            Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
  InitPlan 2
    ->  Aggregate
          ->  CTE Scan on head_job head_job_1
  ->  Nested Loop Left Join
        ->  CTE Scan on head_job
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  LockRows
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: ((chain_id = head_job.id) AND (chain_index > 0))
```

## getChainTails/lockBlockers

1. `lockChainHeadsBlockersFirst`

```
LockRows
  CTE locked_heads
    ->  Unique
          ->  Sort
                Sort Key: d.id
                ->  Append
                      ->  Function Scan on unnest d
                      ->  Nested Loop
                            ->  Bitmap Heap Scan on queuert_job m
                                  Recheck Cond: ((id = ANY ('{<uuid>}'::uuid[])) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  Filter: (((id = ANY ('{<uuid>}'::uuid[])) AND (chain_index = 0)) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  ->  BitmapOr
                                        ->  Bitmap Index Scan on queuert_job_pkey
                                              Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
                                        ->  Bitmap Index Scan on queuert_chain_index_idx
                                              Index Cond: ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0))
                            ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
                                  Index Cond: (job_id = m.id)
  CTE blocker_edges
    ->  Unique
          ->  Sort
                Sort Key: jb_1.blocked_by_chain_id, l.id
                ->  Hash Semi Join
                      Hash Cond: (jb_1.blocked_by_chain_id = locked_heads.id)
                      ->  Nested Loop
                            ->  Nested Loop
                                  ->  CTE Scan on locked_heads l
                                  ->  Append
                                        ->  Index Scan using queuert_job_pkey on queuert_job d_2
                                              Index Cond: (id = l.id)
                                              Filter: (chain_index = 0)
                                        ->  Index Scan using queuert_chain_index_idx on queuert_job d_3
                                              Index Cond: (chain_id = l.id)
                            ->  Memoize
                                  Cache Key: d_2.id
                                  Cache Mode: logical
                                  ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb_1
                                        Index Cond: (job_id = d_2.id)
                      ->  Hash
                            ->  CTE Scan on locked_heads
  CTE blocker_depths
    ->  Recursive Union
          ->  CTE Scan on locked_heads locked_heads_2
          ->  Hash Join
                Hash Cond: (b_1.id = e.blocker_id)
                InitPlan 3
                  ->  Aggregate
                        ->  CTE Scan on locked_heads locked_heads_1
                ->  WorkTable Scan on blocker_depths b_1
                      Filter: (depth < (InitPlan 3).col1)
                ->  Hash
                      ->  CTE Scan on blocker_edges e
  ->  Sort
        Sort Key: b.depth, h.id
        ->  Nested Loop
              ->  Subquery Scan on b
                    ->  HashAggregate
                          Group Key: blocker_depths.id
                          ->  CTE Scan on blocker_depths
              ->  Index Scan using queuert_job_pkey on queuert_job h
                    Index Cond: (id = b.id)
                    Filter: (chain_index = 0)
```

2. `lockChainHeadsBlockersFirst`

```
LockRows
  CTE locked_heads
    ->  Unique
          ->  Sort
                Sort Key: d.id
                ->  Append
                      ->  Function Scan on unnest d
                      ->  Nested Loop
                            ->  Bitmap Heap Scan on queuert_job m
                                  Recheck Cond: ((id = ANY ('{<uuid>}'::uuid[])) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  Filter: (((id = ANY ('{<uuid>}'::uuid[])) AND (chain_index = 0)) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  ->  BitmapOr
                                        ->  Bitmap Index Scan on queuert_job_pkey
                                              Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
                                        ->  Bitmap Index Scan on queuert_chain_index_idx
                                              Index Cond: ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0))
                            ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
                                  Index Cond: (job_id = m.id)
  CTE blocker_edges
    ->  Unique
          ->  Sort
                Sort Key: jb_1.blocked_by_chain_id, l.id
                ->  Hash Semi Join
                      Hash Cond: (jb_1.blocked_by_chain_id = locked_heads.id)
                      ->  Nested Loop
                            ->  Nested Loop
                                  ->  CTE Scan on locked_heads l
                                  ->  Append
                                        ->  Index Scan using queuert_job_pkey on queuert_job d_2
                                              Index Cond: (id = l.id)
                                              Filter: (chain_index = 0)
                                        ->  Index Scan using queuert_chain_index_idx on queuert_job d_3
                                              Index Cond: (chain_id = l.id)
                            ->  Memoize
                                  Cache Key: d_2.id
                                  Cache Mode: logical
                                  ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb_1
                                        Index Cond: (job_id = d_2.id)
                      ->  Hash
                            ->  CTE Scan on locked_heads
  CTE blocker_depths
    ->  Recursive Union
          ->  CTE Scan on locked_heads locked_heads_2
          ->  Hash Join
                Hash Cond: (b_1.id = e.blocker_id)
                InitPlan 3
                  ->  Aggregate
                        ->  CTE Scan on locked_heads locked_heads_1
                ->  WorkTable Scan on blocker_depths b_1
                      Filter: (depth < (InitPlan 3).col1)
                ->  Hash
                      ->  CTE Scan on blocker_edges e
  ->  Sort
        Sort Key: b.depth, h.id
        ->  Nested Loop
              ->  Subquery Scan on b
                    ->  HashAggregate
                          Group Key: blocker_depths.id
                          ->  CTE Scan on blocker_depths
              ->  Index Scan using queuert_job_pkey on queuert_job h
                    Index Cond: (id = b.id)
                    Filter: (chain_index = 0)
```

3. `getChainTailsLocked`

```
Result
  One-Time Filter: ((InitPlan 2).col1 > 0)
  CTE head_job
    ->  LockRows
          ->  Index Scan using queuert_job_pkey on queuert_job queuert_job_1
                Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
                Filter: (chain_index = 0)
  InitPlan 2
    ->  Aggregate
          ->  CTE Scan on head_job head_job_1
  ->  Nested Loop Left Join
        ->  CTE Scan on head_job
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  LockRows
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: ((chain_id = head_job.id) AND (chain_index > 0))
```

## getChainTails/lockBlockersBatch100

1. `lockChainHeadsBlockersFirst`

```
LockRows
  CTE locked_heads
    ->  Unique
          ->  Sort
                Sort Key: d.id
                ->  Append
                      ->  Function Scan on unnest d
                      ->  Nested Loop
                            ->  Bitmap Heap Scan on queuert_job m
                                  Recheck Cond: ((id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) OR ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  Filter: (((id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index = 0)) OR ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  ->  BitmapOr
                                        ->  Bitmap Index Scan on queuert_job_pkey
                                              Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                                        ->  Bitmap Index Scan on queuert_chain_index_idx
                                              Index Cond: ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0))
                            ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
                                  Index Cond: (job_id = m.id)
  CTE blocker_edges
    ->  Unique
          ->  Sort
                Sort Key: jb_1.blocked_by_chain_id, l.id
                ->  Hash Semi Join
                      Hash Cond: (jb_1.blocked_by_chain_id = locked_heads.id)
                      ->  Nested Loop
                            ->  Nested Loop
                                  ->  CTE Scan on locked_heads l
                                  ->  Append
                                        ->  Index Scan using queuert_job_pkey on queuert_job d_2
                                              Index Cond: (id = l.id)
                                              Filter: (chain_index = 0)
                                        ->  Index Scan using queuert_chain_index_idx on queuert_job d_3
                                              Index Cond: (chain_id = l.id)
                            ->  Memoize
                                  Cache Key: d_2.id
                                  Cache Mode: logical
                                  ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb_1
                                        Index Cond: (job_id = d_2.id)
                      ->  Hash
                            ->  CTE Scan on locked_heads
  CTE blocker_depths
    ->  Recursive Union
          ->  CTE Scan on locked_heads locked_heads_2
          ->  Hash Join
                Hash Cond: (b_1.id = e.blocker_id)
                InitPlan 3
                  ->  Aggregate
                        ->  CTE Scan on locked_heads locked_heads_1
                ->  WorkTable Scan on blocker_depths b_1
                      Filter: (depth < (InitPlan 3).col1)
                ->  Hash
                      ->  CTE Scan on blocker_edges e
  ->  Sort
        Sort Key: b.depth, h.id
        ->  Nested Loop
              ->  Subquery Scan on b
                    ->  HashAggregate
                          Group Key: blocker_depths.id
                          ->  CTE Scan on blocker_depths
              ->  Index Scan using queuert_job_pkey on queuert_job h
                    Index Cond: (id = b.id)
                    Filter: (chain_index = 0)
```

2. `lockChainHeadsBlockersFirst`

```
LockRows
  CTE locked_heads
    ->  Unique
          ->  Sort
                Sort Key: d.id
                ->  Append
                      ->  Function Scan on unnest d
                      ->  Nested Loop
                            ->  Bitmap Heap Scan on queuert_job m
                                  Recheck Cond: ((id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) OR ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  Filter: (((id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index = 0)) OR ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0)))
                                  ->  BitmapOr
                                        ->  Bitmap Index Scan on queuert_job_pkey
                                              Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                                        ->  Bitmap Index Scan on queuert_chain_index_idx
                                              Index Cond: ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0))
                            ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
                                  Index Cond: (job_id = m.id)
  CTE blocker_edges
    ->  Unique
          ->  Sort
                Sort Key: jb_1.blocked_by_chain_id, l.id
                ->  Hash Semi Join
                      Hash Cond: (jb_1.blocked_by_chain_id = locked_heads.id)
                      ->  Nested Loop
                            ->  Nested Loop
                                  ->  CTE Scan on locked_heads l
                                  ->  Append
                                        ->  Index Scan using queuert_job_pkey on queuert_job d_2
                                              Index Cond: (id = l.id)
                                              Filter: (chain_index = 0)
                                        ->  Index Scan using queuert_chain_index_idx on queuert_job d_3
                                              Index Cond: (chain_id = l.id)
                            ->  Memoize
                                  Cache Key: d_2.id
                                  Cache Mode: logical
                                  ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb_1
                                        Index Cond: (job_id = d_2.id)
                      ->  Hash
                            ->  CTE Scan on locked_heads
  CTE blocker_depths
    ->  Recursive Union
          ->  CTE Scan on locked_heads locked_heads_2
          ->  Hash Join
                Hash Cond: (b_1.id = e.blocker_id)
                InitPlan 3
                  ->  Aggregate
                        ->  CTE Scan on locked_heads locked_heads_1
                ->  WorkTable Scan on blocker_depths b_1
                      Filter: (depth < (InitPlan 3).col1)
                ->  Hash
                      ->  CTE Scan on blocker_edges e
  ->  Sort
        Sort Key: b.depth, h.id
        ->  Nested Loop
              ->  Subquery Scan on b
                    ->  HashAggregate
                          Group Key: blocker_depths.id
                          ->  CTE Scan on blocker_depths
              ->  Index Scan using queuert_job_pkey on queuert_job h
                    Index Cond: (id = b.id)
                    Filter: (chain_index = 0)
```

3. `getChainTailsLocked`

```
Result
  One-Time Filter: ((InitPlan 2).col1 > 0)
  CTE head_job
    ->  LockRows
          ->  Sort
                Sort Key: queuert_job_1.id
                ->  Bitmap Heap Scan on queuert_job queuert_job_1
                      Recheck Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                      Filter: (chain_index = 0)
                      ->  Bitmap Index Scan on queuert_job_pkey
                            Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
  InitPlan 2
    ->  Aggregate
          ->  CTE Scan on head_job head_job_1
  ->  Nested Loop Left Join
        ->  CTE Scan on head_job
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  LockRows
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: ((chain_id = head_job.id) AND (chain_index > 0))
```

## getJobs/default

1. `getJobs`

```
Nested Loop
  ->  Index Scan using queuert_job_pkey on queuert_job j
        Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
  ->  Index Scan using queuert_job_pkey on queuert_job h
        Index Cond: (id = j.chain_id)
```

## getJobs/lock

1. `getJobsLocked`

```
Nested Loop
  Join Filter: (j.chain_id = h.id)
  CTE locked_heads
    ->  LockRows
          ->  Sort
                Sort Key: h_1.id
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: c.chain_id
                            ->  Index Scan using queuert_job_pkey on queuert_job c
                                  Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
                      ->  Index Scan using queuert_job_pkey on queuert_job h_1
                            Index Cond: (id = c.chain_id)
  CTE locked_jobs
    ->  LockRows
          InitPlan 2
            ->  Aggregate
                  ->  CTE Scan on locked_heads
          ->  Result
                One-Time Filter: ((InitPlan 2).col1 >= 0)
                ->  Index Scan using queuert_job_pkey on queuert_job j_1
                      Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
  ->  CTE Scan on locked_jobs j
  ->  CTE Scan on locked_heads h
```

## getJobs/batch100

1. `getJobs`

```
Nested Loop
  ->  Bitmap Heap Scan on queuert_job j
        Recheck Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
        ->  Bitmap Index Scan on queuert_job_pkey
              Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
  ->  Index Scan using queuert_job_pkey on queuert_job h
        Index Cond: (id = j.chain_id)
```

## getJobs/lockBatch100

1. `getJobsLocked`

```
Hash Join
  Hash Cond: (j.chain_id = h.id)
  CTE locked_heads
    ->  LockRows
          ->  Sort
                Sort Key: h_1.id
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: c.chain_id
                            ->  Bitmap Heap Scan on queuert_job c
                                  Recheck Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                                  ->  Bitmap Index Scan on queuert_job_pkey
                                        Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                      ->  Index Scan using queuert_job_pkey on queuert_job h_1
                            Index Cond: (id = c.chain_id)
  CTE locked_jobs
    ->  LockRows
          InitPlan 2
            ->  Aggregate
                  ->  CTE Scan on locked_heads
          ->  Sort
                Sort Key: j_1.id
                ->  Result
                      One-Time Filter: ((InitPlan 2).col1 >= 0)
                      ->  Bitmap Heap Scan on queuert_job j_1
                            Recheck Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                            ->  Bitmap Index Scan on queuert_job_pkey
                                  Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
  ->  CTE Scan on locked_jobs j
  ->  Hash
        ->  CTE Scan on locked_heads h
```

## getWorkers/default

1. `getWorkers`

```
Seq Scan on queuert_worker
  Filter: (id = ANY ('{<uuid>,<uuid>,<uuid>}'::uuid[]))
```

## getWorkers/lock

1. `getWorkersLocked`

```
LockRows
  ->  Sort
        Sort Key: id
        ->  Seq Scan on queuert_worker
              Filter: (id = ANY ('{<uuid>,<uuid>,<uuid>}'::uuid[]))
```

## getWorkers/batch100

1. `getWorkers`

```
Seq Scan on queuert_worker
  Filter: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
```

## getWorkers/lockBatch100

1. `getWorkersLocked`

```
LockRows
  ->  Sort
        Sort Key: id
        ->  Seq Scan on queuert_worker
              Filter: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
```

## createJobs/default

1. `createJobs`

```
Sort
  Sort Key: ed.ord
  CTE input_data
    ->  Nested Loop
          Join Filter: (raw.ord = t.ord)
          ->  Function Scan on raw
          ->  Function Scan on unnest t
  CTE existing_deduplicated
    ->  Unique
          ->  Sort
                Sort Key: id2.ord, j.created_at DESC
                ->  Nested Loop
                      ->  CTE Scan on input_data id2
                            Filter: ((dedup_key IS NOT NULL) AND ((dedup_scope = 'running'::text) OR (dedup_scope = 'any'::text)))
                      ->  Bitmap Heap Scan on queuert_job j
                            Recheck Cond: ((id2.dedup_key = chain_deduplication_key) AND (chain_index = 0))
                            Filter: ((id2.type_name = type_name) AND (((id2.dedup_scope = 'running'::text) AND (chain_status = 'running'::text)) OR (id2.dedup_scope = 'any'::text)))
                            ->  Bitmap Index Scan on queuert_chain_deduplication_idx
                                  Index Cond: (chain_deduplication_key = id2.dedup_key)
  CTE to_insert_all
    ->  Nested Loop Anti Join
          Join Filter: (ed_1.ord = id2_1.ord)
          ->  CTE Scan on input_data id2_1
          ->  CTE Scan on existing_deduplicated ed_1
  CTE to_insert
    ->  CTE Scan on to_insert_all tia_1
          Filter: ((dedup_key IS NULL) OR (NOT EXISTS(SubPlan 4)))
          SubPlan 4
            ->  CTE Scan on to_insert_all tia2
                  Filter: ((ord < tia_1.ord) AND (dedup_key = tia_1.dedup_key) AND (type_name = tia_1.type_name))
  CTE inserted_jobs
    ->  Insert on queuert_job queuert_job_1
          InitPlan 6
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 6).col1)
                ->  CTE Scan on to_insert ti_2
  ->  Append
        ->  Nested Loop Left Join
              ->  CTE Scan on existing_deduplicated ed
              ->  Subquery Scan on tail_job
                    ->  Limit
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: (chain_id = ed.id)
        ->  Nested Loop
              Join Filter: ((ti.chain_id = ij.chain_id) AND (ti.chain_index = ij.chain_index))
              ->  Nested Loop
                    Join Filter: ((tia.ord <> ti.ord) AND (tia.dedup_key = ti.dedup_key) AND (tia.type_name = ti.type_name))
                    ->  CTE Scan on to_insert_all tia
                          Filter: (dedup_key IS NOT NULL)
                    ->  CTE Scan on to_insert ti
              ->  CTE Scan on inserted_jobs ij
        ->  Nested Loop
              Join Filter: ((ij_1.chain_id = ti_1.chain_id) AND (ij_1.chain_index = ti_1.chain_index))
              ->  CTE Scan on inserted_jobs ij_1
              ->  CTE Scan on to_insert ti_1
```

## createJobs/deduplication

1. `createJobs`

```
Sort
  Sort Key: ed.ord
  CTE input_data
    ->  Nested Loop
          Join Filter: (raw.ord = t.ord)
          ->  Function Scan on raw
          ->  Function Scan on unnest t
  CTE existing_deduplicated
    ->  Unique
          ->  Sort
                Sort Key: id2.ord, j.created_at DESC
                ->  Nested Loop
                      ->  CTE Scan on input_data id2
                            Filter: ((dedup_key IS NOT NULL) AND ((dedup_scope = 'running'::text) OR (dedup_scope = 'any'::text)))
                      ->  Bitmap Heap Scan on queuert_job j
                            Recheck Cond: ((id2.dedup_key = chain_deduplication_key) AND (chain_index = 0))
                            Filter: ((id2.type_name = type_name) AND (((id2.dedup_scope = 'running'::text) AND (chain_status = 'running'::text)) OR (id2.dedup_scope = 'any'::text)))
                            ->  Bitmap Index Scan on queuert_chain_deduplication_idx
                                  Index Cond: (chain_deduplication_key = id2.dedup_key)
  CTE to_insert_all
    ->  Nested Loop Anti Join
          Join Filter: (ed_1.ord = id2_1.ord)
          ->  CTE Scan on input_data id2_1
          ->  CTE Scan on existing_deduplicated ed_1
  CTE to_insert
    ->  CTE Scan on to_insert_all tia_1
          Filter: ((dedup_key IS NULL) OR (NOT EXISTS(SubPlan 4)))
          SubPlan 4
            ->  CTE Scan on to_insert_all tia2
                  Filter: ((ord < tia_1.ord) AND (dedup_key = tia_1.dedup_key) AND (type_name = tia_1.type_name))
  CTE inserted_jobs
    ->  Insert on queuert_job queuert_job_1
          InitPlan 6
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 6).col1)
                ->  CTE Scan on to_insert ti_2
  ->  Append
        ->  Nested Loop Left Join
              ->  CTE Scan on existing_deduplicated ed
              ->  Subquery Scan on tail_job
                    ->  Limit
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: (chain_id = ed.id)
        ->  Nested Loop
              Join Filter: ((ti.chain_id = ij.chain_id) AND (ti.chain_index = ij.chain_index))
              ->  Nested Loop
                    Join Filter: ((tia.ord <> ti.ord) AND (tia.dedup_key = ti.dedup_key) AND (tia.type_name = ti.type_name))
                    ->  CTE Scan on to_insert_all tia
                          Filter: (dedup_key IS NOT NULL)
                    ->  CTE Scan on to_insert ti
              ->  CTE Scan on inserted_jobs ij
        ->  Nested Loop
              Join Filter: ((ij_1.chain_id = ti_1.chain_id) AND (ij_1.chain_index = ti_1.chain_index))
              ->  CTE Scan on inserted_jobs ij_1
              ->  CTE Scan on to_insert ti_1
```

## createJobs/batch100

1. `createJobs`

```
Sort
  Sort Key: ed.ord
  CTE input_data
    ->  Merge Join
          Merge Cond: (raw.ord = t.ord)
          ->  Function Scan on raw
          ->  Materialize
                ->  Function Scan on unnest t
  CTE existing_deduplicated
    ->  Unique
          ->  Sort
                Sort Key: id2.ord, j.created_at DESC
                ->  Nested Loop
                      ->  CTE Scan on input_data id2
                            Filter: ((dedup_key IS NOT NULL) AND ((dedup_scope = 'running'::text) OR (dedup_scope = 'any'::text)))
                      ->  Bitmap Heap Scan on queuert_job j
                            Recheck Cond: ((id2.dedup_key = chain_deduplication_key) AND (chain_index = 0))
                            Filter: ((id2.type_name = type_name) AND (((id2.dedup_scope = 'running'::text) AND (chain_status = 'running'::text)) OR (id2.dedup_scope = 'any'::text)))
                            ->  Bitmap Index Scan on queuert_chain_deduplication_idx
                                  Index Cond: (chain_deduplication_key = id2.dedup_key)
  CTE to_insert_all
    ->  Hash Anti Join
          Hash Cond: (id2_1.ord = ed_1.ord)
          ->  CTE Scan on input_data id2_1
          ->  Hash
                ->  CTE Scan on existing_deduplicated ed_1
  CTE to_insert
    ->  CTE Scan on to_insert_all tia_1
          Filter: ((dedup_key IS NULL) OR (NOT EXISTS(SubPlan 4)))
          SubPlan 4
            ->  CTE Scan on to_insert_all tia2
                  Filter: ((ord < tia_1.ord) AND (dedup_key = tia_1.dedup_key) AND (type_name = tia_1.type_name))
  CTE inserted_jobs
    ->  Insert on queuert_job queuert_job_1
          InitPlan 6
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 6).col1)
                ->  CTE Scan on to_insert ti_2
  ->  Append
        ->  Nested Loop Left Join
              ->  CTE Scan on existing_deduplicated ed
              ->  Subquery Scan on tail_job
                    ->  Limit
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: (chain_id = ed.id)
        ->  Hash Join
              Hash Cond: ((tia.dedup_key = ti.dedup_key) AND (tia.type_name = ti.type_name))
              Join Filter: (tia.ord <> ti.ord)
              ->  CTE Scan on to_insert_all tia
                    Filter: (dedup_key IS NOT NULL)
              ->  Hash
                    ->  Hash Join
                          Hash Cond: ((ti.chain_id = ij.chain_id) AND (ti.chain_index = ij.chain_index))
                          ->  CTE Scan on to_insert ti
                          ->  Hash
                                ->  CTE Scan on inserted_jobs ij
        ->  Hash Join
              Hash Cond: ((ij_1.chain_id = ti_1.chain_id) AND (ij_1.chain_index = ti_1.chain_index))
              ->  CTE Scan on inserted_jobs ij_1
              ->  Hash
                    ->  CTE Scan on to_insert ti_1
```

## createJobs/deduplicationBatch100

1. `createJobs`

```
Sort
  Sort Key: ed.ord
  CTE input_data
    ->  Merge Join
          Merge Cond: (raw.ord = t.ord)
          ->  Function Scan on raw
          ->  Materialize
                ->  Function Scan on unnest t
  CTE existing_deduplicated
    ->  Unique
          ->  Sort
                Sort Key: id2.ord, j.created_at DESC
                ->  Nested Loop
                      ->  CTE Scan on input_data id2
                            Filter: ((dedup_key IS NOT NULL) AND ((dedup_scope = 'running'::text) OR (dedup_scope = 'any'::text)))
                      ->  Bitmap Heap Scan on queuert_job j
                            Recheck Cond: ((id2.dedup_key = chain_deduplication_key) AND (chain_index = 0))
                            Filter: ((id2.type_name = type_name) AND (((id2.dedup_scope = 'running'::text) AND (chain_status = 'running'::text)) OR (id2.dedup_scope = 'any'::text)))
                            ->  Bitmap Index Scan on queuert_chain_deduplication_idx
                                  Index Cond: (chain_deduplication_key = id2.dedup_key)
  CTE to_insert_all
    ->  Hash Anti Join
          Hash Cond: (id2_1.ord = ed_1.ord)
          ->  CTE Scan on input_data id2_1
          ->  Hash
                ->  CTE Scan on existing_deduplicated ed_1
  CTE to_insert
    ->  CTE Scan on to_insert_all tia_1
          Filter: ((dedup_key IS NULL) OR (NOT EXISTS(SubPlan 4)))
          SubPlan 4
            ->  CTE Scan on to_insert_all tia2
                  Filter: ((ord < tia_1.ord) AND (dedup_key = tia_1.dedup_key) AND (type_name = tia_1.type_name))
  CTE inserted_jobs
    ->  Insert on queuert_job queuert_job_1
          InitPlan 6
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 6).col1)
                ->  CTE Scan on to_insert ti_2
  ->  Append
        ->  Nested Loop Left Join
              ->  CTE Scan on existing_deduplicated ed
              ->  Subquery Scan on tail_job
                    ->  Limit
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: (chain_id = ed.id)
        ->  Hash Join
              Hash Cond: ((tia.dedup_key = ti.dedup_key) AND (tia.type_name = ti.type_name))
              Join Filter: (tia.ord <> ti.ord)
              ->  CTE Scan on to_insert_all tia
                    Filter: (dedup_key IS NOT NULL)
              ->  Hash
                    ->  Hash Join
                          Hash Cond: ((ti.chain_id = ij.chain_id) AND (ti.chain_index = ij.chain_index))
                          ->  CTE Scan on to_insert ti
                          ->  Hash
                                ->  CTE Scan on inserted_jobs ij
        ->  Hash Join
              Hash Cond: ((ij_1.chain_id = ti_1.chain_id) AND (ij_1.chain_index = ti_1.chain_index))
              ->  CTE Scan on inserted_jobs ij_1
              ->  Hash
                    ->  CTE Scan on to_insert ti_1
```

## continueJobs/default

1. `continueJobs`

```
Nested Loop
  Join Filter: (c.continued_to_id = i.id)
  CTE input_data
    ->  Function Scan on t
  CTE completed
    ->  Update on queuert_job j
          InitPlan 2
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 2).col1)
                ->  Nested Loop
                      ->  CTE Scan on input_data d
                      ->  Index Scan using queuert_job_pkey on queuert_job j
                            Index Cond: (id = d.continue_from_id)
                            Filter: ((status <> 'completed'::text) AND ((d.attempt_token IS NULL) OR ((status = 'running'::text) AND (attempt_token = d.attempt_token))))
  CTE inserted
    ->  Insert on queuert_job
          InitPlan 4
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 4).col1)
                ->  Nested Loop
                      Join Filter: (d_1.continue_from_id = c_1.id)
                      ->  CTE Scan on input_data d_1
                      ->  CTE Scan on completed c_1
  ->  Nested Loop
        ->  CTE Scan on completed c
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = c.chain_id)
  ->  CTE Scan on inserted i
```

## continueJobs/batch100

1. `continueJobs`

```
Nested Loop
  Join Filter: (c.continued_to_id = i.id)
  CTE input_data
    ->  Function Scan on t
  CTE completed
    ->  Update on queuert_job j
          InitPlan 2
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 2).col1)
                ->  Nested Loop
                      ->  CTE Scan on input_data d
                      ->  Index Scan using queuert_job_pkey on queuert_job j
                            Index Cond: (id = d.continue_from_id)
                            Filter: ((status <> 'completed'::text) AND ((d.attempt_token IS NULL) OR ((status = 'running'::text) AND (attempt_token = d.attempt_token))))
  CTE inserted
    ->  Insert on queuert_job
          InitPlan 4
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 4).col1)
                ->  Hash Join
                      Hash Cond: (d_1.continue_from_id = c_1.id)
                      ->  CTE Scan on input_data d_1
                      ->  Hash
                            ->  CTE Scan on completed c_1
  ->  Nested Loop
        ->  CTE Scan on completed c
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = c.chain_id)
  ->  CTE Scan on inserted i
```

## addJobsBlockers/default

1. `addJobsBlockers`

```
Nested Loop Left Join
  Join Filter: (h.id = d.blocked_by_chain_id)
  CTE input_data
    ->  Function Scan on t
  CTE locked_blocker_heads
    ->  LockRows
          ->  Nested Loop
                ->  Subquery Scan on "ANY_subquery"
                      ->  Unique
                            ->  Sort
                                  Sort Key: input_data_1.blocked_by_chain_id
                                  ->  CTE Scan on input_data input_data_1
                ->  Index Scan using queuert_job_pkey on queuert_job h_1
                      Index Cond: (id = "ANY_subquery".blocked_by_chain_id)
                      Filter: (chain_index = 0)
  CTE inserted_blockers
    ->  Insert on queuert_job_blocker
          InitPlan 3
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 3).col1)
                ->  Nested Loop
                      Join Filter: (d_1.blocked_by_chain_id = h_2.id)
                      ->  CTE Scan on input_data d_1
                      ->  CTE Scan on locked_blocker_heads h_2
  CTE incomplete_blocker_counts
    ->  HashAggregate
          Group Key: d_2.job_id
          ->  Nested Loop
                Join Filter: (d_2.blocked_by_chain_id = h_3.id)
                ->  CTE Scan on input_data d_2
                ->  CTE Scan on locked_blocker_heads h_3
                      Filter: (chain_status = 'running'::text)
  CTE updated_jobs
    ->  Update on queuert_job j_1
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Nested Loop Left Join
                      Join Filter: (c.job_id = t_1.id)
                      ->  Nested Loop
                            ->  Subquery Scan on t_1
                                  ->  Unique
                                        ->  Sort
                                              Sort Key: locked_blocker_heads_2.id
                                              ->  Append
                                                    ->  CTE Scan on locked_blocker_heads locked_blocker_heads_2
                                                    ->  CTE Scan on incomplete_blocker_counts
                            ->  Index Scan using queuert_job_pkey on queuert_job j_1
                                  Index Cond: (id = t_1.id)
                                  Filter: ((status = ANY ('{pending,blocked}'::text[])) OR (ANY (id = (hashed SubPlan 7).col1)))
                                  SubPlan 7
                                    ->  CTE Scan on locked_blocker_heads locked_blocker_heads_1
                      ->  CTE Scan on incomplete_blocker_counts c
                SubPlan 6
                  ->  CTE Scan on locked_blocker_heads
  ->  Nested Loop
        ->  Nested Loop
              Join Filter: (d.job_id = updated_jobs.id)
              ->  CTE Scan on input_data d
              ->  Append
                    ->  CTE Scan on updated_jobs
                    ->  Subquery Scan on "*SELECT* 2"
                          ->  Nested Loop Anti Join
                                Join Filter: (uj.id = j.id)
                                ->  Nested Loop
                                      ->  HashAggregate
                                            Group Key: input_data.job_id
                                            ->  CTE Scan on input_data
                                      ->  Index Scan using queuert_job_pkey on queuert_job j
                                            Index Cond: (id = input_data.job_id)
                                ->  CTE Scan on updated_jobs uj
        ->  Index Scan using queuert_job_pkey on queuert_job jh
              Index Cond: (id = updated_jobs.chain_id)
  ->  CTE Scan on locked_blocker_heads h
```

## addJobsBlockers/batch100

1. `addJobsBlockers`

```
Hash Left Join
  Hash Cond: (d.blocked_by_chain_id = h.id)
  CTE input_data
    ->  Function Scan on t
  CTE locked_blocker_heads
    ->  LockRows
          ->  Nested Loop
                ->  Subquery Scan on "ANY_subquery"
                      ->  Unique
                            ->  Sort
                                  Sort Key: input_data_1.blocked_by_chain_id
                                  ->  CTE Scan on input_data input_data_1
                ->  Index Scan using queuert_job_pkey on queuert_job h_1
                      Index Cond: (id = "ANY_subquery".blocked_by_chain_id)
                      Filter: (chain_index = 0)
  CTE inserted_blockers
    ->  Insert on queuert_job_blocker
          InitPlan 3
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 3).col1)
                ->  Hash Join
                      Hash Cond: (d_1.blocked_by_chain_id = h_2.id)
                      ->  CTE Scan on input_data d_1
                      ->  Hash
                            ->  CTE Scan on locked_blocker_heads h_2
  CTE incomplete_blocker_counts
    ->  HashAggregate
          Group Key: d_2.job_id
          ->  Hash Join
                Hash Cond: (d_2.blocked_by_chain_id = h_3.id)
                ->  CTE Scan on input_data d_2
                ->  Hash
                      ->  CTE Scan on locked_blocker_heads h_3
                            Filter: (chain_status = 'running'::text)
  CTE updated_jobs
    ->  Update on queuert_job j_1
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Hash Left Join
                      Hash Cond: (t_1.id = c.job_id)
                      ->  Nested Loop
                            ->  Subquery Scan on t_1
                                  ->  HashAggregate
                                        Group Key: locked_blocker_heads_2.id
                                        ->  Append
                                              ->  CTE Scan on locked_blocker_heads locked_blocker_heads_2
                                              ->  CTE Scan on incomplete_blocker_counts
                            ->  Index Scan using queuert_job_pkey on queuert_job j_1
                                  Index Cond: (id = t_1.id)
                                  Filter: ((status = ANY ('{pending,blocked}'::text[])) OR (ANY (id = (hashed SubPlan 7).col1)))
                                  SubPlan 7
                                    ->  CTE Scan on locked_blocker_heads locked_blocker_heads_1
                      ->  Hash
                            ->  CTE Scan on incomplete_blocker_counts c
                SubPlan 6
                  ->  CTE Scan on locked_blocker_heads
  ->  Nested Loop
        ->  Hash Join
              Hash Cond: (updated_jobs.id = d.job_id)
              ->  Append
                    ->  CTE Scan on updated_jobs
                    ->  Subquery Scan on "*SELECT* 2"
                          ->  Hash Anti Join
                                Hash Cond: (j.id = uj.id)
                                ->  Nested Loop
                                      ->  HashAggregate
                                            Group Key: input_data.job_id
                                            ->  CTE Scan on input_data
                                      ->  Index Scan using queuert_job_pkey on queuert_job j
                                            Index Cond: (id = input_data.job_id)
                                ->  Hash
                                      ->  CTE Scan on updated_jobs uj
              ->  Hash
                    ->  CTE Scan on input_data d
        ->  Index Scan using queuert_job_pkey on queuert_job jh
              Index Cond: (id = updated_jobs.chain_id)
  ->  Hash
        ->  CTE Scan on locked_blocker_heads h
```

## getJobsBlockers/default

1. `getJobsBlockers`

```
Incremental Sort
  Sort Key: b.job_id, b.index
  Presorted Key: b.job_id
  ->  Nested Loop Left Join
        ->  Nested Loop
              ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker b
                    Index Cond: (job_id = ANY ('{<uuid>}'::uuid[]))
              ->  Index Scan using queuert_job_pkey on queuert_job head_job
                    Index Cond: (id = b.blocked_by_chain_id)
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                          Index Cond: (chain_id = head_job.id)
```

## getJobsBlockers/manyBlockers

1. `getJobsBlockers`

```
Incremental Sort
  Sort Key: b.job_id, b.index
  Presorted Key: b.job_id
  ->  Nested Loop Left Join
        ->  Nested Loop
              ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker b
                    Index Cond: (job_id = ANY ('{<uuid>}'::uuid[]))
              ->  Index Scan using queuert_job_pkey on queuert_job head_job
                    Index Cond: (id = b.blocked_by_chain_id)
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                          Index Cond: (chain_id = head_job.id)
```

## getJobsBlockers/batch100

1. `getJobsBlockers`

```
Incremental Sort
  Sort Key: b.job_id, b.index
  Presorted Key: b.job_id
  ->  Nested Loop Left Join
        ->  Nested Loop
              ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker b
                    Index Cond: (job_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
              ->  Memoize
                    Cache Key: b.blocked_by_chain_id
                    Cache Mode: logical
                    ->  Index Scan using queuert_job_pkey on queuert_job head_job
                          Index Cond: (id = b.blocked_by_chain_id)
        ->  Subquery Scan on tail_job
              ->  Limit
                    ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                          Index Cond: (chain_id = head_job.id)
```

## unblockJobs/default

1. `unblockJobs`

```
Result
  CTE dependent_blocker_counts
    ->  GroupAggregate
          Group Key: jb.job_id
          ->  Sort
                Sort Key: jb.job_id
                ->  Bitmap Heap Scan on queuert_job_blocker jb
                      Recheck Cond: (blocked_by_chain_id = '<uuid>'::uuid)
                      ->  Bitmap Index Scan on queuert_job_blocker_chain_idx
                            Index Cond: (blocked_by_chain_id = '<uuid>'::uuid)
  CTE locked_dependents
    ->  LockRows
          ->  Nested Loop
                ->  CTE Scan on dependent_blocker_counts c
                ->  Index Scan using queuert_job_pkey on queuert_job j
                      Index Cond: (id = c.job_id)
                      Filter: (status = 'blocked'::text)
  CTE updated
    ->  Update on queuert_job j_1
          InitPlan 3
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 3).col1)
                ->  Nested Loop
                      ->  CTE Scan on locked_dependents l
                      ->  Index Scan using queuert_job_pkey on queuert_job j_1
                            Index Cond: (id = l.id)
                            Filter: (status = 'blocked'::text)
  InitPlan 8
    ->  Aggregate
          ->  Sort
                Sort Key: jb_1.job_id, jb_1.index
                ->  Bitmap Heap Scan on queuert_job_blocker jb_1
                      Recheck Cond: (blocked_by_chain_id = '<uuid>'::uuid)
                      ->  Bitmap Index Scan on queuert_job_blocker_chain_idx
                            Index Cond: (blocked_by_chain_id = '<uuid>'::uuid)
          SubPlan 5
            ->  CTE Scan on updated u
                  Filter: (id = jb_1.job_id)
          SubPlan 6
            ->  Index Scan using queuert_job_pkey on queuert_job j_2
                  Index Cond: (id = jb_1.job_id)
          SubPlan 7
            ->  Nested Loop
                  ->  Index Scan using queuert_job_pkey on queuert_job d
                        Index Cond: (id = jb_1.job_id)
                  ->  Index Scan using queuert_job_pkey on queuert_job h
                        Index Cond: (id = d.chain_id)
```

## unblockJobs/batch100

1. `unblockJobs`

```
Result
  CTE dependent_blocker_counts
    ->  GroupAggregate
          Group Key: jb.job_id
          ->  Sort
                Sort Key: jb.job_id
                ->  Bitmap Heap Scan on queuert_job_blocker jb
                      Recheck Cond: (blocked_by_chain_id = '<uuid>'::uuid)
                      ->  Bitmap Index Scan on queuert_job_blocker_chain_idx
                            Index Cond: (blocked_by_chain_id = '<uuid>'::uuid)
  CTE locked_dependents
    ->  LockRows
          ->  Nested Loop
                ->  CTE Scan on dependent_blocker_counts c
                ->  Index Scan using queuert_job_pkey on queuert_job j
                      Index Cond: (id = c.job_id)
                      Filter: (status = 'blocked'::text)
  CTE updated
    ->  Update on queuert_job j_1
          InitPlan 3
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 3).col1)
                ->  Nested Loop
                      ->  CTE Scan on locked_dependents l
                      ->  Index Scan using queuert_job_pkey on queuert_job j_1
                            Index Cond: (id = l.id)
                            Filter: (status = 'blocked'::text)
  InitPlan 8
    ->  Aggregate
          ->  Sort
                Sort Key: jb_1.job_id, jb_1.index
                ->  Bitmap Heap Scan on queuert_job_blocker jb_1
                      Recheck Cond: (blocked_by_chain_id = '<uuid>'::uuid)
                      ->  Bitmap Index Scan on queuert_job_blocker_chain_idx
                            Index Cond: (blocked_by_chain_id = '<uuid>'::uuid)
          SubPlan 5
            ->  CTE Scan on updated u
                  Filter: (id = jb_1.job_id)
          SubPlan 6
            ->  Index Scan using queuert_job_pkey on queuert_job j_2
                  Index Cond: (id = jb_1.job_id)
          SubPlan 7
            ->  Nested Loop
                  ->  Index Scan using queuert_job_pkey on queuert_job d
                        Index Cond: (id = jb_1.job_id)
                  ->  Index Scan using queuert_job_pkey on queuert_job h
                        Index Cond: (id = d.chain_id)
```

## startWorker/default

1. `startWorker`

```
Insert on queuert_worker
  ->  Subquery Scan on "*SELECT*"
        ->  Result
              One-Time Filter: (NOT (InitPlan 1).col1)
              InitPlan 1
                ->  Result
                      One-Time Filter: false
```

## startWorker/batch100

1. `startWorker`

```
Insert on queuert_worker
  ->  Subquery Scan on "*SELECT*"
        ->  Result
              One-Time Filter: (NOT (InitPlan 1).col1)
              InitPlan 1
                ->  Result
                      One-Time Filter: false
```

## extendWorkerLease/default

1. `extendWorkerLease`

```
Update on queuert_worker
  InitPlan 1
    ->  Result
          One-Time Filter: false
  ->  Result
        One-Time Filter: (NOT (InitPlan 1).col1)
        ->  Index Scan using queuert_worker_pkey on queuert_worker
              Index Cond: (id = '<uuid>'::uuid)
              Filter: ((token = '<uuid>'::uuid) AND (lease_until > statement_timestamp()))
```

## stopWorker/default

1. `stopWorker`

```
Delete on queuert_worker
  InitPlan 1
    ->  Result
          One-Time Filter: false
  ->  Result
        One-Time Filter: (NOT (InitPlan 1).col1)
        ->  Index Scan using queuert_worker_pkey on queuert_worker
              Index Cond: (id = '<uuid>'::uuid)
              Filter: (token = '<uuid>'::uuid)
```

## startJobAttempts/default

1. `startJobAttemptsOfType`

```
Nested Loop
  CTE live_worker
    ->  Update on queuert_worker w
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Index Scan using queuert_worker_pkey on queuert_worker w
                      Index Cond: (id = '<uuid>'::uuid)
                      Filter: ((token = '<uuid>'::uuid) AND (lease_until > statement_timestamp()))
  CTE claim_args
    ->  Result
  CTE job_types
    ->  Nested Loop
          ->  CTE Scan on claim_args a
          ->  Function Scan on u_1
  CTE claimed_jobs
    ->  Limit
          InitPlan 5
            ->  CTE Scan on live_worker
          InitPlan 6
            ->  Aggregate
                  ->  CTE Scan on job_types
          ->  Result
                One-Time Filter: (InitPlan 5).col1
                ->  Nested Loop
                      ->  CTE Scan on job_types job_types_1
                      ->  Subquery Scan on j
                            ->  Limit
                                  ->  LockRows
                                        ->  Index Scan using queuert_job_pending_idx on queuert_job j_1
                                              Index Cond: ((type_name = job_types_1.type_name) AND (scheduled_at <= statement_timestamp()))
                                              Filter: (status = 'pending'::text)
  CTE updated
    ->  Update on queuert_job job
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Nested Loop
                      ->  CTE Scan on claimed_jobs
                      ->  Index Scan using queuert_job_pkey on queuert_job job
                            Index Cond: (id = claimed_jobs.id)
  ->  CTE Scan on updated u
  ->  Memoize
        Cache Key: u.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = u.chain_id)
  SubPlan 10
    ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
          Index Cond: (job_id = u.id)
```

## startJobAttempts/limit100

1. `startJobAttemptsOfType`

```
Nested Loop
  CTE live_worker
    ->  Update on queuert_worker w
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Index Scan using queuert_worker_pkey on queuert_worker w
                      Index Cond: (id = '<uuid>'::uuid)
                      Filter: ((token = '<uuid>'::uuid) AND (lease_until > statement_timestamp()))
  CTE claim_args
    ->  Result
  CTE job_types
    ->  Nested Loop
          ->  CTE Scan on claim_args a
          ->  Function Scan on u_1
  CTE claimed_jobs
    ->  Limit
          InitPlan 5
            ->  CTE Scan on live_worker
          InitPlan 6
            ->  Aggregate
                  ->  CTE Scan on job_types
          ->  Result
                One-Time Filter: (InitPlan 5).col1
                ->  Nested Loop
                      ->  CTE Scan on job_types job_types_1
                      ->  Subquery Scan on j
                            ->  Limit
                                  ->  LockRows
                                        ->  Index Scan using queuert_job_pending_idx on queuert_job j_1
                                              Index Cond: ((type_name = job_types_1.type_name) AND (scheduled_at <= statement_timestamp()))
                                              Filter: (status = 'pending'::text)
  CTE updated
    ->  Update on queuert_job job
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Nested Loop
                      ->  CTE Scan on claimed_jobs
                      ->  Index Scan using queuert_job_pkey on queuert_job job
                            Index Cond: (id = claimed_jobs.id)
  ->  CTE Scan on updated u
  ->  Memoize
        Cache Key: u.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = u.chain_id)
  SubPlan 10
    ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
          Index Cond: (job_id = u.id)
```

## startJobAttempts/batchLimit10

1. `startJobAttemptsOfType`

```
Nested Loop
  CTE live_worker
    ->  Update on queuert_worker w
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Index Scan using queuert_worker_pkey on queuert_worker w
                      Index Cond: (id = '<uuid>'::uuid)
                      Filter: ((token = '<uuid>'::uuid) AND (lease_until > statement_timestamp()))
  CTE claim_args
    ->  Result
  CTE job_types
    ->  Nested Loop
          ->  CTE Scan on claim_args a
          ->  Function Scan on u_1
  CTE claimed_jobs
    ->  Limit
          InitPlan 5
            ->  CTE Scan on live_worker
          InitPlan 6
            ->  Aggregate
                  ->  CTE Scan on job_types
          ->  Result
                One-Time Filter: (InitPlan 5).col1
                ->  Nested Loop
                      ->  CTE Scan on job_types job_types_1
                      ->  Subquery Scan on j
                            ->  Limit
                                  ->  LockRows
                                        ->  Index Scan using queuert_job_pending_idx on queuert_job j_1
                                              Index Cond: ((type_name = job_types_1.type_name) AND (scheduled_at <= statement_timestamp()))
                                              Filter: (status = 'pending'::text)
  CTE updated
    ->  Update on queuert_job job
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Nested Loop
                      ->  CTE Scan on claimed_jobs
                      ->  Index Scan using queuert_job_pkey on queuert_job job
                            Index Cond: (id = claimed_jobs.id)
  ->  CTE Scan on updated u
  ->  Memoize
        Cache Key: u.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = u.chain_id)
  SubPlan 10
    ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
          Index Cond: (job_id = u.id)
```

## startJobAttempts/batch100

1. `startJobAttempts`

```
Nested Loop
  CTE live_worker
    ->  Update on queuert_worker w
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Index Scan using queuert_worker_pkey on queuert_worker w
                      Index Cond: (id = '<uuid>'::uuid)
                      Filter: ((token = '<uuid>'::uuid) AND (lease_until > statement_timestamp()))
  CTE claim_args
    ->  Result
  CTE job_types
    ->  Nested Loop
          ->  CTE Scan on claim_args a
          ->  Function Scan on u_1
  CTE batch_heads
    ->  Nested Loop
          ->  CTE Scan on job_types t
          ->  Subquery Scan on h_1
                Filter: ((h_1."position" % (t.batch_limit)::bigint) = 0)
                ->  WindowAgg
                      Window: w1 AS (ORDER BY j.scheduled_at ROWS UNBOUNDED PRECEDING)
                      ->  Limit
                            ->  Index Only Scan using queuert_job_pending_idx on queuert_job j
                                  Index Cond: ((type_name = t.type_name) AND (scheduled_at <= statement_timestamp()))
  CTE type_quotas
    ->  HashAggregate
          Group Key: batch_heads.type_name, batch_heads.batch_limit
          ->  Limit
                InitPlan 6
                  ->  CTE Scan on claim_args
                ->  Sort
                      Sort Key: batch_heads.scheduled_at, batch_heads.type_name
                      ->  CTE Scan on batch_heads
  CTE claimed_jobs
    ->  Limit
          InitPlan 8
            ->  CTE Scan on live_worker
          InitPlan 9
            ->  Aggregate
                  ->  CTE Scan on job_types
          ->  Result
                One-Time Filter: (InitPlan 8).col1
                ->  Nested Loop
                      ->  CTE Scan on type_quotas q
                      ->  Subquery Scan on j_1
                            ->  Limit
                                  ->  LockRows
                                        ->  Index Scan using queuert_job_pending_idx on queuert_job j_2
                                              Index Cond: ((type_name = q.type_name) AND (scheduled_at <= statement_timestamp()))
                                              Filter: (status = 'pending'::text)
  CTE claimed_types
    ->  HashAggregate
          Group Key: q_1.type_name, q_1.batch_limit, q_1.batches
          ->  Hash Right Join
                Hash Cond: (c.type_name = q_1.type_name)
                ->  CTE Scan on claimed_jobs c
                ->  Hash
                      ->  CTE Scan on type_quotas q_1
  CTE leftover_jobs
    ->  Limit
          InitPlan 12
            ->  CTE Scan on live_worker live_worker_1
          InitPlan 13
            ->  Aggregate
                  ->  CTE Scan on job_types job_types_1
          ->  Result
                One-Time Filter: (InitPlan 12).col1
                ->  Nested Loop
                      ->  GroupAggregate
                            Group Key: b.type_name, b.batch_limit
                            ->  Sort
                                  Sort Key: b.type_name, b.batch_limit
                                  ->  Subquery Scan on b
                                        ->  Limit
                                              InitPlan 14
                                                ->  CTE Scan on claim_args claim_args_1
                                              InitPlan 15
                                                ->  Aggregate
                                                      ->  CTE Scan on claimed_types
                                              ->  Sort
                                                    Sort Key: b_1.scheduled_at, b_1.type_name
                                                    ->  Hash Left Join
                                                          Hash Cond: (b_1.type_name = c_1.type_name)
                                                          Filter: ((NOT COALESCE(c_1.short, false)) AND (b_1.batch_index >= COALESCE(c_1.batches, '0'::bigint)))
                                                          ->  CTE Scan on batch_heads b_1
                                                          ->  Hash
                                                                ->  CTE Scan on claimed_types c_1
                      ->  Subquery Scan on j_3
                            ->  Limit
                                  ->  LockRows
                                        ->  Index Scan using queuert_job_pending_idx on queuert_job j_4
                                              Index Cond: ((type_name = b.type_name) AND (scheduled_at <= statement_timestamp()))
                                              Filter: ((NOT (ANY (id = (hashed SubPlan 16).col1))) AND (status = 'pending'::text))
                                              SubPlan 16
                                                ->  CTE Scan on claimed_jobs
  CTE updated
    ->  Update on queuert_job job
          InitPlan 18
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 18).col1)
                ->  Nested Loop
                      ->  Append
                            ->  CTE Scan on claimed_jobs claimed_jobs_1
                            ->  CTE Scan on leftover_jobs
                      ->  Index Scan using queuert_job_pkey on queuert_job job
                            Index Cond: (id = claimed_jobs_1.id)
  ->  CTE Scan on updated u
  ->  Memoize
        Cache Key: u.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = u.chain_id)
  SubPlan 20
    ->  Index Only Scan using queuert_job_blocker_pkey on queuert_job_blocker jb
          Index Cond: (job_id = u.id)
```

## completeJobs/default

1. `completeJobs`

```
Nested Loop Left Join
  Join Filter: (dh.id = d.chain_id)
  CTE done
    ->  Update on queuert_job j
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Nested Loop
                      ->  Function Scan on t
                      ->  Index Scan using queuert_job_pkey on queuert_job j
                            Index Cond: (id = t.job_id)
                            Filter: ((status <> 'completed'::text) AND ((t.attempt_token IS NULL) OR ((status = 'running'::text) AND (attempt_token = t.attempt_token))))
  CTE head_done
    ->  Update on queuert_job h
          InitPlan 3
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 3).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: done.chain_id
                            ->  CTE Scan on done
                                  Filter: (chain_id <> id)
                      ->  Index Scan using queuert_job_pkey on queuert_job h
                            Index Cond: (id = done.chain_id)
  ->  Nested Loop Left Join
        Join Filter: (hd.id = d.chain_id)
        ->  CTE Scan on done d
        ->  CTE Scan on head_done hd
  ->  CTE Scan on done dh
```

## completeJobs/batch100

1. `completeJobs`

```
Nested Loop Left Join
  Join Filter: (dh.id = d.chain_id)
  CTE done
    ->  Update on queuert_job j
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Nested Loop
                      ->  Function Scan on t
                      ->  Index Scan using queuert_job_pkey on queuert_job j
                            Index Cond: (id = t.job_id)
                            Filter: ((status <> 'completed'::text) AND ((t.attempt_token IS NULL) OR ((status = 'running'::text) AND (attempt_token = t.attempt_token))))
  CTE head_done
    ->  Update on queuert_job h
          InitPlan 3
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 3).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: done.chain_id
                            ->  CTE Scan on done
                                  Filter: (chain_id <> id)
                      ->  Index Scan using queuert_job_pkey on queuert_job h
                            Index Cond: (id = done.chain_id)
  ->  Nested Loop Left Join
        Join Filter: (hd.id = d.chain_id)
        ->  CTE Scan on done d
        ->  CTE Scan on head_done hd
  ->  CTE Scan on done dh
```

## getStartAttemptDelayMs/default

1. `getStartAttemptDelayMs`

```
Result
  One-Time Filter: (COALESCE(((InitPlan 4).col1)::double precision, (InitPlan 5).col1) IS NOT NULL)
  CTE due
    ->  Limit
          ->  Nested Loop
                ->  Function Scan on unnest t
                ->  Subquery Scan on j
                      ->  Limit
                            ->  LockRows
                                  ->  Index Scan using queuert_job_pending_idx on queuert_job j_1
                                        Index Cond: ((type_name = t.type_name) AND (scheduled_at <= statement_timestamp()))
                                        Filter: (status = 'pending'::text)
  InitPlan 2
    ->  Limit
          ->  CTE Scan on due
  InitPlan 3
    ->  Subquery Scan on upcoming
          ->  Limit
                ->  Sort
                      Sort Key: queuert_job.scheduled_at
                      ->  Nested Loop
                            ->  Function Scan on unnest t_1
                            ->  Limit
                                  ->  Index Only Scan using queuert_job_pending_idx on queuert_job
                                        Index Cond: ((type_name = t_1.type_name) AND (scheduled_at > statement_timestamp()))
  InitPlan 4
    ->  Limit
          ->  CTE Scan on due due_1
  InitPlan 5
    ->  Subquery Scan on upcoming_1
          ->  Limit
                ->  Sort
                      Sort Key: queuert_job_1.scheduled_at
                      ->  Nested Loop
                            ->  Function Scan on unnest t_2
                            ->  Limit
                                  ->  Index Only Scan using queuert_job_pending_idx on queuert_job queuert_job_1
                                        Index Cond: ((type_name = t_2.type_name) AND (scheduled_at > statement_timestamp()))
```

## getStartAttemptDelayMs/batch100

1. `getStartAttemptDelayMs`

```
Result
  One-Time Filter: (COALESCE(((InitPlan 4).col1)::double precision, (InitPlan 5).col1) IS NOT NULL)
  CTE due
    ->  Limit
          ->  Nested Loop
                ->  Function Scan on unnest t
                ->  Subquery Scan on j
                      ->  Limit
                            ->  LockRows
                                  ->  Index Scan using queuert_job_pending_idx on queuert_job j_1
                                        Index Cond: ((type_name = t.type_name) AND (scheduled_at <= statement_timestamp()))
                                        Filter: (status = 'pending'::text)
  InitPlan 2
    ->  Limit
          ->  CTE Scan on due
  InitPlan 3
    ->  Subquery Scan on upcoming
          ->  Limit
                ->  Sort
                      Sort Key: queuert_job.scheduled_at
                      ->  Nested Loop
                            ->  Function Scan on unnest t_1
                            ->  Limit
                                  ->  Index Only Scan using queuert_job_pending_idx on queuert_job
                                        Index Cond: ((type_name = t_1.type_name) AND (scheduled_at > statement_timestamp()))
  InitPlan 4
    ->  Limit
          ->  CTE Scan on due due_1
  InitPlan 5
    ->  Subquery Scan on upcoming_1
          ->  Limit
                ->  Sort
                      Sort Key: queuert_job_1.scheduled_at
                      ->  Nested Loop
                            ->  Function Scan on unnest t_2
                            ->  Limit
                                  ->  Index Only Scan using queuert_job_pending_idx on queuert_job queuert_job_1
                                        Index Cond: ((type_name = t_2.type_name) AND (scheduled_at > statement_timestamp()))
```

## rescheduleJobs/default

1. `rescheduleJobs`

```
Nested Loop
  CTE updated
    ->  Update on queuert_job j
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Nested Loop
                      ->  Function Scan on t
                      ->  Index Scan using queuert_job_pkey on queuert_job j
                            Index Cond: (id = t.job_id)
                            Filter: ((status <> 'completed'::text) AND ((t.attempt_token IS NULL) OR ((status = 'running'::text) AND (attempt_token = t.attempt_token))))
  ->  CTE Scan on updated u
  ->  Index Scan using queuert_job_pkey on queuert_job h
        Index Cond: (id = u.chain_id)
```

## rescheduleJobs/batch100

1. `rescheduleJobs`

```
Nested Loop
  CTE updated
    ->  Update on queuert_job j
          InitPlan 1
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 1).col1)
                ->  Nested Loop
                      ->  Function Scan on t
                      ->  Index Scan using queuert_job_pkey on queuert_job j
                            Index Cond: (id = t.job_id)
                            Filter: ((status <> 'completed'::text) AND ((t.attempt_token IS NULL) OR ((status = 'running'::text) AND (attempt_token = t.attempt_token))))
  ->  CTE Scan on updated u
  ->  Index Scan using queuert_job_pkey on queuert_job h
        Index Cond: (id = u.chain_id)
```

## deleteChains/default

1. `deleteChains`

```
Result
  CTE _members
    ->  Bitmap Heap Scan on queuert_job
          Recheck Cond: ((id = ANY ('{<uuid>}'::uuid[])) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
          Filter: (((id = ANY ('{<uuid>}'::uuid[])) AND (chain_index = 0)) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
          ->  BitmapOr
                ->  Bitmap Index Scan on queuert_job_pkey
                      Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
                ->  Bitmap Index Scan on queuert_chain_index_idx
                      Index Cond: ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0))
  CTE _deleted_blockers
    ->  Delete on queuert_job_blocker
          InitPlan 2
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 2).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: _members.id
                            ->  CTE Scan on _members
                      ->  Bitmap Heap Scan on queuert_job_blocker
                            Recheck Cond: (job_id = _members.id)
                            ->  Bitmap Index Scan on queuert_job_blocker_pkey
                                  Index Cond: (job_id = _members.id)
  CTE _cleared_heads
    ->  Update on queuert_job h
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: queuert_job_blocker_1.blocked_by_chain_id
                            ->  Nested Loop
                                  ->  HashAggregate
                                        Group Key: _members_3.id
                                        ->  CTE Scan on _members _members_3
                                  ->  Bitmap Heap Scan on queuert_job_blocker queuert_job_blocker_1
                                        Recheck Cond: (job_id = _members_3.id)
                                        ->  Bitmap Index Scan on queuert_job_blocker_pkey
                                              Index Cond: (job_id = _members_3.id)
                      ->  Index Scan using queuert_job_pkey on queuert_job h
                            Index Cond: (id = queuert_job_blocker_1.blocked_by_chain_id)
                            Filter: ((NOT (ANY (id = (hashed SubPlan 7).col1))) AND (chain_index = 0))
                            SubPlan 7
                              ->  CTE Scan on _members _members_2
                SubPlan 5
                  ->  Index Scan using queuert_job_blocker_chain_idx on queuert_job_blocker jb
                        Index Cond: (blocked_by_chain_id = h.id)
                        Filter: (NOT (ANY (job_id = (hashed SubPlan 4).col1)))
                        SubPlan 4
                          ->  CTE Scan on _members _members_1
  CTE _deleted_jobs
    ->  Delete on queuert_job queuert_job_1
          InitPlan 10
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 10).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: _members_4.id
                            ->  CTE Scan on _members _members_4
                      ->  Index Scan using queuert_job_pkey on queuert_job queuert_job_1
                            Index Cond: (id = _members_4.id)
  InitPlan 13
    ->  Aggregate
          ->  CTE Scan on _deleted_jobs head_job
                Filter: (chain_index = 0)
          SubPlan 12
            ->  Limit
                  ->  Sort
                        Sort Key: tail_job.chain_index DESC
                        ->  CTE Scan on _deleted_jobs tail_job
                              Filter: ((chain_index > 0) AND (chain_id = head_job.id))
```

## deleteChains/multiJob

1. `deleteChains`

```
Result
  CTE _members
    ->  Bitmap Heap Scan on queuert_job
          Recheck Cond: ((id = ANY ('{<uuid>}'::uuid[])) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
          Filter: (((id = ANY ('{<uuid>}'::uuid[])) AND (chain_index = 0)) OR ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0)))
          ->  BitmapOr
                ->  Bitmap Index Scan on queuert_job_pkey
                      Index Cond: (id = ANY ('{<uuid>}'::uuid[]))
                ->  Bitmap Index Scan on queuert_chain_index_idx
                      Index Cond: ((chain_id = ANY ('{<uuid>}'::uuid[])) AND (chain_index > 0))
  CTE _deleted_blockers
    ->  Delete on queuert_job_blocker
          InitPlan 2
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 2).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: _members.id
                            ->  CTE Scan on _members
                      ->  Bitmap Heap Scan on queuert_job_blocker
                            Recheck Cond: (job_id = _members.id)
                            ->  Bitmap Index Scan on queuert_job_blocker_pkey
                                  Index Cond: (job_id = _members.id)
  CTE _cleared_heads
    ->  Update on queuert_job h
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: queuert_job_blocker_1.blocked_by_chain_id
                            ->  Nested Loop
                                  ->  HashAggregate
                                        Group Key: _members_3.id
                                        ->  CTE Scan on _members _members_3
                                  ->  Bitmap Heap Scan on queuert_job_blocker queuert_job_blocker_1
                                        Recheck Cond: (job_id = _members_3.id)
                                        ->  Bitmap Index Scan on queuert_job_blocker_pkey
                                              Index Cond: (job_id = _members_3.id)
                      ->  Index Scan using queuert_job_pkey on queuert_job h
                            Index Cond: (id = queuert_job_blocker_1.blocked_by_chain_id)
                            Filter: ((NOT (ANY (id = (hashed SubPlan 7).col1))) AND (chain_index = 0))
                            SubPlan 7
                              ->  CTE Scan on _members _members_2
                SubPlan 5
                  ->  Index Scan using queuert_job_blocker_chain_idx on queuert_job_blocker jb
                        Index Cond: (blocked_by_chain_id = h.id)
                        Filter: (NOT (ANY (job_id = (hashed SubPlan 4).col1)))
                        SubPlan 4
                          ->  CTE Scan on _members _members_1
  CTE _deleted_jobs
    ->  Delete on queuert_job queuert_job_1
          InitPlan 10
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 10).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: _members_4.id
                            ->  CTE Scan on _members _members_4
                      ->  Index Scan using queuert_job_pkey on queuert_job queuert_job_1
                            Index Cond: (id = _members_4.id)
  InitPlan 13
    ->  Aggregate
          ->  CTE Scan on _deleted_jobs head_job
                Filter: (chain_index = 0)
          SubPlan 12
            ->  Limit
                  ->  Sort
                        Sort Key: tail_job.chain_index DESC
                        ->  CTE Scan on _deleted_jobs tail_job
                              Filter: ((chain_index > 0) AND (chain_id = head_job.id))
```

## deleteChains/batch100

1. `deleteChains`

```
Result
  CTE _members
    ->  Bitmap Heap Scan on queuert_job
          Recheck Cond: ((id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) OR ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0)))
          Filter: (((id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index = 0)) OR ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0)))
          ->  BitmapOr
                ->  Bitmap Index Scan on queuert_job_pkey
                      Index Cond: (id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[]))
                ->  Bitmap Index Scan on queuert_chain_index_idx
                      Index Cond: ((chain_id = ANY ('{<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>,<uuid>}'::uuid[])) AND (chain_index > 0))
  CTE _deleted_blockers
    ->  Delete on queuert_job_blocker
          InitPlan 2
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 2).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: _members.id
                            ->  CTE Scan on _members
                      ->  Index Scan using queuert_job_blocker_pkey on queuert_job_blocker
                            Index Cond: (job_id = _members.id)
  CTE _cleared_heads
    ->  Update on queuert_job h
          InitPlan 8
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 8).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: queuert_job_blocker_1.blocked_by_chain_id
                            ->  Nested Loop
                                  ->  HashAggregate
                                        Group Key: _members_3.id
                                        ->  CTE Scan on _members _members_3
                                  ->  Index Scan using queuert_job_blocker_pkey on queuert_job_blocker queuert_job_blocker_1
                                        Index Cond: (job_id = _members_3.id)
                      ->  Index Scan using queuert_job_pkey on queuert_job h
                            Index Cond: (id = queuert_job_blocker_1.blocked_by_chain_id)
                            Filter: ((NOT (ANY (id = (hashed SubPlan 7).col1))) AND (chain_index = 0))
                            SubPlan 7
                              ->  CTE Scan on _members _members_2
                SubPlan 5
                  ->  Index Scan using queuert_job_blocker_chain_idx on queuert_job_blocker jb
                        Index Cond: (blocked_by_chain_id = h.id)
                        Filter: (NOT (ANY (job_id = (hashed SubPlan 4).col1)))
                        SubPlan 4
                          ->  CTE Scan on _members _members_1
  CTE _deleted_jobs
    ->  Delete on queuert_job queuert_job_1
          InitPlan 10
            ->  Result
                  One-Time Filter: false
          ->  Result
                One-Time Filter: (NOT (InitPlan 10).col1)
                ->  Nested Loop
                      ->  HashAggregate
                            Group Key: _members_4.id
                            ->  CTE Scan on _members _members_4
                      ->  Index Scan using queuert_job_pkey on queuert_job queuert_job_1
                            Index Cond: (id = _members_4.id)
  InitPlan 13
    ->  Aggregate
          ->  CTE Scan on _deleted_jobs head_job
                Filter: (chain_index = 0)
          SubPlan 12
            ->  Limit
                  ->  Sort
                        Sort Key: tail_job.chain_index DESC
                        ->  CTE Scan on _deleted_jobs tail_job
                              Filter: ((chain_index > 0) AND (chain_id = head_job.id))
```

## getChainTypeNames/default

1. `getChainTypeNames`

```
CTE Scan on types
  Filter: (type_name IS NOT NULL)
  CTE types
    ->  Recursive Union
          ->  Limit
                ->  Index Only Scan using queuert_chain_idx on queuert_job
          ->  WorkTable Scan on types types_1
                Filter: (type_name IS NOT NULL)
```

## getJobTypeNames/default

1. `getJobTypeNames`

```
CTE Scan on types
  Filter: (type_name IS NOT NULL)
  CTE types
    ->  Recursive Union
          ->  Limit
                ->  Index Only Scan using queuert_job_idx on queuert_job
          ->  WorkTable Scan on types types_1
                Filter: (type_name IS NOT NULL)
```

## countChainsByTypeName/default

1. `countChainsByTypeName`

```
Function Scan on unnest t
  SubPlan 1
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_chain_running_idx on queuert_job
                      Index Cond: (type_name = t.name)
  SubPlan 2
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_chain_completed_idx on queuert_job queuert_job_1
                      Index Cond: (type_name = t.name)
```

## countChainsByTypeName/batch100

1. `countChainsByTypeName`

```
Function Scan on unnest t
  SubPlan 1
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_chain_running_idx on queuert_job
                      Index Cond: (type_name = t.name)
  SubPlan 2
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_chain_completed_idx on queuert_job queuert_job_1
                      Index Cond: (type_name = t.name)
```

## countJobsByTypeName/default

1. `countJobsByTypeName`

```
Function Scan on unnest t
  SubPlan 1
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_blocked_idx on queuert_job
                      Index Cond: (type_name = t.name)
  SubPlan 2
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_pending_idx on queuert_job queuert_job_1
                      Index Cond: (type_name = t.name)
  SubPlan 3
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_running_idx on queuert_job queuert_job_2
                      Index Cond: (type_name = t.name)
  SubPlan 4
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_completed_idx on queuert_job queuert_job_3
                      Index Cond: (type_name = t.name)
```

## countJobsByTypeName/batch100

1. `countJobsByTypeName`

```
Function Scan on unnest t
  SubPlan 1
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_blocked_idx on queuert_job
                      Index Cond: (type_name = t.name)
  SubPlan 2
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_pending_idx on queuert_job queuert_job_1
                      Index Cond: (type_name = t.name)
  SubPlan 3
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_running_idx on queuert_job queuert_job_2
                      Index Cond: (type_name = t.name)
  SubPlan 4
    ->  Aggregate
          ->  Limit
                ->  Index Only Scan using queuert_job_completed_idx on queuert_job queuert_job_3
                      Index Cond: (type_name = t.name)
```

## countWorkers/default

1. `countWorkers`

```
Aggregate
  ->  Seq Scan on queuert_worker
```

## countWorkersByTypeName/default

1. `countWorkersByTypeName`

```
GroupAggregate
  Group Key: t.ord
  ->  Nested Loop Left Join
        Join Filter: (t.type_name = ANY (w.type_names))
        ->  Function Scan on unnest t
        ->  Materialize
              ->  Seq Scan on queuert_worker w
```

## countWorkersByTypeName/batch100

1. `countWorkersByTypeName`

```
GroupAggregate
  Group Key: t.ord
  ->  Nested Loop Left Join
        Join Filter: (t.type_name = ANY (w.type_names))
        ->  Function Scan on unnest t
        ->  Materialize
              ->  Seq Scan on queuert_worker w
```

## countRunningJobsByWorkerId/default

1. `countRunningJobsByWorkerId`

```
GroupAggregate
  Group Key: w.ord
  ->  Nested Loop Left Join
        ->  Function Scan on unnest w
        ->  Index Scan using queuert_job_attempt_by_idx on queuert_job j
              Index Cond: (attempt_by = w.id)
```

## countRunningJobsByWorkerId/batch100

1. `countRunningJobsByWorkerId`

```
GroupAggregate
  Group Key: w.ord
  ->  Sort
        Sort Key: w.ord
        ->  Hash Right Join
              Hash Cond: (j.attempt_by = w.id)
              ->  Bitmap Heap Scan on queuert_job j
                    Recheck Cond: (status = 'running'::text)
                    ->  Bitmap Index Scan on queuert_job_attempt_by_idx
              ->  Hash
                    ->  Function Scan on unnest w
```

## listJobs/noStatus/default

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/noStatus/fromTo

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: ((type_name = 'seed:pending:order'::text) AND (created_at >= '<timestamp>'::timestamp with time zone) AND (created_at <= '<timestamp>'::timestamp with time zone))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/noStatus/cursor

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

2. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
                          Filter: ((created_at < '<timestamp>'::timestamp with time zone) OR ((created_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/pending/default

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_pending_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/pending/fromTo

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_pending_idx on queuert_job j_1
                          Index Cond: ((type_name = 'seed:pending:order'::text) AND (scheduled_at >= '<timestamp>'::timestamp with time zone) AND (scheduled_at <= '<timestamp>'::timestamp with time zone))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/pending/orderByCreatedAt

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
                          Filter: (status = 'pending'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/pending/cursor

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_pending_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

2. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_pending_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
                          Filter: ((scheduled_at < '<timestamp>'::timestamp with time zone) OR ((scheduled_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/blocked/default

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_blocked_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:blocked:fanin:1'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/blocked/fromTo

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_blocked_idx on queuert_job j_1
                          Index Cond: ((type_name = 'seed:blocked:fanin:1'::text) AND (scheduled_at >= '<timestamp>'::timestamp with time zone) AND (scheduled_at <= '<timestamp>'::timestamp with time zone))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/blocked/orderByCreatedAt

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:blocked:fanin:1'::text)
                          Filter: (status = 'blocked'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/blocked/cursor

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_blocked_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:blocked:fanin:1'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

2. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.scheduled_at DESC, j_1.id DESC
                    Presorted Key: j_1.scheduled_at
                    ->  Index Scan Backward using queuert_job_blocked_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:blocked:fanin:1'::text)
                          Filter: ((scheduled_at < '<timestamp>'::timestamp with time zone) OR ((scheduled_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/running/default

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.attempt_at DESC, j_1.id DESC
                    Presorted Key: j_1.attempt_at
                    ->  Index Scan Backward using queuert_job_running_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:running:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/running/orderByCreatedAt

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:running:order'::text)
                          Filter: (status = 'running'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/running/cursor

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.attempt_at DESC, j_1.id DESC
                    Presorted Key: j_1.attempt_at
                    ->  Index Scan Backward using queuert_job_running_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:running:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

2. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Sort
                    Sort Key: j_1.attempt_at DESC, j_1.id DESC
                    ->  Bitmap Heap Scan on queuert_job j_1
                          Recheck Cond: (((type_name = 'seed:running:order'::text) AND (attempt_at < '<timestamp>'::timestamp with time zone) AND (status = 'running'::text)) OR ((type_name = 'seed:running:order'::text) AND (attempt_at = '<timestamp>'::timestamp with time zone) AND (status = 'running'::text)))
                          Filter: ((attempt_at < '<timestamp>'::timestamp with time zone) OR ((attempt_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
                          ->  BitmapOr
                                ->  Bitmap Index Scan on queuert_job_running_idx
                                      Index Cond: ((type_name = 'seed:running:order'::text) AND (attempt_at < '<timestamp>'::timestamp with time zone))
                                ->  Bitmap Index Scan on queuert_job_running_idx
                                      Index Cond: ((type_name = 'seed:running:order'::text) AND (attempt_at = '<timestamp>'::timestamp with time zone))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/completed/default

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.completed_at DESC, j_1.id DESC
                    Presorted Key: j_1.completed_at
                    ->  Index Scan Backward using queuert_job_completed_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/completed/orderByCreatedAt

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.created_at DESC, j_1.id DESC
                    Presorted Key: j_1.created_at
                    ->  Index Scan Backward using queuert_job_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
                          Filter: (status = 'completed'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listJobs/completed/cursor

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.completed_at DESC, j_1.id DESC
                    Presorted Key: j_1.completed_at
                    ->  Index Scan Backward using queuert_job_completed_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

2. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.completed_at DESC, j_1.id DESC
                    Presorted Key: j_1.completed_at
                    ->  Index Scan Backward using queuert_job_completed_idx on queuert_job j_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
                          Filter: ((completed_at < '<timestamp>'::timestamp with time zone) OR ((completed_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listChains/noStatus/default

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/noStatus/nonBlocking

1. `dynamic`

```
Limit
  ->  Incremental Sort
        Sort Key: head_job.created_at DESC, head_job.id DESC
        Presorted Key: head_job.created_at
        ->  Nested Loop Left Join
              ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job
                    Index Cond: (type_name = 'seed:pending:order'::text)
                    Filter: (NOT blocking)
              ->  Subquery Scan on tail_job
                    ->  Limit
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: (chain_id = head_job.id)
```

## listChains/noStatus/blocking

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_blocking_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/noStatus/fromTo

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job_1
                          Index Cond: ((type_name = 'seed:pending:order'::text) AND (created_at >= '<timestamp>'::timestamp with time zone) AND (created_at <= '<timestamp>'::timestamp with time zone))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/noStatus/cursor

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

2. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:pending:order'::text)
                          Filter: ((created_at < '<timestamp>'::timestamp with time zone) OR ((created_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/running/default

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_running_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:running:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/running/nonBlocking

1. `dynamic`

```
Limit
  ->  Incremental Sort
        Sort Key: head_job.created_at DESC, head_job.id DESC
        Presorted Key: head_job.created_at
        ->  Nested Loop Left Join
              ->  Index Scan Backward using queuert_chain_running_idx on queuert_job head_job
                    Index Cond: (type_name = 'seed:running:order'::text)
                    Filter: (NOT blocking)
              ->  Subquery Scan on tail_job
                    ->  Limit
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: (chain_id = head_job.id)
```

## listChains/running/blocking

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_blocking_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:running:order'::text)
                          Filter: (chain_status = 'running'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/running/cursor

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_running_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:running:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

2. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_running_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:running:order'::text)
                          Filter: ((created_at < '<timestamp>'::timestamp with time zone) OR ((created_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/completed/default

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.chain_completed_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.chain_completed_at
                    ->  Index Scan Backward using queuert_chain_completed_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/completed/nonBlocking

1. `dynamic`

```
Limit
  ->  Incremental Sort
        Sort Key: head_job.chain_completed_at DESC, head_job.id DESC
        Presorted Key: head_job.chain_completed_at
        ->  Nested Loop Left Join
              ->  Index Scan Backward using queuert_chain_completed_idx on queuert_job head_job
                    Index Cond: (type_name = 'seed:completed:order'::text)
                    Filter: (NOT blocking)
              ->  Subquery Scan on tail_job
                    ->  Limit
                          ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                                Index Cond: (chain_id = head_job.id)
```

## listChains/completed/blocking

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Sort
                    Sort Key: head_job_1.chain_completed_at DESC, head_job_1.id DESC
                    ->  Bitmap Heap Scan on queuert_job head_job_1
                          Recheck Cond: ((type_name = 'seed:completed:order'::text) AND (chain_index = 0) AND blocking)
                          Filter: (chain_status = 'completed'::text)
                          ->  Bitmap Index Scan on queuert_chain_blocking_idx
                                Index Cond: (type_name = 'seed:completed:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/completed/orderByCreatedAt

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
                          Filter: (chain_status = 'completed'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/completed/orderByCompletedAt

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.chain_completed_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.chain_completed_at
                    ->  Index Scan Backward using queuert_chain_completed_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/completed/cursor

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.chain_completed_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.chain_completed_at
                    ->  Index Scan Backward using queuert_chain_completed_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

2. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.chain_completed_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.chain_completed_at
                    ->  Index Scan Backward using queuert_chain_completed_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
                          Filter: ((chain_completed_at < '<timestamp>'::timestamp with time zone) OR ((chain_completed_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/completed/orderByCreatedAtCursor

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
                          Filter: (chain_status = 'completed'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

2. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.created_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.created_at
                    ->  Index Scan Backward using queuert_chain_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
                          Filter: ((chain_status = 'completed'::text) AND ((created_at < '<timestamp>'::timestamp with time zone) OR ((created_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid))))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChains/completed/orderByCompletedAtCursor

1. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.chain_completed_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.chain_completed_at
                    ->  Index Scan Backward using queuert_chain_completed_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

2. `dynamic`

```
Nested Loop Left Join
  ->  Subquery Scan on head_job
        ->  Limit
              ->  Incremental Sort
                    Sort Key: head_job_1.chain_completed_at DESC, head_job_1.id DESC
                    Presorted Key: head_job_1.chain_completed_at
                    ->  Index Scan Backward using queuert_chain_completed_idx on queuert_job head_job_1
                          Index Cond: (type_name = 'seed:completed:order'::text)
                          Filter: ((chain_completed_at < '<timestamp>'::timestamp with time zone) OR ((chain_completed_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
  ->  Subquery Scan on tail_job
        ->  Limit
              ->  Index Scan Backward using queuert_chain_index_idx on queuert_job
                    Index Cond: (chain_id = head_job.id)
```

## listChainJobs/default

1. `dynamic`

```
Limit
  ->  Sort
        Sort Key: j.chain_index, j.id
        ->  Nested Loop
              ->  Index Scan using queuert_job_pkey on queuert_job h
                    Index Cond: (id = '<uuid>'::uuid)
              ->  Bitmap Heap Scan on queuert_job j
                    Recheck Cond: ((id = '<uuid>'::uuid) OR ((chain_id = '<uuid>'::uuid) AND (chain_index > 0)))
                    Filter: (((id = '<uuid>'::uuid) AND (chain_index = 0)) OR ((chain_id = '<uuid>'::uuid) AND (chain_index > 0)))
                    ->  BitmapOr
                          ->  Bitmap Index Scan on queuert_job_pkey
                                Index Cond: (id = '<uuid>'::uuid)
                          ->  Bitmap Index Scan on queuert_chain_index_idx
                                Index Cond: ((chain_id = '<uuid>'::uuid) AND (chain_index > 0))
```

## listChainJobs/cursor

1. `dynamic`

```
Limit
  ->  Sort
        Sort Key: j.chain_index, j.id
        ->  Nested Loop
              ->  Index Scan using queuert_job_pkey on queuert_job h
                    Index Cond: (id = '<uuid>'::uuid)
              ->  Bitmap Heap Scan on queuert_job j
                    Recheck Cond: ((id = '<uuid>'::uuid) OR ((chain_id = '<uuid>'::uuid) AND (chain_index > 0)))
                    Filter: (((id = '<uuid>'::uuid) AND (chain_index = 0)) OR ((chain_id = '<uuid>'::uuid) AND (chain_index > 0)))
                    ->  BitmapOr
                          ->  Bitmap Index Scan on queuert_job_pkey
                                Index Cond: (id = '<uuid>'::uuid)
                          ->  Bitmap Index Scan on queuert_chain_index_idx
                                Index Cond: ((chain_id = '<uuid>'::uuid) AND (chain_index > 0))
```

2. `dynamic`

```
Limit
  ->  Sort
        Sort Key: j.chain_index, j.id
        ->  Nested Loop
              Join Filter: (j.chain_index > c.chain_index)
              ->  Nested Loop
                    ->  Index Scan using queuert_job_pkey on queuert_job c
                          Index Cond: (id = '<uuid>'::uuid)
                          Filter: (chain_id = '<uuid>'::uuid)
                    ->  Index Scan using queuert_job_pkey on queuert_job h
                          Index Cond: (id = '<uuid>'::uuid)
              ->  Bitmap Heap Scan on queuert_job j
                    Recheck Cond: ((id = '<uuid>'::uuid) OR ((chain_id = '<uuid>'::uuid) AND (chain_index > 0)))
                    Filter: (((id = '<uuid>'::uuid) AND (chain_index = 0)) OR ((chain_id = '<uuid>'::uuid) AND (chain_index > 0)))
                    ->  BitmapOr
                          ->  Bitmap Index Scan on queuert_job_pkey
                                Index Cond: (id = '<uuid>'::uuid)
                          ->  Bitmap Index Scan on queuert_chain_index_idx
                                Index Cond: ((chain_id = '<uuid>'::uuid) AND (chain_index > 0))
```

## listBlockedJobs/default

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Gather Merge
                    Workers Planned: 2
                    ->  Sort
                          Sort Key: j_1.created_at DESC, j_1.id DESC
                          ->  Hash Join
                                Hash Cond: (j_1.id = jb.job_id)
                                ->  Parallel Seq Scan on queuert_job j_1
                                ->  Hash
                                      ->  HashAggregate
                                            Group Key: jb.job_id
                                            ->  Bitmap Heap Scan on queuert_job_blocker jb
                                                  Recheck Cond: (blocked_by_chain_id = '<uuid>'::uuid)
                                                  ->  Bitmap Index Scan on queuert_job_blocker_chain_idx
                                                        Index Cond: (blocked_by_chain_id = '<uuid>'::uuid)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listBlockedJobs/cursor

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Gather Merge
                    Workers Planned: 2
                    ->  Sort
                          Sort Key: j_1.created_at DESC, j_1.id DESC
                          ->  Hash Join
                                Hash Cond: (j_1.id = jb.job_id)
                                ->  Parallel Seq Scan on queuert_job j_1
                                ->  Hash
                                      ->  HashAggregate
                                            Group Key: jb.job_id
                                            ->  Bitmap Heap Scan on queuert_job_blocker jb
                                                  Recheck Cond: (blocked_by_chain_id = '<uuid>'::uuid)
                                                  ->  Bitmap Index Scan on queuert_job_blocker_chain_idx
                                                        Index Cond: (blocked_by_chain_id = '<uuid>'::uuid)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

2. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Gather Merge
                    Workers Planned: 2
                    ->  Sort
                          Sort Key: j_1.created_at DESC, j_1.id DESC
                          ->  Hash Join
                                Hash Cond: (j_1.id = jb.job_id)
                                ->  Parallel Seq Scan on queuert_job j_1
                                      Filter: ((created_at < '<timestamp>'::timestamp with time zone) OR ((created_at = '<timestamp>'::timestamp with time zone) AND (id < '<uuid>'::uuid)))
                                ->  Hash
                                      ->  HashAggregate
                                            Group Key: jb.job_id
                                            ->  Bitmap Heap Scan on queuert_job_blocker jb
                                                  Recheck Cond: (blocked_by_chain_id = '<uuid>'::uuid)
                                                  ->  Bitmap Index Scan on queuert_job_blocker_chain_idx
                                                        Index Cond: (blocked_by_chain_id = '<uuid>'::uuid)
  ->  Memoize
        Cache Key: j.chain_id
        Cache Mode: logical
        ->  Index Scan using queuert_job_pkey on queuert_job h
              Index Cond: (id = j.chain_id)
```

## listWorkers/default

1. `dynamic`

```
Limit
  ->  Incremental Sort
        Sort Key: started_at, id
        Presorted Key: started_at
        ->  Index Scan using queuert_worker_idx on queuert_worker w
```

## listWorkers/typeName

1. `dynamic`

```
Limit
  ->  Sort
        Sort Key: started_at, id
        ->  Seq Scan on queuert_worker w
              Filter: ('seed:pending:order'::text = ANY (type_names))
```

## listWorkers/status

1. `dynamic`

```
Limit
  ->  Sort
        Sort Key: started_at, id
        ->  Seq Scan on queuert_worker w
              Filter: (lease_until <= statement_timestamp())
```

## listWorkers/cursor

1. `dynamic`

```
Limit
  ->  Incremental Sort
        Sort Key: started_at, id
        Presorted Key: started_at
        ->  Index Scan using queuert_worker_idx on queuert_worker w
```

2. `dynamic`

```
Limit
  ->  Incremental Sort
        Sort Key: started_at, id
        Presorted Key: started_at
        ->  Index Scan using queuert_worker_idx on queuert_worker w
              Filter: ((started_at > '<timestamp>'::timestamp with time zone) OR ((started_at = '<timestamp>'::timestamp with time zone) AND (id > '<uuid>'::uuid)))
```

## listWorkerJobs/default

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.attempt_at, j_1.id
                    Presorted Key: j_1.attempt_at
                    ->  Index Scan using queuert_job_attempt_by_idx on queuert_job j_1
                          Index Cond: (attempt_by = '<uuid>'::uuid)
  ->  Index Scan using queuert_job_pkey on queuert_job h
        Index Cond: (id = j.chain_id)
```

## listWorkerJobs/cursor

1. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.attempt_at, j_1.id
                    Presorted Key: j_1.attempt_at
                    ->  Index Scan using queuert_job_attempt_by_idx on queuert_job j_1
                          Index Cond: (attempt_by = '<uuid>'::uuid)
  ->  Index Scan using queuert_job_pkey on queuert_job h
        Index Cond: (id = j.chain_id)
```

2. `dynamic`

```
Nested Loop
  ->  Subquery Scan on j
        ->  Limit
              ->  Incremental Sort
                    Sort Key: j_1.attempt_at, j_1.id
                    Presorted Key: j_1.attempt_at
                    ->  Index Scan using queuert_job_attempt_by_idx on queuert_job j_1
                          Index Cond: (attempt_by = '<uuid>'::uuid)
                          Filter: ((attempt_at > '<timestamp>'::timestamp with time zone) OR ((attempt_at = '<timestamp>'::timestamp with time zone) AND (id > '<uuid>'::uuid)))
  ->  Index Scan using queuert_job_pkey on queuert_job h
        Index Cond: (id = j.chain_id)
```
