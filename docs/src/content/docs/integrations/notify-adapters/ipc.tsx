import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { AtAGlance } from "../../../../components/integrations/AtAGlance.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
import { RunOnYourMachine } from "../../../../components/integrations/RunOnYourMachine.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { Details } from "../../../../components/mdx/Details.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "IPC notify adapter",
  description:
    "Wake workers in other processes on the same host over Unix sockets or named pipes, with no broker to run.",
};

const Page = () => (
  <>
    <p>
      <code>createIpcNotifyAdapter</code> delivers job notifications between processes on one host,
      such as a web process and its worker processes sharing one SQLite database file. There is no
      broker to run: the processes find each other through registry files in a shared directory. Job
      state stays in your <a href={siteHref("/integrations/state-adapters/")}>state adapter</a>.
    </p>
    <ExperimentalAside package="@queuert/ipc" />

    <AtAGlance
      package="@queuert/ipc"
      clients="none; Node.js 24 or later"
      isolationLabel="Delivery"
      isolation="Unix sockets or named pipes between processes on one host, in the sync mode"
      pairsWith={[{ label: "SQLite state adapter", href: "/integrations/state-adapters/sqlite/" }]}
    />

    <h2>Quick start</h2>
    <Code lang="bash">{`npm install @queuert/ipc`}</Code>
    <p>Requires Node.js 24 or later.</p>
    <p>
      The adapter is a <code>NotifyAdapter</code> in the <code>"sync"</code> mode: every method
      returns directly. Pass it to <code>createClient</code> over the{" "}
      <a href={siteHref("/integrations/state-adapters/sqlite/#synchronous-providers")}>
        synchronous SQLite adapter
      </a>{" "}
      the processes share. Give every process the same directory:
    </p>
    <ExampleCode example="ipc/notify" file="src/index.ts" region="setup" />
    <p>
      The adapter is held with <code>using</code>, so it closes when the scope ends, before the
      state adapter created above it, in the{" "}
      <a href={siteHref("/integrations/notify-adapters/#how-adapters-behave")}>shutdown order</a>.
    </p>

    <h2>Run on your machine</h2>
    <RunOnYourMachine example="ipc/notify" />

    <h2>Configure</h2>
    <FieldList
      title="createIpcNotifyAdapter"
      idPrefix="option"
      items={[
        {
          name: "directory",
          chips: ["required"],
          description:
            "Directory for the registry files. Every process that passes the same directory receives every other one's notifications. Created on first use if it does not exist. The sockets themselves live in the operating system's temporary directory (os.tmpdir()), so the processes must also share that: not with systemd's PrivateTmp, and in containers that share only this directory, mount a shared temporary directory as well. On Windows they use named pipes instead.",
        },
        {
          name: "onError",
          description:
            "Called with the error when the server started by a listen call cannot listen or its registry file cannot be written. The next listen call tries again.",
        },
      ]}
    />

    <h2>Reference</h2>
    <Details summary={<span id="delivery">Delivery</span>}>
      <p>
        The first <code>listen*</code> call starts a server on a Unix socket in the operating
        system's temporary directory (a named pipe on Windows) in the background and writes a
        registry file into the directory once it listens. The first <code>notify*</code> call reads
        the registry files, rereads them every second, and writes each notification to every other
        registered process, which filters it locally. Listeners in the same adapter receive
        notifications directly, during the <code>notify*</code> call.
      </p>
      <p>
        Notifications are hints. One sent while a process starts or restarts, or before the sender
        has reread the registry after a new process registered, is lost, and the worker's next poll
        picks the job up. So is one sent while 64 KiB of earlier notifications to the same process
        are still unsent, which keeps a process that reads slowly from growing the sender's memory.
        Socket errors are never thrown: the adapter drops the connection and reconnects on the next
        send.
      </p>
    </Details>

    <h2 id="examples">Examples</h2>
    <ExampleRows
      commandsShownFor="ipc/notify"
      page="/integrations/notify-adapters/ipc/"
      title="@queuert/ipc"
      names={["ipc/notify", "sqlite/multi-worker"]}
    />
  </>
);

export default Page;
