# Processing capacity

Last run 2026-11-23 · commit e279ddec · load average 3.75 · all adapters

## Creation (chains/s): State adapter (noop notify)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 410329 |        665404 |
| In-process (async)       | 318597 |        659586 |
| SQLite (better-sqlite3)  |  57098 |        145282 |
| SQLite (node:sqlite)     |  54102 |        125067 |
| PostgreSQL (postgres-js) |   1772 |         62861 |
| PostgreSQL (pg)          |   1809 |         58722 |
| MySQL (mysql2)           |    862 |         22387 |
| MariaDB (mysql2)         |    864 |         26707 |
| Redis (redis)            |   6726 |         40833 |
| Redis (ioredis)          |   6468 |         41158 |

## Creation (chains/s): Notify adapter (in-process state)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 400834 |        643629 |
| In-process (async)       | 288481 |        656886 |
| Redis (redis)            |   8683 |        357838 |
| Redis (ioredis)          |   8383 |        345824 |
| PostgreSQL (pg)          |   7707 |        334452 |
| PostgreSQL (postgres-js) |   8726 |        344725 |
| NATS                     |   8443 |        344682 |
| IPC                      | 368983 |        649248 |

## Completion, no-op handler (jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 134867 |  155276 |   162827 |
| In-process (async)       | 141594 |  140035 |   158158 |
| SQLite (better-sqlite3)  |  17776 |   21257 |    23089 |
| SQLite (node:sqlite)     |  15574 |   19165 |    20969 |
| PostgreSQL (postgres-js) |    829 |    2517 |     4845 |
| PostgreSQL (pg)          |    865 |    2797 |     4976 |
| MySQL (mysql2)           |    365 |    1008 |     2668 |
| MariaDB (mysql2)         |    358 |     962 |     2434 |
| Redis (redis)            |   2111 |    6208 |    10270 |
| Redis (ioredis)          |   2321 |    5027 |    12581 |

## Completion, no-op handler (jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 138145 |  178807 |   175120 |
| In-process (async)       | 129736 |  125975 |   140612 |
| Redis (redis)            |   2902 |    9805 |    28267 |
| Redis (ioredis)          |   3006 |   14871 |    50186 |
| PostgreSQL (pg)          |   2748 |   18248 |    23387 |
| PostgreSQL (postgres-js) |   2702 |   19476 |    25098 |
| NATS                     |   6785 |   19789 |    47420 |
| IPC                      | 128175 |  149068 |   143851 |

## Completion, batched no-op handler (100 per batch, jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 319937 |  318035 |   276892 |
| In-process (async)       | 343378 |  338573 |   285885 |
| SQLite (better-sqlite3)  |  54105 |   58271 |    56338 |
| SQLite (node:sqlite)     |  47295 |   47036 |    45908 |
| PostgreSQL (postgres-js) |  14323 |   43464 |    44355 |
| PostgreSQL (pg)          |  15093 |   42509 |    46604 |
| MySQL (mysql2)           |  10260 |   21108 |    27538 |
| MariaDB (mysql2)         |   9407 |   18474 |    28089 |
| Redis (redis)            |  18380 |   32330 |    26666 |
| Redis (ioredis)          |  18400 |   36278 |    33257 |

## Completion, batched no-op handler (100 per batch, jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 340373 |  328496 |   301805 |
| In-process (async)       | 348308 |  336180 |   301066 |
| Redis (redis)            | 119209 |  184697 |   239864 |
| Redis (ioredis)          | 130170 |  287323 |   266507 |
| PostgreSQL (pg)          | 118680 |  266764 |   230315 |
| PostgreSQL (postgres-js) | 126231 |  277761 |   244011 |
| NATS                     | 190475 |  271750 |   221194 |
| IPC                      | 270100 |  265240 |   230207 |
