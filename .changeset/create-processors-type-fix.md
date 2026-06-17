---
"queuert": patch
---

Fixed `createProcessors` resolving job type names from the local slice only instead of all registered slices, which caused type errors when processors referenced types defined in a different `defineJobTypes` call.
