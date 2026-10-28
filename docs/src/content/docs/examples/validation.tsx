import { ExampleRows } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "Validation",
  description: "Runnable validation adapters backed by Zod, Valibot, TypeBox and ArkType.",
};

const Page = () => (
  <>
    <p>
      Queuert ships no schema library. Each example writes a validation adapter for one library in
      its <code>*-adapter.ts</code> file, with a spec next to it, and runs a small app that
      validates job inputs, outputs and references both nominally (by type name) and structurally
      (by input shape). Copy the adapter for your library.
    </p>
    <ExampleRows
      title="Validation adapters"
      names={["validation-zod", "validation-valibot", "validation-typebox", "validation-arktype"]}
    />
  </>
);

export default Page;
