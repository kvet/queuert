# Query performance

Last run 2026-11-22 · commit 83960e11 · load average 3.88 · MySQL at scale 100

## Operational queries, p50 (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.33 |   0.03 |  1.04 |    0.36 |  0.62 |       0.01 |
| getChains/lock                   |       0.70 |   0.02 |  1.48 |    0.99 |  0.57 |       0.00 |
| getChains/batch100               |       0.73 |   0.21 |  1.18 |    0.83 |  1.16 |       0.01 |
| getChains/lockBatch100           |       1.14 |   0.18 |  1.32 |    1.81 |  1.63 |       0.01 |
| getChainTails/default            |       0.25 |   0.01 |  0.63 |    0.24 |  0.51 |       0.00 |
| getChainTails/lock               |       0.66 |   0.02 |  1.18 |    0.63 |  0.67 |       0.00 |
| getChainTails/batch100           |       0.70 |   0.19 |  0.89 |    0.81 |  1.11 |       0.02 |
| getChainTails/lockBatch100       |       1.09 |   0.20 |  1.61 |    1.23 |  1.62 |       0.02 |
| getJobs/default                  |       0.29 |   0.02 |  0.21 |    0.20 |  0.18 |       0.00 |
| getJobs/lock                     |       0.67 |   0.01 |  0.64 |    0.63 |  0.31 |       0.00 |
| getJobs/batch100                 |       0.56 |   0.19 |  0.62 |    0.61 |  0.57 |       0.01 |
| getJobs/lockBatch100             |       1.09 |   0.18 |  1.07 |    1.02 |  1.00 |       0.01 |
| getWorkers/default               |       0.20 |   0.01 |  0.19 |    0.20 |  0.16 |       0.00 |
| getWorkers/lock                  |       0.61 |   0.01 |  0.60 |    0.59 |  0.16 |       0.00 |
| getWorkers/batch100              |       0.43 |   0.05 |  0.30 |    0.29 |  0.42 |       0.03 |
| getWorkers/lockBatch100          |       1.36 |   0.05 |  0.72 |    0.70 |  0.41 |       0.03 |
| createJobs/default               |       0.92 |   0.04 |  1.45 |    1.26 |  0.23 |       0.01 |
| createJobs/deduplication         |       0.53 |   0.02 |  0.61 |    0.61 |  0.47 |       0.00 |
| createJobs/batch100              |       3.08 |   0.77 | 14.77 |    3.83 |  2.02 |       0.13 |
| createJobs/deduplicationBatch100 |       1.40 |   0.33 |  2.56 |    1.76 |  1.65 |       0.03 |
| continueJobs/default             |       0.99 |   0.06 |  1.90 |    1.57 |  0.40 |       0.01 |
| continueJobs/batch100            |       6.48 |   1.71 |  9.98 |    7.87 |  4.62 |       0.16 |
| addJobsBlockers/default          |       0.97 |   0.05 |  1.70 |    1.68 |  0.58 |       0.00 |
| addJobsBlockers/batch100         |       3.57 |   1.10 |  5.06 |    4.41 |  3.90 |       0.09 |
| getJobsBlockers/default          |       0.30 |   0.02 |  0.38 |    0.43 |  0.53 |       0.00 |
| getJobsBlockers/manyBlockers     |       0.79 |   0.22 |  1.35 |    1.61 |  1.31 |       0.00 |
| getJobsBlockers/batch100         |       0.81 |   0.21 |  1.16 |    1.42 |  0.97 |       0.01 |
| unblockJobs/default              |       0.79 |   0.08 |  1.66 |    1.50 |  0.52 |       0.00 |
| unblockJobs/batch100             |       3.36 |   0.53 |  4.18 |    3.99 |  3.50 |       0.05 |
| startWorker/default              |       0.31 |   0.01 |  1.01 |    0.75 |  0.33 |       0.00 |
| startWorker/batch100             |       0.45 |   0.02 |  1.00 |    0.77 |  0.60 |       0.01 |
| extendWorkerLease/default        |       0.34 |   0.01 |  1.51 |    1.19 |  0.30 |       0.00 |
| stopWorker/default               |       0.27 |   0.01 |  2.06 |    1.05 |  0.30 |       0.00 |
| startJobAttempts/default         |       0.50 |   0.02 |  1.72 |    2.31 |  0.19 |       0.00 |
| startJobAttempts/limit100        |       2.91 |   0.84 |  5.41 |    6.58 |  1.48 |       0.07 |
| startJobAttempts/batch100        |       0.93 |   0.14 | 12.77 |    6.19 |  0.38 |       0.01 |
| completeJobs/default             |       0.92 |   0.04 |  1.48 |    1.31 |  0.36 |       0.00 |
| completeJobs/batch100            |       4.83 |   1.01 |  5.83 |    5.94 |  3.87 |       0.09 |
| getStartAttemptDelayMs/default   |       0.73 |   0.01 |  0.79 |    1.60 |  0.38 |       0.00 |
| getStartAttemptDelayMs/batch100  |       0.67 |   0.03 |  3.43 |    3.35 |  0.97 |       0.01 |
| rescheduleJobs/default           |       0.52 |   0.02 |  1.73 |    1.80 |  0.35 |       0.00 |
| rescheduleJobs/batch100          |       3.28 |   0.83 |  4.95 |    5.28 |  3.09 |       0.09 |
| deleteChains/default             |       1.64 |   0.05 |  1.98 |    2.32 |  0.66 |       0.01 |
| deleteChains/multiJob            |       1.80 |   0.04 |  1.96 |    1.92 |  0.78 |       0.00 |
| deleteChains/batch100            |       4.64 |   0.86 |  8.51 |    6.11 |  2.89 |       0.16 |

## Type discovery & counts, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.42 |   0.03 |  0.35 |    0.40 |  0.22 |       0.01 |
| getJobTypeNames/default             |       0.37 |   0.03 |  0.26 |    0.30 |  0.20 |       0.01 |
| countChainsByTypeName/default       |       1.66 |   0.57 |  3.90 |    5.21 |  0.16 |       0.00 |
| countChainsByTypeName/batch100      |       1.25 |   0.13 |  4.03 |    4.65 |  0.39 |       0.02 |
| countJobsByTypeName/default         |       1.92 |   0.56 |  4.13 |    5.35 |  0.19 |       0.00 |
| countJobsByTypeName/batch100        |       1.47 |   0.15 | 12.77 |    7.72 |  0.56 |       0.01 |
| countWorkers/default                |       0.22 |   0.01 |  0.24 |    0.25 |  0.20 |       0.00 |
| countWorkersByTypeName/default      |       0.27 |   0.50 |  1.20 |    1.39 |  0.17 |       0.09 |
| countWorkersByTypeName/batch100     |       1.48 |   0.53 |  1.20 |    1.71 |  0.35 |       0.08 |
| countRunningJobsByWorkerId/default  |       0.29 |   0.01 |  0.25 |    0.23 |  0.15 |       0.00 |
| countRunningJobsByWorkerId/batch100 |       4.53 |   0.05 |  0.38 |    0.40 |  0.34 |       0.03 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.44 |   0.17 |  0.45 |    0.70 |  0.53 |       0.01 |
| listChains/noStatus/nonBlocking               |       0.52 |   0.15 |  0.45 |    0.59 |  0.85 |       0.01 |
| listChains/noStatus/blocking                  |       0.31 |   0.09 |  0.26 |    0.32 |  0.12 |       0.00 |
| listChains/noStatus/fromTo                    |       0.49 |   0.15 |  0.41 |    0.49 |  0.52 |       0.01 |
| listChains/noStatus/cursor                    |       0.90 |   0.28 |  0.71 |    0.83 |  1.07 |       0.02 |
| listChains/running/default                    |       0.51 |   0.16 |  0.48 |    0.47 |  0.53 |       0.01 |
| listChains/running/nonBlocking                |       0.52 |   0.15 |  0.44 |    0.46 |  0.86 |       0.01 |
| listChains/running/blocking                   |       0.28 |   0.09 |  0.25 |    0.31 |  0.12 |       0.00 |
| listChains/running/cursor                     |       0.69 |   0.29 |  0.81 |    0.83 |  1.04 |       0.01 |
| listChains/completed/default                  |       0.38 |   0.15 |  0.49 |    0.65 |  0.53 |       0.01 |
| listChains/completed/nonBlocking              |       0.44 |   0.15 |  0.43 |    0.63 |  0.89 |       0.01 |
| listChains/completed/blocking                 |       0.25 |   0.09 |  0.24 |    0.34 |  0.13 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.36 |   0.15 |  0.48 |    0.61 |  0.54 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.37 |   0.17 |  0.46 |    0.64 |  0.53 |       0.00 |
| listChains/completed/cursor                   |       0.66 |   0.29 |  0.83 |    1.27 |  1.08 |       0.02 |
| listChains/completed/orderByCreatedAtCursor   |       0.72 |   0.29 |  0.82 |    1.24 |  1.08 |       0.01 |
| listChains/completed/orderByCompletedAtCursor |       0.65 |   0.29 |  0.80 |    1.16 |  1.07 |       0.01 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.56 |   0.13 |  0.55 |    0.53 |  0.43 |       0.01 |
| listJobs/noStatus/fromTo            |       0.54 |   0.13 |  0.44 |    0.49 |  0.40 |       0.01 |
| listJobs/noStatus/cursor            |       0.90 |   0.23 |  0.89 |    0.95 |  0.93 |       0.02 |
| listJobs/pending/default            |       0.44 |   0.12 |  0.31 |    0.45 |  0.35 |       0.01 |
| listJobs/pending/fromTo             |       0.49 |   0.12 |  0.31 |    0.49 |  0.34 |       0.01 |
| listJobs/pending/orderByCreatedAt   |       0.46 |   0.12 |  0.34 |    0.49 |  0.36 |       0.01 |
| listJobs/pending/cursor             |       0.78 |   0.22 |  0.57 |    0.78 |  0.82 |       0.01 |
| listJobs/blocked/default            |       0.44 |   0.12 |  0.30 |    0.39 |  0.37 |       0.01 |
| listJobs/blocked/fromTo             |       0.46 |   0.13 |  0.31 |    0.42 |  0.36 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.39 |   0.12 |  0.41 |    0.42 |  0.37 |       0.01 |
| listJobs/blocked/cursor             |       0.78 |   0.22 |  0.55 |    0.73 |  0.78 |       0.02 |
| listJobs/running/default            |       0.46 |   0.19 |  0.29 |    0.40 |  0.38 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.48 |   0.12 |  0.37 |    0.42 |  0.36 |       0.01 |
| listJobs/running/cursor             |       6.52 |   0.36 |  0.59 |    0.74 |  0.77 |       0.02 |
| listJobs/completed/default          |       0.59 |   0.13 |  0.32 |    0.47 |  0.36 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.55 |   0.13 |  0.34 |    0.46 |  0.38 |       0.01 |
| listJobs/completed/cursor           |       1.00 |   0.23 |  0.59 |    0.75 |  0.78 |       0.01 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.39 |   0.53 |   0.29 |    0.84 |  0.36 |       0.01 |
| listChainJobs/cursor    |       2.66 |   1.07 |   0.50 |    1.55 |  1.01 |       0.01 |
| listBlockedJobs/default |     106.22 | 120.74 | 133.26 |  104.92 |  0.44 |       0.01 |
| listBlockedJobs/cursor  |     216.15 | 242.67 | 264.37 |  208.09 |  1.01 |       0.01 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.40 |   0.05 |  0.33 |    0.44 |  0.34 |       0.03 |
| listWorkers/typeName   |       0.26 |   0.09 |  0.70 |    0.34 |  0.26 |       0.01 |
| listWorkers/status     |       0.26 |   0.03 |  0.22 |    0.25 |  2.33 |       0.00 |
| listWorkers/cursor     |       0.51 |   0.08 |  0.46 |    0.46 |  0.82 |       0.05 |
| listWorkerJobs/default |       0.36 |   0.09 |  0.29 |    0.29 |  0.31 |       0.00 |
| listWorkerJobs/cursor  |       0.72 |   0.16 |  0.53 |    0.55 |  0.58 |       0.01 |

## Operational queries, max (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.67 |   0.06 |  1.47 |    0.42 |  0.81 |       0.10 |
| getChains/lock                   |       0.74 |   0.03 |  1.70 |    1.17 |  0.81 |       0.03 |
| getChains/batch100               |       0.90 |   0.23 |  2.15 |    0.92 |  1.42 |       0.09 |
| getChains/lockBatch100           |       1.35 |   0.18 |  2.61 |    3.40 |  1.71 |       0.02 |
| getChainTails/default            |       0.29 |   0.02 |  0.65 |    0.28 |  0.57 |       0.03 |
| getChainTails/lock               |       0.77 |   0.02 |  1.27 |    0.66 |  0.89 |       0.02 |
| getChainTails/batch100           |       0.97 |   0.25 |  0.93 |    1.56 |  1.25 |       0.04 |
| getChainTails/lockBatch100       |       1.23 |   0.22 |  1.85 |    1.38 |  3.23 |       0.03 |
| getJobs/default                  |       0.40 |   0.02 |  0.24 |    0.21 |  0.23 |       0.02 |
| getJobs/lock                     |       0.83 |   0.02 |  0.70 |    0.64 |  0.34 |       0.02 |
| getJobs/batch100                 |       0.73 |   0.22 |  0.65 |    0.72 |  0.61 |       0.05 |
| getJobs/lockBatch100             |       1.25 |   0.19 |  1.11 |    1.03 |  1.04 |       0.02 |
| getWorkers/default               |       0.23 |   0.02 |  0.25 |    0.23 |  0.20 |       0.03 |
| getWorkers/lock                  |       8.45 |   0.01 |  0.62 |    0.60 |  0.17 |       0.02 |
| getWorkers/batch100              |       0.53 |   0.06 |  0.33 |    0.30 |  0.46 |       0.08 |
| getWorkers/lockBatch100          |       1.75 |   0.06 |  0.76 |    0.72 |  0.44 |       0.06 |
| createJobs/default               |       1.21 |   0.06 |  2.24 |    2.01 |  0.34 |       0.03 |
| createJobs/deduplication         |       0.64 |   0.13 |  0.80 |    0.77 |  0.58 |       0.03 |
| createJobs/batch100              |       3.74 |   0.83 | 31.21 |    5.77 |  3.35 |       0.19 |
| createJobs/deduplicationBatch100 |       4.71 |   0.41 |  2.88 |    2.71 |  2.88 |       0.27 |
| continueJobs/default             |       1.24 |   0.09 |  2.64 |    1.84 |  0.45 |       0.03 |
| continueJobs/batch100            |       8.27 |   1.76 | 14.70 |   10.83 |  4.85 |       0.24 |
| addJobsBlockers/default          |       1.38 |   0.07 |  1.99 |    3.03 |  0.65 |       0.03 |
| addJobsBlockers/batch100         |       5.99 |   1.15 |  6.16 |    5.42 |  4.61 |       0.12 |
| getJobsBlockers/default          |       0.67 |   0.03 |  0.48 |    0.49 |  0.62 |       0.05 |
| getJobsBlockers/manyBlockers     |       0.87 |   0.25 |  1.45 |    3.63 |  2.95 |       0.03 |
| getJobsBlockers/batch100         |       1.05 |   0.23 |  1.96 |    1.56 |  0.99 |       0.07 |
| unblockJobs/default              |       1.15 |   0.13 |  1.80 |    1.62 |  0.56 |       0.03 |
| unblockJobs/batch100             |       3.67 |   0.60 |  4.64 |    5.23 |  3.68 |       0.06 |
| startWorker/default              |       0.35 |   0.01 |  1.66 |    0.89 |  0.39 |       0.02 |
| startWorker/batch100             |       0.65 |   0.03 |  2.32 |    1.35 |  0.62 |       0.04 |
| extendWorkerLease/default        |       0.38 |   0.01 |  1.91 |    1.26 |  0.35 |       0.02 |
| stopWorker/default               |       0.30 |   0.01 |  3.28 |    1.15 |  0.33 |       0.03 |
| startJobAttempts/default         |       0.70 |   0.02 |  2.46 |    2.52 |  0.25 |       0.02 |
| startJobAttempts/limit100        |       4.66 |   0.85 |  6.28 |    7.02 |  1.63 |       0.09 |
| startJobAttempts/batch100        |       0.99 |   0.15 | 15.70 |   78.96 |  0.43 |       0.02 |
| completeJobs/default             |       1.26 |   0.04 |  2.26 |    1.62 |  0.41 |       0.02 |
| completeJobs/batch100            |       5.87 |   1.07 |  7.04 |    6.71 |  4.79 |       0.14 |
| getStartAttemptDelayMs/default   |       0.75 |   0.02 |  0.95 |    3.38 |  0.41 |       0.07 |
| getStartAttemptDelayMs/batch100  |       0.75 |   0.05 |  3.85 |    3.94 |  2.62 |       0.04 |
| rescheduleJobs/default           |       0.55 |   0.03 |  2.41 |    1.97 |  0.40 |       0.06 |
| rescheduleJobs/batch100          |       3.91 |   0.88 |  6.09 |    6.73 |  3.53 |       0.13 |
| deleteChains/default             |       2.04 |   0.06 |  3.04 |    2.61 |  0.69 |       0.14 |
| deleteChains/multiJob            |       2.07 |   0.04 |  3.01 |    2.70 |  0.81 |       0.02 |
| deleteChains/batch100            |      59.90 |   0.91 | 11.05 |   11.00 |  3.69 |       0.18 |

## Type discovery & counts, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.45 |   0.04 |  0.43 |    0.45 |  0.38 |       0.05 |
| getJobTypeNames/default             |       0.43 |   0.04 |  0.30 |    0.33 |  0.23 |       0.04 |
| countChainsByTypeName/default       |       1.82 |   0.58 |  4.35 |    5.71 |  0.32 |       0.05 |
| countChainsByTypeName/batch100      |       1.61 |   0.15 |  4.73 |    5.06 |  0.52 |       0.04 |
| countJobsByTypeName/default         |       2.15 |   0.58 |  4.67 |    5.83 |  0.22 |       0.04 |
| countJobsByTypeName/batch100        |       4.56 |   0.18 | 13.39 |    8.35 |  0.86 |       0.04 |
| countWorkers/default                |       0.26 |   0.01 |  0.29 |    0.44 |  0.24 |       0.04 |
| countWorkersByTypeName/default      |       0.36 |   0.51 |  1.34 |    1.53 |  0.18 |       0.23 |
| countWorkersByTypeName/batch100     |       1.54 |   0.57 |  1.36 |    1.91 |  0.51 |       0.11 |
| countRunningJobsByWorkerId/default  |       0.36 |   0.01 |  0.32 |    0.29 |  0.19 |       0.02 |
| countRunningJobsByWorkerId/batch100 |       5.50 |   0.06 |  0.41 |    0.45 |  0.42 |       0.05 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.58 |   0.19 |  0.46 |    3.45 |  0.57 |     272.49 |
| listChains/noStatus/nonBlocking               |       0.65 |   0.16 |  0.47 |    0.72 |  0.93 |     268.59 |
| listChains/noStatus/blocking                  |       0.44 |   0.09 |  0.27 |    0.37 |  0.14 |      16.12 |
| listChains/noStatus/fromTo                    |       0.54 |   0.16 |  0.43 |    0.55 |  0.56 |       0.07 |
| listChains/noStatus/cursor                    |       1.00 |   0.29 |  0.88 |    0.85 |  1.14 |       0.09 |
| listChains/running/default                    |       0.56 |   0.19 |  2.16 |    0.51 |  0.54 |     237.57 |
| listChains/running/nonBlocking                |       0.62 |   0.20 |  0.44 |    0.51 |  2.83 |     234.24 |
| listChains/running/blocking                   |       0.32 |   0.10 |  0.29 |    0.34 |  0.13 |      16.34 |
| listChains/running/cursor                     |       0.76 |   0.30 |  0.92 |    1.20 |  1.14 |       0.08 |
| listChains/completed/default                  |       0.39 |   0.16 |  0.53 |    0.72 |  0.54 |      60.74 |
| listChains/completed/nonBlocking              |       0.58 |   0.16 |  0.74 |    0.68 |  1.10 |      59.37 |
| listChains/completed/blocking                 |       0.27 |   0.09 |  0.26 |    0.35 |  0.15 |      14.21 |
| listChains/completed/orderByCreatedAt         |       0.40 |   0.18 |  0.50 |    0.63 |  0.58 |      47.79 |
| listChains/completed/orderByCompletedAt       |       0.38 |   1.97 |  0.49 |    0.66 |  0.58 |       0.03 |
| listChains/completed/cursor                   |       0.69 |   0.31 |  0.89 |    1.42 |  1.22 |       0.06 |
| listChains/completed/orderByCreatedAtCursor   |       3.30 |   0.31 |  0.89 |    1.84 |  1.11 |       0.03 |
| listChains/completed/orderByCompletedAtCursor |       0.71 |   0.36 |  0.84 |    1.43 |  1.11 |       0.04 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.70 |   0.15 |  0.63 |    0.73 |  0.46 |     397.46 |
| listJobs/noStatus/fromTo            |       0.61 |   0.14 |  0.45 |    0.52 |  0.41 |       0.05 |
| listJobs/noStatus/cursor            |       1.08 |   0.33 |  1.07 |    0.97 |  1.00 |       0.09 |
| listJobs/pending/default            |       0.48 |   0.13 |  0.49 |    0.48 |  0.37 |     232.27 |
| listJobs/pending/fromTo             |       0.52 |   0.13 |  0.33 |    0.54 |  0.37 |       0.04 |
| listJobs/pending/orderByCreatedAt   |       0.51 |   0.12 |  0.37 |    0.52 |  0.36 |     181.33 |
| listJobs/pending/cursor             |       0.93 |   0.24 |  0.64 |    1.02 |  2.56 |       0.08 |
| listJobs/blocked/default            |       0.48 |   0.13 |  0.37 |    0.42 |  0.39 |     155.47 |
| listJobs/blocked/fromTo             |       0.50 |   0.18 |  0.33 |    0.48 |  0.38 |       0.03 |
| listJobs/blocked/orderByCreatedAt   |       0.42 |   0.12 |  0.55 |    0.49 |  0.40 |     162.43 |
| listJobs/blocked/cursor             |       0.99 |   0.23 |  0.69 |    0.77 |  0.86 |       0.07 |
| listJobs/running/default            |       0.50 |   0.20 |  0.51 |    0.42 |  0.40 |      48.20 |
| listJobs/running/orderByCreatedAt   |       0.50 |   0.14 |  0.59 |    0.46 |  0.37 |      47.97 |
| listJobs/running/cursor             |       6.99 |   0.43 |  0.63 |    0.86 |  1.07 |       0.07 |
| listJobs/completed/default          |       0.70 |   0.13 |  0.34 |    0.51 |  0.38 |     121.34 |
| listJobs/completed/orderByCreatedAt |       0.81 |   0.14 |  0.36 |    0.52 |  0.39 |      89.46 |
| listJobs/completed/cursor           |       1.13 |   0.24 |  0.61 |    0.85 |  0.82 |       0.07 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       2.07 |   0.63 |   0.32 |    0.90 |  0.38 |       0.06 |
| listChainJobs/cursor    |       2.73 |   1.16 |   0.54 |    1.71 |  1.39 |       0.05 |
| listBlockedJobs/default |     119.03 | 128.15 | 145.08 |  107.81 |  0.82 |       0.10 |
| listBlockedJobs/cursor  |     231.10 | 245.67 | 281.84 |  214.32 |  1.42 |       0.03 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.45 |   0.06 |  0.44 |    0.54 |  0.44 |       0.26 |
| listWorkers/typeName   |       0.33 |   0.09 |  0.77 |    0.37 |  0.27 |       0.04 |
| listWorkers/status     |       0.30 |   0.03 |  0.24 |    0.28 |  2.38 |       0.02 |
| listWorkers/cursor     |       0.61 |   0.09 |  0.49 |    0.57 |  0.97 |       0.08 |
| listWorkerJobs/default |       0.40 |   0.10 |  0.34 |    0.30 |  0.34 |       0.04 |
| listWorkerJobs/cursor  |       0.90 |   0.17 |  0.65 |    0.63 |  0.60 |       0.04 |
