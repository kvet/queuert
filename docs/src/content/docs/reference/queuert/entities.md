---
title: Entities
description: Core entity types — Job, Chain, and resolved variants — for the queuert core package.
sidebar:
  order: 4
---

## Job

```typescript
type Job<TJobId, TJobTypeName, TChainTypeName, TInput, TOutput> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  chainIndex: number;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running"; leasedBy?: string; leasedUntil?: Date }
  | { status: "completed"; completedAt: Date; completedBy: string | null; output: TOutput }
);
```

A discriminated union on **status**. All jobs carry their chain identity via **chainId** and **chainTypeName**, and their position via **chainIndex**. The **running** variant includes lease metadata. The **completed** variant includes completion timestamps, the worker identity, and the job's **output**.

## JobStatus

```typescript
type JobStatus = "blocked" | "pending" | "running" | "completed";
```

The four possible job states. Used in list filters and discriminated union narrowing.

## ResolvedJob

```typescript
type ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
```

A `Job` whose generic parameters have been resolved against job type definitions — typed input, output, and chain type name derived from the declared job types. Returned by client read methods like `getJob` and `listJobs` when narrowed by `typeName`.

## ResolvedJobWithBlockers

```typescript
type ResolvedJobWithBlockers<
  TJobId,
  TJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> = ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName> & {
  blockers: CompletedBlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>;
};
```

A `ResolvedJob` extended with resolved blocker chains. **blockers** contains the completed blocker chain data, available inside worker handlers when the job type declares blockers.

## Chain

```typescript
type Chain<TJobId, TChainTypeName, TInput, TOutput> = {
  id: TJobId;
  typeName: TChainTypeName;
  input: TInput;
  createdAt: Date;
} & (
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running" }
  | { status: "completed"; output: TOutput; completedAt: Date }
);
```

A discriminated union on **status**. Represents the full lifecycle of a chain from creation to completion. The **completed** variant includes the chain output and completion timestamp.

## ChainStatus

```typescript
type ChainStatus = "blocked" | "pending" | "running" | "completed";
```

The four possible chain states. Used in list filters and discriminated union narrowing.

## CompletedChain

```typescript
type CompletedChain<TChain extends Chain<any, any, any, any>> = TChain & {
  status: "completed";
};
```

`Chain` narrowed to `status: "completed"`. Guarantees the presence of **output** and **completedAt** fields.

## ResolvedChain

```typescript
type ResolvedChain<TJobId, TJobTypeDefinitions, TJobTypeName>;
```

A `Chain` whose generic parameters have been resolved against job type definitions — typed input, output, and type name derived from the declared job types. Returned by client read methods like `getChain` and `listChains` when narrowed by `typeName`.

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Worker](/queuert/reference/queuert/worker/) — Worker and job processing reference
- [Utilities](/queuert/reference/queuert/utilities/) — Composition helpers and job-type-system types
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [Core Concepts](/queuert/getting-started/core-concepts/) — Chain model introduction
- [Chain Patterns](/queuert/guides/chain-patterns/) — Continuation references and patterns
