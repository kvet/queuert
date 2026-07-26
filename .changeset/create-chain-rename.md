---
"queuert": major
---

Rename `client.startChain` to `client.createChain` and `client.startChains` to `client.createChains`. The old names suggested the call began execution, which was misleading — the methods create a chain transactionally and a worker picks it up later (possibly much later, with `schedule`). The new names line up with the rest of the vocabulary (`createClient`, `completeChain`, `deleteChain`) and with the state adapter's `createChains`. Update every call site; there is no deprecated alias.

- `client.startChain(...)` → `client.createChain(...)`
- `client.startChains(...)` → `client.createChains(...)`
