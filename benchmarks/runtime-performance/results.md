# Runtime performance

Last run 2026-11-26 · commit 23926ee8 · load average 5.07 · all measurements

## Memory (KB)

| Measurement            | Setup | In-flight peak | Live JS retained | JIT code retained |
| ---------------------- | ----: | -------------: | ---------------: | ----------------: |
| state-postgres         |    65 |            165 |               15 |                95 |
| state-in-process       |   105 |            275 |               10 |               145 |
| state-in-process-async |   105 |            285 |               10 |               145 |
| state-sqlite           |    95 |            165 |               10 |               110 |
| state-mysql            |    75 |            230 |               25 |               120 |
| state-mariadb          |    70 |            205 |               25 |                95 |
| state-redis            |   110 |            260 |               20 |               185 |
| notify-redis           |    65 |            295 |               20 |               155 |
| notify-postgres        |    80 |            365 |               20 |               190 |
| notify-nats            |    75 |            280 |               15 |               110 |
| notify-ipc             |   100 |            240 |               10 |               105 |
| otel                   |    90 |            285 |               10 |               140 |
| dashboard              |   110 |            285 |               10 |               150 |

## CPU per job (µs)

| Measurement            | Queuert core | Adapter | Dependencies | Runtime |
| ---------------------- | -----------: | ------: | -----------: | ------: |
| state-postgres         |           57 |      25 |           76 |      94 |
| state-in-process       |           26 |       8 |            0 |       5 |
| state-in-process-async |           29 |       9 |            0 |      11 |
| state-sqlite           |           30 |      12 |            7 |      64 |
| state-mysql            |           69 |      65 |          185 |     159 |
| state-mariadb          |           77 |      67 |          185 |     185 |
| state-redis            |           46 |      98 |           21 |      69 |
| notify-redis           |           55 |      16 |           15 |      52 |
| notify-postgres        |           53 |      16 |           21 |      50 |
| notify-nats            |           48 |      14 |           11 |      37 |
| notify-ipc             |           30 |      12 |            0 |       9 |
| otel                   |           35 |      12 |            9 |      14 |
| dashboard              |           27 |      10 |            0 |       9 |

## Allocated per job (KB)

| Measurement            | Allocated |
| ---------------------- | --------: |
| state-postgres         |     155.2 |
| state-in-process       |      50.6 |
| state-in-process-async |      72.0 |
| state-sqlite           |      64.4 |
| state-mysql            |     265.5 |
| state-mariadb          |     262.5 |
| state-redis            |     230.2 |
| notify-redis           |     102.8 |
| notify-postgres        |      96.9 |
| notify-nats            |      91.5 |
| notify-ipc             |      53.4 |
| otel                   |      87.6 |
| dashboard              |      71.5 |

## Schema library CPU per job (µs)

| Registry        | Schema library |
| --------------- | -------------: |
| defineJobTypes  |            0.0 |
| Zod             |            0.0 |
| Valibot         |            5.8 |
| TypeBox         |            0.0 |
| ArkType         |            0.2 |
| Zod codec       |            2.9 |
| superjson codec |           28.9 |

## Allocated per job by registry (KB)

| Registry        | Allocated |
| --------------- | --------: |
| defineJobTypes  |      71.9 |
| Zod             |      74.0 |
| Valibot         |      80.8 |
| TypeBox         |      73.5 |
| ArkType         |      73.9 |
| Zod codec       |      78.5 |
| superjson codec |     106.2 |

## Environment

| Setting    |                         Value |
| ---------- | ----------------------------: |
| Machine    | Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                        Normal |
| OS         |                  macOS 26.7.3 |
| Runtime    |              Node.js v24.22.1 |
| Containers |              socktainer 1.6.1 |
