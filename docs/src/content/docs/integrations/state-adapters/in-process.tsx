import { A } from "@solidjs/router";

import { FieldList } from "../../../../components/FieldList.tsx";
import {
  StateAdapterConfigNote,
  stateAdapterConfigItems,
} from "../../../../components/integrations/state-adapters/stateAdapterConfig.tsx";
import { Aside } from "../../../../components/mdx/Aside.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";

export const meta = {
  title: "In-Process State Adapter",
  description:
    "Keep chains and jobs in memory, for tests and single-process scripts that don't need persistence.",
};

const Page = () => (
  <>
    <p>
      The in-process state adapter, <code>createInProcessStateAdapter</code>, is built in: no extra
      package, imported from <code>queuert</code>. It is meant for tests and single-process scripts.
      All state is held in memory and lost on process exit.{" "}
      <code>createSyncInProcessStateAdapter</code> is its synchronous variant, and{" "}
      <code>createInProcessNotifyAdapter</code> and <code>createSyncInProcessNotifyAdapter</code>{" "}
      wake worker runners in the same process.
    </p>
    <Aside type="caution" title="No persistence, one process">
      <p>
        Nothing is persisted, and state is visible only inside the process that created the adapter,
        so workers in other processes can't share it. When jobs must survive a restart, use{" "}
        <A href="/integrations/state-adapters/postgres/">PostgreSQL</A> or{" "}
        <A href="/integrations/state-adapters/sqlite/">SQLite</A>; to run workers across processes,
        use PostgreSQL.
      </p>
    </Aside>

    <h2>Setup</h2>
    <Code lang="ts" title="src/index.ts">{`
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
} from "queuert";

const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
`}</Code>

    <h2>Configuration</h2>
    <FieldList
      title="createInProcessStateAdapter"
      idPrefix="option"
      items={stateAdapterConfigItems()}
    />
    <StateAdapterConfigNote />

    <h2>How it works</h2>
    <p>
      Serializable transactions via an internal lock (the same isolation model as{" "}
      <A href="/integrations/state-adapters/sqlite/">SQLite</A>), with per-type ordered sets and
      per-chain maps so acquisition and chain lookups work against type- and chain-scoped
      collections rather than scanning all jobs.
    </p>
  </>
);

export default Page;
