---
"queuert": major
---

`TransactionContextRequiredError` is removed. Client methods that need a transaction context now throw a plain `Error` when called without one. The condition it reported is a malformed call, not a runtime state a caller can recover from: it carried no structured data, and every typed error in the library exists so callers can branch on something they could not have known statically. Code that caught this class specifically should match on the message or drop the catch — nothing else changes about when the throw happens.

- `TransactionContextRequiredError` is no longer exported from `queuert`.
- The mutating methods (`createChain`, `createChains`, `completeChain`, `deleteChain`, `deleteChains`, `rescheduleJob`, `rescheduleJobs`) and the lockable reads passed `lock: true` (`getChain`, `getChains`, `getJob`, `getJobs`) throw `Error("This client method requires a transaction context from withTransaction")` instead.
