# Runtime performance

Last run 2026-11-26 · commit 28448c56 · load average 5.14 · all measurements

## Memory (KB)

| Measurement            | Setup | In-flight peak | Live JS retained | JIT code retained |
| ---------------------- | ----: | -------------: | ---------------: | ----------------: |
| state-postgres         |    70 |            170 |               15 |               105 |
| state-in-process       |   105 |            275 |               10 |               145 |
| state-in-process-async |   105 |            285 |               10 |               145 |
| state-sqlite           |    95 |            165 |               10 |               110 |
| state-mysql            |    70 |            215 |               20 |               120 |
| state-mariadb          |    70 |            195 |               25 |                95 |
| state-redis            |   110 |            255 |               20 |               185 |
| notify-redis           |    65 |            300 |               20 |               140 |
| notify-postgres        |    80 |            360 |               20 |               195 |
| notify-nats            |    75 |            280 |               15 |               115 |
| notify-ipc             |   100 |            240 |               10 |               105 |
| otel                   |    90 |            285 |               10 |               140 |
| dashboard              |   110 |            285 |               10 |               150 |

## CPU per job (µs)

| Measurement            | Queuert core | Adapter | Dependencies | Runtime |
| ---------------------- | -----------: | ------: | -----------: | ------: |
| state-postgres         |           79 |      30 |          100 |     107 |
| state-in-process       |           25 |       8 |            0 |       7 |
| state-in-process-async |           30 |       9 |            0 |      10 |
| state-sqlite           |           28 |      11 |            8 |      66 |
| state-mysql            |           82 |      89 |          224 |     229 |
| state-mariadb          |           74 |      77 |          202 |     219 |
| state-redis            |           60 |      99 |           20 |      73 |
| notify-redis           |           63 |      21 |           18 |      71 |
| notify-postgres        |           67 |      21 |           27 |      55 |
| notify-nats            |           50 |      14 |           13 |      41 |
| notify-ipc             |           34 |      11 |            0 |       9 |
| otel                   |           33 |       9 |            8 |      11 |
| dashboard              |           28 |       9 |            0 |      10 |

## Allocated per job (KB)

| Measurement            | Allocated |
| ---------------------- | --------: |
| state-postgres         |     155.2 |
| state-in-process       |      50.8 |
| state-in-process-async |      71.9 |
| state-sqlite           |      64.5 |
| state-mysql            |     266.4 |
| state-mariadb          |     264.3 |
| state-redis            |     231.3 |
| notify-redis           |     102.5 |
| notify-postgres        |      96.7 |
| notify-nats            |      91.5 |
| notify-ipc             |      52.9 |
| otel                   |      87.6 |
| dashboard              |      71.6 |

## Schema library CPU per job (µs)

| Registry        | Schema library |
| --------------- | -------------: |
| defineJobTypes  |            0.0 |
| Zod             |            0.1 |
| Valibot         |            6.8 |
| TypeBox         |            0.0 |
| ArkType         |            0.1 |
| Zod codec       |            3.0 |
| superjson codec |           29.6 |

## Allocated per job by registry (KB)

| Registry        | Allocated |
| --------------- | --------: |
| defineJobTypes  |      72.8 |
| Zod             |      74.1 |
| Valibot         |      80.2 |
| TypeBox         |      73.4 |
| ArkType         |      73.7 |
| Zod codec       |      78.7 |
| superjson codec |     107.1 |

## Environment

| Setting    |                                  Value |
| ---------- | -------------------------------------: |
| Machine    |          Apple M5 Pro, 15 cores, 48 GB |
| Power mode |                                 Normal |
| OS         |                           macOS 26.7.3 |
| Runtime    |                       Node.js v24.22.1 |
| Containers | Docker Desktop 4.100.1 (247138) 29.9.3 |
