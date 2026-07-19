---
title: Chain Model
description: Promise-like chain model, identity, and execution patterns.
sidebar:
  order: 3
---

## Overview

This document describes Queuert's unified job model and the Promise-inspired chain abstraction.

## Core Concepts

### Job

A **Job** is an individual unit of work with a lifecycle:

```
pending → running → completed
```

Each job:

- Belongs to a **Job Type** that defines its input/output schema
- Contains typed input data and (when completed) output data
- Can `continueWith` to create a linked follow-up job
- Can depend on **blockers** (other chains that must complete first)

### Chain

A **Chain** is a series of linked jobs where each job can continue to the next—just like a JavaScript Promise chain.

```
Job A → Job B → Job C → (completed)
```

The chain completes when its final job completes without continuing.

## The Promise Analogy

The design mirrors JavaScript Promises:

```javascript
// JavaScript: A Promise chain IS the first promise
const chain = fetch(url)           // chain === this promise
  .then(processResponse)           // continuation
  .then(formatResult);             // continuation

// Queuert: A Chain IS its head job
const chain = startChain(...)   // chain.id === headJob.id
  .continueWith(processStep)       // continuation
  .continueWith(formatStep);       // continuation
```

The fundamental insight: **the head job IS the chain**. Chains work like Promises but persist across process restarts and distribute across workers.

## Identity Model

For the head job in a chain: `job.id === job.chainId`

This isn't redundant—it's a meaningful signal that identifies the chain starter. Continuation jobs have `job.id !== job.chainId` but share the same `chainId` as all other jobs in the chain.

```d2
...@../_classes.d2

direction: right

chain: "chain (id = X)" {
  class: process

  first: "head job\n\nid = X\nchainId = X\n\nid === chainId" { class: job-accent; width: 240; height: 160 }
  cont:  "continuation\n\nid = Y\nchainId = X\n\nown id, shared chainId" { class: job; width: 240; height: 160 }
  term:  "terminal\n\nid = Z\nchainId = X\n\nown id, shared chainId" { class: job; width: 240; height: 160 }

  first -> cont: then { class: flow-blue }
  cont  -> term: then { class: flow-blue }
}
```

## Unified Model Benefits

Having the head job BE the chain (rather than a separate entity) provides:

### Simplicity

- No separate `chain` table — chains are a view over the `job` table (plus a `job_blocker` junction table for dependencies)
- One primary type, one set of operations
- No synchronization issues

### Flexibility

The head job can be:

- A lightweight "alias" that immediately continues to real work
- A full job that processes and completes the chain in one step
- Anything in between

### Performance

- `chainTypeName` denormalized on every job for O(1) filtering
- No subqueries needed to find chains by type
- Efficient at scale (millions of jobs)

## Execution Patterns

Chains support various patterns via `continueWith`:

### Linear

```
A → B → C → done
```

### Branched

```
A → B1 (if condition)
  → B2 (else)
```

### Loop

```
A → A → A → done
```

### Go-to (jump back)

```
A → B → A → B → done
```

## Blockers: Chain Dependencies

Chains can depend on other chains to complete before starting:

```
┌──────────────┐
│ Blocker A    │───┐
└──────────────┘   │
                   ├──→ Main Chain (blocked until A and B complete)
┌──────────────┐   │
│ Blocker B    │───┘
└──────────────┘
```

Blockers are declared at the type level and provided via the `blockers` array when creating a chain. The main job starts as `pending` with `blocked: true` and transitions to `blocked: false` when all blockers complete.

## Consistent Terminology

Parallel entities use consistent lifecycle terminology to reduce cognitive load:

- Job: `pending` → `running` → `completed`
- Chain: `running` → `completed`

Avoid asymmetric naming (e.g., `started`/`finished` vs `created`/`completed`) even if individual terms seem natural. Consistency across the API produces fewer questions and faster comprehension.

## Summary

The Chain model:

1. **Mirrors Promises**: Familiar mental model for JavaScript developers
2. **Unified identity**: The head job IS the chain—no separate entity
3. **Single table**: Jobs and chains share storage; `chainId` links them
4. **Flexible patterns**: Linear, branched, looped, or jumping execution
5. **Distributed**: Unlike Promises, chains persist and distribute across workers
