# Processing capacity

Last run 2026-11-26 · commit 23926ee8 · load average 3.04 · all adapters

## Creation (chains/s): State adapter (noop notify)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 420143 |        672546 |
| In-process (async)       | 329753 |        682288 |
| SQLite (better-sqlite3)  |  58869 |        158157 |
| SQLite (node:sqlite)     |  55253 |        125372 |
| PostgreSQL (postgres-js) |   2291 |         66386 |
| PostgreSQL (pg)          |   2336 |         50669 |
| MySQL (mysql2)           |    948 |         22884 |
| MariaDB (mysql2)         |   1314 |         20830 |
| Redis (redis)            |   7435 |         24058 |
| Redis (ioredis)          |   6751 |         21529 |

## Creation (chains/s): Notify adapter (in-process state)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 403784 |        678665 |
| In-process (async)       | 295650 |        668159 |
| Redis (redis)            |   9445 |        371405 |
| Redis (ioredis)          |  10082 |        372803 |
| PostgreSQL (pg)          |   9337 |        346232 |
| PostgreSQL (postgres-js) |  10306 |        383066 |
| NATS                     |   8570 |        336214 |
| IPC                      | 368558 |        655451 |

## Completion, no-op handler (jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 142407 |  158784 |   177818 |
| In-process (async)       | 145596 |  141102 |   156236 |
| SQLite (better-sqlite3)  |  18288 |   21904 |    23828 |
| SQLite (node:sqlite)     |  15909 |   19532 |    21541 |
| PostgreSQL (postgres-js) |   1031 |    3628 |     6799 |
| PostgreSQL (pg)          |    989 |    3563 |     6901 |
| MySQL (mysql2)           |    392 |    1341 |     2669 |
| MariaDB (mysql2)         |    390 |    1370 |     3158 |
| Redis (redis)            |   2567 |    6773 |     4667 |
| Redis (ioredis)          |   2543 |    7001 |    14665 |

## Completion, no-op handler (jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 158241 |  181105 |   179617 |
| In-process (async)       | 131639 |  127646 |   141425 |
| Redis (redis)            |   3221 |   11609 |    29458 |
| Redis (ioredis)          |   3603 |   30912 |    62805 |
| PostgreSQL (pg)          |   3357 |   21912 |    25688 |
| PostgreSQL (postgres-js) |   3493 |   23647 |    28371 |
| NATS                     |   8159 |   26725 |    58900 |
| IPC                      | 118417 |  141215 |   152016 |

## Completion, batched no-op handler (100 per batch, jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 385387 |  381638 |   301342 |
| In-process (async)       | 357833 |  369208 |   287193 |
| SQLite (better-sqlite3)  |  58956 |   54171 |    60984 |
| SQLite (node:sqlite)     |  47732 |   48140 |    47635 |
| PostgreSQL (postgres-js) |  11946 |   51599 |    62327 |
| PostgreSQL (pg)          |  11500 |   47447 |    56726 |
| MySQL (mysql2)           |  12050 |   26011 |    29521 |
| MariaDB (mysql2)         |  10183 |   19315 |    30221 |
| Redis (redis)            |  10354 |   34581 |    29173 |
| Redis (ioredis)          |  11355 |   37472 |    35831 |

## Completion, batched no-op handler (100 per batch, jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 357788 |  362485 |   330597 |
| In-process (async)       | 345969 |  342290 |   299456 |
| Redis (redis)            |  99422 |  148941 |   241788 |
| Redis (ioredis)          | 129152 |  260282 |   263852 |
| PostgreSQL (pg)          | 127707 |  274922 |   275880 |
| PostgreSQL (postgres-js) | 122471 |  295795 |   239472 |
| NATS                     | 204706 |  275842 |   274883 |
| IPC                      | 285130 |  248613 |   241119 |

## Chains with continuations and blockers (4 slots, jobs/s): State adapter (noop notify)

| Adapter                  | 4-job chains | Fan-in of 4 |
| ------------------------ | -----------: | ----------: |
| In-process               |       138883 |      144898 |
| In-process (async)       |       119944 |      108618 |
| SQLite (better-sqlite3)  |        21284 |       10592 |
| SQLite (node:sqlite)     |        18444 |       14398 |
| PostgreSQL (postgres-js) |         3414 |        2181 |
| PostgreSQL (pg)          |         3494 |        2202 |
| MySQL (mysql2)           |         1432 |        1151 |
| MariaDB (mysql2)         |         1242 |         928 |
| Redis (redis)            |         5966 |        2495 |
| Redis (ioredis)          |         6396 |        2951 |

## Chains with continuations and blockers (4 slots, jobs/s): Notify adapter (in-process state)

| Adapter                  | 4-job chains | Fan-in of 4 |
| ------------------------ | -----------: | ----------: |
| In-process               |       147033 |      158053 |
| In-process (async)       |        93061 |      105498 |
| Redis (redis)            |        11911 |       10853 |
| Redis (ioredis)          |        28872 |       27999 |
| PostgreSQL (pg)          |        22168 |       20956 |
| PostgreSQL (postgres-js) |        22240 |       21688 |
| NATS                     |        23679 |       26024 |
| IPC                      |       119642 |      112464 |

## Deletion of completed chains (chains/s): State adapter (noop notify)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 526862 |       1110185 |
| In-process (async)       | 410020 |       1279551 |
| SQLite (better-sqlite3)  |  37063 |        119388 |
| SQLite (node:sqlite)     |  30213 |         88552 |
| PostgreSQL (postgres-js) |    529 |         18414 |
| PostgreSQL (pg)          |    532 |         18229 |
| MySQL (mysql2)           |    692 |         19766 |
| MariaDB (mysql2)         |    770 |         20624 |
| Redis (redis)            |   1837 |         14722 |
| Redis (ioredis)          |   1865 |         11083 |

## Deletion of completed chains (chains/s): Notify adapter (in-process state)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 458021 |       1382921 |
| In-process (async)       | 417928 |       1404708 |
| Redis (redis)            | 364219 |        695165 |
| Redis (ioredis)          | 385917 |       1384826 |
| PostgreSQL (pg)          | 409259 |       1439511 |
| PostgreSQL (postgres-js) | 385724 |       1482564 |
| NATS                     | 333670 |       1219317 |
| IPC                      | 449908 |       1000464 |

## Environment

| Setting    |                         Value |
| ---------- | ----------------------------: |
| Machine    | Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                        Normal |
| OS         |                  macOS 26.7.3 |
| Runtime    |              Node.js v24.22.1 |
| Containers |              socktainer 1.6.1 |
