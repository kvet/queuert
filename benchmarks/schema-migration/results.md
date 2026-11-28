# Schema migration

Last run 2026-11-27 · commit eddcf3e7 · load average 2.24 · PostgreSQL at scales 1, 10, 100

## Dataset

| Scale     |    Jobs |  Chains | Continuations | Completed chains | Blocker rows | Blocked | Partly unblocked | Running | Orphaned running | Stranded blocked | Attempt errors |
| --------- | ------: | ------: | ------------: | ---------------: | -----------: | ------: | ---------------: | ------: | ---------------: | ---------------: | -------------: |
| Scale 1   |   14192 |   13292 |           900 |             2025 |         6932 |    4533 |              200 |     550 |               20 |                3 |            502 |
| Scale 10  |  139746 |  131613 |          8133 |            19984 |        69357 |   45321 |             2006 |    5411 |              200 |               15 |           5047 |
| Scale 100 | 1388572 | 1311957 |         76615 |           196912 |       693098 |  453261 |            20059 |   54015 |             2000 |              184 |          50422 |

## Migration time, idle (s)

| Run       | PostgreSQL | SQLite | MySQL | MariaDB | Redis |
| --------- | ---------: | -----: | ----: | ------: | ----: |
| Scale 1   |       0.20 |   0.00 |  0.18 |    0.10 |  0.19 |
| Scale 10  |       1.58 |   0.06 |  1.28 |    0.69 |  1.78 |
| Scale 100 |      37.06 |   0.65 | 11.31 |    9.52 | 19.22 |

## Migration time, with schema v1 writers (s)

| Run       | PostgreSQL | MySQL | MariaDB |
| --------- | ---------: | ----: | ------: |
| Scale 1   |       1.09 |  0.38 |    0.21 |
| Scale 10  |       3.92 |  1.39 |    1.22 |
| Scale 100 |      67.02 | 15.46 |   10.81 |

## Longest schema v1 write stall (ms)

| Run       | PostgreSQL | MySQL | MariaDB |
| --------- | ---------: | ----: | ------: |
| Scale 1   |       69.2 |  15.5 |    12.2 |
| Scale 10  |      177.6 | 104.4 |    16.1 |
| Scale 100 |     1790.3 | 112.9 |   103.3 |

## PostgreSQL phases

| Run                          | Copy (s) | Copy batches | Batch p50 (ms) | Batch max (ms) | Lock wait (ms) | Swap (ms) | ANALYZE (s) |
| ---------------------------- | -------: | -----------: | -------------: | -------------: | -------------: | --------: | ----------: |
| Scale 1                      |     0.13 |           16 |            8.5 |           10.4 |            0.2 |      16.6 |        0.04 |
| Scale 1, schema v1 writers   |     0.92 |           46 |           18.7 |           47.1 |            1.2 |      67.9 |        0.09 |
| Scale 10                     |     1.40 |          141 |            9.7 |           14.3 |            0.2 |      68.4 |        0.09 |
| Scale 10, schema v1 writers  |     3.62 |          177 |           19.0 |           49.3 |            2.2 |     181.4 |        0.10 |
| Scale 100                    |    36.75 |         1390 |           25.5 |           93.0 |            0.2 |     144.4 |        0.14 |
| Scale 100, schema v1 writers |    64.89 |         1505 |           40.7 |          307.7 |            5.8 |    1805.4 |        0.19 |

## PostgreSQL schema v1 writes

| Run       | Before (ops/s) | Before p99 (ms) | During copy (ops/s) | During copy p50 (ms) | During copy p99 (ms) |
| --------- | -------------: | --------------: | ------------------: | -------------------: | -------------------: |
| Scale 1   |           4199 |             4.0 |                3321 |                  2.4 |                  6.7 |
| Scale 10  |           4167 |             4.0 |                3251 |                  2.6 |                  5.7 |
| Scale 100 |           4062 |             4.7 |                1755 |                  4.0 |                 18.6 |

## MySQL and MariaDB phases (s)

| Run                                   | Before fence | After fence |
| ------------------------------------- | -----------: | ----------: |
| MySQL, scale 1                        |         0.07 |        0.11 |
| MySQL, scale 1, schema v1 writers     |         0.15 |        0.23 |
| MySQL, scale 10                       |         0.30 |        0.98 |
| MySQL, scale 10, schema v1 writers    |         0.36 |        1.03 |
| MySQL, scale 100                      |         1.57 |        9.74 |
| MySQL, scale 100, schema v1 writers   |         4.52 |       10.94 |
| MariaDB, scale 1                      |         0.04 |        0.06 |
| MariaDB, scale 1, schema v1 writers   |         0.08 |        0.13 |
| MariaDB, scale 10                     |         0.15 |        0.55 |
| MariaDB, scale 10, schema v1 writers  |         0.53 |        0.69 |
| MariaDB, scale 100                    |         1.36 |        8.15 |
| MariaDB, scale 100, schema v1 writers |         2.43 |        8.38 |

## MySQL and MariaDB schema v1 writes

| Run                | Before (ops/s) | Before p99 (ms) | Until fence (ops/s) | Until fence p99 (ms) |
| ------------------ | -------------: | --------------: | ------------------: | -------------------: |
| MySQL, scale 1     |           1892 |             9.0 |                1402 |                 12.4 |
| MySQL, scale 10    |           1853 |            17.0 |                 655 |                103.9 |
| MySQL, scale 100   |           1755 |            18.5 |                1321 |                 27.4 |
| MariaDB, scale 1   |           2074 |             6.5 |                1251 |                 12.2 |
| MariaDB, scale 10  |           2177 |             6.3 |                1961 |                 10.4 |
| MariaDB, scale 100 |           2135 |             6.7 |                1304 |                 46.5 |

## Redis phases (s)

| Run       | Blocking flags | consecutiveFailures rewrite |
| --------- | -------------: | --------------------------: |
| Scale 1   |           0.03 |                        0.16 |
| Scale 10  |           0.21 |                        1.57 |
| Scale 100 |           1.99 |                       17.23 |

## Environment

| Setting    |                                  Value |
| ---------- | -------------------------------------: |
| Machine    |          Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                                 Normal |
| OS         |                           macOS 26.7.3 |
| Runtime    |                       Node.js v24.22.1 |
| Containers | Docker Desktop 4.100.1 (247138) 29.9.3 |
