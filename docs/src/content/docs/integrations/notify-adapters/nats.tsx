import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { AtAGlance } from "../../../../components/integrations/AtAGlance.tsx";
import { ExperimentalAside } from "../../../../components/integrations/ExperimentalAside.tsx";
import { FoldGroup } from "../../../../components/integrations/FoldGroup.tsx";
import { RunOnYourMachine } from "../../../../components/integrations/RunOnYourMachine.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";
import { Details } from "../../../../components/mdx/Details.tsx";
import { siteHref } from "../../../../docs/href.ts";

export const meta = {
  title: "NATS notify adapter",
  description: "Wake workers with NATS core pub/sub over a single NatsConnection.",
};

const Page = () => (
  <>
    <p>
      <code>createNatsNotifyAdapter</code> uses NATS core pub/sub for job notifications. Like Redis,
      NATS is used exclusively as a notification adapter — it does not store job state; that stays
      in your <a href={siteHref("/integrations/state-adapters/")}>state adapter</a>.
    </p>
    <ExperimentalAside package="@queuert/nats" />

    <AtAGlance
      package="@queuert/nats"
      clients="@nats-io/nats-core NatsConnection"
      isolationLabel="Delivery"
      isolation="NATS core pub/sub"
      pairsWith={[
        { label: "PostgreSQL state adapter", href: "/integrations/state-adapters/postgres/" },
        { label: "MySQL / MariaDB state adapter", href: "/integrations/state-adapters/mysql/" },
        { label: "Redis state adapter", href: "/integrations/state-adapters/redis/" },
      ]}
    />

    <h2>Quick start</h2>
    <Code lang="bash">{`npm install @queuert/nats @nats-io/nats-core @nats-io/transport-node`}</Code>
    <p>Requires NATS 2.2 or later.</p>
    <ExampleCode example="postgresql/notify-nats" file="src/index.ts" region="setup" />
    <p>
      The connection and the notify adapter are held with <code>await using</code>, so when the
      scope ends the notify adapter closes before the connection, in the{" "}
      <a href={siteHref("/integrations/notify-adapters/#how-adapters-behave")}>shutdown order</a>.
    </p>

    <h2>Run on your machine</h2>
    <RunOnYourMachine
      example="postgresql/notify-nats"
      needs="a local PostgreSQL and a NATS server"
    />

    <h2>Configure</h2>
    <FieldList
      title="createNatsNotifyAdapter"
      idPrefix="option"
      items={[
        {
          name: "nc",
          chips: ["required"],
          description: (
            <>
              The <code>NatsConnection</code>, used for both publishing and subscribing.
            </>
          ),
        },
        {
          name: "subjectPrefix",
          chips: [{ label: '"queuert"', mono: true }],
          description: "Prefix of the three subject names.",
        },
      ]}
    />

    <h2>Reference</h2>
    <FoldGroup>
      <Details summary={<span id="conformance">Conformance</span>}>
        <p>
          The example's <code>src/adapter.spec.ts</code> runs the cases from{" "}
          <code>createNotifyAdapterConformanceCases</code>
          and is a working template. To run it under another test runner, see{" "}
          <a href={siteHref("/integrations/notify-adapters/custom/#conformance")}>
            Custom notify adapter
          </a>
          .
        </p>
        <ExampleCode
          example="postgresql/notify-nats"
          file="src/adapter.spec.ts"
          region="conformance"
        />
      </Details>
      <Details summary={<span id="subjects">Subjects</span>}>
        <p>
          Three NATS subjects carry notifications (configurable prefix, default <code>queuert</code>
          ):
        </p>
        <FieldList
          items={[
            {
              name: "{prefix}.sched",
              chips: ["job scheduled"],
              meta: "payload · job type name",
              description:
                "Published when jobs become pending, or when a transaction that held pending jobs locked ends. Wakes idle workers.",
            },
            {
              name: "{prefix}.chainc",
              chips: ["chain completed"],
              meta: "payload · chain id",
              description: "Published when a chain completes. Wakes clients awaiting results.",
            },
            {
              name: "{prefix}.atls",
              chips: ["attempt lost"],
              meta: "payload · job id",
              description: "Published when a running job's attempt is lost. Notifies attempt loss.",
            },
          ]}
        />
        <p>
          NATS core pub/sub is fire-and-forget — messages are delivered to currently connected
          subscribers only.
        </p>
      </Details>
      <Details summary={<span id="connection-model">Connection model</span>}>
        <p>
          NATS uses a single connection (<code>NatsConnection</code>) for both publishing and
          subscribing — unlike Redis, there is no need for separate connections. The adapter accepts
          the connection directly.
        </p>
      </Details>
    </FoldGroup>

    <h2 id="examples">Examples</h2>
    <ExampleRows
      commandsShownFor="postgresql/notify-nats"
      page="/integrations/notify-adapters/nats/"
      title="@queuert/nats"
      names={["postgresql/notify-nats"]}
    />
  </>
);

export default Page;
