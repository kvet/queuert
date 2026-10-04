---
"queuert": patch
---

Reduce the type-checking cost of Queuert's types by roughly 20–40% (fewer instantiations, faster editor feedback and `tsc` runs), and fix the type of a chain's `input`. A chain's `input` was typed as a union of every job input along the chain; it is now the entry job's input, matching the value returned at runtime.

- `chain.input` is now typed as the entry job type's input; `chain.output` is still the union of outputs reachable along the chain, and chains over several entry types are discriminated by `typeName`.
- `defineJobTypes` validates plain terminal and continuing definitions through a cheaper path; accepted and rejected definitions are unchanged.
- Single job and chain variants (completed, continued, rescheduled, running, blocker chains) are now built directly instead of filtered from the full status union, with identical shapes.
