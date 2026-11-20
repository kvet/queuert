# Runtime performance

Last run 2026-11-20 · commit 9939bcf9 · load average 6.16 · state-mysql, state-mariadb

## Memory (KB)

| Measurement            | Setup | In-flight peak | Live JS retained | JIT code retained |
| ---------------------- | ----: | -------------: | ---------------: | ----------------: |
| state-postgres         |    60 |            135 |               15 |                55 |
| state-in-process       |   100 |            260 |                5 |               135 |
| state-in-process-async |   105 |            270 |                5 |               135 |
| state-sqlite           |    90 |            150 |               10 |               110 |
| state-mysql            |    70 |            200 |               20 |               105 |
| state-mariadb          |    70 |            180 |               20 |                80 |
| state-redis            |   110 |            240 |               20 |               165 |
| notify-redis           |    65 |            280 |               20 |               130 |
| notify-postgres        |    75 |            285 |               15 |               120 |
| notify-nats            |    75 |            260 |               15 |               105 |
| notify-ipc             |   100 |            225 |               10 |                95 |
| otel                   |    90 |            270 |               10 |               125 |
| dashboard              |   105 |            270 |                5 |               140 |

## CPU per job (µs)

| Measurement            | Queuert core | Adapter | Dependencies | Runtime |
| ---------------------- | -----------: | ------: | -----------: | ------: |
| state-postgres         |           51 |      32 |           98 |     106 |
| state-in-process       |           11 |       9 |            0 |       5 |
| state-in-process-async |           16 |       7 |            0 |       8 |
| state-sqlite           |           13 |      10 |           10 |      54 |
| state-mysql            |           49 |      78 |          194 |     207 |
| state-mariadb          |           42 |      80 |          185 |     213 |
| state-redis            |           33 |     110 |           22 |      74 |
| notify-redis           |           38 |      16 |           19 |      65 |
| notify-postgres        |           44 |      21 |           31 |      68 |
| notify-nats            |           34 |      15 |           11 |      41 |
| notify-ipc             |           13 |      11 |            0 |       8 |
| otel                   |           19 |      10 |            6 |       9 |
| dashboard              |           14 |       9 |            0 |       9 |

## Allocated per job (KB)

| Measurement            | Allocated |
| ---------------------- | --------: |
| state-postgres         |     135.5 |
| state-in-process       |      32.7 |
| state-in-process-async |      50.5 |
| state-sqlite           |      45.7 |
| state-mysql            |     245.9 |
| state-mariadb          |     243.7 |
| state-redis            |     207.9 |
| notify-redis           |      80.6 |
| notify-postgres        |      82.4 |
| notify-nats            |      70.0 |
| notify-ipc             |      35.3 |
| otel                   |      65.0 |
| dashboard              |      50.1 |

## Schema library CPU per job (µs)

| Registry        | Schema library |
| --------------- | -------------: |
| defineJobTypes  |            0.0 |
| Zod             |            0.0 |
| Valibot         |            5.2 |
| TypeBox         |            0.1 |
| ArkType         |            0.3 |
| Zod codec       |            2.1 |
| superjson codec |           27.5 |

## Allocated per job by registry (KB)

| Registry        | Allocated |
| --------------- | --------: |
| defineJobTypes  |      50.2 |
| Zod             |      52.6 |
| Valibot         |      58.6 |
| TypeBox         |      52.5 |
| ArkType         |      52.1 |
| Zod codec       |      56.9 |
| superjson codec |      85.2 |
