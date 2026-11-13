import { ExampleDetail } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "Operations",
  description:
    "Showcases for multiple workers, prioritization, queries, chain deletion, cleanup and application migrations.",
};

const Page = () => (
  <>
    <p>
      Running Queuert in production: several workers on one database, reserved capacity, and
      inspecting and pruning what the database holds, and migrating your own tables. Each example
      except the SQLite one runs against PostgreSQL in Docker.
    </p>
    <h2 id="state-postgres-multi-worker">Multiple worker processes</h2>
    <ExampleDetail name="state-postgres-multi-worker" />
    <h2 id="state-sqlite-multi-worker">Multiple worker processes on SQLite</h2>
    <ExampleDetail name="state-sqlite-multi-worker" />
    <h2 id="showcase-multiworker-prioritization">Prioritization</h2>
    <ExampleDetail name="showcase-multiworker-prioritization" />
    <h2 id="showcase-queries">Queries</h2>
    <ExampleDetail name="showcase-queries" />
    <h2 id="showcase-chain-deletion">Chain deletion</h2>
    <ExampleDetail name="showcase-chain-deletion" />
    <h2 id="showcase-cleanup">Cleanup</h2>
    <ExampleDetail name="showcase-cleanup" />
    <h2 id="showcase-application-migrations">Application migrations</h2>
    <ExampleDetail name="showcase-application-migrations" />
  </>
);

export default Page;
