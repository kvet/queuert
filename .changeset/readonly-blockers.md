---
"queuert": patch
---

`createChain`, `createChains` and a `continueWith` outcome accept a readonly tuple of blockers, such as an `as const` array, alongside a mutable one.
