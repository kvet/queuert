# @queuert/ipc

## 0.18.0

### Minor Changes

- bce5c32: `@queuert/ipc` is now published, as an experimental package. Its notify adapter delivers job notifications between processes on one host over Unix sockets (named pipes on Windows), with no broker to run: processes that pass the same directory find each other through registry files in it. It is a `NotifyAdapter<"sync">`, for setups such as worker processes sharing one SQLite database file through a synchronous provider.

  - New package `@queuert/ipc` with `createIpcNotifyAdapter`.

- Queuert 0.18 can run synchronously inside your driver's own transaction. It adds experimental MySQL/MariaDB and Redis state adapters, a broker-free IPC notify adapter and a public migrator for your own migrations. Schema fencing protects state across upgrades, and the release reworks tx hooks, the worker runner, job type codecs and adapter conformance, with breaking API changes and a Node.js 24 minimum.

### Patch Changes

- Updated dependencies [8e6214a]
- Updated dependencies [5faa717]
- Updated dependencies [23481af]
- Updated dependencies [fa5f72e]
- Updated dependencies [9358147]
- Updated dependencies [77e02a0]
- Updated dependencies [bce5c32]
- Updated dependencies [aedda52]
- Updated dependencies [68cb9eb]
- Updated dependencies [0834205]
- Updated dependencies [9832912]
- Updated dependencies [b1c0838]
- Updated dependencies [6df6caf]
- Updated dependencies
- Updated dependencies [cb19191]
- Updated dependencies [e4244e4]
- Updated dependencies [9e6c2b5]
- Updated dependencies [bce5c32]
- Updated dependencies [cf464c5]
- Updated dependencies [747cd37]
- Updated dependencies [cf464c5]
  - queuert@0.18.0
