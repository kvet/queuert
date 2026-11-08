import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";

export const meta = {
  title: "Custom Validation Adapter",
  description:
    "Wrap any schema library into a JobTypes registry and check it with the conformance suite.",
};

const Page = () => (
  <>
    <p>
      Validation adapters are thin wrappers around schema libraries that produce a{" "}
      <code>JobTypes</code> registry. You can write one for any schema library, following the same
      pattern as the <A href="/integrations/validation/">Zod, Valibot, TypeBox and ArkType</A>{" "}
      adapters, and validate it with the conformance suite.
    </p>

    <h2>Conformance</h2>
    <p>
      <code>runValidationAdapterConformance</code> from <code>queuert/conformance</code> checks
      that:
    </p>
    <ul>
      <li>
        The adapter's eight runtime methods (<code>getTypeNames</code>, <code>validateEntry</code>,{" "}
        <code>encodeInput</code>, <code>decodeInput</code>, <code>encodeOutput</code>,{" "}
        <code>decodeOutput</code>, <code>validateContinueWith</code>, <code>validateBlockers</code>)
        behave correctly.
      </li>
      <li>
        Schema validation failures are wrapped in <code>JobTypeValidationError</code> with the right{" "}
        <code>code</code>, <code>typeName</code> and <code>cause</code>.
      </li>
      <li>
        The schema-to-shape inference (<code>z.infer</code>, <code>{"Static<>"}</code>,{" "}
        <code>T["infer"]</code>, <code>v.InferOutput</code>, etc.) threads through to the phantom
        job type definitions correctly.
      </li>
    </ul>
    <p>
      The last point is enforced at compile time: each builder in the fixture has a precise return
      type, so an inference bug in your adapter trips a TypeScript error at the call site of{" "}
      <code>runValidationAdapterConformance</code>, before the runtime suite even executes. The
      runner throws on failure, so any test framework works. The Zod example's spec:
    </p>
    <ExampleCode example="validation-zod" file="src/zod-adapter.spec.ts" />
    <p>
      The exact phantom shape each builder must produce is encoded in the{" "}
      <a href="https://github.com/kvet/queuert/blob/main/packages/core/src/conformance/validation-adapter-cases.ts">
        <code>ValidationConformanceFixture</code>
      </a>{" "}
      type. The full API is in the <A href="/api/conformance/readme/">conformance reference</A>.
    </p>
  </>
);

export default Page;
