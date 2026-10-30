---
"queuert": minor
---

Add `pickProcessors` and `omitProcessors` to split one processor registry across several workers, for example to give CPU-heavy job types a dedicated low-concurrency worker without defining their handlers twice.

- `pickProcessors(processors, typeNames)` returns a registry with only the listed job types; `omitProcessors(processors, typeNames)` returns one with every other job type.
- Picked processors keep their handler, their slice's middleware chain, and their `backoffConfig`, so `requiredAttemptMiddleware` checks still pass.
- Job type names are type-checked against the registry; an unknown name, an empty list, or omitting every processor is a type error and throws at runtime.
- `createInProcessWorker` now reports overlapping job types across a `processors` array at compile time when the array's length is known statically (inline arrays and `as const` tuples); arrays built at runtime are still checked at runtime only.
