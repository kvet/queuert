import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { type FieldItem, FieldList } from "../../../../components/FieldList.tsx";
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
    description: "Returns known type names (for merge/routing).",
  },
  {
    name: "validateEntry",
    chips: [{ label: "entry?: boolean", mono: true }],
    description: "Validates job type can start a chain.",
  },
  {
    name: "parseInput",
    chips: [{ label: "input: unknown", mono: true }],
    description: "Parses and validates job input.",
  },
  {
    name: "parseOutput",
    chips: [{ label: "output?: unknown", mono: true }],
    description: "Parses and validates job output.",
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
      <code>createJobTypes</code>, which accepts raw validation functions. Schema-specific adapters
      (Zod, Valibot, TypeBox, ArkType) are implemented in user-land, wrapping their respective
      schema libraries into the <code>JobTypes</code> interface.
    </p>
    <p>Each adapter:</p>
    <ol>
      <li>Accepts schema definitions in the library's native format.</li>
      <li>
        Infers the job type definitions from the schemas, providing the same compile-time safety as{" "}
        <code>defineJobTypes</code>.
      </li>
      <li>
        Calls <code>createJobTypes</code> with validation functions that delegate to the schema
        library.
      </li>
    </ol>
    <p>
      When to use runtime validation instead of the type-only <code>defineJobTypes</code> is covered
      in the <A href="/guides/runtime-validation/">Runtime Validation</A> guide.
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
    <p>Complete adapter implementations for each library:</p>
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

    <h2>Conformance</h2>
    <p>
      Each example checks its adapter with <code>runValidationAdapterConformance</code>; see{" "}
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
  </>
);

export default Page;
