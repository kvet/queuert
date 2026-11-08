# superjson Codec

superjson codec adapter — one codec for every job type carries `Date`, `Map`, `Set` and `bigint` through job inputs and outputs, so job types are plain TypeScript types with no per-type schema. Each stored value is superjson's `{ json, meta }` envelope.

## Running

```bash
pnpm install
pnpm --filter example-codec-superjson start
```
