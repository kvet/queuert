---
"queuert": major
"@queuert/postgres": major
"@queuert/sqlite": major
"@queuert/dashboard": major
---

Remove the `cascade` option from `deleteChains` and `deleteChain`. Cascade deletion — which automatically resolved and deleted transitive blocker dependencies — is no longer supported. Callers that relied on `cascade: true` must enumerate the chains to delete explicitly.
