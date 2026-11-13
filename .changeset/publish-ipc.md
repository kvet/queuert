---
"@queuert/ipc": minor
---

`@queuert/ipc` is now published, as an experimental package. Its notify adapter delivers job notifications between processes on one host over Unix sockets (named pipes on Windows), with no broker to run: processes that pass the same directory find each other through registry files in it. It is a `SyncNotifyAdapter`, for setups such as worker processes sharing one SQLite database file through a synchronous provider.

- New package `@queuert/ipc` with `createIpcNotifyAdapter`.
