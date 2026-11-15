# Runtime performance

Last run 2026-11-15 · commit f6399c38 · load average 6.51 · all measurements

## Memory (KB)

| Measurement            | Setup | In-flight peak | Live JS retained | JIT code retained |
| ---------------------- | ----: | -------------: | ---------------: | ----------------: |
| state-postgres         |    60 |            130 |               20 |                55 |
| state-in-process       |   100 |            260 |                5 |               135 |
| state-in-process-async |   105 |            270 |                5 |               135 |
| state-sqlite           |    90 |            150 |               10 |               110 |
| state-mysql            |    70 |            185 |               20 |                90 |
| state-mariadb          |    70 |            175 |               20 |                80 |
| state-redis            |   105 |            235 |               20 |               165 |
| notify-redis           |    65 |            285 |               20 |               125 |
| notify-postgres        |    75 |            285 |               15 |               125 |
| notify-nats            |    75 |            255 |               15 |               110 |
| notify-ipc             |   100 |            225 |               10 |                95 |
| otel                   |    90 |            270 |               10 |               125 |
| dashboard              |   105 |            270 |                5 |               140 |

## CPU per job (µs)

| Measurement            | Queuert core | Adapter | Dependencies | Runtime |
| ---------------------- | -----------: | ------: | -----------: | ------: |
| state-postgres         |           84 |      46 |          177 |     196 |
| state-in-process       |           22 |      13 |            0 |       9 |
| state-in-process-async |           28 |      16 |            0 |      13 |
| state-sqlite           |           23 |      19 |           15 |      91 |
| state-mysql            |           82 |     118 |          347 |     379 |
| state-mariadb          |           80 |     123 |          343 |     383 |
| state-redis            |           45 |     156 |           37 |     116 |
| notify-redis           |           67 |      31 |           31 |     113 |
| notify-postgres        |           70 |      31 |           69 |     123 |
| notify-nats            |           64 |      31 |           24 |      78 |
| notify-ipc             |           27 |      17 |            0 |       9 |
| otel                   |           28 |      18 |           11 |      15 |
| dashboard              |           27 |      16 |            0 |      13 |

## Allocated per job (KB)

| Measurement            | Allocated |
| ---------------------- | --------: |
| state-postgres         |     135.4 |
| state-in-process       |      32.8 |
| state-in-process-async |      50.2 |
| state-sqlite           |      45.9 |
| state-mysql            |     243.5 |
| state-mariadb          |     241.5 |
| state-redis            |     206.9 |
| notify-redis           |      81.3 |
| notify-postgres        |      82.3 |
| notify-nats            |      70.1 |
| notify-ipc             |      35.5 |
| otel                   |      64.9 |
| dashboard              |      49.9 |

## Schema library CPU per job (µs)

| Registry        | Schema library |
| --------------- | -------------: |
| defineJobTypes  |            0.0 |
| Zod             |            0.0 |
| Valibot         |            9.6 |
| TypeBox         |            0.0 |
| ArkType         |            0.4 |
| Zod codec       |            4.8 |
| superjson codec |           45.8 |

## Allocated per job by registry (KB)

| Registry        | Allocated |
| --------------- | --------: |
| defineJobTypes  |      51.1 |
| Zod             |      52.5 |
| Valibot         |      59.3 |
| TypeBox         |      51.7 |
| ArkType         |      52.4 |
| Zod codec       |      56.4 |
| superjson codec |      85.3 |
