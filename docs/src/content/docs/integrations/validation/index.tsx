import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { type FieldItem, FieldList } from "../../../../components/FieldList.tsx";
import { Aside } from "../../../../components/mdx/Aside.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "Validation",
  description:
    "Runtime validation of job inputs, outputs, continuations and blockers with Zod, Valibot, TypeBox or ArkType.",
};

const boundaries = (): FieldItem[] => [
  {
    name: "getTypeNames",
    chips: [{ label: "(all)", mono: true }],
    description:
      "Returns known type names, used to route merged slices and to pick which values are decoded.",
  },
  {
    name: "validateEntry",
    chips: [{ label: "entry?: boolean", mono: true }],
    description: "Validates job type can start a chain.",
  },
  {
    name: "encodeInput / decodeInput",
    chips: [{ label: "input: unknown", mono: true }],
    description: "Converts input between runtime and stored form.",
  },
  {
    name: "encodeOutput / decodeOutput",
    chips: [{ label: "output?: unknown", mono: true }],
    description: "Converts output between runtime and stored form.",
  },
  {
    name: "validateContinueWith",
    chips: [{ label: "continueWith?: Reference", mono: true }],
    description: "Validates continuation target.",
  },
  {
    name: "validateBlockers",
    chips: [{ label: "blockers?: Reference[]", mono: true }],
    description: "Validates blocker references.",
  },
];

const Page = () => (
  <>
    <p>
      Queuert's runtime validation follows an adapter pattern. The core provides{" "}
      <code>createJobTypes</code>, which accepts raw validation and codec functions. Schema-specific
      adapters (Zod, Valibot, TypeBox, ArkType) are implemented in user-land, wrapping their
      respective schema libraries into the <code>JobTypes</code> interface.
    </p>
    <p>Each adapter:</p>
    <ol>
      <li>Accepts schema definitions in the library's native format.</li>
      <li>
        Infers the job type definitions from the schemas, providing the same compile-time safety as{" "}
        <code>defineJobTypes</code>.
      </li>
      <li>
        Calls <code>createJobTypes</code> with functions that delegate to the schema library.
      </li>
    </ol>
    <h2>When to use it</h2>
    <p>
      <code>defineJobTypes</code> gives compile-time type safety with zero runtime cost. When job
      inputs come from outside your program — HTTP handlers, dashboards, cross-service cron payloads
      — TypeScript can't reject a malformed value before your handler runs.{" "}
      <code>createJobTypes</code> closes that gap with callbacks that run at every boundary the
      library touches (entry, input, output, continuation, blockers).
    </p>
    <p>
      Reach for it when inputs cross a trust boundary, or when you already depend on a schema
      library and want the same schemas to guard your jobs. Stick with <code>defineJobTypes</code>{" "}
      when every caller is internal code TypeScript already checks.
    </p>

    <h2 id="runtime-form-vs-stored-form">Runtime form vs stored form</h2>
    <p>
      A job type definition's <code>input</code> and <code>output</code> describe the{" "}
      <strong>runtime</strong> form — what a handler receives and what a client read returns. The{" "}
      <strong>stored</strong> form is what the state adapter persists, and it must be
      JSON-serializable.
    </p>
    <p>
      The two forms are bridged by an encoder and a decoder for each of <code>input</code> and{" "}
      <code>output</code>:
    </p>
    <ul>
      <li>
        <code>encodeInput</code> / <code>encodeOutput</code> run on every write, turning the runtime
        form into the stored form.
      </li>
      <li>
        <code>decodeInput</code> / <code>decodeOutput</code> run on every read, turning the stored
        form back into the runtime form.
      </li>
    </ul>
    <p>
      For most schemas the two forms are identical and both methods are a validation pass that
      returns the value unchanged. They diverge when a schema transforms — a <code>Date</code> in
      the handler stored as an ISO string, for instance. Whatever an encoder returns is checked
      against <code>isJsonSerializable</code> by <code>createJobTypes</code> itself, so an adapter
      that lets a <code>Date</code> reach storage fails on the first write, before anything is
      stored.
    </p>
    <p>
      <code>defineJobTypes</code> has no codec, so the runtime form <em>is</em> the stored form: it
      constrains <code>input</code> and <code>output</code> to JSON-serializable types at compile
      time, and a definition carrying a <code>Date</code>, <code>Map</code> or <code>bigint</code>{" "}
      is a type error.
    </p>

    <h3>Values that aren't JSON</h3>
    <p>
      A <code>Date</code>, <code>Map</code> or <code>bigint</code> needs a codec adapter that
      converts it to a stored form on every write and back on every read. A Zod codec does that in
      one schema:
    </p>
    <Code lang="ts">{`const zDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});

const jobTypes = createZodCodecJobTypes({
  "send-reminder": {
    entry: true,
    input: z.object({ sendAt: zDate }),
    output: z.object({ sent: z.boolean() }),
  },
});`}</Code>
    <p>
      <code>sendAt</code> is a <code>Date</code> in the handler and a string in the database. See
      the <code>validation/codec-zod</code> example for the full chain.
    </p>
    <p>
      When you'd rather not write a codec per type, one codec can serve every job type. The{" "}
      <code>validation/codec-superjson</code> example declares job types as plain TypeScript types
      holding a <code>Date</code>, <code>Map</code> or <code>bigint</code> and stores each value as
      superjson's <code>{"{ json, meta }"}</code> envelope:
    </p>
    <Code lang="ts">{`const jobTypes = createSuperjsonJobTypes<{
  "send-reminder": { entry: true; input: { sendAt: Date }; output: { sent: boolean } };
}>({ "send-reminder": true });`}</Code>

    <h2>Define job types</h2>
    <Tabs syncKey="validation-library">
      <TabItem label="Zod">
        <ExampleCode example="validation/zod" file="src/index.ts" region="usage" />
      </TabItem>
      <TabItem label="Valibot">
        <ExampleCode example="validation/valibot" file="src/index.ts" region="usage" />
      </TabItem>
      <TabItem label="TypeBox">
        <ExampleCode example="validation/typebox" file="src/index.ts" region="usage" />
      </TabItem>
      <TabItem label="ArkType">
        <ExampleCode example="validation/arktype" file="src/index.ts" region="usage" />
      </TabItem>
    </Tabs>
    <h2>The adapter</h2>
    <p>
      Complete adapter implementations for each library. What each one costs per job is on the{" "}
      <a href={siteHref("/benchmarks/runtime-performance/#job-type-registries")}>
        Runtime Performance
      </a>{" "}
      page.
    </p>
    <Tabs syncKey="validation-library">
      <TabItem label="Zod">
        <ExampleCode example="validation/zod" file="src/zod-adapter.ts" />
      </TabItem>
      <TabItem label="Valibot">
        <ExampleCode example="validation/valibot" file="src/valibot-adapter.ts" />
      </TabItem>
      <TabItem label="TypeBox">
        <ExampleCode example="validation/typebox" file="src/typebox-adapter.ts" />
      </TabItem>
      <TabItem label="ArkType">
        <ExampleCode example="validation/arktype" file="src/arktype-adapter.ts" />
      </TabItem>
    </Tabs>
    <h2>The JobTypes interface</h2>
    <p>
      The <code>JobTypes</code> object validates at each boundary:
    </p>
    <FieldList title="JobTypes" idPrefix="method" items={boundaries()} />

    <h3>Codec calls</h3>
    <p>
      Each codec method takes the <code>typeName</code> and the value. An adapter whose schemas only
      validate passes one function as both the encoder and the decoder of a field, so a schema that
      transforms would be applied again on every read; transforming schemas belong in a codec
      adapter such as the <code>validation/codec-zod</code> example. The encoders are the gate: they
      run on every write, and a value they reject never reaches the database. The decoders run on
      every read and only for type names the registry lists in <code>getTypeNames</code>. When a
      decoder throws, the read that needed the value fails with <code>JobTypeValidationError</code>.
    </p>
    <Aside type="caution">
      Keep a job type, and a decoder that accepts every stored shape of it, for as long as rows of
      that type remain in the database. A row whose job type the registry does not list is read in
      its stored form, so its <code>input</code> and <code>output</code> do not match the declared
      types; a decoder that rejects an older stored shape makes every read of that row — including a
      dashboard page listing it — fail. Delete the chains of a job type before removing it, and
      change a schema in a way that still decodes rows written under the previous one.
    </Aside>

    <h2 id="how-errors-surface">How errors surface</h2>
    <p>
      A failed validation throws <code>JobTypeValidationError</code>. A <code>code</code> identifies
      which boundary rejected the value, and <code>typeName</code> identifies the job type:
    </p>
    <Code lang="ts">{`import { JobTypeValidationError } from "queuert";

try {
  await stateProvider.withTransaction(async (txCtx) =>
    client.createChain({ ...txCtx, typeName: "send-email", input: untrusted }),
  );
} catch (err) {
  if (err instanceof JobTypeValidationError && err.code === "invalid_input") {
    // 400 to the caller — the payload was malformed
  }
}`}</Code>
    <p>
      Errors thrown by the underlying schema library (<code>ZodError</code>, <code>ValiError</code>,{" "}
      <code>TypeBoxError</code>, ...) are caught and wrapped, so callers always handle a single
      error type regardless of which library the adapter uses. The five codes are{" "}
      <code>not_entry_point</code>, <code>invalid_input</code>, <code>invalid_output</code>,{" "}
      <code>invalid_continuation</code>, and <code>invalid_blockers</code>. <code>details</code>{" "}
      holds what failed validation (the input, output, continuation target or blockers), and{" "}
      <code>cause</code> the error the validation function threw. When an encoder returns a value
      that is not JSON-serializable, <code>details</code> holds that encoded value and the{" "}
      <code>path</code> to the offending part, such as <code>["items", 1, "at"]</code>.
    </p>
    <p>
      The client's <code>createChains</code> and <code>applyJobOutcomes</code>, and a batched
      attempt handler's <code>applyJobOutcomes</code>, validate every item before throwing, and
      throw <code>JobsTypeValidationError</code>: <code>itemIndexes</code> lists the position of
      each rejected item in <code>items</code>, and <code>errors</code> holds its{" "}
      <code>JobTypeValidationError</code>, in the same order. When items fail with different kinds
      of errors, it lists the items of the first kind, and blockers are validated after the other
      checks pass. How a validation error interacts with retries and chain failure is in{" "}
      <a href={siteHref("/guides/error-handling/")}>Error Handling</a>.
    </p>

    <h2>Conformance</h2>
    <p>
      Each example checks its adapter with the cases from{" "}
      <code>createValidationAdapterConformanceCases</code>; see{" "}
      <a href={siteHref("/integrations/validation/custom/#conformance")}>
        Custom validation adapter
      </a>
      .
    </p>
    <Tabs syncKey="validation-library">
      <TabItem label="Zod">
        <ExampleCode example="validation/zod" file="src/zod-adapter.spec.ts" />
      </TabItem>
      <TabItem label="Valibot">
        <ExampleCode example="validation/valibot" file="src/valibot-adapter.spec.ts" />
      </TabItem>
      <TabItem label="TypeBox">
        <ExampleCode example="validation/typebox" file="src/typebox-adapter.spec.ts" />
      </TabItem>
      <TabItem label="ArkType">
        <ExampleCode example="validation/arktype" file="src/arktype-adapter.spec.ts" />
      </TabItem>
    </Tabs>
    <h2>Examples</h2>
    <ExampleRows
      title="Validation adapters"
      names={["validation/zod", "validation/valibot", "validation/typebox", "validation/arktype"]}
    />
    <ExampleRows title="Codecs" names={["validation/codec-zod", "validation/codec-superjson"]} />
  </>
);

export default Page;
