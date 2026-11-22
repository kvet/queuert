# Query performance

Last run 2026-11-22 · commit 0b14f202 · load average 5.71 · MariaDB at scale 100

## Operational queries, p50 (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.31 |   0.03 |  0.88 |    0.46 |  0.59 |       0.00 |
| getChains/lock                   |       0.71 |   0.02 |  1.24 |    1.12 |  0.53 |       0.00 |
| getChains/batch100               |       0.71 |   0.20 |  0.83 |    0.84 |  1.17 |       0.01 |
| getChains/lockBatch100           |       1.09 |   0.17 |  1.22 |    1.84 |  1.63 |       0.01 |
| getChainTails/default            |       0.25 |   0.01 |  0.60 |    0.24 |  0.48 |       0.00 |
| getChainTails/lock               |       0.67 |   0.02 |  1.01 |    0.64 |  0.57 |       0.00 |
| getChainTails/batch100           |       0.67 |   0.19 |  0.90 |    0.79 |  0.95 |       0.02 |
| getChainTails/lockBatch100       |       1.15 |   0.19 |  1.32 |    1.18 |  1.49 |       0.02 |
| getJobs/default                  |       0.30 |   0.02 |  0.20 |    0.21 |  0.17 |       0.00 |
| getJobs/lock                     |       0.73 |   0.01 |  0.64 |    0.61 |  0.31 |       0.00 |
| getJobs/batch100                 |       0.61 |   0.18 |  0.73 |    0.58 |  0.56 |       0.01 |
| getJobs/lockBatch100             |       1.08 |   0.17 |  1.38 |    1.02 |  1.03 |       0.01 |
| getWorkers/default               |       0.20 |   0.01 |  0.19 |    0.18 |  0.16 |       0.00 |
| getWorkers/lock                  |       0.57 |   0.01 |  0.64 |    0.55 |  0.16 |       0.00 |
| getWorkers/batch100              |       0.24 |   0.05 |  0.33 |    0.30 |  0.42 |       0.03 |
| getWorkers/lockBatch100          |       0.64 |   0.05 |  0.70 |    0.70 |  0.39 |       0.03 |
| createJobs/default               |       1.00 |   0.03 |  1.29 |    1.15 |  0.22 |       0.01 |
| createJobs/deduplication         |       0.58 |   0.02 |  0.60 |    0.54 |  0.44 |       0.00 |
| createJobs/batch100              |       3.12 |   0.71 |  4.15 |    3.71 |  2.04 |       0.13 |
| createJobs/deduplicationBatch100 |       1.40 |   0.31 |  2.54 |    1.65 |  1.55 |       0.03 |
| continueJobs/default             |       0.86 |   0.05 |  8.17 |    1.75 |  0.40 |       0.01 |
| continueJobs/batch100            |       6.48 |   1.77 |  8.59 |    6.98 |  4.53 |       0.12 |
| addJobsBlockers/default          |       1.23 |   0.05 |  1.53 |    1.86 |  0.61 |       0.00 |
| addJobsBlockers/batch100         |       3.78 |   1.09 |  5.02 |    5.39 |  3.73 |       0.08 |
| getJobsBlockers/default          |       0.31 |   0.02 |  0.32 |    0.37 |  0.51 |       0.00 |
| getJobsBlockers/manyBlockers     |       1.01 |   0.22 |  1.31 |    1.37 |  1.35 |       0.00 |
| getJobsBlockers/batch100         |       0.82 |   0.21 |  0.84 |    1.33 |  0.98 |       0.01 |
| unblockJobs/default              |       0.82 |   0.07 |  3.35 |    1.41 |  0.51 |       0.00 |
| unblockJobs/batch100             |       3.57 |   0.50 |  3.60 |    3.61 |  3.81 |       0.05 |
| startWorker/default              |       0.37 |   0.01 |  0.67 |    0.81 |  0.36 |       0.00 |
| startWorker/batch100             |       0.54 |   0.02 |  0.65 |    0.85 |  0.60 |       0.01 |
| extendWorkerLease/default        |       0.37 |   0.01 |  1.08 |    1.21 |  0.29 |       0.00 |
| stopWorker/default               |       0.33 |   0.01 |  0.96 |    1.06 |  0.28 |       0.00 |
| startJobAttempts/default         |       0.61 |   0.03 |  1.40 |    1.60 |  0.17 |       0.00 |
| startJobAttempts/limit100        |       2.66 |   0.90 |  7.42 |    5.23 |  1.39 |       0.06 |
| startJobAttempts/batchLimit10    |       2.84 |   0.86 |  5.32 |    5.51 |  1.46 |       0.06 |
| startJobAttempts/batch100        |       1.01 |   0.15 |  3.31 |    3.31 |  0.44 |       0.02 |
| completeJobs/default             |       0.67 |   0.03 |  1.23 |    1.30 |  0.37 |       0.00 |
| completeJobs/batch100            |       5.16 |   0.95 |  5.15 |    4.98 |  3.91 |       0.05 |
| getStartAttemptDelayMs/default   |       0.68 |   0.01 |  0.70 |    0.76 |  0.38 |       0.00 |
| getStartAttemptDelayMs/batch100  |       0.56 |   0.03 |  2.50 |    2.45 |  1.16 |       0.01 |
| rescheduleJobs/default           |       0.43 |   0.02 |  1.56 |    1.57 |  0.33 |       0.00 |
| rescheduleJobs/batch100          |       3.37 |   0.76 |  4.73 |    4.66 |  3.06 |       0.06 |
| deleteChains/default             |       1.71 |   0.05 |  1.80 |    1.75 |  0.73 |       0.01 |
| deleteChains/multiJob            |       1.58 |   0.04 |  1.49 |    1.59 |  0.84 |       0.00 |
| deleteChains/batch100            |       3.89 |   0.76 | 11.90 |    5.21 |  2.94 |       0.04 |

## Type discovery & counts, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.36 |   0.03 |  0.44 |    0.37 |  0.23 |       0.01 |
| getJobTypeNames/default             |       0.36 |   0.03 |  0.28 |    0.31 |  0.22 |       0.01 |
| countChainsByTypeName/default       |       1.94 |   0.55 |  3.91 |    5.30 |  0.19 |       0.00 |
| countChainsByTypeName/batch100      |       0.64 |   0.13 |  4.85 |    3.86 |  0.39 |       0.02 |
| countJobsByTypeName/default         |       1.62 |   0.56 |  4.02 |    5.29 |  0.19 |       0.00 |
| countJobsByTypeName/batch100        |       0.74 |   0.14 | 10.73 |    7.18 |  0.58 |       0.01 |
| countWorkers/default                |       0.18 |   0.01 |  0.29 |    0.25 |  0.17 |       0.00 |
| countWorkersByTypeName/default      |       0.25 |   0.49 |  1.10 |    1.35 |  0.16 |       0.10 |
| countWorkersByTypeName/batch100     |       1.35 |   0.50 |  1.27 |    1.51 |  0.37 |       0.09 |
| countRunningJobsByWorkerId/default  |       0.21 |   0.01 |  0.25 |    0.21 |  0.15 |       0.00 |
| countRunningJobsByWorkerId/batch100 |       0.30 |   0.05 |  0.42 |    0.35 |  0.37 |       0.03 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.54 |   0.14 |  0.54 |    0.60 |  0.52 |       0.01 |
| listChains/noStatus/nonBlocking               |       0.59 |   0.14 |  0.54 |    0.69 |  0.85 |       0.01 |
| listChains/noStatus/blocking                  |       0.35 |   0.09 |  0.27 |    0.34 |  0.12 |       0.00 |
| listChains/noStatus/fromTo                    |       0.43 |   0.16 |  0.57 |    0.59 |  0.52 |       0.01 |
| listChains/noStatus/cursor                    |       0.81 |   0.28 |  0.68 |    1.00 |  1.06 |       0.02 |
| listChains/running/default                    |       0.41 |   0.15 |  0.47 |    0.58 |  0.51 |       0.01 |
| listChains/running/nonBlocking                |       0.48 |   0.15 |  0.42 |    0.62 |  0.87 |       0.01 |
| listChains/running/blocking                   |       0.27 |   0.09 |  0.26 |    0.33 |  0.13 |       0.00 |
| listChains/running/cursor                     |       0.76 |   0.29 |  0.97 |    1.05 |  1.06 |       0.02 |
| listChains/completed/default                  |       0.40 |   0.16 |  0.63 |    0.62 |  0.53 |       0.01 |
| listChains/completed/nonBlocking              |       0.43 |   0.15 |  0.52 |    0.62 |  0.85 |       0.01 |
| listChains/completed/blocking                 |       0.27 |   0.08 |  0.27 |    0.34 |  0.12 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.37 |   0.15 |  0.60 |    0.66 |  0.52 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.36 |   0.15 |  0.59 |    0.65 |  0.51 |       0.00 |
| listChains/completed/cursor                   |       0.70 |   0.29 |  1.03 |    1.15 |  1.04 |       0.01 |
| listChains/completed/orderByCreatedAtCursor   |       0.67 |   0.28 |  1.03 |    1.02 |  1.05 |       0.01 |
| listChains/completed/orderByCompletedAtCursor |       0.72 |   0.29 |  1.04 |    1.04 |  1.05 |       0.01 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.38 |   0.14 |  0.47 |    0.56 |  0.48 |       0.01 |
| listJobs/noStatus/fromTo            |       0.39 |   0.13 |  0.47 |    0.50 |  0.42 |       0.01 |
| listJobs/noStatus/cursor            |       0.68 |   0.22 |  0.84 |    0.84 |  1.01 |       0.02 |
| listJobs/pending/default            |       0.36 |   0.11 |  0.39 |    0.36 |  0.44 |       0.01 |
| listJobs/pending/fromTo             |       0.37 |   0.12 |  0.43 |    0.39 |  0.42 |       0.01 |
| listJobs/pending/orderByCreatedAt   |       0.35 |   0.11 |  0.42 |    0.40 |  0.42 |       0.01 |
| listJobs/pending/cursor             |       0.66 |   0.22 |  0.60 |    0.65 |  0.82 |       0.01 |
| listJobs/blocked/default            |       0.35 |   0.12 |  0.31 |    0.31 |  0.34 |       0.01 |
| listJobs/blocked/fromTo             |       0.48 |   0.12 |  0.32 |    0.32 |  0.34 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.43 |   0.11 |  0.32 |    0.39 |  0.35 |       0.01 |
| listJobs/blocked/cursor             |       0.74 |   0.21 |  0.53 |    0.65 |  0.77 |       0.01 |
| listJobs/running/default            |       0.45 |   0.18 |  0.30 |    0.37 |  0.37 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.41 |   0.11 |  0.31 |    0.40 |  0.37 |       0.01 |
| listJobs/running/cursor             |       5.98 |   0.33 |  0.66 |    0.64 |  0.78 |       0.02 |
| listJobs/completed/default          |       0.61 |   0.12 |  0.42 |    0.33 |  0.37 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.70 |   0.12 |  0.42 |    0.43 |  0.36 |       0.01 |
| listJobs/completed/cursor           |       1.12 |   0.23 |  0.69 |    0.74 |  0.77 |       0.02 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.39 |   0.53 |   0.44 |    0.74 |  0.35 |       0.01 |
| listChainJobs/cursor    |       2.77 |   1.02 |   0.82 |    1.31 |  0.89 |       0.01 |
| listBlockedJobs/default |     111.10 | 117.32 | 131.64 |  103.14 |  0.37 |       0.01 |
| listBlockedJobs/cursor  |     218.17 | 254.49 | 258.66 |  207.74 |  1.03 |       0.01 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.37 |   0.05 |  0.38 |    0.32 |  0.34 |       0.03 |
| listWorkers/typeName   |       0.25 |   0.09 |  0.69 |    0.32 |  0.24 |       0.01 |
| listWorkers/status     |       0.23 |   0.03 |  0.22 |    0.25 |  2.24 |       0.00 |
| listWorkers/cursor     |       0.49 |   0.08 |  0.50 |    0.50 |  0.73 |       0.05 |
| listWorkerJobs/default |       0.32 |   0.09 |  0.34 |    0.29 |  0.31 |       0.00 |
| listWorkerJobs/cursor  |       0.62 |   0.19 |  0.62 |    0.56 |  0.56 |       0.01 |

## Operational queries, max (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.38 |   0.05 |  0.99 |    0.68 |  0.78 |       0.12 |
| getChains/lock                   |       0.78 |   0.03 |  1.30 |    1.31 |  0.83 |       0.03 |
| getChains/batch100               |       0.83 |   0.23 |  0.92 |    1.46 |  1.46 |       0.09 |
| getChains/lockBatch100           |       1.17 |   0.18 |  2.46 |    3.10 |  1.69 |       0.02 |
| getChainTails/default            |       0.28 |   0.02 |  0.60 |    0.25 |  0.55 |       0.04 |
| getChainTails/lock               |       0.72 |   0.02 |  1.03 |    0.66 |  0.64 |       0.02 |
| getChainTails/batch100           |       0.71 |   0.23 |  1.96 |    0.82 |  1.01 |       0.04 |
| getChainTails/lockBatch100       |       1.17 |   0.23 |  1.44 |    1.25 |  3.16 |       0.04 |
| getJobs/default                  |       0.40 |   0.02 |  0.29 |    0.25 |  0.35 |       0.02 |
| getJobs/lock                     |       1.15 |   0.02 |  0.71 |    0.64 |  0.33 |       0.02 |
| getJobs/batch100                 |       0.85 |   0.21 |  1.85 |    0.64 |  0.57 |       0.06 |
| getJobs/lockBatch100             |       1.26 |   0.18 |  1.88 |    1.04 |  1.19 |       0.02 |
| getWorkers/default               |       0.21 |   0.01 |  0.21 |    0.20 |  0.18 |       0.03 |
| getWorkers/lock                  |       0.61 |   0.01 |  0.69 |    0.58 |  0.17 |       0.02 |
| getWorkers/batch100              |       0.24 |   0.06 |  0.37 |    0.31 |  0.46 |       0.08 |
| getWorkers/lockBatch100          |       0.67 |   0.09 |  0.76 |    0.76 |  0.42 |       0.06 |
| createJobs/default               |       1.27 |   0.05 |  1.67 |    2.08 |  0.27 |       0.04 |
| createJobs/deduplication         |       4.52 |   0.12 |  0.81 |    0.70 |  0.53 |       0.03 |
| createJobs/batch100              |       3.58 |   0.79 |  4.86 |   22.84 |  3.01 |       0.18 |
| createJobs/deduplicationBatch100 |       3.55 |   0.41 |  2.96 |    2.68 |  3.06 |       0.28 |
| continueJobs/default             |       0.92 |   0.09 | 10.42 |    2.31 |  0.45 |       0.03 |
| continueJobs/batch100            |       7.99 |   1.90 | 10.63 |    7.52 |  5.30 |       0.17 |
| addJobsBlockers/default          |       1.32 |   0.06 |  1.88 |   15.42 |  0.63 |       0.03 |
| addJobsBlockers/batch100         |       9.23 |   1.14 |  5.24 |    7.53 |  4.65 |       0.12 |
| getJobsBlockers/default          |       0.32 |   0.03 |  0.35 |    0.42 |  0.69 |       0.04 |
| getJobsBlockers/manyBlockers     |       1.08 |   0.26 |  3.40 |    1.56 |  1.53 |       0.02 |
| getJobsBlockers/batch100         |       0.91 |   2.29 |  6.10 |    1.45 |  1.01 |       0.07 |
| unblockJobs/default              |       0.88 |   0.15 |  6.25 |    1.53 |  0.54 |       0.02 |
| unblockJobs/batch100             |       3.78 |   0.51 |  4.41 |    5.00 |  4.57 |       0.09 |
| startWorker/default              |       0.43 |   0.01 |  0.82 |    0.87 |  0.37 |       0.02 |
| startWorker/batch100             |       0.94 |   0.02 |  1.01 |    1.35 |  0.71 |       0.05 |
| extendWorkerLease/default        |       1.54 |   0.01 |  1.17 |    1.24 |  0.34 |       0.02 |
| stopWorker/default               |       0.57 |   0.01 |  1.00 |    1.19 |  0.30 |       0.03 |
| startJobAttempts/default         |       1.42 |   0.03 |  1.54 |    1.72 |  0.19 |       0.02 |
| startJobAttempts/limit100        |       3.33 |   0.93 | 16.91 |    5.91 |  1.55 |       0.09 |
| startJobAttempts/batchLimit10    |       3.37 |   0.89 |  8.10 |    7.33 |  1.55 |       0.07 |
| startJobAttempts/batch100        |       1.35 |   0.21 |  5.39 |    8.36 |  0.48 |       0.09 |
| completeJobs/default             |       0.71 |   0.04 |  1.41 |    1.53 |  0.42 |       0.03 |
| completeJobs/batch100            |      10.57 |   0.99 |  6.43 |    6.33 |  5.01 |       2.90 |
| getStartAttemptDelayMs/default   |       0.82 |   0.02 |  0.84 |    0.82 |  0.41 |       0.08 |
| getStartAttemptDelayMs/batch100  |       1.64 |   0.04 |  2.88 |    2.82 |  1.77 |       0.05 |
| rescheduleJobs/default           |       0.58 |   0.03 |  3.52 |    1.72 |  0.38 |       0.05 |
| rescheduleJobs/batch100          |       3.66 |   0.78 |  6.44 |    5.14 |  4.17 |       0.11 |
| deleteChains/default             |       2.07 |   0.06 |  2.46 |    2.06 |  0.77 |       0.12 |
| deleteChains/multiJob            |       1.69 |   0.05 |  1.58 |    2.14 |  0.88 |       0.02 |
| deleteChains/batch100            |      76.31 |   0.85 | 20.00 |    5.45 |  4.51 |       0.06 |

## Type discovery & counts, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.39 |   0.04 |  0.94 |    0.57 |  0.25 |       0.05 |
| getJobTypeNames/default             |       0.39 |   0.04 |  0.32 |    0.35 |  0.30 |       0.04 |
| countChainsByTypeName/default       |       2.15 |   0.59 |  4.20 |    5.83 |  0.20 |       0.05 |
| countChainsByTypeName/batch100      |       0.96 |   0.16 |  5.42 |    4.18 |  0.44 |       0.04 |
| countJobsByTypeName/default         |       1.69 |   0.59 |  4.37 |    6.63 |  0.20 |       0.04 |
| countJobsByTypeName/batch100        |       0.76 |   0.19 | 11.86 |    9.46 |  0.60 |       0.03 |
| countWorkers/default                |       0.19 |   0.01 |  0.52 |    0.29 |  0.21 |       0.04 |
| countWorkersByTypeName/default      |       0.26 |   0.51 |  1.14 |    1.37 |  0.21 |       0.20 |
| countWorkersByTypeName/batch100     |       1.39 |   0.51 |  1.43 |    1.58 |  0.43 |       0.11 |
| countRunningJobsByWorkerId/default  |       0.24 |   0.01 |  0.35 |    0.28 |  0.16 |       0.04 |
| countRunningJobsByWorkerId/batch100 |       5.25 |   0.06 |  0.47 |    0.56 |  0.57 |       0.07 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.59 |   0.19 |  0.71 |    0.70 |  0.55 |     268.96 |
| listChains/noStatus/nonBlocking               |       0.62 |   0.15 |  0.62 |    1.13 |  0.89 |     264.34 |
| listChains/noStatus/blocking                  |       0.37 |   0.21 |  0.29 |    0.36 |  0.15 |      16.69 |
| listChains/noStatus/fromTo                    |       0.48 |   0.17 |  0.66 |    0.63 |  0.56 |       0.07 |
| listChains/noStatus/cursor                    |       0.87 |   0.32 |  0.70 |    1.08 |  1.11 |       0.08 |
| listChains/running/default                    |       0.45 |   0.17 |  0.50 |    0.71 |  0.53 |     237.47 |
| listChains/running/nonBlocking                |       0.52 |   0.16 |  0.46 |    0.63 |  2.70 |     235.55 |
| listChains/running/blocking                   |       0.31 |   0.10 |  0.28 |    0.35 |  0.14 |      16.47 |
| listChains/running/cursor                     |       0.82 |   0.31 |  2.27 |    1.11 |  1.34 |       0.09 |
| listChains/completed/default                  |       7.07 |   0.17 |  0.67 |    0.64 |  0.54 |      56.04 |
| listChains/completed/nonBlocking              |       0.47 |   0.18 |  0.55 |    0.64 |  0.94 |      53.68 |
| listChains/completed/blocking                 |       0.33 |   0.10 |  0.28 |    0.39 |  0.13 |      14.68 |
| listChains/completed/orderByCreatedAt         |       0.42 |   0.16 |  0.61 |    0.68 |  0.54 |      41.07 |
| listChains/completed/orderByCompletedAt       |       0.37 |   0.18 |  0.65 |    0.68 |  0.54 |       0.03 |
| listChains/completed/cursor                   |       0.74 |   0.30 |  1.12 |    1.24 |  1.33 |       0.05 |
| listChains/completed/orderByCreatedAtCursor   |       0.82 |   0.29 |  1.13 |    1.12 |  1.08 |       0.03 |
| listChains/completed/orderByCompletedAtCursor |       0.77 |   0.33 |  1.13 |    1.08 |  1.07 |       0.04 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.42 |   0.14 |  0.73 |    0.75 |  3.22 |     389.69 |
| listJobs/noStatus/fromTo            |       0.43 |   0.17 |  0.49 |    0.52 |  0.51 |       0.05 |
| listJobs/noStatus/cursor            |       0.72 |   0.23 |  0.89 |    0.91 |  1.36 |       0.10 |
| listJobs/pending/default            |       0.41 |   0.11 |  0.44 |    0.38 |  0.45 |     231.20 |
| listJobs/pending/fromTo             |       0.40 |   0.13 |  0.49 |    0.42 |  0.43 |       0.06 |
| listJobs/pending/orderByCreatedAt   |       0.37 |   0.12 |  0.51 |    0.43 |  0.44 |     187.24 |
| listJobs/pending/cursor             |       0.67 |   0.25 |  0.72 |    0.73 |  0.96 |       0.08 |
| listJobs/blocked/default            |       0.38 |   0.13 |  0.35 |    0.35 |  0.37 |     162.56 |
| listJobs/blocked/fromTo             |       0.54 |   0.13 |  0.34 |    0.37 |  0.37 |       0.05 |
| listJobs/blocked/orderByCreatedAt   |       0.45 |   0.12 |  0.33 |    0.43 |  2.13 |     161.90 |
| listJobs/blocked/cursor             |       0.87 |   0.22 |  0.55 |    0.67 |  0.82 |       0.07 |
| listJobs/running/default            |       0.49 |   0.24 |  0.31 |    0.39 |  0.38 |      45.20 |
| listJobs/running/orderByCreatedAt   |       0.44 |   0.12 |  0.32 |    0.42 |  0.38 |      46.44 |
| listJobs/running/cursor             |       6.50 |   0.37 |  0.79 |    0.66 |  0.85 |       0.08 |
| listJobs/completed/default          |       0.65 |   0.12 |  0.44 |    0.37 |  0.37 |     112.98 |
| listJobs/completed/orderByCreatedAt |       0.79 |   0.13 |  0.43 |    0.70 |  0.37 |      83.47 |
| listJobs/completed/cursor           |       2.52 |   0.32 |  0.72 |    1.00 |  0.81 |       0.07 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.98 |   0.63 |   0.94 |    0.83 |  0.41 |       0.04 |
| listChainJobs/cursor    |       2.98 |   1.17 |   0.97 |    1.41 |  0.98 |       0.05 |
| listBlockedJobs/default |     136.34 | 125.69 | 176.18 |  114.80 |  0.50 |       0.10 |
| listBlockedJobs/cursor  |     220.75 | 308.10 | 266.33 |  234.84 |  1.27 |       0.03 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.44 |   0.06 |  0.50 |    0.42 |  0.50 |       0.25 |
| listWorkers/typeName   |       0.34 |   0.09 |  0.72 |    0.39 |  2.66 |       0.03 |
| listWorkers/status     |       0.25 |   0.03 |  0.24 |    0.29 |  2.45 |       0.02 |
| listWorkers/cursor     |       0.78 |   0.09 |  0.59 |    0.64 |  0.75 |       0.08 |
| listWorkerJobs/default |       0.41 |   0.10 |  0.38 |    0.33 |  0.33 |       0.04 |
| listWorkerJobs/cursor  |       0.72 |   0.27 |  0.70 |    0.61 |  0.58 |       0.03 |
