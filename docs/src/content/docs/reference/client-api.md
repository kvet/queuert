---
title: Client API
description: Mutation and query methods on the Queuert client.
sidebar:
  order: 1
---

## Overview

The client is the public API for managing job chains. Created via `createClient()`. See the `Client` type TSDoc for detailed method signatures and parameters.

## Method Categories

The client has two categories of methods: mutating and read-only.

**Mutating** — `startJobChain`, `completeJobChain`, `deleteJobChains`. Require `transactionHooks` and a transaction context. Side effects (notifications, observability) are buffered via hooks and only flushed after the caller's transaction commits.

**Read-only** — `getJobChain`, `getJob`, `listJobChains`, `listJobs`, `listJobChainJobs`, `getJobBlockers`, `listBlockedJobs`, `awaitJobChain`. Do not require `transactionHooks`. Accept an optional transaction context — when omitted, the adapter acquires its own connection.

All methods accept a transaction context: required for mutations (rollback safety for side effects), optional for queries (standalone reads are fine).

## Internal Hooks

The client and worker register hooks on `TransactionHooks` internally. These are not part of the public `TransactionHooks` API.

- **Notify hooks** — buffer notification calls (`notifyJobScheduled`, `notifyJobChainCompleted`, `notifyJobOwnershipLost`) and flush them after commit
- **Observability hook** — buffer metric emissions, log calls, and span completions until after commit

## See Also

- [Job Chain Model](../job-chain-model/) — Chain structure, Promise analogy, terminology
- [Job Processing](../job-processing/) — Prepare/complete pattern, transactional design
- [In-Process Worker](../in-process-worker/) — Worker lifecycle, leasing, reaper
- [Adapters](../adapters/) — StateAdapter context architecture
