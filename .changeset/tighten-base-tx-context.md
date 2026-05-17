---
"@queuert/core": patch
---

Tighten `BaseTxContext` from `{}` to `Record<string, unknown>`. The previous `{}` constraint accepted any non-nullish value (string, number, function), letting custom `StateAdapter` authors pick a non-object `TTxContext` without a type error. All built-in adapters are already object-shaped, so no runtime behavior changes.
