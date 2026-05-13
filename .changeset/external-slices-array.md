---
"queuert": major
---

Restore composition of multiple external slices for validation adapters. The 0.12 release removed `mergeJobTypeRegistries` without leaving a way to thread more than one external slice through `JobTypes`-aware adapters; adapter signatures now accept the same "single slice or readonly array" shape `createClient` already takes. A new `JobTypesDefinitions<T>` public type resolves either form to the merged `BaseJobTypeDefinitions` record, so adapter authors thread it through their `externalDefinitions` parameter without writing local helpers.

Breaking for adapter authors implementing `runValidationAdapterConformance`:

- A new required `buildWithExternalSlices` fixture exercises the multi-slice path — implementers must add a builder that consumes two external slices passed as a `readonly` array.
- The existing `buildWithExternalSlice` fixture's `blockers` type tightened from `readonly { typeName: "..." }[]` to a `readonly` tuple, so adapter schemas under test must switch the array form (e.g. `z.array(...)`, `v.array(...)`, `Type.Array(...)`, `type(...).array()`) for the tuple form (`z.tuple([...])`, `v.tuple([...])`, `Type.Tuple([...])`, `type([...])`).
- The `ExternalJobTypeDefinitions` utility type is no longer exported. It was an extractor for an implementation-detail phantom and had no production use; if you need a slice's definitions, use `JobTypeDefinitions` (single slice) or `JobTypesDefinitions` (slice or array).
