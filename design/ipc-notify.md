# IPC notify adapter

A notify adapter in a new `@queuert/ipc` package. It delivers notifications between processes on one host: a web process and a worker process, `cluster` workers, PM2 instances, scripts. It is written for single-SQLite deployments but depends on nothing beyond `node:net` and `node:fs`, so it works next to any state adapter.

## Problem

- SQLite has no cross-process notification primitive. Its commit and update hooks are per-connection, and neither `better-sqlite3` nor `node:sqlite` exposes them.
- The in-process notify adapter reaches only its own process, so other processes learn of new jobs and completed chains only at their next poll (`pollIntervalMs`).
- Redis and NATS need a server, which a single-SQLite deployment usually exists to avoid.

## API

```ts
const notifyAdapter = createIpcNotifyAdapter({
  directory: "/var/run/my-app/queuert", // shared by every process that should hear each other
});
```

- The factory is synchronous and does no I/O, per `design/sync-factories.md`. The socket server, registry file and recipient timer start lazily on the first `listen*` or `notify*` call.
- `directory` is required. Processes that pass the same directory form one group. The adapter creates the directory on first use if it is missing.
- There is no provider. The adapter uses only Node built-ins, so there is no client library to wrap.

## Direction

- **Sync-ready `notify*`.** `notify*` queues its socket writes and returns without waiting for them, so it can later flush from `TxHooksSync`. Until core calls notify adapters synchronously, it keeps the current `NotifyAdapter` type and returns an already-resolved promise.
- **One socket per listening process.** On the first `listen*` call, the process starts a `net` server. On Unix the server listens on a socket at `os.tmpdir()/queuert-<random id>.sock`; the temp directory keeps the path short, because Unix socket paths are limited to about 104 bytes on macOS and 108 on Linux. On Windows it uses the named pipe `\\.\pipe\queuert-<random id>`.
- **Registry files.** When its server starts, a listening process writes `<directory>/<id>.json` containing `{ "pid", "address" }`. It deletes the file on `close`. Each process writes only its own file, so there are no write races and no locking. A process that only sends registers nothing.
- **Recipient list.** A timer re-reads the directory and refreshes an in-memory list of recipients, so `notify*` never touches the disk.
- **Send.** For every item, `notify*` writes one newline-delimited JSON line, `{ "kind", "key" }`, to every recipient. `kind` is `jobScheduled`, `chainCompleted` or `jobAttemptLost`, and `key` is the type name, chain ID or job ID. The process delivers to its own listeners directly instead of through its socket. Each process receives every notification and filters by key on its side.
- **Connections.** The adapter opens a connection to a recipient the first time it sends there and keeps it open. If a connection errors, the adapter drops it and opens a new one on the next send.
- **Stale entries.** When connecting to a recipient fails and `process.kill(pid, 0)` shows the process is gone, the sender deletes that recipient's registry file and its socket file.
- **Hints only.** Notifications can be lost, for example while a recipient restarts or before the recipient list refreshes. The next poll catches them.

## Alternatives considered

- **A registry table in the SQLite migrations.** It needs a migration, a database provider and heartbeat writes that compete for the write lock. Files give the same registry without touching the database.
- **One shared registry file.** Removing an entry means rewriting the file, and concurrent rewrites lose updates without a cross-platform file lock.
- **One shared address with a hub process that relays.** No registry, but it needs hub election and failover, and on Unix a crashed hub leaves a socket file that racing processes can delete from under each other.
- **A port range.** Every send probes the whole range, other software can occupy ports in it, and any local user can connect.
- **`PRAGMA data_version` polling.** Cheap, but it carries no payload, and latency equals the poll interval.
- **`fs.watch` on a sidecar file, signals, FIFOs.** Either no payload or no Windows support. Sockets give the same shape on every platform.
- **`cluster` IPC or the PM2 bus.** Needs relay code in the primary or ties the adapter to PM2, and misses processes outside the group.
