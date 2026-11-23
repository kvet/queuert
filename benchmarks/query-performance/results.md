# Query performance

Last run 2026-11-23 · commit e279ddec · load average 3.42 · In-process at scale 100

## Operational queries, p50 (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.33 |   0.04 |  1.07 |    0.33 |  0.56 |       0.00 |
| getChains/lock                   |       0.72 |   0.03 |  1.49 |    0.97 |  0.51 |       0.00 |
| getChains/batch100               |       0.71 |   0.28 |  0.91 |    0.85 |  1.13 |       0.01 |
| getChains/lockBatch100           |       1.09 |   0.20 |  1.28 |    1.93 |  1.53 |       0.01 |
| getChainTails/default            |       0.25 |   0.01 |  0.67 |    0.24 |  0.41 |       0.00 |
| getChainTails/lock               |       0.67 |   0.02 |  1.09 |    0.66 |  0.53 |       0.00 |
| getChainTails/batch100           |       0.67 |   0.22 |  0.88 |    0.84 |  0.94 |       0.02 |
| getChainTails/lockBatch100       |       1.14 |   0.21 |  1.36 |    1.34 |  1.48 |       0.02 |
| getJobs/default                  |       0.29 |   0.02 |  0.21 |    0.23 |  0.15 |       0.00 |
| getJobs/lock                     |       0.71 |   0.02 |  0.65 |    0.67 |  0.27 |       0.00 |
| getJobs/batch100                 |       0.58 |   0.25 |  0.63 |    0.63 |  0.55 |       0.01 |
| getJobs/lockBatch100             |       1.07 |   0.20 |  1.05 |    1.11 |  1.00 |       0.01 |
| getWorkers/default               |       0.20 |   0.01 |  0.19 |    0.22 |  0.16 |       0.00 |
| getWorkers/lock                  |       0.57 |   0.01 |  0.56 |    0.80 |  0.16 |       0.00 |
| getWorkers/batch100              |       0.24 |   0.06 |  0.30 |    0.34 |  0.43 |       0.03 |
| getWorkers/lockBatch100          |       0.67 |   0.05 |  0.71 |    0.89 |  0.41 |       0.03 |
| createJobs/default               |       0.99 |   0.03 |  1.61 |    1.75 |  0.24 |       0.01 |
| createJobs/deduplication         |       0.66 |   0.05 |  0.70 |    0.70 |  0.46 |       0.00 |
| createJobs/batch100              |       5.75 |   0.81 |  4.57 |    5.79 |  2.38 |       0.16 |
| createJobs/deduplicationBatch100 |       2.49 |   0.32 |  2.02 |    1.76 |  1.62 |       0.03 |
| continueJobs/default             |       1.05 |   0.06 |  1.60 |    1.89 |  0.39 |       0.01 |
| continueJobs/batch100            |       6.83 |   2.01 |  9.39 |    9.48 |  4.48 |       0.13 |
| addJobsBlockers/default          |       1.05 |   0.05 |  1.96 |    1.61 |  0.60 |       0.01 |
| addJobsBlockers/batch100         |       3.20 |   1.16 |  5.10 |    6.05 |  3.85 |       0.08 |
| getJobsBlockers/default          |       0.31 |   0.02 |  0.33 |    0.37 |  0.52 |       0.00 |
| getJobsBlockers/manyBlockers     |       0.78 |   0.23 |  1.49 |    3.12 |  1.24 |       0.01 |
| getJobsBlockers/batch100         |       0.71 |   0.21 |  0.84 |    2.04 |  0.92 |       0.01 |
| unblockJobs/default              |       0.95 |   0.08 |  1.65 |    1.88 |  0.46 |       0.00 |
| unblockJobs/batch100             |       3.62 |   0.54 |  9.86 |    4.02 |  3.66 |       0.05 |
| startWorker/default              |       0.40 |   0.01 |  0.95 |    0.68 |  0.35 |       0.00 |
| startWorker/batch100             |       0.57 |   0.02 |  0.88 |    0.75 |  0.62 |       0.01 |
| extendWorkerLease/default        |       0.36 |   0.01 |  1.34 |    1.20 |  0.31 |       0.00 |
| stopWorker/default               |       0.30 |   0.01 |  1.14 |    0.99 |  0.30 |       0.00 |
| startJobAttempts/default         |       0.55 |   0.03 |  1.70 |    1.43 |  0.20 |       0.00 |
| startJobAttempts/limit100        |       2.94 |   0.96 |  4.89 |    4.94 |  1.55 |       0.07 |
| startJobAttempts/batchLimit10    |       2.94 |   1.00 |  4.61 |    5.55 |  1.50 |       0.06 |
| startJobAttempts/batch100        |       1.04 |   0.15 |  3.59 |    3.83 |  0.41 |       0.02 |
| completeJobs/default             |       0.87 |   0.04 |  1.35 |    1.38 |  0.35 |       0.00 |
| completeJobs/batch100            |       5.19 |   1.04 |  5.62 |    4.74 |  3.77 |       0.05 |
| getStartAttemptDelayMs/default   |       0.66 |   0.01 |  0.70 |    0.70 |  0.38 |       0.00 |
| getStartAttemptDelayMs/batch100  |       0.60 |   0.03 |  2.71 |    3.60 |  0.96 |       0.01 |
| rescheduleJobs/default           |       0.45 |   0.02 |  1.74 |    1.76 |  0.34 |       0.00 |
| rescheduleJobs/batch100          |       2.76 |   0.82 |  5.02 |    3.77 |  3.07 |       0.06 |
| deleteChains/default             |       1.63 |   0.06 |  1.92 |    1.82 |  0.72 |       0.01 |
| deleteChains/multiJob            |       1.77 |   0.04 |  1.81 |    2.05 |  0.83 |       0.00 |
| deleteChains/batch100            |       4.58 |   0.85 |  5.97 |    4.90 |  2.91 |       0.04 |

## Type discovery & counts, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.41 |   0.03 |  0.42 |    0.30 |  0.23 |       0.01 |
| getJobTypeNames/default             |       0.47 |   0.03 |  0.26 |    0.22 |  0.22 |       0.01 |
| countChainsByTypeName/default       |       1.56 |   0.56 |  3.85 |    5.19 |  0.20 |       0.00 |
| countChainsByTypeName/batch100      |       0.82 |   0.14 |  4.55 |    3.85 |  0.42 |       0.02 |
| countJobsByTypeName/default         |       1.61 |   0.57 |  4.22 |    5.43 |  0.21 |       0.00 |
| countJobsByTypeName/batch100        |       1.02 |   0.16 | 10.75 |    7.45 |  0.61 |       0.01 |
| countWorkers/default                |       0.25 |   0.01 |  0.20 |    0.24 |  0.19 |       0.00 |
| countWorkersByTypeName/default      |       0.27 |   0.53 |  1.09 |    1.42 |  0.20 |       0.10 |
| countWorkersByTypeName/batch100     |       1.49 |   0.54 |  1.11 |    1.58 |  0.37 |       0.08 |
| countRunningJobsByWorkerId/default  |       0.25 |   0.01 |  0.21 |    0.28 |  0.17 |       0.00 |
| countRunningJobsByWorkerId/batch100 |       0.49 |   0.05 |  0.32 |    0.36 |  0.32 |       0.03 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.42 |   0.25 |  0.41 |    0.65 |  0.54 |       0.01 |
| listChains/noStatus/nonBlocking               |       0.49 |   0.20 |  0.42 |    0.51 |  0.86 |       0.01 |
| listChains/noStatus/blocking                  |       0.25 |   0.09 |  0.22 |    0.38 |  0.12 |       0.00 |
| listChains/noStatus/fromTo                    |       0.41 |   0.18 |  0.38 |    0.64 |  0.52 |       0.01 |
| listChains/noStatus/cursor                    |       0.71 |   0.29 |  0.64 |    0.87 |  1.04 |       0.02 |
| listChains/running/default                    |       0.43 |   0.15 |  0.49 |    0.52 |  0.53 |       0.01 |
| listChains/running/nonBlocking                |       0.52 |   0.15 |  0.42 |    0.52 |  0.84 |       0.01 |
| listChains/running/blocking                   |       0.28 |   0.09 |  0.24 |    0.37 |  0.13 |       0.00 |
| listChains/running/cursor                     |       0.74 |   0.29 |  0.83 |    1.03 |  1.03 |       0.02 |
| listChains/completed/default                  |       0.43 |   0.16 |  0.50 |    0.62 |  0.53 |       0.01 |
| listChains/completed/nonBlocking              |       0.50 |   0.16 |  0.43 |    0.60 |  0.87 |       0.01 |
| listChains/completed/blocking                 |       0.26 |   0.09 |  0.23 |    0.37 |  0.13 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.42 |   0.16 |  0.52 |    0.61 |  0.52 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.43 |   0.16 |  0.48 |    0.64 |  0.56 |       0.01 |
| listChains/completed/cursor                   |       0.79 |   0.30 |  0.81 |    1.10 |  1.09 |       0.01 |
| listChains/completed/orderByCreatedAtCursor   |       0.79 |   0.29 |  0.93 |    0.84 |  1.06 |       0.01 |
| listChains/completed/orderByCompletedAtCursor |       0.80 |   0.30 |  0.94 |    1.04 |  1.21 |       0.01 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.51 |   0.21 |  0.46 |    0.60 |  0.45 |       0.01 |
| listJobs/noStatus/fromTo            |       0.52 |   0.20 |  0.47 |    0.40 |  0.42 |       0.01 |
| listJobs/noStatus/cursor            |       0.92 |   0.26 |  0.82 |    0.73 |  0.92 |       0.02 |
| listJobs/pending/default            |       0.50 |   0.16 |  0.41 |    0.34 |  0.41 |       0.01 |
| listJobs/pending/fromTo             |       0.53 |   0.15 |  0.39 |    0.32 |  0.36 |       0.01 |
| listJobs/pending/orderByCreatedAt   |       0.44 |   0.14 |  0.37 |    0.34 |  0.37 |       0.01 |
| listJobs/pending/cursor             |       0.85 |   0.30 |  0.57 |    0.59 |  0.77 |       0.02 |
| listJobs/blocked/default            |       0.44 |   0.17 |  0.30 |    0.30 |  0.36 |       0.01 |
| listJobs/blocked/fromTo             |       0.45 |   0.14 |  0.30 |    0.31 |  0.37 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.44 |   0.13 |  0.31 |    0.33 |  0.35 |       0.01 |
| listJobs/blocked/cursor             |       0.79 |   0.23 |  0.52 |    0.58 |  0.79 |       0.01 |
| listJobs/running/default            |       0.50 |   0.32 |  0.29 |    0.32 |  0.36 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.48 |   0.16 |  0.30 |    0.33 |  0.42 |       0.01 |
| listJobs/running/cursor             |       6.66 |   0.72 |  0.49 |    0.54 |  0.82 |       0.02 |
| listJobs/completed/default          |       0.57 |   0.13 |  0.30 |    0.31 |  0.36 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.56 |   0.13 |  0.33 |    0.50 |  0.36 |       0.01 |
| listJobs/completed/cursor           |       1.00 |   0.24 |  0.52 |    0.71 |  0.80 |       0.02 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.54 |   0.55 |   0.29 |    0.87 |  0.47 |       0.01 |
| listChainJobs/cursor    |       3.39 |   1.10 |   0.51 |    1.47 |  0.97 |       0.01 |
| listBlockedJobs/default |     107.51 | 124.17 | 133.54 |  108.03 |  0.37 |       0.01 |
| listBlockedJobs/cursor  |     221.13 | 248.45 | 266.65 |  217.72 |  0.79 |       0.01 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.47 |   0.05 |  0.36 |    0.31 |  0.34 |       0.03 |
| listWorkers/typeName   |       0.24 |   0.09 |  0.69 |    0.32 |  0.24 |       0.01 |
| listWorkers/status     |       0.21 |   0.03 |  0.27 |    0.23 |  2.30 |       0.00 |
| listWorkers/cursor     |       0.45 |   0.08 |  0.65 |    0.45 |  0.73 |       0.05 |
| listWorkerJobs/default |       0.34 |   0.10 |  0.33 |    0.28 |  0.29 |       0.00 |
| listWorkerJobs/cursor  |       0.60 |   0.16 |  0.63 |    0.76 |  0.53 |       0.01 |

## Operational queries, max (ms)

| Query                            | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| -------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default                |       0.41 |   0.07 |  1.24 |    0.73 |  0.67 |       0.11 |
| getChains/lock                   |       0.76 |   0.04 |  1.61 |    1.27 |  0.74 |       0.03 |
| getChains/batch100               |       0.81 |   0.44 |  0.96 |    0.95 |  1.52 |       0.10 |
| getChains/lockBatch100           |       1.12 |   0.25 |  2.77 |    3.37 |  1.64 |       0.03 |
| getChainTails/default            |       0.29 |   0.03 |  0.69 |    0.27 |  0.46 |       0.04 |
| getChainTails/lock               |       0.71 |   0.03 |  1.19 |    0.79 |  0.54 |       0.02 |
| getChainTails/batch100           |       0.74 |   0.60 |  0.92 |    0.87 |  1.13 |       0.04 |
| getChainTails/lockBatch100       |       1.25 |   0.23 |  1.46 |    1.59 |  3.02 |       0.03 |
| getJobs/default                  |       0.60 |   0.14 |  0.26 |    0.41 |  0.17 |       0.03 |
| getJobs/lock                     |       0.78 |   0.04 |  0.73 |    0.77 |  0.29 |       0.02 |
| getJobs/batch100                 |       0.82 |   0.38 |  0.74 |    0.67 |  0.57 |       0.06 |
| getJobs/lockBatch100             |       1.23 |   0.27 |  1.15 |    1.21 |  1.08 |       0.02 |
| getWorkers/default               |       0.21 |   0.02 |  0.21 |    0.39 |  0.17 |       0.03 |
| getWorkers/lock                  |       0.59 |   0.01 |  0.61 |    1.07 |  0.18 |       0.02 |
| getWorkers/batch100              |       0.25 |   0.06 |  0.35 |    0.41 |  0.47 |       0.08 |
| getWorkers/lockBatch100          |       0.94 |   0.06 |  0.75 |    2.10 |  0.43 |       0.07 |
| createJobs/default               |       1.45 |   0.07 |  2.29 |    2.36 |  0.41 |       0.04 |
| createJobs/deduplication         |       0.82 |   0.23 |  1.22 |    0.87 |  0.53 |       0.03 |
| createJobs/batch100              |      14.18 |   0.90 |  5.32 |    6.42 |  3.39 |       0.19 |
| createJobs/deduplicationBatch100 |      21.59 |   0.42 |  2.17 |    2.90 |  2.99 |       0.28 |
| continueJobs/default             |       1.65 |   0.11 |  2.29 |    6.09 |  0.45 |       0.04 |
| continueJobs/batch100            |       8.24 |   2.47 | 11.44 |   10.97 |  5.31 |       0.17 |
| addJobsBlockers/default          |       1.30 |   0.12 |  2.70 |    1.90 |  0.66 |       0.03 |
| addJobsBlockers/batch100         |       3.46 |   1.30 |  6.05 |    9.02 |  4.69 |       0.13 |
| getJobsBlockers/default          |       0.34 |   0.03 |  0.43 |    0.49 |  0.58 |       0.05 |
| getJobsBlockers/manyBlockers     |       0.83 |   0.26 |  2.82 |    4.49 |  1.43 |       0.02 |
| getJobsBlockers/batch100         |       0.78 |   2.81 |  0.86 |    3.13 |  0.93 |       0.07 |
| unblockJobs/default              |       3.86 |   0.13 |  2.69 |    2.57 |  0.52 |       0.02 |
| unblockJobs/batch100             |       6.31 |   0.62 | 15.25 |   10.74 |  4.22 |       0.06 |
| startWorker/default              |       0.62 |   0.01 |  1.86 |    5.27 |  0.38 |       0.03 |
| startWorker/batch100             |       1.02 |   0.03 |  1.44 |    1.17 |  0.66 |       0.06 |
| extendWorkerLease/default        |       0.41 |   0.01 |  2.25 |    1.34 |  0.34 |       0.02 |
| stopWorker/default               |       0.36 |   0.01 |  1.38 |    1.37 |  0.32 |       0.03 |
| startJobAttempts/default         |       0.64 |   0.03 |  2.54 |    1.52 |  0.22 |       0.02 |
| startJobAttempts/limit100        |       5.68 |   1.07 |  6.51 |    8.33 |  1.68 |       0.09 |
| startJobAttempts/batchLimit10    |       3.32 |   1.39 |  7.82 |    6.41 |  2.19 |       0.07 |
| startJobAttempts/batch100        |       1.23 |   0.20 |  4.36 |    4.59 |  0.52 |       0.09 |
| completeJobs/default             |       0.93 |   0.04 |  1.40 |    1.76 |  0.38 |       0.03 |
| completeJobs/batch100            |       5.88 |   1.12 |  6.53 |    7.56 |  4.32 |       0.09 |
| getStartAttemptDelayMs/default   |       0.80 |   0.02 |  0.81 |    0.75 |  0.39 |       0.06 |
| getStartAttemptDelayMs/batch100  |       0.70 |   0.04 |  4.16 |    6.11 |  1.18 |       0.04 |
| rescheduleJobs/default           |       0.51 |   0.03 |  2.82 |    2.17 |  0.38 |       0.05 |
| rescheduleJobs/batch100          |       2.97 |   0.92 | 18.89 |    4.58 |  4.18 |       0.10 |
| deleteChains/default             |       2.92 |   0.13 |  2.49 |    1.98 |  0.76 |       0.13 |
| deleteChains/multiJob            |       2.49 |   0.04 |  2.31 |    2.76 |  0.88 |       0.02 |
| deleteChains/batch100            |      63.74 |   0.94 |  7.33 |    5.52 |  3.04 |       0.06 |

## Type discovery & counts, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default           |       0.48 |   0.05 |  0.57 |    0.32 |  1.63 |       0.05 |
| getJobTypeNames/default             |       0.53 |   0.04 |  0.30 |    0.25 |  0.30 |       0.05 |
| countChainsByTypeName/default       |       1.80 |   0.61 |  4.18 |    5.69 |  0.49 |       0.05 |
| countChainsByTypeName/batch100      |       0.86 |   0.15 |  5.02 |    5.26 |  0.58 |       0.04 |
| countJobsByTypeName/default         |       1.78 |   0.59 |  4.89 |    5.49 |  0.41 |       0.04 |
| countJobsByTypeName/batch100        |       1.15 |   0.19 | 12.21 |   12.10 |  0.76 |       0.03 |
| countWorkers/default                |       0.27 |   0.01 |  0.25 |    0.32 |  0.22 |       0.05 |
| countWorkersByTypeName/default      |       0.28 |   0.59 |  1.17 |    1.50 |  0.42 |       0.20 |
| countWorkersByTypeName/batch100     |       1.58 |   0.56 |  1.22 |    2.83 |  0.41 |       0.12 |
| countRunningJobsByWorkerId/default  |       0.30 |   0.01 |  0.26 |    0.53 |  0.19 |       0.04 |
| countRunningJobsByWorkerId/batch100 |       5.13 |   0.06 |  0.34 |    0.40 |  0.33 |       0.06 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.48 |   0.38 |  0.46 |    0.73 |  0.65 |     275.64 |
| listChains/noStatus/nonBlocking               |       0.51 |   0.36 |  0.47 |    0.60 |  1.02 |     271.55 |
| listChains/noStatus/blocking                  |       0.29 |   0.10 |  0.23 |    0.43 |  0.14 |      16.74 |
| listChains/noStatus/fromTo                    |       0.44 |   0.24 |  0.42 |    0.69 |  0.70 |       0.07 |
| listChains/noStatus/cursor                    |       0.76 |   0.35 |  0.70 |    1.06 |  1.20 |       0.11 |
| listChains/running/default                    |       0.45 |   0.16 |  0.55 |    0.57 |  0.55 |     244.79 |
| listChains/running/nonBlocking                |       0.54 |   0.16 |  0.52 |    0.58 |  0.98 |     242.03 |
| listChains/running/blocking                   |       0.32 |   0.11 |  0.28 |    0.47 |  0.14 |      15.19 |
| listChains/running/cursor                     |       0.75 |   0.33 |  2.25 |    1.12 |  3.12 |       1.50 |
| listChains/completed/default                  |       0.44 |   0.18 |  0.56 |    0.67 |  0.62 |      59.49 |
| listChains/completed/nonBlocking              |       0.57 |   0.16 |  0.46 |    0.64 |  0.93 |      56.47 |
| listChains/completed/blocking                 |       0.32 |   0.10 |  0.25 |    0.41 |  0.13 |      14.84 |
| listChains/completed/orderByCreatedAt         |       0.45 |   0.17 |  0.61 |    0.68 |  0.73 |      42.52 |
| listChains/completed/orderByCompletedAt       |       0.47 |   0.18 |  0.49 |    0.68 |  0.62 |       0.03 |
| listChains/completed/cursor                   |       0.97 |   0.31 |  0.90 |    1.28 |  1.21 |       0.05 |
| listChains/completed/orderByCreatedAtCursor   |       0.93 |   0.31 |  1.47 |    0.87 |  1.10 |       0.04 |
| listChains/completed/orderByCompletedAtCursor |       0.86 |   0.39 |  1.57 |    1.12 |  1.71 |       0.04 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.60 |   0.39 |  0.64 |    0.73 |  0.46 |     403.92 |
| listJobs/noStatus/fromTo            |       0.57 |   0.37 |  0.50 |    0.47 |  0.45 |       0.05 |
| listJobs/noStatus/cursor            |       1.15 |   0.37 |  1.00 |    0.79 |  1.00 |       0.11 |
| listJobs/pending/default            |       0.62 |   0.21 |  0.63 |    0.36 |  0.43 |     245.39 |
| listJobs/pending/fromTo             |       6.85 |   0.20 |  0.49 |    0.38 |  0.39 |       0.08 |
| listJobs/pending/orderByCreatedAt   |       0.50 |   0.19 |  0.52 |    0.35 |  0.39 |     194.63 |
| listJobs/pending/cursor             |       0.93 |   0.38 |  0.98 |    0.61 |  0.80 |       0.10 |
| listJobs/blocked/default            |       0.54 |   0.24 |  0.31 |    0.30 |  0.39 |     166.10 |
| listJobs/blocked/fromTo             |       0.51 |   0.17 |  0.36 |    0.34 |  0.40 |       0.05 |
| listJobs/blocked/orderByCreatedAt   |       0.49 |   2.01 |  0.34 |    0.35 |  0.37 |     159.85 |
| listJobs/blocked/cursor             |       0.97 |   0.27 |  0.56 |    0.60 |  2.64 |       0.07 |
| listJobs/running/default            |       0.54 |   0.42 |  0.30 |    0.33 |  0.37 |      44.61 |
| listJobs/running/orderByCreatedAt   |       0.52 |   0.25 |  0.31 |    0.35 |  0.53 |      47.78 |
| listJobs/running/cursor             |       7.09 |   0.99 |  0.53 |    0.57 |  0.84 |       0.17 |
| listJobs/completed/default          |       0.64 |   0.14 |  0.31 |    0.34 |  0.41 |     113.73 |
| listJobs/completed/orderByCreatedAt |       0.84 |   0.14 |  0.36 |    0.76 |  0.39 |      83.49 |
| listJobs/completed/cursor           |       1.12 |   0.25 |  0.54 |    0.96 |  0.85 |       0.08 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       2.25 |   0.63 |   0.54 |    1.15 |  0.73 |       0.04 |
| listChainJobs/cursor    |       3.93 |   1.20 |   0.89 |    1.93 |  1.56 |       0.05 |
| listBlockedJobs/default |     128.98 | 127.18 | 142.75 |  110.93 |  0.39 |       0.08 |
| listBlockedJobs/cursor  |     236.85 | 253.23 | 320.85 |  251.86 |  0.93 |       0.03 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.56 |   0.06 |  0.67 |    0.36 |  0.35 |       0.20 |
| listWorkers/typeName   |       0.35 |   0.09 |  0.81 |    0.35 |  0.26 |       0.03 |
| listWorkers/status     |       0.24 |   0.04 |  0.32 |    0.24 |  4.72 |       0.02 |
| listWorkers/cursor     |       0.60 |   0.09 |  0.75 |    0.67 |  0.82 |       0.09 |
| listWorkerJobs/default |       0.38 |   0.16 |  0.38 |    0.63 |  0.42 |       0.05 |
| listWorkerJobs/cursor  |       3.64 |   0.18 |  0.74 |    1.78 |  0.86 |       0.03 |
