import { A } from "@solidjs/router";

import { ExampleDetail } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "App Structure",
  description: "Showcases for feature slices and attempt middleware.",
};

const Page = () => (
  <>
    <p>
      Each showcase runs against PostgreSQL in Docker and prints what happens, scenario by scenario.
      Read one next to the guide it accompanies. Runtime validation has one example per schema
      library, on the <A href="/examples/validation/">Validation</A> page.
    </p>
    <h2 id="showcase-slices">Feature slices</h2>
    <ExampleDetail name="showcase-slices" />
    <h2 id="showcase-middleware">Attempt middleware</h2>
    <ExampleDetail name="showcase-middleware" />
  </>
);

export default Page;
