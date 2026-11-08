# @queuert/rpc

Typed server functions served from a single streaming RPC endpoint, built on seroval. Private: a published package that imports it gets its own copy inlined by tsdown at build time.

- `@queuert/rpc/server`: `createServerFnFactory<TContext>()` returns a `createServerFn` whose functions are declared as `createServerFn().inputValidator(standardSchema).handler(({ data, ...context }) => result)`. `handleRpc(request, context, serverFns)` answers `POST` requests with a JSON `{ fn, data }` body. A result streams as NDJSON of seroval cross-JSON records, so a promise inside it resolves later on the same response, and every `Error` crosses the wire as its message only.
- `@queuert/rpc/client`: `createServerFnClient<typeof serverFns>(url)` returns a typed client that calls each function as `serverFns.name({ data, signal })` and decodes responses without `eval`.
- `@queuert/rpc`: `RpcError`, the error both halves use for a failed call and its HTTP status.
- `@queuert/rpc/testing`: `readRpcResponse` decodes a whole response in specs.
