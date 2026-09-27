---
"queuert": major
---

Rename `client.startChain` to `client.createChain` and `client.startChains` to `client.createChains`. The old names suggested the call began execution, which was misleading — the methods create a chain transactionally and a worker picks it up later (possibly much later, with `schedule`).

- `client.startChain(...)` → `client.createChain(...)`
- `client.startChains(...)` → `client.createChains(...)`
