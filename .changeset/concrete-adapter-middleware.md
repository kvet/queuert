---
"queuert": major
---

Fix `AttemptMiddleware` typed with a concrete state adapter (e.g. `AttemptMiddleware<typeof stateAdapter, …>`) silently collapsing the handler context to `unknown` whenever two or more middleware were composed. Middleware can now be typed against your adapter, giving fully typed transaction context (`sql`, `db`, …) inside `wrapPrepare` / `wrapExecute` / `wrapComplete` and correct ctx inference in the handler, and tuples may freely mix adapter-typed and `any`-typed middleware. `createProcessors` and `createInProcessWorker` additionally reject middleware typed against a _different_ adapter than the client's, which previously type-checked and then failed at runtime when a hook destructured a transaction context that adapter never provides. Middleware typed with `any` keeps working unchanged.
