# Query performance

Last run 2026-11-18 · commit 2748cec8 · load average 3.71 · MariaDB at scale 100

## Operational queries, p50 (ms)

| Query                          | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ------------------------------ | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default              |       0.32 |   0.03 |  1.11 |    0.40 |  1.50 |       0.01 |
| getChains/lock                 |       0.80 |   0.02 |  1.52 |    1.08 |  0.83 |       0.00 |
| getJobs/default                |       0.41 |   0.02 |  0.29 |    0.25 |  0.23 |       0.00 |
| getJobs/lock                   |       0.76 |   0.01 |  0.70 |    0.70 |  0.31 |       0.00 |
| getWorkers/default             |       0.19 |   0.01 |  0.23 |    0.22 |  0.17 |       0.00 |
| getWorkers/lock                |       0.63 |   0.01 |  0.66 |    0.69 |  0.17 |       0.00 |
| createJobs/default             |       0.90 |   0.04 |  1.37 |    1.45 |  0.24 |       0.01 |
| createJobs/deduplication       |       0.55 |   0.06 |  0.61 |    0.68 |  0.46 |       0.01 |
| continueJobs/default           |       0.85 |   0.06 |  1.49 |    1.89 |  0.39 |       0.01 |
| addJobsBlockers/default        |       0.96 |   0.06 |  1.47 |    1.66 |  0.52 |       0.01 |
| getJobBlockers/default         |       0.21 |   0.05 |  0.21 |    0.24 |  0.45 |       0.00 |
| unblockJobs/default            |       1.03 |   0.07 |  1.14 |    1.26 |  0.39 |       0.00 |
| startWorker/default            |       0.30 |   0.01 |  0.76 |    0.81 |  0.27 |       0.00 |
| extendWorkerLease/default      |       0.26 |   0.01 |  1.09 |    1.24 |  0.29 |       0.00 |
| stopWorker/default             |       0.25 |   0.01 |  1.01 |    0.98 |  0.25 |       0.00 |
| startJobAttempts/default       |       0.44 |   0.02 |  1.45 |    1.65 |  0.15 |       0.00 |
| startJobAttempts/limit10       |       0.72 |   0.10 |  1.78 |    1.86 |  0.37 |       0.01 |
| completeJobs/default           |       0.75 |   0.04 |  1.14 |    1.25 |  0.35 |       0.00 |
| getStartAttemptDelayMs/default |       0.93 |   0.01 |  0.56 |    0.63 |  0.30 |       0.00 |
| rescheduleJobs/default         |       0.63 |   0.02 |  1.40 |    1.40 |  0.29 |       0.00 |
| deleteChains/default           |       2.12 |   0.04 |  1.74 |    1.63 |  0.55 |       0.01 |
| deleteChains/multiJob          |       1.49 |   0.04 |  1.69 |    1.87 |  0.69 |       0.00 |

## Type discovery & counts, p50 (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default          |       0.40 |   0.03 |  0.27 |    0.27 |  0.17 |       0.01 |
| getJobTypeNames/default            |       0.41 |   0.03 |  0.21 |    0.20 |  0.17 |       0.01 |
| countChainsByTypeName/default      |       1.61 |   0.54 |  5.58 |    5.23 |  0.15 |       0.00 |
| countJobsByTypeName/default        |       1.52 |   0.53 |  4.07 |    5.44 |  0.15 |       0.00 |
| countWorkers/default               |       0.24 |   0.01 |  0.23 |    0.19 |  0.15 |       0.00 |
| countWorkersByTypeName/default     |       0.23 |   0.02 |  0.36 |    0.22 |  0.15 |       0.01 |
| countRunningJobsByWorkerId/default |       0.22 |   0.01 |  0.25 |    0.18 |  0.13 |       0.00 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.41 |   0.15 |  0.41 |    0.52 |  0.95 |       0.01 |
| listChains/noStatus/nonBlocking               |       0.46 |   0.15 |  0.43 |    0.55 |  1.20 |       0.01 |
| listChains/noStatus/blocking                  |       0.26 |   0.08 |  0.24 |    0.39 |  0.22 |       0.00 |
| listChains/noStatus/fromTo                    |       0.45 |   0.16 |  0.38 |    0.47 |  0.80 |       0.01 |
| listChains/noStatus/cursor                    |       0.81 |   0.27 |  0.65 |    0.93 |  1.39 |       0.01 |
| listChains/running/default                    |       0.48 |   0.15 |  0.47 |    0.53 |  0.66 |       0.01 |
| listChains/running/nonBlocking                |       0.56 |   0.15 |  0.40 |    0.54 |  1.72 |       0.01 |
| listChains/running/blocking                   |       0.48 |   0.08 |  0.25 |    0.31 |  0.18 |       0.00 |
| listChains/running/cursor                     |       0.76 |   0.27 |  0.79 |    0.80 |  1.06 |       0.02 |
| listChains/completed/default                  |       0.41 |   0.15 |  0.47 |    0.48 |  0.53 |       0.01 |
| listChains/completed/nonBlocking              |       0.48 |   0.15 |  0.42 |    0.47 |  0.87 |       0.01 |
| listChains/completed/blocking                 |       0.29 |   0.08 |  0.24 |    0.31 |  0.12 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.39 |   0.15 |  0.45 |    0.48 |  0.52 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.38 |   0.15 |  0.45 |    0.47 |  0.53 |       0.00 |
| listChains/completed/cursor                   |       0.71 |   0.28 |  0.78 |    0.89 |  1.12 |       0.01 |
| listChains/completed/orderByCreatedAtCursor   |       0.70 |   0.30 |  0.81 |    0.93 |  1.11 |       0.01 |
| listChains/completed/orderByCompletedAtCursor |       0.68 |   0.28 |  0.80 |    0.95 |  1.10 |       0.01 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.54 |   0.13 |  0.39 |    0.38 |  0.42 |       0.01 |
| listJobs/noStatus/fromTo            |       0.49 |   0.13 |  0.35 |    0.34 |  0.54 |       0.01 |
| listJobs/noStatus/cursor            |       0.69 |   0.22 |  0.62 |    0.92 |  0.85 |       0.02 |
| listJobs/pending/default            |       0.41 |   0.11 |  0.29 |    0.45 |  0.37 |       0.01 |
| listJobs/pending/fromTo             |       0.39 |   0.12 |  0.29 |    0.32 |  0.38 |       0.01 |
| listJobs/pending/orderByCreatedAt   |       0.39 |   0.12 |  0.34 |    0.38 |  0.38 |       0.01 |
| listJobs/pending/cursor             |       0.72 |   0.22 |  0.54 |    0.61 |  0.82 |       0.02 |
| listJobs/blocked/default            |       0.36 |   0.11 |  0.28 |    0.34 |  0.41 |       0.01 |
| listJobs/blocked/fromTo             |       0.39 |   0.13 |  0.32 |    0.35 |  0.37 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.41 |   0.12 |  0.31 |    0.33 |  0.42 |       0.01 |
| listJobs/blocked/cursor             |       0.86 |   0.23 |  0.52 |    0.58 |  0.87 |       0.01 |
| listJobs/running/default            |       0.42 |   0.19 |  0.29 |    0.32 |  0.38 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.38 |   0.12 |  0.34 |    0.32 |  0.37 |       0.01 |
| listJobs/running/cursor             |       5.65 |   0.35 |  0.53 |    0.63 |  0.79 |       0.02 |
| listJobs/completed/default          |       0.49 |   0.13 |  0.30 |    0.38 |  0.38 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.46 |   0.13 |  0.35 |    0.33 |  0.41 |       0.01 |
| listJobs/completed/cursor           |       0.87 |   0.24 |  0.55 |    0.55 |  1.20 |       0.02 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.31 |   0.66 |   0.37 |    0.65 |  0.36 |       0.01 |
| listChainJobs/cursor    |       2.58 |   1.11 |   0.52 |    1.16 |  0.87 |       0.01 |
| listBlockedJobs/default |      94.27 | 133.04 | 136.15 |  107.66 |  0.36 |       0.01 |
| listBlockedJobs/cursor  |     190.09 | 261.61 | 254.98 |  207.63 |  0.75 |       0.02 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.43 |   0.05 |  0.38 |    0.42 |  0.33 |       0.02 |
| listWorkers/typeName   |       0.22 |   0.03 |  0.27 |    0.25 |  0.24 |       0.00 |
| listWorkers/status     |       0.23 |   0.03 |  0.23 |    0.25 |  1.25 |       0.00 |
| listWorkers/cursor     |       0.47 |   0.09 |  0.48 |    0.43 |  0.76 |       0.04 |
| listWorkerJobs/default |       0.37 |   0.09 |  0.28 |    0.26 |  0.30 |       0.00 |
| listWorkerJobs/cursor  |       0.69 |   0.16 |  0.48 |    0.53 |  0.55 |       0.01 |

## Operational queries, max (ms)

| Query                          | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ------------------------------ | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default              |       0.38 |   0.05 |  1.31 |    0.64 |  2.38 |       0.13 |
| getChains/lock                 |       1.05 |   0.03 |  3.46 |    1.52 |  1.37 |       0.04 |
| getJobs/default                |       0.59 |   0.02 |  0.51 |    0.31 |  0.38 |       0.04 |
| getJobs/lock                   |       0.96 |   0.02 |  0.74 |    0.82 |  0.33 |       1.84 |
| getWorkers/default             |       0.24 |   0.02 |  0.25 |    0.27 |  0.21 |       0.04 |
| getWorkers/lock                |       1.13 |   0.02 |  0.68 |    0.81 |  0.18 |       0.02 |
| createJobs/default             |       1.11 |   0.22 |  2.11 |    2.09 |  0.26 |       0.04 |
| createJobs/deduplication       |       0.62 |   0.11 |  0.75 |    0.95 |  0.51 |       0.03 |
| continueJobs/default           |       1.00 |   0.25 |  2.84 |    2.23 |  0.42 |       0.05 |
| addJobsBlockers/default        |       1.15 |   0.25 |  1.55 |    2.55 |  0.55 |       0.05 |
| getJobBlockers/default         |       0.29 |   0.06 |  0.24 |    0.33 |  0.49 |       0.04 |
| unblockJobs/default            |       1.18 |   0.12 |  1.19 |    1.42 |  0.45 |       0.02 |
| startWorker/default            |       0.34 |   0.01 |  0.81 |    0.95 |  0.28 |       0.01 |
| extendWorkerLease/default      |       0.32 |   0.01 |  1.25 |    1.50 |  0.32 |       0.01 |
| stopWorker/default             |       0.27 |   0.01 |  1.10 |    1.10 |  0.30 |       0.03 |
| startJobAttempts/default       |       0.54 |   0.03 |  1.76 |    1.80 |  0.19 |       0.01 |
| startJobAttempts/limit10       |       1.50 |   0.29 |  1.98 |    2.25 |  0.41 |       0.02 |
| completeJobs/default           |       0.91 |   0.04 |  1.38 |    1.48 |  0.53 |       0.02 |
| getStartAttemptDelayMs/default |       1.38 |   0.02 |  0.60 |    0.68 |  0.32 |       0.04 |
| rescheduleJobs/default         |       0.95 |   0.03 |  1.56 |    1.52 |  0.35 |       0.05 |
| deleteChains/default           |       4.61 |   0.05 |  3.26 |    1.99 |  0.63 |       0.11 |
| deleteChains/multiJob          |       1.67 |   0.06 |  3.07 |    2.82 |  0.86 |       0.02 |

## Type discovery & counts, max (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default          |       0.47 |   0.03 |  0.30 |    0.29 |  0.18 |       0.04 |
| getJobTypeNames/default            |       0.54 |   0.03 |  0.23 |    0.23 |  0.18 |       0.04 |
| countChainsByTypeName/default      |       1.79 |   0.57 |  6.26 |    5.51 |  0.16 |       0.05 |
| countJobsByTypeName/default        |       1.74 |   0.56 |  4.98 |    6.01 |  0.16 |       0.04 |
| countWorkers/default               |       0.27 |   0.01 |  0.39 |    0.21 |  0.18 |       0.03 |
| countWorkersByTypeName/default     |       0.30 |   0.03 |  0.39 |    0.25 |  0.16 |       0.04 |
| countRunningJobsByWorkerId/default |       0.27 |   0.02 |  0.38 |    0.21 |  0.15 |       0.02 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.48 |   0.20 |  0.48 |    0.70 |  3.32 |     349.44 |
| listChains/noStatus/nonBlocking               |       0.54 |   0.23 |  0.48 |    0.64 |  1.72 |     341.30 |
| listChains/noStatus/blocking                  |       0.29 |   0.09 |  0.26 |    0.47 |  0.31 |      38.02 |
| listChains/noStatus/fromTo                    |       0.48 |   0.19 |  0.42 |    0.57 |  1.50 |       0.10 |
| listChains/noStatus/cursor                    |       1.08 |   0.28 |  0.72 |    1.25 |  1.80 |       0.08 |
| listChains/running/default                    |       0.59 |   0.15 |  0.49 |    0.65 |  2.91 |     303.82 |
| listChains/running/nonBlocking                |       0.84 |   0.22 |  0.43 |    0.70 |  2.26 |     301.29 |
| listChains/running/blocking                   |       1.06 |   0.09 |  0.39 |    0.33 |  0.35 |      36.70 |
| listChains/running/cursor                     |       0.84 |   0.28 |  2.30 |    0.86 |  1.43 |       0.11 |
| listChains/completed/default                  |       0.58 |   0.15 |  0.53 |    0.51 |  0.54 |      89.14 |
| listChains/completed/nonBlocking              |       0.51 |   0.15 |  0.43 |    0.48 |  0.91 |      86.57 |
| listChains/completed/blocking                 |       0.34 |   0.12 |  0.25 |    0.33 |  0.14 |      37.86 |
| listChains/completed/orderByCreatedAt         |       0.45 |   0.16 |  0.48 |    0.52 |  0.58 |      76.35 |
| listChains/completed/orderByCompletedAt       |       0.41 |   0.17 |  0.48 |    0.50 |  0.59 |       0.05 |
| listChains/completed/cursor                   |       0.79 |   0.29 |  0.85 |    1.21 |  3.32 |       0.05 |
| listChains/completed/orderByCreatedAtCursor   |       0.76 |   0.42 |  0.83 |    1.17 |  1.58 |       0.03 |
| listChains/completed/orderByCompletedAtCursor |       0.71 |   0.30 |  0.98 |    1.88 |  1.28 |       0.04 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.74 |   0.16 |  0.66 |    0.45 |  0.44 |     375.78 |
| listJobs/noStatus/fromTo            |       0.79 |   0.15 |  0.42 |    0.40 |  0.78 |       0.04 |
| listJobs/noStatus/cursor            |       0.77 |   0.24 |  0.66 |    1.20 |  1.05 |       0.10 |
| listJobs/pending/default            |       0.44 |   0.11 |  0.32 |    0.73 |  0.39 |     226.67 |
| listJobs/pending/fromTo             |       0.42 |   0.13 |  0.32 |    0.36 |  0.44 |       0.05 |
| listJobs/pending/orderByCreatedAt   |       0.43 |   0.19 |  0.40 |    0.82 |  0.55 |     177.68 |
| listJobs/pending/cursor             |       0.82 |   0.23 |  0.58 |    0.69 |  1.06 |       0.09 |
| listJobs/blocked/default            |       0.43 |   0.12 |  0.30 |    0.41 |  0.57 |     157.59 |
| listJobs/blocked/fromTo             |       0.47 |   0.25 |  0.39 |    1.58 |  0.38 |       0.05 |
| listJobs/blocked/orderByCreatedAt   |       0.45 |   0.13 |  0.37 |    0.36 |  0.61 |     150.08 |
| listJobs/blocked/cursor             |       1.03 |   0.33 |  0.56 |    0.63 |  1.23 |       0.07 |
| listJobs/running/default            |       0.56 |   0.19 |  0.31 |    0.33 |  0.43 |      39.75 |
| listJobs/running/orderByCreatedAt   |       0.41 |   0.15 |  0.36 |    0.38 |  0.38 |      40.15 |
| listJobs/running/cursor             |       6.38 |   0.39 |  0.55 |    0.88 |  0.89 |       0.09 |
| listJobs/completed/default          |       0.55 |   0.18 |  0.33 |    0.75 |  0.56 |     113.49 |
| listJobs/completed/orderByCreatedAt |       0.54 |   0.14 |  0.37 |    0.35 |  1.48 |      86.17 |
| listJobs/completed/cursor           |       0.92 |   0.38 |  0.61 |    0.60 |  2.66 |       0.07 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       1.95 |   0.83 |   0.66 |    0.94 |  0.37 |       0.04 |
| listChainJobs/cursor    |       2.80 |   1.23 |   0.85 |    1.19 |  0.90 |       0.05 |
| listBlockedJobs/default |     105.87 | 144.40 | 146.89 |  116.44 |  0.38 |       0.08 |
| listBlockedJobs/cursor  |     237.29 | 270.97 | 264.04 |  223.38 |  0.81 |       0.04 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.49 |   0.06 |  0.56 |    0.95 |  0.36 |       0.17 |
| listWorkers/typeName   |       0.25 |   0.03 |  0.33 |    0.29 |  0.25 |       0.03 |
| listWorkers/status     |       0.29 |   0.03 |  0.26 |    0.35 |  1.29 |       0.01 |
| listWorkers/cursor     |       0.48 |   0.11 |  0.70 |    0.49 |  0.79 |       0.06 |
| listWorkerJobs/default |       0.52 |   0.10 |  0.31 |    0.34 |  0.52 |       0.04 |
| listWorkerJobs/cursor  |       0.79 |   0.18 |  0.51 |    0.60 |  0.57 |       0.03 |
