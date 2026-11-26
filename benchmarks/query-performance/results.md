# Query performance

Last run 2026-11-26 · commit 23926ee8 · load average 5.10 · In-process at scale 100

## Operational queries, p50 (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.36 |   0.03 |  1.11 |    0.63 |  0.64 |       0.00 |
| getChains/lock                   |       0.74 |   0.02 |  1.61 |    1.16 |  0.58 |       0.00 |
| getChains/batch100               |       0.69 |   0.21 |  1.54 |    0.81 |  1.11 |       0.01 |
| getChains/lockBatch100           |       1.10 |   0.18 |  1.81 |    2.14 |  1.53 |       0.01 |
| getChainTails/default            |       0.26 |   0.01 |  0.70 |    0.24 |  0.49 |       0.00 |
| getChainTails/lock               |       0.69 |   0.02 |  1.33 |    0.99 |  0.66 |       0.00 |
| getChainTails/batch100           |       0.62 |   0.20 |  1.29 |    0.81 |  0.99 |       0.02 |
| getChainTails/lockBatch100       |       1.03 |   0.20 |  1.95 |    1.79 |  1.50 |       0.02 |
| getJobs/default                  |       0.22 |   0.02 |  0.22 |    0.21 |  0.17 |       0.00 |
| getJobs/lock                     |       0.67 |   0.01 |  1.11 |    1.08 |  0.34 |       0.00 |
| getJobs/batch100                 |       0.56 |   0.20 |  0.63 |    0.62 |  0.58 |       0.01 |
| getJobs/lockBatch100             |       0.98 |   0.18 |  1.94 |    1.89 |  1.02 |       0.01 |
| getWorkers/default               |       0.15 |   0.01 |  0.21 |    0.20 |  0.19 |       0.00 |
| getWorkers/lock                  |       0.36 |   0.01 |  0.68 |    0.69 |  0.18 |       0.00 |
| getWorkers/batch100              |       0.20 |   0.05 |  0.33 |    0.33 |  0.42 |       0.03 |
| getWorkers/lockBatch100          |       0.53 |   0.05 |  1.28 |    0.59 |  0.42 |       0.03 |
| createJobs/default               |       0.75 |   0.03 |  1.17 |    0.88 |  0.24 |       0.01 |
| createJobs/deduplication         |       0.39 |   0.02 |  0.72 |    0.53 |  0.48 |       0.00 |
| createJobs/batch100              |       3.81 |   0.77 |  3.80 |    3.35 |  2.01 |       0.12 |
| createJobs/deduplicationBatch100 |       1.86 |   0.33 |  1.94 |    1.69 |  1.57 |       0.03 |
| continueJobs/default             |       1.56 |   0.06 |  1.36 |    1.66 |  0.39 |       0.01 |
| continueJobs/batch100            |       5.94 |   1.71 |  7.69 |    8.29 |  4.39 |       0.13 |
| addJobsBlockers/default          |       0.99 |   0.05 |  1.69 |    1.41 |  0.63 |       0.00 |
| addJobsBlockers/batch100         |       3.13 |   1.11 |  4.68 |    3.43 |  3.67 |       0.08 |
| getJobsBlockers/default          |       0.27 |   0.02 |  0.31 |    0.28 |  0.58 |       0.00 |
| getJobsBlockers/manyBlockers     |       0.76 |   0.21 |  1.43 |    0.84 |  1.39 |       0.00 |
| getJobsBlockers/batch100         |       0.64 |   0.21 |  1.35 |    0.80 |  1.05 |       0.01 |
| unblockJobs/default              |       1.35 |   0.07 |  1.36 |    1.19 |  0.62 |       0.00 |
| unblockJobs/batch100             |       4.51 |   0.50 |  3.41 |    2.59 |  3.77 |       0.05 |
| startWorker/default              |       0.28 |   0.01 |  0.58 |    0.45 |  0.39 |       0.00 |
| startWorker/batch100             |       0.38 |   0.02 |  0.63 |    0.53 |  0.63 |       0.01 |
| extendWorkerLease/default        |       0.28 |   0.01 |  1.16 |    1.06 |  0.32 |       0.00 |
| stopWorker/default               |       0.29 |   0.01 |  0.97 |    0.86 |  0.31 |       0.00 |
| startJobAttempts/default         |       0.56 |   0.03 |  1.42 |    1.35 |  0.20 |       0.00 |
| startJobAttempts/limit100        |       3.17 |   0.92 |  4.28 |    4.42 |  1.49 |       0.07 |
| startJobAttempts/batchLimit10    |       2.50 |   0.91 |  4.59 |    4.28 |  1.81 |       0.06 |
| startJobAttempts/batch100        |       0.84 |   0.17 |  5.38 |   66.69 |  0.52 |       0.02 |
| completeJobs/default             |       0.76 |   0.04 |  1.53 |    1.25 |  0.47 |       0.00 |
| completeJobs/batch100            |       4.28 |   1.03 |  4.49 |    3.73 |  4.22 |       0.05 |
| getStartAttemptDelayMs/default   |       0.63 |   0.01 |  0.73 |    0.67 |  0.45 |       0.00 |
| getStartAttemptDelayMs/batch100  |       0.58 |   0.03 |  2.34 |    2.35 |  1.01 |       0.01 |
| rescheduleJobs/default           |       0.43 |   0.02 |  1.24 |    1.33 |  0.36 |       0.00 |
| rescheduleJobs/batch100          |       2.21 |   0.81 |  3.89 |    3.21 |  4.23 |       0.06 |
| deleteChains/default             |      90.73 |   0.05 |  1.15 |    1.04 |  0.80 |       0.01 |
| deleteChains/multiJob            |      61.92 |   0.03 |  1.07 |    1.02 |  0.95 |       0.00 |
| deleteChains/batch100            |      85.48 |   0.79 |  3.26 |    2.98 |  3.28 |       0.04 |

## Type discovery & counts, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.36 |   0.03 |  0.36 |    0.33 |  0.26 |       0.01 |
| getJobTypeNames/default             |       0.36 |   0.03 |  0.26 |    0.24 |  0.23 |       0.01 |
| countChainsByTypeName/default       |       1.48 |   0.56 |  3.77 |    5.16 |  0.19 |       0.00 |
| countChainsByTypeName/batch100      |       0.59 |   0.13 |  4.03 |    3.62 |  0.45 |       0.02 |
| countJobsByTypeName/default         |       1.51 |   0.57 |  3.90 |    5.20 |  0.23 |       0.00 |
| countJobsByTypeName/batch100        |       0.98 |   0.16 |  9.93 |    7.15 |  0.64 |       0.01 |
| countWorkers/default                |       0.21 |   0.01 |  0.22 |    0.23 |  0.21 |       0.00 |
| countWorkersByTypeName/default      |       0.26 |   0.51 |  1.06 |    1.30 |  0.22 |       0.10 |
| countWorkersByTypeName/batch100     |       1.48 |   0.54 |  1.14 |    1.41 |  0.38 |       0.08 |
| countRunningJobsByWorkerId/default  |       0.27 |   0.01 |  0.27 |    0.24 |  0.17 |       0.00 |
| countRunningJobsByWorkerId/batch100 |       4.76 |   0.05 |  0.49 |    0.37 |  0.35 |       0.03 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.45 |   0.15 |  0.70 |    0.73 |  0.48 |       0.01 |
| listChains/noStatus/nonBlocking               |       0.50 |   0.14 |  0.65 |    0.73 |  0.79 |       0.01 |
| listChains/noStatus/blocking                  |       0.31 |   0.09 |  0.31 |    0.33 |  0.10 |       0.00 |
| listChains/noStatus/fromTo                    |       0.36 |   0.15 |  0.59 |    0.59 |  0.47 |       0.01 |
| listChains/noStatus/cursor                    |       0.64 |   0.28 |  0.84 |    0.88 |  0.95 |       0.02 |
| listChains/running/default                    |       0.41 |   0.15 |  0.59 |    0.55 |  0.48 |       0.01 |
| listChains/running/nonBlocking                |       0.42 |   0.15 |  0.43 |    0.53 |  0.79 |       0.01 |
| listChains/running/blocking                   |       0.27 |   0.09 |  0.24 |    0.34 |  0.10 |       0.00 |
| listChains/running/cursor                     |       0.69 |   0.29 |  0.84 |    0.93 |  0.95 |       0.01 |
| listChains/completed/default                  |       0.37 |   0.15 |  0.54 |    0.63 |  0.48 |       0.01 |
| listChains/completed/nonBlocking              |       0.44 |   0.16 |  0.45 |    0.61 |  0.78 |       0.01 |
| listChains/completed/blocking                 |       0.25 |   0.08 |  0.33 |    0.39 |  0.10 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.49 |   0.15 |  0.63 |    0.56 |  0.49 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.43 |   0.16 |  0.63 |    0.52 |  0.48 |       0.00 |
| listChains/completed/cursor                   |       0.69 |   0.29 |  1.14 |    0.89 |  0.94 |       0.01 |
| listChains/completed/orderByCreatedAtCursor   |       0.68 |   0.30 |  0.89 |    0.84 |  0.93 |       0.01 |
| listChains/completed/orderByCompletedAtCursor |       0.68 |   0.29 |  0.82 |    0.86 |  0.94 |       0.01 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.41 |   0.14 |  0.76 |    0.56 |  0.52 |       0.01 |
| listJobs/noStatus/fromTo            |       0.41 |   0.12 |  0.53 |    0.49 |  0.41 |       0.01 |
| listJobs/noStatus/cursor            |       0.99 |   0.22 |  1.07 |    0.99 |  0.78 |       0.02 |
| listJobs/pending/default            |       0.38 |   0.11 |  0.32 |    0.45 |  0.35 |       0.01 |
| listJobs/pending/fromTo             |       0.37 |   0.12 |  0.48 |    0.46 |  0.36 |       0.01 |
| listJobs/pending/orderByCreatedAt   |       0.36 |   0.12 |  0.49 |    0.46 |  0.34 |       0.01 |
| listJobs/pending/cursor             |       0.67 |   0.23 |  0.83 |    0.74 |  0.68 |       0.01 |
| listJobs/blocked/default            |       0.35 |   0.12 |  0.58 |    0.39 |  0.33 |       0.01 |
| listJobs/blocked/fromTo             |       0.36 |   0.12 |  0.55 |    0.42 |  0.31 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.38 |   0.11 |  0.65 |    0.39 |  0.33 |       0.01 |
| listJobs/blocked/cursor             |       0.66 |   0.21 |  1.34 |    0.68 |  0.70 |       0.01 |
| listJobs/running/default            |       0.39 |   0.19 |  0.53 |    0.42 |  0.34 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.37 |   0.12 |  0.52 |    0.40 |  0.34 |       0.01 |
| listJobs/running/cursor             |       6.00 |   0.36 |  0.78 |    0.78 |  0.70 |       0.02 |
| listJobs/completed/default          |       0.59 |   0.13 |  0.49 |    0.43 |  0.35 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.55 |   0.13 |  0.51 |    0.48 |  0.35 |       0.01 |
| listJobs/completed/cursor           |       0.85 |   0.23 |  0.80 |    0.78 |  0.70 |       0.01 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.28 |   0.55 |   0.30 |    0.79 |  0.32 |       0.01 |
| listChainJobs/cursor    |       2.32 |   1.07 |   0.55 |    1.22 |  0.77 |       0.01 |
| listBlockedJobs/default |      92.68 | 119.61 | 129.18 |  101.97 |  0.34 |       0.01 |
| listBlockedJobs/cursor  |     186.35 | 240.96 | 257.34 |  207.37 |  0.69 |       0.01 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.27 |   0.05 |  0.38 |    0.34 |  0.30 |       0.03 |
| listWorkers/typeName   |       0.24 |   0.09 |  0.66 |    0.31 |  0.20 |       0.01 |
| listWorkers/status     |       0.25 |   0.03 |  0.22 |    0.25 |  2.14 |       0.00 |
| listWorkers/cursor     |       0.51 |   0.08 |  0.46 |    0.52 |  0.72 |       0.05 |
| listWorkerJobs/default |       0.32 |   0.09 |  0.28 |    0.30 |  0.28 |       0.00 |
| listWorkerJobs/cursor  |       0.63 |   0.17 |  0.51 |    0.57 |  0.49 |       0.01 |

## Operational queries, max (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.39 |   0.06 |  1.47 |    0.82 |  0.69 |       0.10 |
| getChains/lock                   |       0.84 |   0.03 |  1.73 |    1.29 |  0.77 |       0.04 |
| getChains/batch100               |       0.84 |   0.23 |  1.70 |    0.91 |  1.26 |       0.09 |
| getChains/lockBatch100           |       1.25 |   0.19 |  4.65 |    3.90 |  2.07 |       0.03 |
| getChainTails/default            |       0.30 |   0.02 |  0.85 |    0.28 |  0.59 |       0.03 |
| getChainTails/lock               |       0.72 |   0.02 |  1.46 |    1.01 |  0.69 |       0.02 |
| getChainTails/batch100           |       0.66 |   0.25 |  1.40 |    0.89 |  1.02 |       0.04 |
| getChainTails/lockBatch100       |       1.12 |   0.22 |  2.49 |    1.95 |  3.25 |       0.05 |
| getJobs/default                  |       0.28 |   0.02 |  0.25 |    0.51 |  0.17 |       0.04 |
| getJobs/lock                     |       0.74 |   0.02 |  1.16 |    1.15 |  0.36 |       0.02 |
| getJobs/batch100                 |       0.79 |   0.22 |  0.68 |    0.76 |  0.65 |       0.05 |
| getJobs/lockBatch100             |       1.09 |   0.19 |  2.00 |    1.95 |  1.09 |       0.03 |
| getWorkers/default               |       0.19 |   0.02 |  0.23 |    0.21 |  0.20 |       0.03 |
| getWorkers/lock                  |       0.41 |   0.01 |  0.70 |    0.74 |  0.21 |       0.02 |
| getWorkers/batch100              |       0.23 |   0.05 |  0.35 |    0.37 |  0.48 |       0.08 |
| getWorkers/lockBatch100          |       0.65 |   0.06 |  1.46 |    0.63 |  0.44 |       0.05 |
| createJobs/default               |       0.84 |   0.05 |  2.96 |    1.54 |  0.28 |       0.03 |
| createJobs/deduplication         |       0.51 |   0.12 |  0.90 |    0.65 |  0.60 |       0.03 |
| createJobs/batch100              |       4.79 |   0.80 |  4.14 |    3.98 |  3.31 |       0.17 |
| createJobs/deduplicationBatch100 |       2.30 |   0.42 |  2.89 |    2.74 |  2.95 |       0.23 |
| continueJobs/default             |      20.97 |   0.07 |  1.48 |    1.86 |  0.41 |       0.03 |
| continueJobs/batch100            |       6.80 |   1.77 |  8.52 |   15.04 |  4.87 |       0.17 |
| addJobsBlockers/default          |       1.38 |   0.07 |  2.03 |    1.56 |  0.68 |       0.03 |
| addJobsBlockers/batch100         |       3.56 |   1.16 |  6.29 |    4.30 |  4.61 |       0.12 |
| getJobsBlockers/default          |       0.38 |   0.03 |  0.39 |    0.33 |  0.61 |       0.04 |
| getJobsBlockers/manyBlockers     |       0.82 |   0.27 |  1.56 |    0.93 |  1.43 |       0.02 |
| getJobsBlockers/batch100         |       0.70 |   2.25 |  1.39 |    0.81 |  1.08 |       0.08 |
| unblockJobs/default              |      10.12 |   0.12 |  1.42 |    1.32 |  0.64 |       0.03 |
| unblockJobs/batch100             |      14.18 |   0.54 |  3.76 |    3.42 |  4.00 |       0.06 |
| startWorker/default              |       0.34 |   0.01 |  1.09 |    0.53 |  0.41 |       0.02 |
| startWorker/batch100             |       1.10 |   0.03 |  0.81 |    0.96 |  0.67 |       0.04 |
| extendWorkerLease/default        |       0.33 |   0.01 |  1.20 |    1.09 |  0.34 |       0.02 |
| stopWorker/default               |       0.63 |   0.01 |  0.99 |    0.93 |  0.33 |       0.03 |
| startJobAttempts/default         |       0.72 |   0.03 |  1.47 |    2.78 |  0.21 |       0.02 |
| startJobAttempts/limit100        |       7.49 |   0.93 |  5.04 |    5.63 |  1.97 |       0.09 |
| startJobAttempts/batchLimit10    |       2.79 |   0.94 |  4.83 |    5.46 |  2.09 |       0.07 |
| startJobAttempts/batch100        |       1.05 |   0.19 |  8.84 |   68.84 |  0.57 |       3.33 |
| completeJobs/default             |       0.90 |   0.04 |  1.83 |    1.92 |  0.51 |       0.04 |
| completeJobs/batch100            |       4.88 |   1.05 |  5.08 |    3.94 |  4.63 |       0.09 |
| getStartAttemptDelayMs/default   |       0.70 |   0.02 |  0.78 |    0.69 |  0.47 |       0.06 |
| getStartAttemptDelayMs/batch100  |       0.66 |   0.04 |  2.73 |    2.68 |  1.12 |       0.04 |
| rescheduleJobs/default           |       0.45 |   0.03 |  1.40 |    1.45 |  0.40 |       0.06 |
| rescheduleJobs/batch100          |       2.52 |   0.84 |  4.33 |    4.19 |  4.80 |       0.10 |
| deleteChains/default             |     112.40 |   0.05 |  1.25 |    1.10 |  0.90 |       0.10 |
| deleteChains/multiJob            |      77.36 |   0.05 |  1.21 |    1.08 |  0.98 |       0.02 |
| deleteChains/batch100            |      86.88 |   0.85 |  3.62 |    3.19 |  3.44 |       0.06 |

## Type discovery & counts, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.38 |   0.04 |  0.39 |    0.41 |  1.94 |       0.04 |
| getJobTypeNames/default             |       0.40 |   0.04 |  0.29 |    0.26 |  0.38 |       0.04 |
| countChainsByTypeName/default       |       1.63 |   0.58 |  4.04 |    5.50 |  0.24 |       0.05 |
| countChainsByTypeName/batch100      |       0.77 |   0.15 |  4.43 |    3.97 |  0.51 |       0.04 |
| countJobsByTypeName/default         |       1.67 |   0.59 |  4.12 |    5.57 |  0.25 |       0.04 |
| countJobsByTypeName/batch100        |       1.26 |   0.19 | 10.27 |    8.29 |  0.71 |       0.03 |
| countWorkers/default                |       0.22 |   0.01 |  0.45 |    0.38 |  0.23 |       0.04 |
| countWorkersByTypeName/default      |       0.28 |   0.53 |  1.12 |    1.32 |  0.24 |       0.21 |
| countWorkersByTypeName/batch100     |       1.60 |   0.56 |  1.18 |    1.49 |  0.44 |       0.11 |
| countRunningJobsByWorkerId/default  |       0.33 |   0.01 |  0.30 |    0.43 |  0.19 |       0.03 |
| countRunningJobsByWorkerId/batch100 |       6.12 |   0.06 |  0.56 |    0.42 |  0.38 |       0.05 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.53 |   0.18 |  0.81 |    0.89 |  0.51 |     269.07 |
| listChains/noStatus/nonBlocking               |       0.53 |   0.16 |  0.66 |    0.88 |  0.83 |     263.42 |
| listChains/noStatus/blocking                  |       0.36 |   0.13 |  0.34 |    0.38 |  0.12 |      16.95 |
| listChains/noStatus/fromTo                    |       0.37 |   0.16 |  0.61 |    0.73 |  0.49 |       0.08 |
| listChains/noStatus/cursor                    |       0.88 |   0.29 |  1.12 |    0.91 |  0.97 |       0.08 |
| listChains/running/default                    |       0.43 |   0.16 |  0.66 |    0.58 |  0.49 |     237.03 |
| listChains/running/nonBlocking                |       0.45 |   0.17 |  3.02 |    0.66 |  0.80 |     234.46 |
| listChains/running/blocking                   |       0.29 |   0.11 |  0.25 |    0.37 |  0.11 |      16.64 |
| listChains/running/cursor                     |       0.71 |   0.29 |  1.12 |    0.99 |  2.84 |       0.08 |
| listChains/completed/default                  |       0.39 |   0.16 |  0.60 |    0.67 |  0.51 |      56.16 |
| listChains/completed/nonBlocking              |       0.47 |   0.19 |  0.60 |    0.64 |  0.99 |      55.08 |
| listChains/completed/blocking                 |       0.26 |   0.10 |  0.38 |    0.46 |  0.12 |      13.20 |
| listChains/completed/orderByCreatedAt         |       0.58 |   0.16 |  0.74 |    0.75 |  0.50 |      43.60 |
| listChains/completed/orderByCompletedAt       |       0.47 |   0.21 |  0.67 |    0.55 |  0.50 |       0.03 |
| listChains/completed/cursor                   |       0.73 |   0.30 |  1.41 |    1.92 |  0.98 |       0.05 |
| listChains/completed/orderByCreatedAtCursor   |       0.73 |   0.35 |  1.05 |    1.19 |  0.95 |       0.03 |
| listChains/completed/orderByCompletedAtCursor |       0.70 |   0.31 |  0.87 |    1.10 |  0.96 |       0.03 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.43 |   0.18 |  0.93 |    0.69 |  0.53 |     386.46 |
| listJobs/noStatus/fromTo            |       0.50 |   0.14 |  0.56 |    0.53 |  0.50 |       0.04 |
| listJobs/noStatus/cursor            |       1.31 |   0.23 |  1.29 |    1.12 |  0.82 |       0.12 |
| listJobs/pending/default            |       0.55 |   0.13 |  0.39 |    0.47 |  0.37 |     231.33 |
| listJobs/pending/fromTo             |       0.40 |   0.13 |  0.57 |    0.50 |  0.37 |       0.06 |
| listJobs/pending/orderByCreatedAt   |       0.37 |   0.17 |  0.53 |    0.53 |  0.37 |     181.89 |
| listJobs/pending/cursor             |       0.75 |   0.24 |  0.96 |    0.89 |  0.78 |       0.08 |
| listJobs/blocked/default            |       0.38 |   0.13 |  0.88 |    0.42 |  0.34 |     154.77 |
| listJobs/blocked/fromTo             |       0.39 |   0.13 |  0.80 |    0.46 |  0.35 |       0.04 |
| listJobs/blocked/orderByCreatedAt   |       3.31 |   0.16 |  0.87 |    0.66 |  0.34 |     155.20 |
| listJobs/blocked/cursor             |       0.68 |   0.22 |  1.59 |    0.73 |  2.43 |       0.07 |
| listJobs/running/default            |       0.44 |   0.19 |  0.67 |    0.43 |  0.37 |      44.69 |
| listJobs/running/orderByCreatedAt   |       0.40 |   0.13 |  0.55 |    0.42 |  0.37 |      44.84 |
| listJobs/running/cursor             |       6.24 |   0.45 |  0.89 |    0.85 |  0.73 |       0.07 |
| listJobs/completed/default          |       0.75 |   0.13 |  0.55 |    0.46 |  0.37 |     111.06 |
| listJobs/completed/orderByCreatedAt |       0.64 |   0.14 |  0.67 |    0.56 |  0.38 |      82.99 |
| listJobs/completed/cursor           |       1.02 |   0.24 |  0.86 |    0.79 |  0.73 |       0.05 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.90 |   0.60 |   0.33 |    0.83 |  0.37 |       0.04 |
| listChainJobs/cursor    |       2.98 |   1.09 |   0.57 |    1.65 |  0.84 |       0.05 |
| listBlockedJobs/default |      96.05 | 179.14 | 170.36 |  123.11 |  0.36 |       0.07 |
| listBlockedJobs/cursor  |     247.81 | 267.12 | 289.42 |  231.53 |  0.71 |       0.03 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.34 |   0.06 |  0.60 |    0.61 |  0.33 |       0.20 |
| listWorkers/typeName   |       0.29 |   0.09 |  0.77 |    0.36 |  0.21 |       0.04 |
| listWorkers/status     |       0.29 |   0.03 |  0.27 |    0.28 |  4.29 |       0.02 |
| listWorkers/cursor     |       0.52 |   0.09 |  0.50 |    0.59 |  0.75 |       0.09 |
| listWorkerJobs/default |       0.35 |   0.10 |  0.31 |    0.33 |  0.31 |       0.04 |
| listWorkerJobs/cursor  |       0.71 |   0.18 |  0.61 |    0.63 |  0.50 |       0.03 |

## Environment

| Setting    |                         Value |
| ---------- | ----------------------------: |
| Machine    | Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                        Normal |
| OS         |                  macOS 26.7.3 |
| Runtime    |              Node.js v24.22.1 |
| Containers |              socktainer 1.6.1 |
