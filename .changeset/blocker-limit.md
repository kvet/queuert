---
"queuert": minor
---

A job can now declare at most 100 blocker chains. `startChain`, `startChains`, and `continueWith` throw the new `BlockerLimitExceededError` (carrying `typeName`, `count`, and `limit`) when a job exceeds the limit, validated up front before any state is written. The cap is intentional — the blocker model is built for bounded fan-in, not millions of dependencies per job — and applies uniformly across every state adapter.
