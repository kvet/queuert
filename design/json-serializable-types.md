# Codec-Based Input/Output Serialization

## Problem

Job `input` and `output` are typed as `unknown` in `BaseJobTypeDefinition`. Non-JSON-serializable values (`Date`, `Map`, `Set`, `bigint`) are accepted at compile time but silently break on DB round-trip:

- **SQLite adapter** ([packages/sqlite/src/state-adapter/state-adapter.sqlite.ts:348](../packages/sqlite/src/state-adapter/state-adapter.sqlite.ts#L348)): `JSON.stringify(input)` — a `Date` becomes a string, deserialized as that string (type mismatch).
- **Postgres adapter** ([packages/postgres/src/state-adapter/state-adapter.pg.ts:188](../packages/postgres/src/state-adapter/state-adapter.pg.ts#L188)): pg driver stringifies internally — same silent coercion.
- **In-process adapter**: stores by reference — hides the bug entirely during testing.

Today the registry only has `parseInput`/`parseOutput` — synchronous one-way transforms applied on **write only**. There is no decode step on read, so the persisted form is what reaches the handler. Even a correct write-side transform doesn't help: a `Date` parsed and stringified to ISO is then handed to the handler as a string, not a `Date`.

## Design

The job-types registry exposes a **codec contract** with four batch async methods. Validation lives inside `encode`/`decode`. Validators with native bidirectional codec support (Zod 4's `z.codec`) integrate cleanly; validators with only one-way transforms (Zod 3, Valibot, ArkType) wire up two pipelines via a small `Codec<TIn, TOut>` helper.

### Type-level pieces

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonSerializable =
  | JsonPrimitive
  | readonly JsonSerializable[]
  | { readonly [key: string]: JsonSerializable | undefined };
```

`undefined` in object value positions supports optional properties (`{ label?: string }` → `{ label: string | undefined }`).

`BaseJobTypeDefinition.input`/`output` continue to be the **runtime** type (the form the handler sees, equivalent to `z.output<>`). `BaseJobTypeDefinition` stays `unknown` in core; the `JsonSerializable` constraint is applied at the validator-adapter layer to the **encoded** form (e.g. `createZodJobTypes` requires `z.input<schema> extends JsonSerializable`). Core stays validator-agnostic.

### Adapter contract (`JobTypesOptions`)

```ts
type ResolvedJobTypeReference = { typeName: string; input: unknown };
type ResolvedJobTypeValue = {
  typeName: string;
  direction: "input" | "output";
  value: unknown;
};

type JobTypesOptions = {
  getTypeNames(): readonly string[];
  validateEntry(typeName: string): void;

  // Both async, batch-only, heterogeneous in both `typeName` and `direction`.
  encode(items: readonly ResolvedJobTypeValue[]): Promise<unknown[]>;
  decode(items: readonly ResolvedJobTypeValue[]): Promise<unknown[]>;

  validateContinueWith(typeName: string, ref: ResolvedJobTypeReference): void;
  validateBlockers(typeName: string, refs: readonly ResolvedJobTypeReference[]): void;
};
```

Rules:

- Single-item call sites pass `[item]` and unwrap; the codec methods are batch-only by contract.
- `encode` validates the runtime form. Failures throw, wrapped as `JobTypeValidationError` (code derived from the first item's `direction`).
- `decode` validates the persisted form (defends against corruption / schema drift). Failures throw, wrapped as `JobTypeValidationError`.
- `validateContinueWith` and `validateBlockers` operate on **runtime** form. Encoding happens afterwards in the `createStateJobs` pipeline.
- **Heterogeneous batches in BOTH typeName AND direction**: read paths decode a page's worth of inputs _and_ outputs in a single `decode` call, which is load-bearing for KMS-style outer codecs that operate on `string` ciphertext regardless of typeName/direction (one `BatchDecrypt` per page, not one per type or one per direction). Validator-only adapters dispatch on `direction` per item — small mechanical boilerplate that's the cost of the simpler API.

### End-to-end flow

| Stage                                                                                                         | Operation                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `client.startChain`                                                                                           | `validateEntry` → `encode` (direction: input) → state adapter persist                                         |
| handler `continueWith`                                                                                        | `validateContinueWith` (runtime) → `encode` (direction: input) → persist next job                             |
| handler returns output                                                                                        | `encode` (direction: output) → state adapter persist completion                                               |
| worker pickup                                                                                                 | state adapter `acquireJob` → `decode` (direction: input) → handler receives runtime form                      |
| client read (`getJob`, `listJobs`, `listChainJobs`, `listBlockedJobs`, `getChain`, `trigger` returning a job) | state adapter fetch → single `decode` covering the page's inputs _and_ outputs together → return runtime form |
| observability hooks                                                                                           | encoded form passed (open question — see below)                                                               |

`mapStateJobToJob` is replaced by a batch helper (`mapStateJobsToJobs`) used by every read site. Single-job sites call it with `[job]` and unwrap. Same for `mapStatePairsToChains`. Each helper issues exactly one `decode` call per call (mixing input + output items).

### Base-layer JsonSerializable enforcement

The `JsonSerializable` contract is enforced **at the base layer**, inside the wrappers that `createJobTypes` and `createNoopJobTypes` build around the user-supplied codec methods. It is not the adapter author's responsibility to remember the check — every leaf registry runs it.

Concretely, after `encode` produces a batch, the wrapper walks each value with `isJsonSerializable` (recursive type+prototype check; rejects `Date`, `Map`, `Set`, class instances, `NaN`/`Infinity`, `bigint`, functions). On failure it throws `JobTypeValidationError` with the offending path, the item's direction (input/output), and item index.

```ts
const isJsonSerializable = (v: unknown): true | { path: string } => {
  // returns true on success, or the path of the first non-serializable node
};
```

Cost: ~10–20ns per node on V8; ~600ns for a typical 30-node payload — negligible against the DB write. Always-on, not opt-in.

`createNoopJobTypes` has identity codec methods, but it goes through the same wrapper — so the **no-codec path** (`defineJobTypes`) gets the same protection. A user who declares `input: { sendAt: Date }` and uses `defineJobTypes` gets a clear error on the first write instead of silent string coercion. This is exactly the bug the whole design closes.

### Type-level constraint on `defineJobTypes`

Because there is no codec in the noop world (encoded === runtime), `defineJobTypes` itself constrains its `input`/`output` to `JsonSerializable` at the type level. Anyone who wants `Date` (or another non-JSON type) in their handler with `defineJobTypes` gets a TS error pointing them at "use a validator adapter with codecs."

Validator adapters (`createZodJobTypes`, etc.) keep their own type-level constraint on the encoded form (`z.input<schema> extends JsonSerializable`). `BaseJobTypeDefinition.input` stays `unknown` in core — it remains validator-agnostic; the `JsonSerializable` constraint lives one layer up, applied per-adapter according to whether a codec exists.

The asymmetry is the right one: TS catches it where TS knows the shape (each adapter's surface), runtime catches it everywhere (base-layer wrapper).

### Merge-job-types routing

Three modes today (line numbers from [packages/core/src/entities/merge-job-types.ts](../packages/core/src/entities/merge-job-types.ts)):

1. **All-noop** (line 102-108): produces a fresh noop registry. Identity through, JsonSerializable check still applies.
2. **All-validated** (line 139-142): strict routing; unknown typeName throws `UnknownJobTypeError`.
3. **Mixed (validated + noop)** (line 138): routes known typeNames to owning slice; unknown typeNames fall through to identity behavior.

Under the codec API, the merge becomes a pure composer over its slices — every leaf registry already enforces JsonSerializable, so the merge itself does no extra checking:

```ts
// pseudocode
encode: async (items) => {
  // 1. Group items by owning slice using typeNameMap (direction rides along).
  // 2. Items whose typeName isn't in the map go to a "fallback" group;
  //    in mode (3), that group routes through an *internal noop registry*
  //    (synthesized once, held by closure) — so its identity encode still
  //    runs through the base-layer JsonSerializable check.
  //    In mode (2), the unknown subset throws UnknownJobTypeError.
  // 3. Call each slice's `encode` (or the internal noop's) with its subset.
  // 4. Stitch results back into the original input order.
};
```

The key invariant: **every encoded value crosses through some leaf registry's wrapper**. Mode 3's "fallback to identity for unknown types" is what made the old design risk silent `Date` corruption — replacing the inline `() => input` with delegation to an internal noop registry preserves that semantic but routes the check through. The `noopRegistries` WeakSet stays — its meaning ("this slice was made by `defineJobTypes` and tolerates unknown types") is unaffected by the codec change.

`decode` follows the same grouping-and-stitching pattern.

**Tradeoff for cross-slice batching codecs.** Per-slice grouping means that if multiple merged slices independently use the same codec backend (e.g. all KMS-backed), a single page's items get split into N codec calls rather than one. This is a **list-path concern only** — worker pickup, write paths, and blocker fetches are single-item or small-N, so the slice split costs nothing. Even on list paths, slice abstraction lets users apply KMS surgically (one sensitive slice, others plaintext) — the N-call cost only shows up when _multiple_ slices independently use the same heavy codec, which is uncommon. If a deployment hits this case, the answer is "collapse those slices into one registry"; the framework intentionally doesn't try to detect a shared backend across opaque slices.

### Adapter ergonomics

#### Built from scratch — identity codec, no validator

```ts
createJobTypes({
  getTypeNames: () => Object.keys(spec),
  validateEntry: (t) => {
    if (!spec[t].entry) throw new Error(`${t} not entry`);
  },
  encode: async (items) => items.map((i) => i.value),
  decode: async (items) => items.map((i) => i.value),
  validateContinueWith: () => {},
  validateBlockers: () => {},
});
```

#### Zod 4 — native `z.codec`

```ts
"send-email": {
  input: z.object({
    sendAt: z.codec(z.iso.datetime(), z.date(), {
      decode: (s) => new Date(s),
      encode: (d) => d.toISOString(),
    }),
  }),
}

// In the adapter (dispatch on direction per item):
encode: async (items) =>
  items.map((i) => {
    const schema = i.direction === "input" ? schemas[i.typeName].input : schemas[i.typeName].output;
    return z.encode(schema, i.value);
  }),
decode: async (items) =>
  items.map((i) => {
    const schema = i.direction === "input" ? schemas[i.typeName].input : schemas[i.typeName].output;
    return z.decode(schema, i.value);
  }),
```

#### Zod 3 / Valibot / ArkType

Pair two schemas via a `Codec<TIn, TOut>` helper (these libraries only have one-way `.transform()`). Same per-item dispatch on `direction`.

#### KMS / sensitive-data — operate on the whole heterogeneous batch

```ts
decode: async (items) => {
  const ciphers = items.map((i) => i.value as string);
  const plain = await kms.batchDecrypt(ciphers);
  return inner.decode(items.map((i, n) => ({ ...i, value: plain[n] })));
},
encode: async (items) => {
  const inner_ = await inner.encode(items);
  return kms.batchEncrypt(inner_.map(String));
},
```

Storage form for fully-encrypted values is `string`; chain semantics are unaffected because chain compatibility uses **runtime** types and `typeName`, not the encoded shape.

## Breaking changes

This is a **major** version bump.

- `parseInput`/`parseOutput` removed from `JobTypesOptions` and `JobTypes`.
- All four codec methods are required (no defaults — even passthrough adapters must spell out identity).
- `mapStateJobToJob` becomes async (or replaced by a batch helper). Direct callers in core only — public API unaffected since it was already async.
- `BaseJobTypeDefinition` semantics shift: `input`/`output` are now formally the runtime type. No syntactic change, but documentation and type derivation rely on this.
- The existing `examples/validation-zod` is updated to provide identity codecs.

## Examples

- **`validation-zod`** (updated): minimal Zod adapter, primitive-only schemas where `z.input === z.output`. Identity encode/decode. Demonstrates the basic adapter contract under the new API.
- **`codec-zod`** (new): bidirectional codecs using `z.codec` for `Date`/`Map`/etc. Demonstrates `z.input` ≠ `z.output` and the JsonSerializable enforcement on the encoded form.
- **`codec-encrypted`** (new, optional): codec wrapper for sensitive-data flow. In-process fake KMS, decrypted in handler, encrypted at rest. Demonstrates layering and the dashboard-without-codec pattern.

## Known issues / TS limits (carried over from prior design)

- **`any` escapes**: `any extends JsonSerializable` always passes — intentional, preserves existing behavior.
- **Class instances sneak through**: structural shape match — TS can't distinguish.
- **Error messages on deep nesting**: failures point at the outermost type, not the offending leaf.
- **Depth limits**: recursive conditional types may hit TS instantiation limits on deep payloads — measure with `benchmarks/type-complexity/`.
- **`unknown` in structural references**: `BaseJobTypeDefinition` stays `unknown` in core, so the existing `input: unknown` pattern in structural job-type references continues to work.

## Open questions

1. **Observability decode policy**. Decision made: encoded form is passed to observability hooks. Documentation pattern for users who need decoded values (decode-in-adapter using user-supplied codec, with the per-event cost / plaintext-leak tradeoff) is **left open** — revisit when writing the adapter docs.
2. **Error context**: if persisted error rows ever reference input/output values, what form do they carry? User-side concern; revisit if/when error attachments are added.
3. **`EnsureJsonSerializable<T>` helper**: core exports it (now decided — `defineJobTypes` and validator adapters all consume it). Open: do we want a friendlier "must-be-serializable error" message via a branded error type, or is the standard "type 'Date' is not assignable to type 'JsonSerializable'" message good enough? Defer to a usability check during Phase 5.
4. **Batching `validateEntry` / `validateContinueWith` / `validateBlockers`**: these stay one-call-per-typeName today, while `encode`/`decode` are batch async. For most usage this is fine — they fire on individual write paths (single chain start, single continueWith, single createStateJobs call). But if/when bulk-creation paths (e.g. `client.startChains` with N entries) become hot, or if a future KMS-style validator wants to amortize a network call, these may want list versions: `validateEntries(typeNames)`, `validateContinueWiths(...)`, `validateBlockerSets(...)`. Async-ifying them also opens that door. Decide when a use case forces it; not blocking the current design.

## Files (touch list)

| File                                                               | Role                                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/entities/job-types.ts`                          | `JobTypesOptions`, `JobTypes`, `createJobTypes`, `createNoopJobTypes` — primary API change; both wrappers run `isJsonSerializable` post-encode |
| `packages/core/src/entities/json-serializable.ts` (new)            | `JsonSerializable` type, `isJsonSerializable` runtime check, `EnsureJsonSerializable<T>` utility                                               |
| `packages/core/src/entities/define-job-type-registry.ts`           | `defineJobTypes` constrains `input`/`output` to `JsonSerializable` at the type level                                                           |
| `packages/core/src/entities/job-type.ts`                           | `BaseJobTypeDefinition` — semantic clarification (runtime type); stays `unknown` in core                                                       |
| `packages/core/src/entities/job-type.validation.ts`                | `ValidateJobType` — keep `NoVoidOrUndefined`; `JsonSerializable` constraint applied in `defineJobTypes` and validator adapters                 |
| `packages/core/src/entities/merge-job-types.ts`                    | Group items by owning slice; route fallback (mixed-merge unknown types) through internal noop registry so JsonSerializable check still fires   |
| `packages/core/src/entities/job.ts`                                | `mapStateJobToJob` → async/batch variant                                                                                                       |
| `packages/core/src/implementation/create-state-jobs.ts`            | Call `encode` (direction: input) after validate                                                                                                |
| `packages/core/src/implementation/finish-job.ts`                   | Call `encode` (direction: output)                                                                                                              |
| `packages/core/src/implementation/continue-with.ts`                | Validate runtime form (unchanged); decode after pickup elsewhere                                                                               |
| `packages/core/src/worker/job-process.ts`                          | `decode` on pickup; mapping decoded job for handler                                                                                            |
| `packages/core/src/client.ts`                                      | All read methods batch-decode pages                                                                                                            |
| `packages/core/src/observability-adapter/observability-adapter.ts` | Document encoded form; no signature change today                                                                                               |
| `examples/validation-zod/src/zod-adapter.ts`                       | Identity codecs                                                                                                                                |
| `examples/codec-zod/` (new)                                        | Bidirectional codec showcase                                                                                                                   |
| `examples/codec-encrypted/` (new, optional)                        | KMS-style wrapper showcase                                                                                                                     |
| `packages/core/src/entities/job-types.spec.ts`                     | Update for new contract                                                                                                                        |
| `packages/core/src/conformance/validation-adapter.spec.ts`         | Update conformance for codec API                                                                                                               |
| `packages/core/src/client.merge.spec.ts`                           | Update routing tests                                                                                                                           |
| `benchmarks/type-complexity/`                                      | Re-measure after type changes                                                                                                                  |
| `docs/src/content/docs/advanced/`                                  | Reference docs update                                                                                                                          |
| `.changeset/codec-job-types.md`                                    | Major changeset across affected packages                                                                                                       |

## Implementation plan

Phased so each phase ends with a green `bun run check`. Each phase is a single PR-sized unit.

### Phase 1 — Core API surface (registry only)

Goal: replace `parseInput`/`parseOutput` with the two batch async codec methods (`encode`/`decode`, with `direction: "input" | "output"` on each item) inside the registry, with no consumers updated yet (compile errors expected outside this phase's files; gate with a temporary `parseInput`/`parseOutput` shim if necessary to keep intermediate commits compiling).

- [ ] Add `packages/core/src/entities/json-serializable.ts`: `JsonSerializable` type, `EnsureJsonSerializable<T>` utility, and `isJsonSerializable(value): true | { path: string }` runtime check (recursive walk; rejects `Date`, `Map`, `Set`, class instances, `NaN`/`Infinity`, `bigint`, functions, symbols). Export from package root. Unit tests cover each rejection class plus deep-nesting paths.
- [ ] Update `JobTypesOptions` and `JobTypes` in [packages/core/src/entities/job-types.ts](../packages/core/src/entities/job-types.ts): remove `parseInput`/`parseOutput`, add the two batch async codec methods (`encode`/`decode`, with `direction: "input" | "output"` on each item). Wrap each call so that:
  1. Adapter-thrown errors are wrapped as `JobTypeValidationError` per item (preserve item index, `typeName`, and original cause).
  2. After `encode` returns, every value is checked with `isJsonSerializable`; failures throw `JobTypeValidationError` with the offending path and item's direction.
- [ ] Update `createNoopJobTypes`: identity codec methods that go through the same wrapper (so `defineJobTypes` users get the runtime check for free).
- [ ] Update `defineJobTypes` ([packages/core/src/entities/define-job-type-registry.ts](../packages/core/src/entities/define-job-type-registry.ts)) to constrain its `input`/`output` generics to `JsonSerializable` at the type level. Compile-error message points users at validator adapters with codecs.
- [ ] Update `mergeJobTypes` ([packages/core/src/entities/merge-job-types.ts](../packages/core/src/entities/merge-job-types.ts)) for the four codec methods:
  - All-noop mode: unchanged — returns a fresh noop registry.
  - All-validated and mixed modes: group `items` by owning slice (using `typeNameMap`), call each slice's batch method with its subset, stitch results back to original input order.
  - Mixed-mode fallback for unknown types: synthesize one internal `createNoopJobTypes()` instance held by the merge closure; route the fallback subset through it (replaces today's inline `() => input`). This preserves the JsonSerializable check on every encoded value, including unknowns in noop-tolerant merges.
  - All-validated unknown-type behavior unchanged: `UnknownJobTypeError`.
- [ ] Update `packages/core/src/entities/job-types.spec.ts` for the new contract; add tests for: heterogeneous batches; per-item error wrapping with index/typeName; async error propagation; `isJsonSerializable` enforcement on identity (noop) encoders; `defineJobTypes` type-level rejection of `Date`-bearing definitions.
- [ ] Update `packages/core/src/client.merge.spec.ts` to cover: mixed-merge unknown-type fallback now JsonSerializable-checked; heterogeneous batch grouping/stitching preserves order across multiple slices.
- [ ] Update `packages/core/src/conformance/validation-adapter.spec.ts` to drive the four batch methods through every adapter under test.

### Phase 2 — Write paths (encode)

- [ ] [packages/core/src/implementation/create-state-jobs.ts](../packages/core/src/implementation/create-state-jobs.ts): collect all to-be-created jobs into a single `encode` call (each item with `direction: "input"`). Preserve order when assigning encoded values back to `createJobParams`.
- [ ] [packages/core/src/implementation/finish-job.ts](../packages/core/src/implementation/finish-job.ts): call `encode([{typeName, direction: "output", value: output}])`.
- [ ] [packages/core/src/implementation/continue-with.ts](../packages/core/src/implementation/continue-with.ts): no change to `validateContinueWith` (still runtime form). Encoding happens via the downstream `createStateJobs` call.
- [ ] Tests: write-side encode happens exactly once per batch; encode failures surface as `JobTypeValidationError`; multi-job creates produce a single `encode` call.

### Phase 3 — Read paths (decode)

- [ ] [packages/core/src/entities/job.ts](../packages/core/src/entities/job.ts): replace `mapStateJobToJob` with `mapStateJobsToJobs(stateJobs, jobTypes): Promise<Job[]>`. The helper:
  1. Builds a single batch covering every job's input plus every completed job's output (each item carries its `direction`), and issues one `decode` call.
  2. Awaits both.
  3. Maps decoded values back onto each job in original order.
     Single-job sites call it with `[job]` and unwrap.
- [ ] Update all 8 callers (per inventory):
  - `packages/core/src/client.ts` — `trigger` (line 629), `getJob` (919), `listJobs` (1004), `listChainJobs` (1045), `listBlockedJobs` (1120). All already async.
  - `packages/core/src/implementation/continue-with.ts` (line 62).
  - `packages/core/src/worker/job-process.ts` (lines 368, 531).
- [ ] Worker pickup specifically: ensure `decode` is called between `acquireJob` and handler invocation; runtime input is what the handler sees and what continues into `continueWith` flows.
- [ ] `getChain`/`listChains` paths: if they surface job-shaped data, batch-decode that page too. Audit during implementation.
- [ ] Tests:
  - List of N jobs of mixed types → exactly one `decode` call per page (covering both inputs and outputs).
  - Corrupt persisted value → `JobTypeValidationError` with item context.
  - Worker handler receives runtime form, not encoded form.
  - End-to-end roundtrip with `Date` field via Zod 4 codec lands as `Date` in handler and `Date` in `getJob`.

### Phase 4 — Observability and structural unknowns

- [ ] Confirm observability hooks receive the **encoded** form (no signature change in [packages/core/src/observability-adapter/observability-adapter.ts](../packages/core/src/observability-adapter/observability-adapter.ts) — clarify in JSDoc).
- [ ] Verify structural job-type references with `input: unknown` still type-check after the `BaseJobTypeDefinition` semantic clarification. Run the existing spec suite that uses this pattern.
- [ ] Run `benchmarks/type-complexity/` to confirm no instantiation-depth regressions.

### Phase 5 — Validator adapters and examples

- [ ] Update `examples/validation-zod` to provide identity codecs (define an inline `perTypeName` helper at the top of the adapter module). Tighten its schemas to primitive-only so `z.input === z.output` is real, not assumed.
- [ ] New `examples/codec-zod`: end-to-end Zod 4 `z.codec` example with the same inline `perTypeName` helper, at least one `Date` field, a chain that crosses jobs carrying the `Date` through `continueWith`, and a client read that returns the decoded `Date`. Single-purpose, follows examples conventions in [code-style.md](../code-style.md).
- [ ] Optional `examples/codec-encrypted`: in-process fake KMS wrapping `codec-zod`. Demonstrates a "dashboard without codec sees ciphertext, dashboard with codec sees plaintext" split. Skip if it bloats the example surface — judgment call during implementation.

### Phase 6 — Reference docs and changeset

- [ ] Update `docs/src/content/docs/advanced/` reference doc(s) covering job-type registries to describe the codec contract, the runtime-vs-encoded split, and the observability-decode open question.
- [ ] Migration guide section: how to port a `parseInput`/`parseOutput` adapter to the two codec methods (identity case + codec case + per-direction dispatch pattern).
- [ ] `.changeset/codec-job-types.md` — major bump for `queuert` and any package that re-exports the registry surface; one-paragraph user-facing note + flat bullet list of changes.

### Phase 7 — Final validation

- [ ] `bun run fmt`, `bun run check` (redirected to a file per CLAUDE.md).
- [ ] Cross-check the type-complexity benchmark output against the pre-change baseline.
- [ ] Smoke-test all examples (covered by `bun run examples` in `bun run check`).

### Out of scope for this change

- Dashboard UI awareness of encoded vs decoded forms beyond the natural "decoded by client" path.
- Error-row attachments referencing input/output values.
- Helper utilities to decode-in-observability — left as documentation.
- Type-level enforcement that the encoded form is `JsonSerializable` inside core (lives in validator-adapters; revisit if a shared core utility proves useful).
