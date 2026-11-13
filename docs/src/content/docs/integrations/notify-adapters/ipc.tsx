import { A } from "@solidjs/router";

import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";

export const meta = {
  title: "IPC Notify Adapter",
  description:
    "Wake workers in other processes on the same host over Unix sockets or named pipes, with no broker to run.",
};

const Page = () => (
  <>
    <p>
      <code>createIpcNotifyAdapter</code> delivers job notifications between processes on one host,
      such as a web process and its worker processes sharing one SQLite database file. There is no
      broker to run: the processes find each other through registry files in a shared directory. Job
      state stays in your <A href="/integrations/state-adapters/">state adapter</A>.
    </p>
    <ExperimentalAside package="@queuert/ipc" />

    <h2 id="install">Install</h2>
    <Code lang="bash">{`npm install @queuert/ipc`}</Code>
    <p>Requires Node.js 24 or later.</p>

    <h2 id="setup">Setup</h2>
    <p>
      The adapter is a <code>SyncNotifyAdapter</code>: every method returns directly. Pass it to{" "}
      <code>createClient</code> over the{" "}
      <A href="/integrations/state-adapters/sqlite/#synchronous-providers">
        synchronous SQLite adapter
      </A>{" "}
      the processes share. Give every process the same directory:
    </p>
    <ExampleCode example="notify-ipc" file="src/index.ts" region="setup" />
    <p>
      The adapter is held with <code>using</code>, so it closes when the scope ends, before the
      state adapter created above it, in the{" "}
      <A href="/integrations/notify-adapters/#how-adapters-behave">shutdown order</A>.
    </p>

    <h2 id="configuration">Configuration</h2>
    <FieldList
      title="createIpcNotifyAdapter options"
      idPrefix="option"
      items={[
        {
          name: "directory",
          chips: ["required"],
          meta: "string",
          description:
            "Directory for the registry files. Every process that passes the same directory receives every other one's notifications. Created on first use if it does not exist. The sockets themselves live in the operating system's temporary directory (os.tmpdir()), so the processes must also share that: not with systemd's PrivateTmp, and in containers that share only this directory, mount a shared temporary directory as well. On Windows they use named pipes instead.",
        },
        {
          name: "onError",
          meta: "(error: unknown) => void",
          description:
            "Called when the server started by a listen call cannot listen or its registry file cannot be written. The next listen call tries again.",
        },
      ]}
    />

    <h2 id="conformance">Conformance</h2>
    <p>
      The example's <code>src/adapter.spec.ts</code> registers one test per case of{" "}
      <code>syncNotifyAdapterConformanceCases</code> and is a working template. To run it under
      another test runner, see{" "}
      <A href="/integrations/notify-adapters/custom/#conformance">Custom Notify Adapter</A>.
    </p>
    <ExampleCode example="notify-ipc" file="src/adapter.spec.ts" region="conformance" />

    <h2 id="delivery">Delivery</h2>
    <p>
      The first <code>listen*</code> call starts a server on a Unix socket in the operating system's
      temporary directory (a named pipe on Windows) in the background and writes a registry file
      into the directory once it listens. The first <code>notify*</code> call reads the registry
      files, rereads them every second, and writes each notification to every other registered
      process, which filters it locally. Listeners in the same adapter receive notifications
      directly, during the <code>notify*</code> call.
    </p>
    <p>
      Notifications are hints. One sent while a process starts or restarts, or before the sender has
      reread the registry after a new process registered, is lost, and the worker's next poll picks
      the job up. So is one sent while 64 KiB of earlier notifications to the same process are still
      unsent, which keeps a process that reads slowly from growing the sender's memory. Socket
      errors are never thrown: the adapter drops the connection and reconnects on the next send.
    </p>

    <h2 id="examples">Examples</h2>
    <ExampleRows title="@queuert/ipc" names={["notify-ipc", "state-sqlite-multi-worker"]} />
  </>
);

export default Page;
