# Processing capacity

Last run 2026-11-26 · commit 28448c56 · load average 5.40 · all adapters

## Creation (chains/s): State adapter (noop notify)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 368212 |        680365 |
| In-process (async)       | 324693 |        661811 |
| SQLite (better-sqlite3)  |  57289 |        156808 |
| SQLite (node:sqlite)     |  55431 |        124123 |
| PostgreSQL (postgres-js) |   1906 |         61436 |
| PostgreSQL (pg)          |   2009 |         53975 |
| MySQL (mysql2)           |    867 |         21944 |
| MariaDB (mysql2)         |    870 |         28939 |
| Redis (redis)            |   6707 |         35697 |
| Redis (ioredis)          |   6717 |         36443 |

## Creation (chains/s): Notify adapter (in-process state)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 398406 |        659098 |
| In-process (async)       | 288423 |        663984 |
| Redis (redis)            |   8182 |        355337 |
| Redis (ioredis)          |   8344 |        333968 |
| PostgreSQL (pg)          |   7635 |        314557 |
| PostgreSQL (postgres-js) |   8363 |        342556 |
| NATS                     |   8329 |        345318 |
| IPC                      | 361682 |        632082 |

## Completion, no-op handler (jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 159709 |  183575 |   164575 |
| In-process (async)       | 144602 |  141352 |   158671 |
| SQLite (better-sqlite3)  |  17679 |   21820 |    23521 |
| SQLite (node:sqlite)     |  15553 |   19205 |    21256 |
| PostgreSQL (postgres-js) |    924 |    2916 |     5435 |
| PostgreSQL (pg)          |    959 |    2885 |     5514 |
| MySQL (mysql2)           |    366 |    1045 |     2783 |
| MariaDB (mysql2)         |    353 |     971 |     2464 |
| Redis (redis)            |   2218 |    6339 |    10223 |
| Redis (ioredis)          |   2271 |    5617 |    13065 |

## Completion, no-op handler (jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 154765 |  173738 |   175939 |
| In-process (async)       | 126940 |  124460 |   140209 |
| Redis (redis)            |   2925 |   10151 |    27879 |
| Redis (ioredis)          |   2796 |   14613 |    50265 |
| PostgreSQL (pg)          |   2661 |   17792 |    22408 |
| PostgreSQL (postgres-js) |   2824 |   18202 |    21830 |
| NATS                     |   6697 |   18954 |    47012 |
| IPC                      | 123602 |  147611 |   146839 |

## Completion, batched no-op handler (100 per batch, jobs/s): State adapter (noop notify)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 383078 |  347865 |   344071 |
| In-process (async)       | 374386 |  354714 |   333451 |
| SQLite (better-sqlite3)  |  58858 |   59053 |    57883 |
| SQLite (node:sqlite)     |  46221 |   46558 |    46700 |
| PostgreSQL (postgres-js) |  14255 |   45865 |    59645 |
| PostgreSQL (pg)          |  13417 |   45874 |    56037 |
| MySQL (mysql2)           |  10203 |   23802 |    30630 |
| MariaDB (mysql2)         |   9546 |   18752 |    30966 |
| Redis (redis)            |  17594 |   29963 |    29983 |
| Redis (ioredis)          |  17585 |   37039 |    34873 |

## Completion, batched no-op handler (100 per batch, jobs/s): Notify adapter (in-process state)

| Adapter                  | 1 slot | 4 slots | 16 slots |
| ------------------------ | -----: | ------: | -------: |
| In-process               | 355173 |  331909 |   325063 |
| In-process (async)       | 341864 |  332664 |   303083 |
| Redis (redis)            | 120832 |  189870 |   265690 |
| Redis (ioredis)          | 131800 |  291825 |   281199 |
| PostgreSQL (pg)          | 117446 |  267154 |   225950 |
| PostgreSQL (postgres-js) | 116038 |  237867 |   220360 |
| NATS                     | 196026 |  279477 |   257892 |
| IPC                      | 281299 |  256479 |   261946 |

## Chains with continuations and blockers (4 slots, jobs/s): State adapter (noop notify)

| Adapter                  | 4-job chains | Fan-in of 4 |
| ------------------------ | -----------: | ----------: |
| In-process               |       142269 |      132054 |
| In-process (async)       |       116412 |      109159 |
| SQLite (better-sqlite3)  |        20764 |       11633 |
| SQLite (node:sqlite)     |        17804 |       14344 |
| PostgreSQL (postgres-js) |         2807 |        1637 |
| PostgreSQL (pg)          |         2893 |        1678 |
| MySQL (mysql2)           |          922 |         762 |
| MariaDB (mysql2)         |          871 |         743 |
| Redis (redis)            |         5512 |        2097 |
| Redis (ioredis)          |         5566 |        2261 |

## Chains with continuations and blockers (4 slots, jobs/s): Notify adapter (in-process state)

| Adapter                  | 4-job chains | Fan-in of 4 |
| ------------------------ | -----------: | ----------: |
| In-process               |       145164 |      153390 |
| In-process (async)       |        91674 |      105059 |
| Redis (redis)            |         9475 |        9514 |
| Redis (ioredis)          |        15922 |       15646 |
| PostgreSQL (pg)          |        17291 |       15309 |
| PostgreSQL (postgres-js) |        18030 |       16201 |
| NATS                     |        19311 |       19225 |
| IPC                      |       121150 |      129445 |

## Deletion of completed chains (chains/s): State adapter (noop notify)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 422704 |       1009853 |
| In-process (async)       | 286333 |        916898 |
| SQLite (better-sqlite3)  |  36833 |        133890 |
| SQLite (node:sqlite)     |  29947 |         86592 |
| PostgreSQL (postgres-js) |    481 |         14262 |
| PostgreSQL (pg)          |    482 |         14328 |
| MySQL (mysql2)           |    590 |         14741 |
| MariaDB (mysql2)         |    601 |         19521 |
| Redis (redis)            |   1591 |         22415 |
| Redis (ioredis)          |   1585 |         19811 |

## Deletion of completed chains (chains/s): Notify adapter (in-process state)

| Adapter                  | Single | Batched (100) |
| ------------------------ | -----: | ------------: |
| In-process               | 548113 |       1311395 |
| In-process (async)       | 395314 |       1401624 |
| Redis (redis)            | 363557 |       1452925 |
| Redis (ioredis)          | 390805 |       1430600 |
| PostgreSQL (pg)          | 406699 |       1472478 |
| PostgreSQL (postgres-js) | 383209 |       1317572 |
| NATS                     | 384441 |       1287656 |
| IPC                      | 470497 |       1188963 |

## Environment

| Setting    |                                  Value |
| ---------- | -------------------------------------: |
| Machine    |          Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                                 Normal |
| OS         |                           macOS 26.7.3 |
| Runtime    |                       Node.js v24.22.1 |
| Containers | Docker Desktop 4.100.1 (247138) 29.9.3 |
