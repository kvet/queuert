---
"queuert": patch
---

Relax the generic bound on `AttemptMiddleware`'s `TStateAdapter` parameter from `StateAdapter<BaseTxContext, any>` to `StateAdapter<any, any>`.

The previous bound was unusable in practice: because `StateAdapter`'s transaction-context type parameter appears in contravariant positions (e.g. `withSavepoint(txCtx, fn)`), no concrete adapter with a non-empty `txCtx` (such as `StateAdapter<{ db }, string>`) could satisfy `StateAdapter<BaseTxContext = {}, any>`. Consumers had to fall back to `AttemptMiddleware<any, …>` to silence `TS2344`, and helpers typed as `Client<…, StateAdapter<any, any>>` rejected concrete clients with the same contravariance error. Widening to `StateAdapter<any, any>` lets adapter-aware middleware and generic test helpers type-check without `any` workarounds; the structural shape of each middleware hook still enforces the right call sites.
