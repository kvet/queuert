# Query performance

Last run 2026-11-21 · commit ae6ebc02 · load average 5.05 · In-process at scale 100

## Operational queries, p50 (ms)

| Query                          | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ------------------------------ | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default              |       0.34 |   0.04 |  1.15 |    0.37 |  0.62 |       0.00 |
| getChains/lock                 |       0.76 |   0.02 |  1.56 |    1.15 |  0.57 |       0.00 |
| getChainTails/default          |       0.32 |   0.01 |  0.80 |    0.24 |  0.49 |       0.00 |
| getChainTails/lock             |       0.70 |   0.02 |  1.27 |    0.74 |  0.64 |       0.00 |
| getJobs/default                |       0.30 |   0.02 |  0.26 |    0.22 |  0.17 |       0.00 |
| getJobs/lock                   |       0.75 |   0.01 |  0.88 |    0.68 |  0.32 |       0.00 |
| getWorkers/default             |       0.22 |   0.01 |  0.23 |    0.21 |  0.18 |       0.00 |
| getWorkers/lock                |       0.61 |   0.01 |  0.72 |    0.65 |  0.18 |       0.00 |
| createJobs/default             |       0.92 |   0.03 |  1.28 |    1.39 |  0.24 |       0.01 |
| createJobs/deduplication       |       0.54 |   0.07 |  0.93 |    0.65 |  0.41 |       0.00 |
| continueJobs/default           |       0.91 |   0.06 |  1.50 |    1.81 |  0.38 |       0.01 |
| addJobsBlockers/default        |       1.06 |   0.05 |  1.44 |    1.56 |  0.50 |       0.00 |
| getJobBlockers/default         |       0.26 |   0.05 |  0.19 |    0.22 |  0.41 |       0.00 |
| unblockJobs/default            |       0.84 |   0.08 |  1.39 |    1.48 |  0.47 |       0.00 |
| startWorker/default            |       0.31 |   0.01 |  0.68 |    0.70 |  0.29 |       0.00 |
| extendWorkerLease/default      |       0.30 |   0.01 |  1.18 |    1.22 |  0.29 |       0.00 |
| stopWorker/default             |       0.25 |   0.01 |  1.12 |    1.05 |  0.27 |       0.00 |
| startJobAttempts/default       |       0.49 |   0.02 |  1.64 |    1.91 |  0.17 |       0.00 |
| startJobAttempts/limit10       |       0.76 |   0.11 |  1.88 |    2.16 |  0.36 |       0.01 |
| completeJobs/default           |       0.73 |   0.04 |  1.80 |    1.52 |  0.37 |       0.00 |
| getStartAttemptDelayMs/default |       0.52 |   0.01 |  0.59 |    0.74 |  0.32 |       0.00 |
| rescheduleJobs/default         |       0.41 |   0.02 |  1.44 |    1.68 |  0.31 |       0.00 |
| deleteChains/default           |       1.73 |   0.04 |  1.82 |    1.70 |  0.57 |       0.01 |
| deleteChains/multiJob          |       1.90 |   0.04 |  1.73 |    1.63 |  0.71 |       0.00 |

## Type discovery & counts, p50 (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default          |       0.43 |   0.03 |  0.27 |    0.25 |  0.18 |       0.01 |
| getJobTypeNames/default            |       0.44 |   0.03 |  0.22 |    0.21 |  0.20 |       0.01 |
| countChainsByTypeName/default      |       1.61 |   0.54 |  4.30 |    5.72 |  0.18 |       0.00 |
| countJobsByTypeName/default        |       1.64 |   0.55 |  4.38 |    5.52 |  0.17 |       0.00 |
| countWorkers/default               |       0.20 |   0.01 |  0.21 |    0.23 |  0.16 |       0.00 |
| countWorkersByTypeName/default     |       0.21 |   0.03 |  0.31 |    0.30 |  0.18 |       0.01 |
| countRunningJobsByWorkerId/default |       0.22 |   0.01 |  0.21 |    0.23 |  0.13 |       0.00 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.47 |   0.15 |  0.49 |    0.56 |  0.53 |       0.01 |
| listChains/noStatus/nonBlocking               |       0.52 |   0.15 |  0.56 |    0.67 |  0.86 |       0.01 |
| listChains/noStatus/blocking                  |       0.29 |   0.09 |  0.28 |    0.44 |  0.12 |       0.00 |
| listChains/noStatus/fromTo                    |       0.46 |   0.16 |  0.45 |    0.47 |  0.50 |       0.01 |
| listChains/noStatus/cursor                    |       0.81 |   0.28 |  0.84 |    0.94 |  1.11 |       0.01 |
| listChains/running/default                    |       0.44 |   0.17 |  0.65 |    0.53 |  0.55 |       0.01 |
| listChains/running/nonBlocking                |       0.53 |   0.16 |  0.57 |    0.50 |  0.90 |       0.01 |
| listChains/running/blocking                   |       0.29 |   0.09 |  0.30 |    0.33 |  0.13 |       0.00 |
| listChains/running/cursor                     |       0.79 |   0.29 |  1.05 |    0.89 |  1.06 |       0.02 |
| listChains/completed/default                  |       0.44 |   0.16 |  0.50 |    0.49 |  0.57 |       0.01 |
| listChains/completed/nonBlocking              |       0.49 |   0.15 |  0.44 |    0.50 |  1.05 |       0.01 |
| listChains/completed/blocking                 |       0.29 |   0.09 |  0.25 |    0.36 |  0.14 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.45 |   0.16 |  0.49 |    0.48 |  0.55 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.44 |   0.15 |  0.51 |    0.54 |  0.57 |       0.00 |
| listChains/completed/cursor                   |       0.77 |   0.30 |  0.88 |    0.91 |  1.11 |       0.01 |
| listChains/completed/orderByCreatedAtCursor   |       0.72 |   0.29 |  1.04 |    0.87 |  1.12 |       0.01 |
| listChains/completed/orderByCompletedAtCursor |       0.77 |   0.28 |  0.96 |    0.92 |  1.09 |       0.02 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.41 |   0.15 |  0.49 |    0.44 |  0.48 |       0.01 |
| listJobs/noStatus/fromTo            |       0.43 |   0.22 |  0.40 |    0.36 |  0.55 |       0.01 |
| listJobs/noStatus/cursor            |       0.73 |   0.24 |  0.67 |    0.71 |  0.81 |       0.02 |
| listJobs/pending/default            |       0.38 |   0.12 |  0.34 |    0.30 |  0.36 |       0.01 |
| listJobs/pending/fromTo             |       0.37 |   0.14 |  0.34 |    0.32 |  0.37 |       0.03 |
| listJobs/pending/orderByCreatedAt   |       0.36 |   0.12 |  0.34 |    0.32 |  0.36 |       0.01 |
| listJobs/pending/cursor             |       0.66 |   0.24 |  0.57 |    0.57 |  0.75 |       0.01 |
| listJobs/blocked/default            |       0.37 |   0.12 |  0.32 |    0.29 |  0.36 |       0.01 |
| listJobs/blocked/fromTo             |       0.38 |   0.15 |  0.31 |    0.29 |  0.35 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.36 |   0.13 |  0.31 |    0.31 |  0.35 |       0.01 |
| listJobs/blocked/cursor             |       0.66 |   0.23 |  0.51 |    0.53 |  0.76 |       0.02 |
| listJobs/running/default            |       0.44 |   0.19 |  0.34 |    0.30 |  0.37 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.41 |   0.13 |  0.31 |    0.33 |  0.35 |       0.01 |
| listJobs/running/cursor             |       6.34 |   0.38 |  0.55 |    0.56 |  0.74 |       0.01 |
| listJobs/completed/default          |       0.53 |   0.13 |  0.31 |    0.32 |  0.38 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.51 |   0.14 |  0.34 |    0.33 |  0.36 |       0.01 |
| listJobs/completed/cursor           |       0.95 |   0.23 |  0.60 |    0.62 |  0.74 |       0.01 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.62 |   0.56 |   0.30 |    0.69 |  0.37 |       0.01 |
| listChainJobs/cursor    |       2.89 |   1.10 |   0.58 |    1.21 |  1.14 |       0.01 |
| listBlockedJobs/default |     113.72 | 134.19 | 142.55 |  105.60 |  0.40 |       0.01 |
| listBlockedJobs/cursor  |     199.58 | 264.83 | 271.00 |  212.64 |  0.86 |       0.01 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.45 |   0.05 |  0.37 |    0.32 |  0.35 |       0.02 |
| listWorkers/typeName   |       0.30 |   0.03 |  0.28 |    0.25 |  0.26 |       0.00 |
| listWorkers/status     |       0.25 |   0.03 |  0.21 |    0.21 |  1.25 |       0.00 |
| listWorkers/cursor     |       0.59 |   0.08 |  0.48 |    0.45 |  0.73 |       0.03 |
| listWorkerJobs/default |       0.34 |   0.09 |  0.29 |    0.29 |  0.32 |       0.00 |
| listWorkerJobs/cursor  |       0.65 |   0.17 |  0.56 |    0.51 |  0.57 |       0.01 |

## Operational queries, max (ms)

| Query                          | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ------------------------------ | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default              |       0.50 |   0.06 |  1.35 |    0.43 |  0.85 |       0.10 |
| getChains/lock                 |       0.99 |   0.03 |  2.01 |    1.65 |  0.82 |       0.03 |
| getChainTails/default          |       0.40 |   0.02 |  0.98 |    0.35 |  0.79 |       0.04 |
| getChainTails/lock             |       0.76 |   0.02 |  1.42 |    1.10 |  0.72 |       0.02 |
| getJobs/default                |       0.33 |   0.02 |  0.29 |    0.24 |  0.20 |       0.03 |
| getJobs/lock                   |       0.84 |   0.02 |  1.53 |    0.72 |  0.34 |       0.02 |
| getWorkers/default             |       0.25 |   0.03 |  0.32 |    0.24 |  0.21 |       0.03 |
| getWorkers/lock                |       0.70 |   0.02 |  0.86 |    0.70 |  0.19 |       0.02 |
| createJobs/default             |       1.17 |   0.05 |  6.48 |    2.21 |  0.42 |       0.05 |
| createJobs/deduplication       |       0.67 |   0.19 |  1.35 |    0.86 |  0.57 |       0.03 |
| continueJobs/default           |       1.05 |   0.07 |  1.80 |    4.64 |  0.43 |       0.04 |
| addJobsBlockers/default        |       1.21 |   0.06 |  1.64 |    1.68 |  0.55 |       0.03 |
| getJobBlockers/default         |       0.34 |   0.05 |  0.22 |    1.47 |  0.49 |       0.03 |
| unblockJobs/default            |       0.92 |   0.12 |  2.85 |    1.89 |  0.81 |       0.02 |
| startWorker/default            |       0.33 |   0.01 |  0.81 |    1.90 |  0.38 |       0.01 |
| extendWorkerLease/default      |       0.41 |   0.01 |  1.72 |    1.39 |  0.35 |       0.01 |
| stopWorker/default             |       0.27 |   0.01 |  1.45 |    1.35 |  0.33 |       0.03 |
| startJobAttempts/default       |       0.53 |   0.03 |  2.09 |    3.83 |  0.25 |       0.01 |
| startJobAttempts/limit10       |       0.92 |   0.31 |  2.09 |    2.95 |  0.65 |       0.02 |
| completeJobs/default           |       0.88 |   0.05 | 12.94 |    2.65 |  0.49 |       0.02 |
| getStartAttemptDelayMs/default |       0.58 |   0.02 |  0.64 |    0.79 |  0.37 |       0.04 |
| rescheduleJobs/default         |       0.51 |   0.03 |  1.80 |    1.93 |  0.36 |       0.06 |
| deleteChains/default           |       2.30 |   0.05 |  2.33 |    2.41 |  0.63 |       0.28 |
| deleteChains/multiJob          |       2.55 |   0.05 |  2.57 |    2.15 |  0.73 |       0.02 |

## Type discovery & counts, max (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default          |       0.55 |   0.03 |  0.31 |    0.39 |  0.20 |       0.05 |
| getJobTypeNames/default            |       0.47 |   0.09 |  0.27 |    0.25 |  0.41 |       0.04 |
| countChainsByTypeName/default      |       1.79 |   0.58 |  4.58 |    7.04 |  0.25 |       0.05 |
| countJobsByTypeName/default        |       1.79 |   0.58 |  4.62 |    5.90 |  0.22 |       0.03 |
| countWorkers/default               |       0.25 |   0.01 |  0.31 |    0.31 |  0.20 |       0.03 |
| countWorkersByTypeName/default     |       0.29 |   0.03 |  0.55 |    0.41 |  0.33 |       0.05 |
| countRunningJobsByWorkerId/default |       0.26 |   0.02 |  0.27 |    0.38 |  0.13 |       0.02 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.60 |   0.19 |  0.57 |    0.77 |  0.56 |     374.76 |
| listChains/noStatus/nonBlocking               |       0.67 |   0.20 |  1.47 |    1.88 |  1.01 |     365.23 |
| listChains/noStatus/blocking                  |       0.61 |   0.09 |  0.36 |    0.68 |  0.13 |      45.78 |
| listChains/noStatus/fromTo                    |       0.60 |   0.18 |  0.50 |    0.81 |  0.63 |       0.09 |
| listChains/noStatus/cursor                    |       0.90 |   0.29 |  0.89 |    1.64 |  1.22 |       0.08 |
| listChains/running/default                    |       0.55 |   0.23 |  1.26 |    0.60 |  0.64 |     328.03 |
| listChains/running/nonBlocking                |       1.66 |   0.17 |  0.98 |    0.68 |  1.18 |     318.07 |
| listChains/running/blocking                   |       0.30 |   0.09 |  0.72 |    0.34 |  0.14 |      42.49 |
| listChains/running/cursor                     |       0.86 |   0.31 |  1.58 |    0.98 |  1.18 |       0.10 |
| listChains/completed/default                  |       0.52 |   0.20 |  0.77 |    0.51 |  0.68 |      97.83 |
| listChains/completed/nonBlocking              |       0.60 |   0.45 |  0.46 |    0.63 |  3.41 |      95.50 |
| listChains/completed/blocking                 |       0.33 |   0.10 |  0.44 |    0.48 |  0.15 |      40.43 |
| listChains/completed/orderByCreatedAt         |       0.64 |   0.16 |  0.53 |    0.53 |  0.63 |      78.90 |
| listChains/completed/orderByCompletedAt       |       0.83 |   0.19 |  0.57 |    0.81 |  0.68 |       0.03 |
| listChains/completed/cursor                   |       0.94 |   0.39 |  1.05 |    0.99 |  1.45 |       0.05 |
| listChains/completed/orderByCreatedAtCursor   |       0.97 |   0.33 |  1.72 |    0.96 |  1.22 |       0.03 |
| listChains/completed/orderByCompletedAtCursor |       0.97 |   0.35 |  1.21 |    1.22 |  1.47 |       0.02 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.48 |   0.28 |  0.67 |    0.54 |  0.59 |     427.11 |
| listJobs/noStatus/fromTo            |       0.47 |   0.37 |  0.65 |    0.45 |  0.98 |       0.05 |
| listJobs/noStatus/cursor            |       0.83 |   0.26 |  0.75 |    0.76 |  0.98 |       0.15 |
| listJobs/pending/default            |       0.43 |   0.12 |  0.54 |    0.33 |  0.40 |     254.95 |
| listJobs/pending/fromTo             |       0.41 |   0.29 |  0.42 |    0.37 |  0.55 |       0.13 |
| listJobs/pending/orderByCreatedAt   |       0.43 |   0.14 |  0.36 |    0.35 |  0.44 |     189.79 |
| listJobs/pending/cursor             |       0.71 |   0.37 |  0.66 |    0.72 |  0.96 |       0.08 |
| listJobs/blocked/default            |       0.43 |   0.13 |  0.40 |    0.35 |  0.38 |     167.19 |
| listJobs/blocked/fromTo             |       0.51 |   0.22 |  0.33 |    0.32 |  0.62 |       0.05 |
| listJobs/blocked/orderByCreatedAt   |       0.37 |   0.15 |  0.35 |    0.35 |  0.36 |     167.79 |
| listJobs/blocked/cursor             |       0.70 |   0.24 |  0.55 |    0.57 |  1.18 |       0.08 |
| listJobs/running/default            |       0.57 |   0.22 |  0.50 |    0.32 |  0.48 |      44.55 |
| listJobs/running/orderByCreatedAt   |       0.48 |   0.16 |  0.37 |    0.54 |  0.37 |      43.29 |
| listJobs/running/cursor             |      10.89 |   0.50 |  0.66 |    0.59 |  0.91 |       0.07 |
| listJobs/completed/default          |       0.62 |   0.13 |  0.35 |    0.35 |  2.14 |     126.56 |
| listJobs/completed/orderByCreatedAt |       0.59 |   0.17 |  0.38 |    0.37 |  0.63 |      94.71 |
| listJobs/completed/cursor           |       1.27 |   0.25 |  0.62 |    0.71 |  0.83 |       0.08 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       2.43 |   1.06 |   0.32 |    0.75 |  0.42 |       0.04 |
| listChainJobs/cursor    |       3.48 |   1.26 |   0.62 |    1.73 |  2.01 |       0.05 |
| listBlockedJobs/default |     141.16 | 152.43 | 170.49 |  120.95 |  0.44 |       0.08 |
| listBlockedJobs/cursor  |     229.14 | 268.48 | 274.18 |  217.86 |  1.33 |       0.03 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.65 |   2.23 |  0.50 |    0.46 |  0.38 |       0.19 |
| listWorkers/typeName   |       0.45 |   0.03 |  0.38 |    0.30 |  0.36 |       0.03 |
| listWorkers/status     |       0.34 |   0.03 |  0.24 |    0.29 |  1.33 |       0.01 |
| listWorkers/cursor     |       0.70 |   0.10 |  0.52 |    0.46 |  0.77 |       0.20 |
| listWorkerJobs/default |       0.39 |   0.11 |  0.32 |    0.32 |  0.35 |       0.04 |
| listWorkerJobs/cursor  |       1.22 |   0.17 |  0.76 |    0.56 |  0.60 |       0.03 |
