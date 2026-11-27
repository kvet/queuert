# Query performance

Last run 2026-11-26 · commit 28448c56 · load average 3.64 · MariaDB at scale 100

## Operational queries, p50 (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                  |       0.32 |   0.03 |  1.11 |    0.35 |  0.61 |       0.00 |
| getChains/lock                     |       0.72 |   0.02 |  1.49 |    1.03 |  0.57 |       0.00 |
| getChains/batch100                 |       0.70 |   0.22 |  0.97 |    0.80 |  1.15 |       0.01 |
| getChains/lockBatch100             |       1.10 |   0.18 |  1.80 |    1.74 |  1.63 |       0.01 |
| getChainTails/default              |       0.24 |   0.01 |  0.84 |    0.23 |  0.54 |       0.00 |
| getChainTails/lock                 |       0.60 |   0.02 |  1.47 |    0.83 |  0.59 |       0.00 |
| getChainTails/batch100             |       0.72 |   0.20 |  1.38 |    0.82 |  0.97 |       0.02 |
| getChainTails/lockBatch100         |       1.14 |   0.20 |  2.21 |    1.90 |  1.52 |       0.02 |
| getChainTails/lockBlockers         |       1.27 |   0.01 |  1.67 |    1.72 |  0.30 |       0.00 |
| getChainTails/lockBlockersBatch100 |       2.86 |   0.21 |  4.45 |    4.12 |  1.23 |       0.02 |
| getJobs/default                    |       0.37 |   0.02 |  0.23 |    0.21 |  0.17 |       0.00 |
| getJobs/lock                       |       0.82 |   0.01 |  1.06 |    0.98 |  0.30 |       0.00 |
| getJobs/batch100                   |       1.15 |   0.21 |  0.59 |    0.57 |  0.57 |       0.01 |
| getJobs/lockBatch100               |       1.20 |   0.18 |  1.76 |    1.74 |  1.02 |       0.01 |
| getWorkers/default                 |       0.19 |   0.01 |  0.19 |    0.19 |  0.22 |       0.00 |
| getWorkers/lock                    |       0.53 |   0.01 |  0.60 |    0.59 |  0.16 |       0.00 |
| getWorkers/batch100                |       0.25 |   0.05 |  0.30 |    0.29 |  0.44 |       0.03 |
| getWorkers/lockBatch100            |       0.59 |   0.05 |  0.72 |    0.61 |  0.42 |       0.03 |
| createJobs/default                 |       0.83 |   0.03 |  1.96 |    1.18 |  0.24 |       0.01 |
| createJobs/deduplication           |       0.49 |   0.03 |  0.66 |    0.53 |  0.47 |       0.00 |
| createJobs/batch100                |       2.65 |   0.78 |  4.41 |    3.63 |  2.24 |       0.13 |
| createJobs/deduplicationBatch100   |       1.17 |   0.32 |  1.90 |    1.63 |  1.56 |       0.03 |
| continueJobs/default               |       0.80 |   0.06 |  1.40 |    1.80 |  0.38 |       0.01 |
| continueJobs/batch100              |       7.02 |   1.75 |  9.03 |    7.43 |  4.58 |       0.12 |
| addJobsBlockers/default            |       1.13 |   0.05 |  1.83 |    2.01 |  0.57 |       0.01 |
| addJobsBlockers/batch100           |       4.06 |   1.07 |  5.46 |    5.05 |  3.97 |       0.08 |
| getJobsBlockers/default            |       0.34 |   0.02 |  0.34 |    0.48 |  0.53 |       0.00 |
| getJobsBlockers/manyBlockers       |       1.14 |   0.23 |  1.36 |    1.87 |  1.34 |       0.00 |
| getJobsBlockers/batch100           |       1.01 |   0.20 |  0.87 |    1.58 |  0.99 |       0.01 |
| unblockJobs/default                |       0.93 |   0.07 |  9.45 |    1.74 |  0.52 |       0.00 |
| unblockJobs/batch100               |       3.96 |   0.50 |  4.51 |    3.67 |  3.56 |       0.05 |
| startWorker/default                |       0.32 |   0.01 |  0.87 |    0.73 |  0.34 |       0.00 |
| startWorker/batch100               |       0.47 |   0.02 |  0.92 |    0.89 |  0.61 |       0.01 |
| extendWorkerLease/default          |       0.29 |   0.01 |  1.31 |    1.20 |  0.30 |       0.00 |
| stopWorker/default                 |       0.24 |   0.01 |  1.05 |    1.02 |  0.32 |       0.00 |
| startJobAttempts/default           |       0.36 |   0.03 |  1.60 |    1.45 |  0.19 |       0.00 |
| startJobAttempts/limit100          |       2.44 |   0.93 |  5.05 |    5.14 |  1.48 |       0.07 |
| startJobAttempts/batchLimit10      |       2.61 |   0.89 |  4.98 |    6.02 |  1.61 |       0.06 |
| startJobAttempts/batch100          |       1.15 |   0.15 |  3.58 |    3.54 |  0.43 |       0.02 |
| completeJobs/default               |       0.76 |   0.04 |  1.18 |    1.53 |  0.38 |       0.00 |
| completeJobs/batch100              |       5.39 |   1.01 |  4.84 |    5.20 |  3.86 |       0.05 |
| getStartAttemptDelayMs/default     |       0.70 |   0.01 |  0.82 |    0.90 |  0.38 |       0.00 |
| getStartAttemptDelayMs/batch100    |       0.64 |   0.03 |  3.14 |    2.49 |  1.07 |       0.01 |
| rescheduleJobs/default             |       0.54 |   0.02 |  9.98 |    1.56 |  0.33 |       0.00 |
| rescheduleJobs/batch100            |       2.86 |   0.81 |  4.81 |    4.74 |  3.30 |       0.06 |
| deleteChains/default               |       1.07 |   0.05 |  1.33 |    1.45 |  0.72 |       0.01 |
| deleteChains/multiJob              |       0.99 |   0.04 |  1.24 |    1.13 |  0.76 |       0.00 |
| deleteChains/batch100              |       2.06 |   0.81 |  3.97 |    3.81 |  2.91 |       0.04 |

## Type discovery & counts, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.36 |   0.03 |  0.45 |    0.39 |  0.22 |       0.01 |
| getJobTypeNames/default             |       0.37 |   0.03 |  0.34 |    0.30 |  0.21 |       0.01 |
| countChainsByTypeName/default       |       1.52 |   0.56 |  3.90 |    5.59 |  0.18 |       0.00 |
| countChainsByTypeName/batch100      |       0.81 |   0.13 |  4.20 |    3.81 |  0.40 |       0.02 |
| countJobsByTypeName/default         |       1.57 |   0.58 |  3.91 |    5.55 |  0.19 |       0.00 |
| countJobsByTypeName/batch100        |       1.00 |   0.16 | 10.90 |    7.25 |  0.56 |       0.01 |
| countWorkers/default                |       0.19 |   0.01 |  0.30 |    0.26 |  0.17 |       0.00 |
| countWorkersByTypeName/default      |       0.26 |   0.52 |  1.10 |    1.34 |  0.17 |       0.10 |
| countWorkersByTypeName/batch100     |       1.45 |   0.53 |  1.21 |    1.49 |  0.34 |       0.08 |
| countRunningJobsByWorkerId/default  |       0.26 |   0.01 |  0.28 |    0.27 |  0.15 |       0.00 |
| countRunningJobsByWorkerId/batch100 |       0.55 |   0.05 |  0.42 |    0.54 |  0.30 |       0.03 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.43 |   0.15 |  0.79 |    0.52 |  0.52 |       0.01 |
| listChains/noStatus/nonBlocking               |       0.43 |   0.14 |  0.99 |    0.66 |  1.08 |       0.01 |
| listChains/noStatus/blocking                  |       0.24 |   0.09 |  0.59 |    0.38 |  0.14 |       0.00 |
| listChains/noStatus/fromTo                    |       0.37 |   0.15 |  0.79 |    0.60 |  0.56 |       0.01 |
| listChains/noStatus/cursor                    |       0.63 |   0.27 |  0.99 |    0.82 |  1.07 |       0.02 |
| listChains/running/default                    |       0.36 |   0.15 |  1.01 |    0.47 |  0.53 |       0.01 |
| listChains/running/nonBlocking                |       0.44 |   0.15 |  0.90 |    0.60 |  0.85 |       0.01 |
| listChains/running/blocking                   |       0.25 |   0.09 |  0.51 |    0.38 |  0.13 |       0.00 |
| listChains/running/cursor                     |       0.79 |   0.28 |  1.60 |    1.05 |  1.04 |       0.01 |
| listChains/completed/default                  |       0.39 |   0.15 |  0.54 |    0.60 |  0.56 |       0.01 |
| listChains/completed/nonBlocking              |       0.49 |   0.16 |  0.44 |    0.62 |  0.88 |       0.01 |
| listChains/completed/blocking                 |       0.35 |   0.09 |  0.23 |    0.34 |  0.13 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.52 |   0.15 |  0.46 |    0.63 |  0.54 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.50 |   0.15 |  0.46 |    0.61 |  0.53 |       0.00 |
| listChains/completed/cursor                   |       0.94 |   0.28 |  0.83 |    1.13 |  1.10 |       0.01 |
| listChains/completed/orderByCreatedAtCursor   |       0.95 |   0.28 |  0.82 |    1.08 |  1.08 |       0.01 |
| listChains/completed/orderByCompletedAtCursor |       0.81 |   0.28 |  0.83 |    1.35 |  1.04 |       0.01 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.49 |   0.15 |  0.59 |    0.60 |  0.44 |       0.01 |
| listJobs/noStatus/fromTo            |       0.72 |   0.14 |  0.49 |    0.61 |  0.40 |       0.01 |
| listJobs/noStatus/cursor            |       0.95 |   0.23 |  0.90 |    1.08 |  0.95 |       0.02 |
| listJobs/pending/default            |       0.47 |   0.12 |  0.39 |    0.53 |  0.37 |       0.01 |
| listJobs/pending/fromTo             |       0.45 |   0.13 |  0.37 |    0.59 |  0.37 |       0.01 |
| listJobs/pending/orderByCreatedAt   |       0.62 |   0.12 |  0.38 |    0.55 |  0.37 |       0.01 |
| listJobs/pending/cursor             |       0.85 |   0.24 |  0.64 |    0.70 |  0.79 |       0.01 |
| listJobs/blocked/default            |       0.46 |   0.12 |  0.38 |    0.36 |  0.37 |       0.01 |
| listJobs/blocked/fromTo             |       0.48 |   0.13 |  0.38 |    0.37 |  0.39 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.46 |   0.12 |  0.38 |    0.42 |  0.37 |       0.01 |
| listJobs/blocked/cursor             |       0.84 |   0.22 |  0.68 |    0.69 |  0.78 |       0.01 |
| listJobs/running/default            |       0.49 |   0.19 |  0.40 |    0.38 |  0.38 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.51 |   0.12 |  0.42 |    0.34 |  0.39 |       0.01 |
| listJobs/running/cursor             |       5.69 |   0.36 |  0.69 |    0.56 |  0.83 |       0.02 |
| listJobs/completed/default          |       0.62 |   0.13 |  0.51 |    0.31 |  0.38 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.63 |   0.13 |  0.65 |    0.43 |  0.38 |       0.01 |
| listJobs/completed/cursor           |       0.94 |   0.23 |  0.91 |    0.56 |  0.82 |       0.02 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.24 |   0.53 |   0.31 |    0.86 |  0.37 |       0.01 |
| listChainJobs/cursor    |       2.34 |   1.05 |   0.51 |    1.48 |  0.88 |       0.01 |
| listBlockedJobs/default |     102.41 | 122.56 | 147.66 |  107.04 |  0.37 |       0.01 |
| listBlockedJobs/cursor  |     211.30 | 243.34 | 263.19 |  214.35 |  0.77 |       0.01 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.33 |   0.05 |  0.35 |    0.31 |  0.35 |       0.03 |
| listWorkers/typeName   |       0.22 |   0.08 |  0.63 |    0.31 |  0.25 |       0.01 |
| listWorkers/status     |       0.22 |   0.03 |  0.21 |    0.23 |  2.33 |       0.00 |
| listWorkers/cursor     |       0.47 |   0.08 |  0.48 |    0.45 |  0.80 |       0.05 |
| listWorkerJobs/default |       0.33 |   0.09 |  0.28 |    0.28 |  0.30 |       0.00 |
| listWorkerJobs/cursor  |       0.57 |   0.16 |  0.50 |    0.53 |  0.57 |       0.01 |

## Operational queries, max (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                  |       0.36 |   0.06 |  1.66 |    0.41 |  0.72 |       0.11 |
| getChains/lock                     |       0.84 |   0.03 |  2.66 |    1.09 |  0.80 |       0.03 |
| getChains/batch100                 |       0.85 |   0.24 |  1.47 |    1.14 |  1.36 |       0.09 |
| getChains/lockBatch100             |       1.13 |   0.19 |  2.56 |    2.99 |  1.82 |       0.03 |
| getChainTails/default              |       0.28 |   0.02 |  1.16 |    0.29 |  0.57 |       0.04 |
| getChainTails/lock                 |       0.65 |   0.05 |  1.92 |    0.85 |  0.71 |       0.02 |
| getChainTails/batch100             |       0.74 |   0.23 |  1.71 |    1.22 |  1.02 |       0.04 |
| getChainTails/lockBatch100         |       1.18 |   0.22 |  2.52 |    2.52 |  3.27 |       0.03 |
| getChainTails/lockBlockers         |       1.45 |   0.01 |  1.82 |    1.97 |  0.36 |       0.02 |
| getChainTails/lockBlockersBatch100 |       4.85 |   0.21 |  5.49 |    4.27 |  1.54 |       0.10 |
| getJobs/default                    |       0.62 |   0.02 |  0.26 |    0.23 |  0.19 |       0.02 |
| getJobs/lock                       |       0.98 |   0.02 |  1.11 |    1.02 |  0.34 |       0.02 |
| getJobs/batch100                   |       4.43 |   0.24 |  0.64 |    0.60 |  0.62 |       0.05 |
| getJobs/lockBatch100               |       1.25 |   0.18 |  1.81 |    2.53 |  1.41 |       0.02 |
| getWorkers/default                 |       0.22 |   0.02 |  0.21 |    0.20 |  0.29 |       0.03 |
| getWorkers/lock                    |       0.57 |   0.01 |  0.64 |    0.61 |  0.17 |       0.02 |
| getWorkers/batch100                |       0.27 |   0.06 |  1.24 |    0.30 |  0.52 |       0.08 |
| getWorkers/lockBatch100            |       0.62 |   0.06 |  0.76 |    0.69 |  0.47 |       0.05 |
| createJobs/default                 |       0.96 |   0.11 |  2.34 |    1.79 |  0.35 |       0.03 |
| createJobs/deduplication           |       0.52 |   0.12 |  0.80 |    0.68 |  0.59 |       0.03 |
| createJobs/batch100                |       2.85 |   0.89 |  6.10 |    5.84 |  2.40 |       0.18 |
| createJobs/deduplicationBatch100   |       1.55 |   0.43 |  2.00 |    1.69 |  1.75 |       0.24 |
| continueJobs/default               |       0.94 |   0.07 |  1.92 |    3.00 |  0.43 |       0.03 |
| continueJobs/batch100              |       7.96 |   1.86 | 10.03 |   10.15 |  5.91 |       0.17 |
| addJobsBlockers/default            |       1.33 |   0.08 |  2.20 |   13.75 |  0.67 |       0.04 |
| addJobsBlockers/batch100           |       4.70 |   1.15 |  6.93 |    5.33 |  4.40 |       0.13 |
| getJobsBlockers/default            |       0.37 |   0.03 |  0.64 |    0.78 |  0.59 |       0.04 |
| getJobsBlockers/manyBlockers       |       1.39 |   2.10 |  1.57 |    2.00 |  2.75 |       0.02 |
| getJobsBlockers/batch100           |       1.16 |   0.21 |  1.76 |    1.67 |  1.08 |       0.06 |
| unblockJobs/default                |       1.04 |   0.13 | 17.32 |    1.98 |  0.54 |       0.02 |
| unblockJobs/batch100               |       5.32 |   0.54 |  5.83 |    6.21 |  4.01 |       0.06 |
| startWorker/default                |       0.34 |   0.01 |  2.21 |    0.79 |  0.38 |       0.02 |
| startWorker/batch100               |       0.60 |   0.03 |  3.21 |    3.72 |  0.65 |       0.04 |
| extendWorkerLease/default          |       0.34 |   0.01 |  1.46 |    1.27 |  0.34 |       0.02 |
| stopWorker/default                 |       0.26 |   0.01 |  1.11 |    1.06 |  0.35 |       0.03 |
| startJobAttempts/default           |       0.38 |   0.03 |  2.43 |    1.56 |  0.20 |       0.02 |
| startJobAttempts/limit100          |       3.23 |   0.97 |  6.46 |    9.21 |  1.51 |       0.09 |
| startJobAttempts/batchLimit10      |       3.24 |   0.91 |  7.91 |    7.14 |  1.80 |       0.08 |
| startJobAttempts/batch100          |       1.46 |   0.19 |  5.40 |    4.16 |  0.59 |       0.09 |
| completeJobs/default               |       0.88 |   0.04 |  1.41 |    1.92 |  0.44 |       0.04 |
| completeJobs/batch100              |       6.17 |   1.07 |  6.73 |    5.66 |  4.47 |       0.07 |
| getStartAttemptDelayMs/default     |       0.88 |   0.02 |  1.18 |    0.97 |  0.43 |       0.06 |
| getStartAttemptDelayMs/batch100    |       0.78 |   0.04 |  3.86 |    2.86 |  1.11 |       0.04 |
| rescheduleJobs/default             |       0.65 |   0.03 | 14.49 |    1.68 |  0.36 |       0.05 |
| rescheduleJobs/batch100            |       3.50 |   0.89 |  6.38 |    5.69 |  4.38 |       0.10 |
| deleteChains/default               |       1.66 |   0.06 |  1.54 |    1.58 |  0.81 |       0.10 |
| deleteChains/multiJob              |       1.62 |   0.04 |  8.64 |    1.22 |  0.87 |       0.02 |
| deleteChains/batch100              |       2.26 |   0.85 |  6.87 |    4.93 |  4.76 |       0.06 |

## Type discovery & counts, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.38 |   0.04 |  0.71 |    0.46 |  0.25 |       0.07 |
| getJobTypeNames/default             |       0.42 |   0.04 |  0.38 |    0.34 |  0.24 |       0.05 |
| countChainsByTypeName/default       |       1.64 |   0.59 |  4.28 |   32.62 |  0.22 |       0.07 |
| countChainsByTypeName/batch100      |       0.94 |   0.15 |  5.20 |    4.54 |  0.48 |       0.04 |
| countJobsByTypeName/default         |       1.60 |   0.60 |  4.05 |    5.89 |  0.21 |       0.04 |
| countJobsByTypeName/batch100        |       1.13 |   0.18 | 13.26 |    8.55 |  0.59 |       0.04 |
| countWorkers/default                |       0.23 |   0.01 |  0.48 |    0.31 |  0.20 |       0.05 |
| countWorkersByTypeName/default      |       0.30 |   0.55 |  1.19 |    1.40 |  0.21 |       0.20 |
| countWorkersByTypeName/batch100     |       1.48 |   0.56 |  1.30 |    1.56 |  0.70 |       0.11 |
| countRunningJobsByWorkerId/default  |       0.28 |   0.01 |  0.31 |    0.31 |  0.16 |       0.03 |
| countRunningJobsByWorkerId/batch100 |       5.35 |   0.06 |  0.47 |    1.50 |  1.75 |       0.06 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       8.14 |   0.18 |  1.16 |    0.83 |  0.57 |     271.96 |
| listChains/noStatus/nonBlocking               |       0.47 |   0.15 |  1.31 |    0.82 |  3.16 |     264.61 |
| listChains/noStatus/blocking                  |       0.26 |   0.10 |  1.00 |    0.41 |  0.17 |      17.48 |
| listChains/noStatus/fromTo                    |       0.40 |   0.18 |  1.74 |    0.63 |  0.79 |       0.08 |
| listChains/noStatus/cursor                    |       0.66 |   0.30 |  2.08 |    0.87 |  1.15 |       0.09 |
| listChains/running/default                    |       0.38 |   0.16 |  2.41 |    0.50 |  0.58 |     237.30 |
| listChains/running/nonBlocking                |       0.58 |   0.16 |  1.37 |    0.80 |  0.89 |     235.06 |
| listChains/running/blocking                   |       0.30 |   0.09 |  0.64 |    0.40 |  0.16 |      14.80 |
| listChains/running/cursor                     |       0.85 |   0.39 |  2.39 |    1.15 |  1.08 |       0.09 |
| listChains/completed/default                  |       0.43 |   0.16 |  1.32 |    0.65 |  0.61 |      58.66 |
| listChains/completed/nonBlocking              |       0.58 |   0.16 |  0.53 |    0.64 |  0.93 |      55.86 |
| listChains/completed/blocking                 |       0.56 |   0.10 |  0.24 |    0.62 |  0.14 |      14.80 |
| listChains/completed/orderByCreatedAt         |       0.55 |   0.16 |  0.49 |    0.66 |  0.65 |      41.55 |
| listChains/completed/orderByCompletedAt       |       0.60 |   0.22 |  0.49 |    0.66 |  0.54 |       0.04 |
| listChains/completed/cursor                   |       1.32 |   0.30 |  0.87 |    1.22 |  3.38 |       0.05 |
| listChains/completed/orderByCreatedAtCursor   |       1.18 |   0.30 |  0.86 |    1.14 |  1.26 |       0.03 |
| listChains/completed/orderByCompletedAtCursor |       1.11 |   0.41 |  0.86 |    3.02 |  1.12 |       0.04 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.57 |   0.19 |  0.84 |    0.70 |  0.48 |     399.47 |
| listJobs/noStatus/fromTo            |       0.80 |   0.16 |  0.56 |    1.06 |  0.42 |       0.27 |
| listJobs/noStatus/cursor            |       1.08 |   0.25 |  0.98 |    1.17 |  1.00 |       0.10 |
| listJobs/pending/default            |       0.49 |   0.12 |  0.41 |    0.57 |  0.39 |     236.29 |
| listJobs/pending/fromTo             |       0.48 |   0.13 |  0.44 |    0.62 |  0.39 |       0.05 |
| listJobs/pending/orderByCreatedAt   |       0.73 |   0.12 |  0.41 |    0.66 |  0.41 |     181.72 |
| listJobs/pending/cursor             |       1.33 |   1.85 |  0.69 |    0.77 |  0.87 |       0.07 |
| listJobs/blocked/default            |       0.52 |   0.13 |  0.42 |    0.41 |  0.41 |     158.46 |
| listJobs/blocked/fromTo             |       0.51 |   0.19 |  0.38 |    0.37 |  0.41 |       0.04 |
| listJobs/blocked/orderByCreatedAt   |       0.51 |   0.12 |  0.39 |    0.45 |  0.37 |     158.23 |
| listJobs/blocked/cursor             |       1.07 |   0.23 |  0.73 |    4.44 |  0.87 |       0.06 |
| listJobs/running/default            |       0.57 |   0.22 |  0.44 |    0.40 |  0.40 |      45.89 |
| listJobs/running/orderByCreatedAt   |       0.54 |   0.12 |  0.44 |    0.35 |  0.40 |      45.22 |
| listJobs/running/cursor             |       5.78 |   0.39 |  0.75 |    0.60 |  1.10 |       0.08 |
| listJobs/completed/default          |       0.69 |   0.14 |  0.83 |    0.33 |  0.40 |     110.97 |
| listJobs/completed/orderByCreatedAt |       0.67 |   0.14 |  3.57 |    0.46 |  0.40 |      83.39 |
| listJobs/completed/cursor           |       1.01 |   0.24 |  1.39 |    0.60 |  0.89 |       0.08 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.87 |   0.59 |   0.34 |    1.11 |  0.38 |       0.05 |
| listChainJobs/cursor    |       2.55 |   1.12 |   0.53 |    1.91 |  0.94 |       0.05 |
| listBlockedJobs/default |     123.68 | 162.47 | 197.02 |  148.62 |  0.43 |       0.07 |
| listBlockedJobs/cursor  |     236.64 | 261.07 | 290.29 |  242.48 |  0.78 |       0.04 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.58 |   0.06 |  0.45 |    0.44 |  0.39 |       0.22 |
| listWorkers/typeName   |       0.23 |   0.10 |  0.67 |    0.36 |  0.27 |       0.03 |
| listWorkers/status     |       0.30 |   0.03 |  0.21 |    0.27 |  2.44 |       0.02 |
| listWorkers/cursor     |       0.49 |   0.09 |  2.97 |    0.54 |  0.84 |       0.09 |
| listWorkerJobs/default |       0.37 |   0.10 |  0.32 |    0.31 |  0.32 |       0.04 |
| listWorkerJobs/cursor  |       0.60 |   0.17 |  0.57 |    0.55 |  0.60 |       0.03 |

## Environment

| Setting    |                                  Value |
| ---------- | -------------------------------------: |
| Machine    |          Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                                 Normal |
| OS         |                           macOS 26.7.3 |
| Runtime    |                       Node.js v24.22.1 |
| Containers | Docker Desktop 4.100.1 (247138) 29.9.3 |
