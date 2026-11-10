import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { type FieldItem, FieldList } from "../../../../components/FieldList.tsx";
import { Aside } from "../../../../components/mdx/Aside.tsx";
import { TabItem, Tabs } from "../../../../components/mdx/Tabs.tsx";

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
    <p>
      When to use runtime validation instead of the type-only <code>defineJobTypes</code> is covered
      in the <A href="/guides/runtime-validation/">Runtime Validation</A> guide.
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

    <h2>Define job types</h2>
    <Tabs syncKey="validation-library">
      <TabItem label="Zod">
        <ExampleCode example="validation-zod" file="src/index.ts" region="usage" />
      </TabItem>
      <TabItem label="Valibot">
        <ExampleCode example="validation-valibot" file="src/index.ts" region="usage" />
      </TabItem>
      <TabItem label="TypeBox">
        <ExampleCode example="validation-typebox" file="src/index.ts" region="usage" />
      </TabItem>
      <TabItem label="ArkType">
        <ExampleCode example="validation-arktype" file="src/index.ts" region="usage" />
      </TabItem>
    </Tabs>
    <h2>The adapter</h2>
    <p>
      Complete adapter implementations for each library. What each one costs per job is on the{" "}
      <A href="/benchmarks/runtime-performance/#job-type-registries">Runtime Performance</A> page.
    </p>
    <Tabs syncKey="validation-library">
      <TabItem label="Zod">
        <ExampleCode example="validation-zod" file="src/zod-adapter.ts" />
      </TabItem>
      <TabItem label="Valibot">
        <ExampleCode example="validation-valibot" file="src/valibot-adapter.ts" />
      </TabItem>
      <TabItem label="TypeBox">
        <ExampleCode example="validation-typebox" file="src/typebox-adapter.ts" />
      </TabItem>
      <TabItem label="ArkType">
        <ExampleCode example="validation-arktype" file="src/arktype-adapter.ts" />
      </TabItem>
    </Tabs>
    <h2>The JobTypes interface</h2>
    <p>
      The <code>JobTypes</code> object validates at each boundary:
    </p>
    <FieldList title="JobTypes" idPrefix="method" items={boundaries()} />

    <p>
      A rejected value throws <code>JobTypeValidationError</code>; its codes and how it surfaces are
      in <A href="/guides/runtime-validation/#how-errors-surface">Runtime Validation</A>.
    </p>

    <h3>Codec calls</h3>
    <p>
      Each codec method takes the <code>typeName</code> and the value. An adapter whose schemas only
      validate passes one function as both the encoder and the decoder of a field, so a schema that
      transforms would be applied again on every read; transforming schemas belong in a codec
      adapter such as the <code>codec-zod</code> example. The encoders are the gate: they run on
      every write, and a value they reject never reaches the database. The decoders run on every
      read and only for type names the registry lists in <code>getTypeNames</code>. When a decoder
      throws, the read that needed the value fails with <code>JobTypeValidationError</code>.
    </p>
    <Aside type="caution">
      Keep a job type, and a decoder that accepts every stored shape of it, for as long as rows of
      that type remain in the database. A row whose job type the registry does not list is read in
      its stored form, so its <code>input</code> and <code>output</code> do not match the declared
      types; a decoder that rejects an older stored shape makes every read of that row — including a
      dashboard page listing it — fail. Delete the chains of a job type before removing it, and
      change a schema in a way that still decodes rows written under the previous one.
    </Aside>

    <h2>Conformance</h2>
    <p>
      Each example checks its adapter with <code>validationAdapterConformanceCases</code>; see{" "}
      <A href="/integrations/validation/custom/#conformance">Custom validation adapter</A>.
    </p>
    <Tabs syncKey="validation-library">
      <TabItem label="Zod">
        <ExampleCode example="validation-zod" file="src/zod-adapter.spec.ts" />
      </TabItem>
      <TabItem label="Valibot">
        <ExampleCode example="validation-valibot" file="src/valibot-adapter.spec.ts" />
      </TabItem>
      <TabItem label="TypeBox">
        <ExampleCode example="validation-typebox" file="src/typebox-adapter.spec.ts" />
      </TabItem>
      <TabItem label="ArkType">
        <ExampleCode example="validation-arktype" file="src/arktype-adapter.spec.ts" />
      </TabItem>
    </Tabs>
    <h2>Examples</h2>
    <ExampleRows
      title="Validation adapters"
      names={["validation-zod", "validation-valibot", "validation-typebox", "validation-arktype"]}
    />
    <ExampleRows title="Codecs" names={["codec-zod", "codec-superjson"]} />
  </>
);

export default Page;
