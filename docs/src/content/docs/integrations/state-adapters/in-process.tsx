import { FieldList } from "../../../../components/FieldList.tsx";
import {
  StateAdapterConfigNote,
  stateAdapterConfigItems,
} from "../../../../components/integrations/state-adapters/stateAdapterConfig.tsx";
import { Aside } from "../../../../components/mdx/Aside.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { siteHref } from "../../../../docs/href.ts";

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
      All state is held in memory and lost on process exit. It is synchronous by default, and{" "}
      <code>{'mode: "async"'}</code> makes its methods return promises;{" "}
      <code>createInProcessNotifyAdapter</code>, with the same <code>mode</code> option, wakes
      worker runners in the same process.
    </p>
    <Aside type="caution" title="No persistence, one process">
      <p>
        Nothing is persisted, and state is visible only inside the process that created the adapter,
        so workers in other processes can't share it. When jobs must survive a restart, use{" "}
        <a href={siteHref("/integrations/state-adapters/postgres/")}>PostgreSQL</a> or{" "}
        <a href={siteHref("/integrations/state-adapters/sqlite/")}>SQLite</a>; to run workers across
        processes, use a shared database such as PostgreSQL,{" "}
        <a href={siteHref("/integrations/state-adapters/mysql/")}>MySQL / MariaDB</a> or{" "}
        <a href={siteHref("/integrations/state-adapters/redis/")}>Redis</a>, or, on one host, SQLite
        with the <a href={siteHref("/integrations/notify-adapters/ipc/")}>IPC notify adapter</a>.
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
      items={[
        {
          name: "mode",
          chips: [{ label: '"sync"', mono: true }],
          description: (
            <>
              <code>"sync"</code> or <code>"async"</code>: whether the adapter's methods return
              their results directly or return promises.
            </>
          ),
        },
        ...stateAdapterConfigItems(),
      ]}
    />
    <StateAdapterConfigNote />

    <h2>How it works</h2>
    <p>
      Serializable transactions (the same isolation model as{" "}
      <a href={siteHref("/integrations/state-adapters/sqlite/")}>SQLite</a>; in the{" "}
      <code>"async"</code> mode through an internal lock), with per-type ordered sets and per-chain
      maps so acquisition and chain lookups work against type- and chain-scoped collections rather
      than scanning all jobs.
    </p>
  </>
);

export default Page;
