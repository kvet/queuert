---
title: Entities
description: Core entity types — Job, Chain, and resolved variants — for the queuert core package.
sidebar:
  order: 4
---

## Job

```typescript
type Job<TJobId, TJobTypeName, TChainTypeName, TInput, TOutput, TCanContinue extends boolean> = {
  id: TJobId;
  chainId: TJobId;
  typeName: TJobTypeName;
  chainTypeName: TChainTypeName;
  input: TInput;
  createdAt: Date;
  scheduledAt: Date;
  attempt: number;
  lastAttemptAt: Date | null;
  lastAttemptError: string | null;
} & (
  | { status: "pending"; blocked: boolean }
  | {
      status: "running";
      attemptAt: Date | null;
      attemptBy: string | null;
      attemptUntil: Date | null;
    }
  | {
      status: "completed";
      completedAt: Date;
      completedBy: string | null;
      output: TOutput;
      continuedToId: null;
    }
  | (TCanContinue extends true
      ? {
          status: "completed";
          completedAt: Date;
          completedBy: string | null;
          output?: never;
          continuedToId: TJobId;
        }
      : never)
);
```

A discriminated union on **status**. All jobs carry their chain identity via **chainId** and **chainTypeName**. The **completed** status splits into two variants: a _terminal_ variant that carries the real **output** (`continuedToId: null`), and a _continued_ variant that points at the next job in the chain via **continuedToId** (no `output` field). This disambiguates "job continued via `continueWith`" from "job terminated with `output: null`". The **running** variant includes attempt metadata.

## JobStatus

```typescript
type JobStatus = "pending" | "running" | "completed";
```

The three possible job states. Used in list filters and discriminated union narrowing.

## ResolvedJob

```typescript
type ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName>;
```

A `Job` whose generic parameters have been resolved against job type definitions — typed input, output, and chain type name derived from the declared job types. Returned by client read methods like `getJob`, `getJobs`, and `listJobs` when narrowed by `typeName`.

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
} & ({ status: "running" } | { status: "completed"; output: TOutput; completedAt: Date });
```

A discriminated union on **status**. Represents the full lifecycle of a chain from creation to completion. The **completed** variant includes the chain output and completion timestamp.

## ChainStatus

```typescript
type ChainStatus = "running" | "completed";
```

The two possible chain states: `running` until the chain's tail job completes, then `completed`. Used in list filters and discriminated union narrowing.

## CompletedChain

```typescript
type CompletedChain<TChain extends AnyChain> = Extract<
  TChain,
  {
    status: "completed";
  }
>;
```

`Chain` narrowed to `status: "completed"`. Guarantees the presence of **output** and **completedAt** fields.

## ResolvedChain

```typescript
type ResolvedChain<TJobId, TJobTypeDefinitions, TJobTypeName>;
```

A `Chain` whose generic parameters have been resolved against job type definitions — typed input, output, and type name derived from the declared job types. Returned by client read methods like `getChain`, `getChains`, and `listChains` when narrowed by `typeName`.

## See Also

- [Client](/queuert/reference/queuert/client/) — Client API reference
- [Worker](/queuert/reference/queuert/worker/) — Worker and job processing reference
- [Utilities](/queuert/reference/queuert/utilities/) — Composition helpers and job-type-system types
- [Errors](/queuert/reference/queuert/errors/) — Error classes reference
- [Core Concepts](/queuert/getting-started/core-concepts/) — Chain model introduction
- [Chain Patterns](/queuert/guides/chain-patterns/) — Continuation references and patterns
