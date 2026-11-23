# Runtime performance

Last run 2026-11-23 · commit e279ddec · load average 1.70 · all measurements

## Memory (KB)

| Measurement            | Setup | In-flight peak | Live JS retained | JIT code retained |
| ---------------------- | ----: | -------------: | ---------------: | ----------------: |
| state-postgres         |    70 |            175 |               15 |               115 |
| state-in-process       |   105 |            275 |               10 |               145 |
| state-in-process-async |   105 |            285 |               10 |               145 |
| state-sqlite           |    95 |            165 |               10 |               110 |
| state-mysql            |    75 |            230 |               25 |               130 |
| state-mariadb          |    70 |            205 |               20 |               105 |
| state-redis            |   110 |            255 |               20 |               185 |
| notify-redis           |    65 |            295 |               20 |               135 |
| notify-postgres        |    80 |            365 |               20 |               200 |
| notify-nats            |    75 |            280 |               15 |               115 |
| notify-ipc             |   100 |            240 |               10 |               105 |
| otel                   |    90 |            285 |               10 |               140 |
| dashboard              |   110 |            285 |                5 |               150 |

## CPU per job (µs)

| Measurement            | Queuert core | Adapter | Dependencies | Runtime |
| ---------------------- | -----------: | ------: | -----------: | ------: |
| state-postgres         |           69 |      27 |           96 |     103 |
| state-in-process       |           27 |       8 |            0 |       6 |
| state-in-process-async |           32 |      12 |            0 |      12 |
| state-sqlite           |           28 |      13 |            8 |      63 |
| state-mysql            |           73 |      80 |          194 |     202 |
| state-mariadb          |           88 |      88 |          203 |     238 |
| state-redis            |           62 |     109 |           26 |      87 |
| notify-redis           |           80 |      23 |           25 |      90 |
| notify-postgres        |           64 |      22 |           28 |      60 |
| notify-nats            |           83 |      26 |           20 |      73 |
| notify-ipc             |           32 |      11 |            0 |       8 |
| otel                   |           34 |       9 |            6 |      11 |
| dashboard              |           28 |       9 |            0 |      12 |

## Allocated per job (KB)

| Measurement            | Allocated |
| ---------------------- | --------: |
| state-postgres         |     154.7 |
| state-in-process       |      51.0 |
| state-in-process-async |      71.4 |
| state-sqlite           |      64.2 |
| state-mysql            |     266.3 |
| state-mariadb          |     262.7 |
| state-redis            |     232.1 |
| notify-redis           |     102.5 |
| notify-postgres        |      96.5 |
| notify-nats            |      92.1 |
| notify-ipc             |      52.8 |
| otel                   |      87.9 |
| dashboard              |      71.6 |

## Schema library CPU per job (µs)

| Registry        | Schema library |
| --------------- | -------------: |
| defineJobTypes  |            0.0 |
| Zod             |            0.1 |
| Valibot         |            5.7 |
| TypeBox         |            0.0 |
| ArkType         |            0.1 |
| Zod codec       |            3.0 |
| superjson codec |           30.2 |

## Allocated per job by registry (KB)

| Registry        | Allocated |
| --------------- | --------: |
| defineJobTypes  |      72.3 |
| Zod             |      74.7 |
| Valibot         |      80.8 |
| TypeBox         |      73.4 |
| ArkType         |      73.9 |
| Zod codec       |      78.1 |
| superjson codec |     107.0 |
