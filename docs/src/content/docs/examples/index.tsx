import { ExamplePageCards } from "../../../components/ExampleList.tsx";
import { Code } from "../../../components/mdx/Code.tsx";

export const meta = {
  title: "Examples",
  description: "Self-contained, runnable examples for each adapter and most guides.",
};

const Page = () => (
  <>
    <p>
      Each example in{" "}
      <a href="https://github.com/kvet/queuert/tree/main/examples">
        <code>examples/</code>
      </a>{" "}
      is a workspace package that shows one integration or one pattern. Every example has a stable
      link on its page here, with what it shows, the command that runs it, and its key files.
    </p>
    <h2 id="running">Running an example</h2>
    <p>
      Clone the repository, run <code>pnpm install</code> at its root, then start an example by its
      package name, which is the directory name with an <code>example-</code> prefix:
    </p>
    <Code lang="bash">{`
      pnpm install
      pnpm --filter example-showcase-scheduling start
    `}</Code>
    <p>
      Examples that use PostgreSQL, Redis or NATS start them in Docker with testcontainers, so
      Docker must be running. Examples marked <strong>Bun</strong> run under Bun instead of Node.js.
    </p>
    <h2 id="integrations">Integrations</h2>
    <p>One example per driver, ORM or library, each wiring a single adapter into a minimal app.</p>
    <ExamplePageCards
      slugs={["state-adapters", "notify-adapters", "validation", "logging-observability"]}
    />
    <h2 id="showcases">Showcases</h2>
    <p>
      Scenario-driven examples on PostgreSQL, each built around the guide it accompanies and grouped
      the way the guides are.
    </p>
    <ExamplePageCards
      slugs={["building-chains", "scheduling", "reliability", "app-structure", "operations"]}
    />
  </>
);

export default Page;
