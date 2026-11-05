import { ExampleCode } from "../../../../components/ExampleCode.tsx";

export const meta = {
  title: "In-Process Notify Adapter",
  description: "Built-in notify adapter for tests and single-process apps.",
};

const Page = () => (
  <>
    <p>
      Mostly for tests and single-process apps. <code>createInProcessNotifyAdapter</code> is built
      in, imported from <code>queuert</code>, and delivers job-arrival signals via in-memory
      subscriptions. Useful whenever publisher and subscriber run in the same process.
      Single-process only — workers in other processes won't receive notifications.
    </p>

    <h2 id="setup">Setup</h2>
    <ExampleCode example="dashboard" file="src/common.ts" region="in-process-notify" />
  </>
);

export default Page;
