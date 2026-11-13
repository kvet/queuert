---
title: Typing a job chain
description: How to keep a job's input and output types connected across the queue boundary, from the call that starts a chain to the job that ends it.
date: "2026-05-04"
---

A `Promise` chain in TypeScript is checked from end to end:

```ts
const summary = await fetchUser(userId)
  .then((user) => fetchOrders(user.id))
  .then((orders) => summarize(orders));
```

Each step's input is the previous step's output. Rename a field on `user` and the compiler points at `fetchOrders(user.id)`; misuse `summary` and it points there too.

Now the same sequence as background jobs:

```ts
await queue.add("fetch-user", { userId });
// a worker handles fetch-user, then enqueues fetch-orders
// a worker handles fetch-orders, then enqueues summarize
```

The compiler sees a `string` and an `unknown`. Nothing connects what the `fetch-user` handler produces to what the `fetch-orders` handler expects, so renaming a field breaks production instead of the build. That isn't a TypeScript limitation. The queue boundary is a name and a serialized payload, and the connection between producer, handler and next step lives only in convention. To get it back, the types need something to anchor to.

## One map of every job type

The anchor is a single type that describes every job type: what it takes, what it may continue with, and what it returns if it ends the chain.

```ts
type JobTypes = {
  "provision-account": {
    entry: true;
    input: { userId: string };
    continueWith: "send-welcome-email";
  };
  "send-welcome-email": {
    input: { userId: string; accountId: string };
    continueWith: "sync-to-crm";
  };
  "sync-to-crm": {
    input: { userId: string; accountId: string };
    output: { syncedAt: string };
  };
};

type TypeName = keyof JobTypes;
```

It is a plain type literal: no code generation, no decorators, no schema language. The `continueWith` field turns the set of job types into a graph, and everything below is a walk over that graph.

## Starting a chain

Only some job types make sense as the start of a chain. A mapped type picks them out, and a generic over the type name ties the input to it:

```ts
type EntryTypeName = {
  [K in TypeName]: JobTypes[K] extends { entry: true } ? K : never;
}[TypeName];

declare const startChain: <T extends EntryTypeName>(
  typeName: T,
  input: JobTypes[T]["input"],
) => Promise<void>;

startChain("provision-account", { userId: "u_1" });
startChain("provision-account", { user: "u_1" }); // error: wrong input
startChain("sync-to-crm", { userId: "u_1", accountId: "a_1" }); // error: not an entry
```

`T` is inferred from the literal you pass, so the input is checked against exactly that type, and a type that can only appear mid-chain is rejected outright.

## Continuing a chain

A handler's result is the edge to the next job. Compute it from the map: a type with `continueWith` must name one of its declared successors and pass that successor's input; a type without it must return its `output`.

```ts
type Outcome<K extends TypeName> = JobTypes[K] extends { continueWith: infer Next extends TypeName }
  ? { [N in Next]: { continueWith: N; input: JobTypes[N]["input"] } }[Next]
  : JobTypes[K] extends { output: infer Output }
    ? { output: Output }
    : never;

type Handlers = {
  [K in TypeName]: (job: { input: JobTypes[K]["input"] }) => Promise<Outcome<K>>;
};
```

The inner mapped type matters. Indexing it with `[Next]` produces one object per successor, a union discriminated by `continueWith`, so each successor's name is paired with its own input rather than with any successor's input.

```ts
const handlers: Handlers = {
  "provision-account": async (job) => ({
    continueWith: "send-welcome-email",
    input: { userId: job.input.userId, accountId: await createAccount(job.input.userId) },
  }),
  // ...
};
```

Leave out `accountId` and the compiler complains. Continue with a job type that `provision-account` didn't declare and it complains too.

## Branches and loops

Both fall out of the same definitions. A branch is a union of successors:

```ts
"trial-decision": {
  entry: true;
  input: { subscriptionId: number };
  continueWith: "convert-to-paid" | "expire-trial";
};
```

The handler may return either edge, and each is checked against its own target. A loop is a job type that lists itself:

```ts
"charge-billing": {
  input: { subscriptionId: number; cycle: number };
  output: { totalCharged: number };
  continueWith: "charge-billing" | "cancel-subscription";
};
```

Because edges are names rather than nested types, a self-reference is nothing special to the compiler. Recurring billing, polling and retry loops are just cycles in the graph.

The other direction is harder. The result of a whole chain is the `output` of whichever job ends it, so typing `await chain.result` means collecting every job type reachable from the entry type and taking the union of the outputs of those that can end the chain. That is a recursive walk at the type level, and it needs a visited set so cycles terminate.

## Fan-in

A job sometimes waits for other chains to finish before it runs: an aggregate over several fetches, an action that needs a validated user and a loaded config. Describe its dependencies as a tuple of type names, and a mapped tuple type keeps every position:

```ts
type BlockerOutputs<TBlockers extends readonly TypeName[]> = {
  [I in keyof TBlockers]: {
    output: JobTypes[TBlockers[I]] extends { output: infer Output } ? Output : never;
  };
};

declare const fixed: BlockerOutputs<["validate-user", "load-config"]>;
fixed[0].output.role; // validate-user's output
fixed[1].output.value; // load-config's output

declare const variadic: BlockerOutputs<"fetch-source"[]>;
variadic.map((blocker) => blocker.output.data); // any number of fetch-source outputs
```

A fixed tuple gives each slot its own type; an array type gives any number of the same one. Mapping over `keyof` a tuple preserves its shape, so both come from the same definition.

## What the compiler can't see

All of this is erased at runtime, and job payloads outlive the code that wrote them:

- **Persisted inputs outlive deploys.** A job inserted by yesterday's code is handled by today's. Changing a job type's input changes the type for new jobs only, so a breaking change needs a new type name, or a handler that accepts both shapes, until the old jobs are gone.
- **Not every producer is your compiler.** Jobs created from another service, a script or a SQL console bypass the types. Validating input at the boundary, with a runtime schema that matches the type, catches what the compiler never saw.

## What it costs

Type-level graph walks aren't free. Every check instantiates mapped and conditional types, and a naive recursive walk over a large graph can make the editor sluggish or hit the compiler's depth limits. Two techniques keep it in check: compute derived maps (successors, reachable outputs) once and index into them instead of recomputing per call site, and write recursive types in tail position so the compiler can evaluate them iteratively. With those, graphs far larger than a real application's stay fast to check.

Queuert's job types work this way: [Chain Patterns](../../guides/chain-patterns/) shows `defineJobTypes` with branches and loops, [Job Type References](../../how-it-works/job-type-references/) covers the type hierarchy, and the [Type Complexity](../../benchmarks/type-complexity/) benchmark measures what checking them costs.
