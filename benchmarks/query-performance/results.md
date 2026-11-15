# Query performance

Last run 2026-11-15 · commit e6c10f79 · load average 4.28 · Redis at scale 100

## Operational queries, p50 (ms)

| Query                          | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ------------------------------ | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default              |       0.69 |   0.05 |  1.64 |    0.54 |  0.98 |       0.01 |
| getChains/lock                 |       1.20 |   0.04 |  2.25 |    1.37 |  0.77 |       0.01 |
| getJobs/default                |       0.57 |   0.02 |  0.44 |    0.34 |  0.25 |       0.00 |
| getJobs/lock                   |       1.60 |   0.02 |  1.21 |    0.80 |  0.41 |       0.00 |
| getWorkers/default             |       0.35 |   0.02 |  0.34 |    0.25 |  0.22 |       0.00 |
| getWorkers/lock                |       0.88 |   0.02 |  1.15 |    0.71 |  0.22 |       0.00 |
| createJobs/default             |       1.51 |   0.06 |  2.14 |    2.06 |  0.34 |       0.01 |
| createJobs/deduplication       |       0.77 |   0.10 |  1.01 |    1.06 |  0.59 |       0.01 |
| continueJobs/default           |       1.37 |   0.09 |  2.66 |    2.95 |  0.54 |       0.01 |
| addJobsBlockers/default        |       1.63 |   0.08 |  2.51 |    2.31 |  0.66 |       0.01 |
| getJobBlockers/default         |       0.36 |   0.07 |  0.31 |    0.30 |  0.50 |       0.00 |
| unblockJobs/default            |       1.53 |   0.12 |  1.89 |    2.82 |  0.72 |       0.01 |
| startWorker/default            |       0.37 |   0.01 |  1.24 |    1.09 |  0.55 |       0.00 |
| extendWorkerLease/default      |       0.37 |   0.01 |  1.82 |    1.89 |  0.53 |       0.00 |
| stopWorker/default             |       0.37 |   0.01 |  1.90 |    1.61 |  0.51 |       0.00 |
| startJobAttempts/default       |       0.85 |   0.04 |  2.65 |    2.23 |  0.24 |       0.00 |
| startJobAttempts/limit10       |       1.37 |   0.15 |  3.82 |    3.07 |  0.52 |       0.01 |
| completeJobs/default           |       1.52 |   0.07 |  2.73 |    3.17 |  0.58 |       0.01 |
| getStartAttemptDelayMs/default |       0.96 |   0.02 |  1.72 |    1.22 |  0.44 |       0.00 |
| rescheduleJobs/default         |       0.77 |   0.03 |  2.48 |    3.82 |  0.46 |       0.00 |
| deleteChains/default           |       1.68 |   0.06 | 14.01 |    2.93 |  0.94 |       0.01 |
| deleteChains/multiJob          |       1.73 |   0.06 |  4.31 |    3.30 |  1.24 |       0.01 |

## Type discovery & counts, p50 (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default          |       0.58 |   0.05 |  0.56 |    0.52 |  0.37 |       0.01 |
| getJobTypeNames/default            |       0.64 |   0.05 |  0.36 |    0.30 |  0.30 |       0.02 |
| countChainsByTypeName/default      |       3.05 |   1.18 |  7.57 |    9.72 |  0.19 |       0.00 |
| countJobsByTypeName/default        |       3.29 |   1.20 |  8.06 |    9.53 |  0.20 |       0.01 |
| countWorkers/default               |       0.37 |   0.01 |  0.27 |    0.36 |  0.22 |       0.00 |
| countWorkersByTypeName/default     |       0.43 |   0.04 |  0.62 |    0.43 |  0.21 |       0.01 |
| countRunningJobsByWorkerId/default |       0.55 |   0.02 |  0.44 |    0.26 |  0.17 |       0.00 |

## List chains, p50 (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.64 |   0.26 |  0.77 |    0.95 |  0.78 |       0.01 |
| listChains/noStatus/independent               |       0.73 |   0.24 |  1.44 |    0.92 |  1.85 |       0.01 |
| listChains/noStatus/nonIndependent            |       0.49 |   0.14 |  0.63 |    0.56 |  0.19 |       0.00 |
| listChains/noStatus/fromTo                    |       0.62 |   0.26 |  1.15 |    0.94 |  0.80 |       0.01 |
| listChains/noStatus/cursor                    |       1.03 |   0.45 |  1.31 |    1.50 |  1.82 |       0.02 |
| listChains/running/default                    |       0.58 |   0.26 |  1.30 |    1.12 |  0.77 |       0.01 |
| listChains/running/independent                |       0.72 |   0.26 |  1.41 |    0.91 |  1.38 |       0.01 |
| listChains/running/nonIndependent             |       0.47 |   0.14 |  0.66 |    0.57 |  0.23 |       0.00 |
| listChains/running/cursor                     |       1.07 |   0.43 |  2.07 |    1.53 |  1.83 |       0.03 |
| listChains/completed/default                  |       0.56 |   0.24 |  1.30 |    0.91 |  1.38 |       0.01 |
| listChains/completed/independent              |       0.78 |   0.24 |  1.25 |    1.13 |  1.88 |       0.01 |
| listChains/completed/nonIndependent           |       0.47 |   0.14 |  0.63 |    0.72 |  0.29 |       0.00 |
| listChains/completed/orderByCreatedAt         |       0.60 |   0.24 |  1.27 |    0.98 |  0.80 |       0.01 |
| listChains/completed/orderByCompletedAt       |       0.63 |   0.28 |  1.17 |    1.24 |  0.78 |       0.01 |
| listChains/completed/cursor                   |       1.26 |   0.48 |  2.39 |    2.41 |  1.87 |       0.02 |
| listChains/completed/orderByCreatedAtCursor   |       1.08 |   0.48 |  1.61 |    2.32 |  1.75 |       0.02 |
| listChains/completed/orderByCompletedAtCursor |       1.10 |   0.46 |  1.56 |    2.29 |  1.63 |       0.03 |

## List jobs, p50 (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.69 |   0.22 |  0.79 |    0.80 |  0.69 |       0.02 |
| listJobs/noStatus/fromTo            |       0.64 |   0.20 |  0.68 |    0.92 |  0.73 |       0.02 |
| listJobs/noStatus/cursor            |       1.22 |   0.36 |  1.04 |    1.72 |  1.36 |       0.03 |
| listJobs/pending/default            |       1.29 |   0.18 |  0.46 |    0.49 |  0.63 |       0.01 |
| listJobs/pending/fromTo             |       0.73 |   0.20 |  0.48 |    0.44 |  0.56 |       0.02 |
| listJobs/pending/orderByCreatedAt   |       1.07 |   0.19 |  0.47 |    0.48 |  0.57 |       0.01 |
| listJobs/pending/cursor             |       2.01 |   0.39 |  0.85 |    0.75 |  1.24 |       0.02 |
| listJobs/blocked/default            |       1.14 |   0.20 |  0.43 |    0.45 |  0.55 |       0.01 |
| listJobs/blocked/fromTo             |       1.10 |   0.20 |  0.47 |    0.41 |  0.62 |       0.01 |
| listJobs/blocked/orderByCreatedAt   |       0.64 |   0.20 |  0.93 |    0.52 |  0.53 |       0.01 |
| listJobs/blocked/cursor             |       1.15 |   0.38 |  0.93 |    0.88 |  1.11 |       0.03 |
| listJobs/running/default            |       0.73 |   0.31 |  0.52 |    0.42 |  0.54 |       0.01 |
| listJobs/running/orderByCreatedAt   |       0.63 |   0.22 |  0.53 |    0.46 |  0.55 |       0.01 |
| listJobs/running/cursor             |      15.22 |   0.58 |  0.95 |    0.81 |  1.19 |       0.03 |
| listJobs/completed/default          |       1.52 |   0.31 |  0.51 |    0.47 |  0.83 |       0.01 |
| listJobs/completed/orderByCreatedAt |       0.74 |   0.22 |  1.11 |    0.51 |  0.63 |       0.01 |
| listJobs/completed/cursor           |       1.35 |   0.51 |  1.36 |    0.84 |  1.36 |       0.02 |

## List chain jobs & blocked jobs, p50 (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       3.08 |   0.88 |   0.51 |    2.45 |  0.50 |       0.01 |
| listChainJobs/cursor    |       6.03 |   1.76 |   1.06 |    3.73 |  1.15 |       0.01 |
| listBlockedJobs/default |     193.83 | 189.84 | 208.72 |  174.50 |  0.53 |       0.01 |
| listBlockedJobs/cursor  |     371.07 | 379.36 | 396.83 |  308.49 |  1.00 |       0.02 |

## List workers & worker jobs, p50 (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.63 |   0.09 |  0.57 |    0.64 |  0.45 |       0.03 |
| listWorkers/typeName   |       0.42 |   0.06 |  0.42 |    0.45 |  0.29 |       0.00 |
| listWorkers/status     |       0.30 |   0.05 |  0.28 |    0.47 |  1.75 |       0.00 |
| listWorkers/cursor     |       0.79 |   0.17 |  0.76 |    1.05 |  1.06 |       0.06 |
| listWorkerJobs/default |       0.65 |   0.15 |  0.50 |    0.39 |  0.44 |       0.00 |
| listWorkerJobs/cursor  |       1.09 |   0.28 |  0.79 |    0.76 |  0.76 |       0.02 |

## Operational queries, max (ms)

| Query                          | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ------------------------------ | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChains/default              |       0.91 |   0.09 | 17.58 |    4.51 |  1.45 |       0.16 |
| getChains/lock                 |       1.35 |   0.05 |  4.28 |    2.98 |  1.28 |       0.06 |
| getJobs/default                |       0.64 |   0.03 |  2.45 |    1.80 |  0.33 |       0.05 |
| getJobs/lock                   |       1.95 |   0.03 |  2.33 |    1.69 |  0.47 |       0.03 |
| getWorkers/default             |       0.47 |   0.03 |  1.99 |    1.24 |  0.27 |       0.05 |
| getWorkers/lock                |       1.05 |   0.03 |  1.91 |    1.39 |  0.27 |       0.03 |
| createJobs/default             |       1.81 |   0.08 |  6.74 |    4.01 |  0.39 |       0.06 |
| createJobs/deduplication       |       0.82 |   0.20 |  4.83 |    4.33 |  0.81 |       0.05 |
| continueJobs/default           |       1.72 |   0.31 |  5.83 |    7.14 |  0.60 |       0.06 |
| addJobsBlockers/default        |       2.12 |   0.32 |  6.21 |    6.57 |  0.78 |       0.06 |
| getJobBlockers/default         |       0.43 |   0.08 |  1.43 |    1.24 |  0.62 |       0.05 |
| unblockJobs/default            |       1.92 |   0.21 |  4.49 |    4.18 |  1.73 |       0.03 |
| startWorker/default            |       0.42 |   0.02 |  2.57 |    4.09 |  0.60 |       0.02 |
| extendWorkerLease/default      |       0.38 |   0.02 |  3.23 |    3.38 |  0.77 |       0.02 |
| stopWorker/default             |       0.56 |   0.02 |  3.09 |    3.36 |  0.72 |       0.04 |
| startJobAttempts/default       |       0.98 |   0.04 |  4.03 |    3.66 |  0.30 |       0.02 |
| startJobAttempts/limit10       |       1.90 |   0.39 |  7.31 |    4.14 |  0.55 |       0.03 |
| completeJobs/default           |       1.97 |   0.12 |  8.90 |    6.76 |  0.77 |       0.04 |
| getStartAttemptDelayMs/default |       1.15 |   0.03 |  5.97 |    3.45 |  0.55 |       0.07 |
| rescheduleJobs/default         |       0.97 |   0.04 |  5.94 |    8.14 |  0.49 |       0.08 |
| deleteChains/default           |       2.04 |   0.09 | 22.94 |    9.56 |  0.98 |       0.15 |
| deleteChains/multiJob          |       2.33 |   0.07 | 20.13 |    6.01 |  5.19 |       0.03 |

## Type discovery & counts, max (ms)

| Query                              | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| getChainTypeNames/default          |       0.67 |   0.06 |  6.95 |    3.59 |  0.43 |       0.06 |
| getJobTypeNames/default            |       0.70 |   0.06 |  4.38 |    2.81 |  0.34 |       0.06 |
| countChainsByTypeName/default      |       3.36 |   1.22 | 71.96 |   78.76 |  0.23 |       0.12 |
| countJobsByTypeName/default        |       4.45 |   1.27 | 70.93 |   72.60 |  0.22 |       0.06 |
| countWorkers/default               |       0.63 |   0.02 |  4.09 |    1.86 |  0.26 |       0.07 |
| countWorkersByTypeName/default     |       0.70 |   0.08 |  1.55 |    2.04 |  0.23 |       0.08 |
| countRunningJobsByWorkerId/default |       1.00 |   0.03 | 10.15 |    1.20 |  0.20 |       0.04 |

## List chains, max (ms)

| Query                                         | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| --------------------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listChains/noStatus/default                   |       0.70 |   0.27 |  5.16 |    2.48 |  4.37 |     493.90 |
| listChains/noStatus/independent               |       0.84 |   0.27 |  3.67 |    1.61 |  2.01 |     493.39 |
| listChains/noStatus/nonIndependent            |       0.52 |   0.16 |  1.77 |    1.09 |  0.29 |      44.38 |
| listChains/noStatus/fromTo                    |       1.28 |   0.33 |  2.03 |    1.46 |  0.91 |       0.13 |
| listChains/noStatus/cursor                    |       1.13 |   0.48 |  2.67 |    2.55 |  2.20 |       0.11 |
| listChains/running/default                    |       0.61 |   0.53 |  3.40 |    1.87 |  0.85 |     449.09 |
| listChains/running/independent                |       0.76 |   0.27 |  2.75 |    1.48 |  1.53 |     435.91 |
| listChains/running/nonIndependent             |       0.55 |   0.15 |  2.45 |    3.98 |  0.28 |      63.94 |
| listChains/running/cursor                     |       1.12 |   0.48 |  3.92 |    2.52 |  2.46 |       0.15 |
| listChains/completed/default                  |       0.66 |   0.30 |  4.54 |    1.75 |  2.53 |     136.92 |
| listChains/completed/independent              |       1.33 |   0.26 |  2.45 |    2.01 |  2.25 |     129.91 |
| listChains/completed/nonIndependent           |       0.50 |   0.17 |  1.69 |    1.52 |  0.32 |      62.49 |
| listChains/completed/orderByCreatedAt         |       0.63 |   0.28 |  2.54 |    1.61 |  1.05 |     112.30 |
| listChains/completed/orderByCompletedAt       |       0.66 |   1.10 |  2.36 |    1.59 |  0.82 |       0.04 |
| listChains/completed/cursor                   |       1.67 |   4.44 |  4.22 |    4.68 |  6.23 |       0.08 |
| listChains/completed/orderByCreatedAtCursor   |       1.13 |   0.53 |  4.29 |    3.98 |  2.78 |       0.05 |
| listChains/completed/orderByCompletedAtCursor |       1.23 |   0.50 |  3.01 |    3.54 |  1.74 |       0.06 |

## List jobs, max (ms)

| Query                               | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ----------------------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listJobs/noStatus/default           |       0.82 |   0.24 |  8.54 |   13.93 |  0.87 |     565.37 |
| listJobs/noStatus/fromTo            |       0.66 |   0.32 |  1.42 |    1.68 |  0.83 |       0.07 |
| listJobs/noStatus/cursor            |       4.68 |   0.39 |  2.59 |    3.87 |  1.95 |       0.14 |
| listJobs/pending/default            |       3.20 |   0.23 |  0.94 |    1.02 |  0.70 |     374.08 |
| listJobs/pending/fromTo             |       0.89 |   0.20 |  1.07 |    0.96 |  0.76 |       0.07 |
| listJobs/pending/orderByCreatedAt   |       1.72 |   0.20 |  0.95 |    0.91 |  0.63 |     271.07 |
| listJobs/pending/cursor             |       2.38 |   0.71 |  1.73 |    1.68 |  1.48 |       0.11 |
| listJobs/blocked/default            |       3.83 |   0.22 |  1.60 |    0.99 |  0.67 |     236.11 |
| listJobs/blocked/fromTo             |       1.54 |   0.23 |  0.91 |    0.82 |  0.69 |       0.07 |
| listJobs/blocked/orderByCreatedAt   |       0.73 |   0.20 |  6.37 |    6.12 |  0.67 |     234.40 |
| listJobs/blocked/cursor             |       1.28 |   0.44 |  5.98 |    2.76 |  1.26 |       0.10 |
| listJobs/running/default            |       0.93 |   0.32 |  3.07 |    1.06 |  0.67 |      72.98 |
| listJobs/running/orderByCreatedAt   |       0.68 |   0.39 |  1.52 |    1.25 |  0.68 |      73.77 |
| listJobs/running/cursor             |      25.80 |   0.61 |  1.85 |    1.63 |  1.89 |       0.12 |
| listJobs/completed/default          |      29.86 |   0.62 |  2.84 |    2.71 |  1.16 |     172.51 |
| listJobs/completed/orderByCreatedAt |       0.81 |   0.24 |  9.19 |    7.96 |  0.74 |     141.44 |
| listJobs/completed/cursor           |       1.62 |   0.65 |  3.66 |    1.65 |  1.52 |       0.09 |

## List chain jobs & blocked jobs, max (ms)

| Query                   | PostgreSQL | SQLite |  MySQL | MariaDB | Redis | In-process |
| ----------------------- | ---------: | -----: | -----: | ------: | ----: | ---------: |
| listChainJobs/default   |       4.35 |   0.94 |   6.29 |    5.59 |  0.68 |       0.06 |
| listChainJobs/cursor    |      10.32 |   1.88 |   2.44 |    4.97 |  1.39 |       0.09 |
| listBlockedJobs/default |     229.19 | 231.90 | 511.34 |  442.97 |  0.61 |       0.11 |
| listBlockedJobs/cursor  |     468.23 | 393.48 | 412.85 |  316.09 |  1.09 |       0.06 |

## List workers & worker jobs, max (ms)

| Query                  | PostgreSQL | SQLite | MySQL | MariaDB | Redis | In-process |
| ---------------------- | ---------: | -----: | ----: | ------: | ----: | ---------: |
| listWorkers/default    |       0.92 |   0.10 |  2.12 |    2.90 |  0.52 |       0.23 |
| listWorkers/typeName   |       0.48 |   0.07 |  1.08 |    2.28 |  0.35 |       0.04 |
| listWorkers/status     |       0.36 |   0.06 |  1.26 |    0.92 |  1.99 |       0.03 |
| listWorkers/cursor     |       1.04 |   0.28 |  1.42 |    2.97 |  1.73 |       0.09 |
| listWorkerJobs/default |       0.81 |   0.19 |  1.15 |    1.13 |  0.54 |       0.06 |
| listWorkerJobs/cursor  |       1.44 |   0.30 |  1.80 |    1.65 |  0.79 |       0.05 |
