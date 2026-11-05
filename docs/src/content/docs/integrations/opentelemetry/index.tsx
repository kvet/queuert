import { ExampleCode } from "../../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../../components/ExampleList.tsx";
import { FieldList } from "../../../../components/FieldList.tsx";
import { CardGrid, LinkCard } from "../../../../components/mdx/Cards.tsx";
import { Code } from "../../../../components/mdx/Code.tsx";

export const meta = {
  title: "OpenTelemetry",
  description: "OpenTelemetry metrics and tracing for Queuert job chains.",
};

const Page = () => (
  <>
    <p>
      Queuert provides an OpenTelemetry adapter for metrics and tracing. Configure your OTEL SDK
      with desired exporters (Prometheus, OTLP, Jaeger, etc.) before using this adapter.
    </p>
    <CardGrid>
      <LinkCard
        title="Metrics"
        href="/queuert/integrations/opentelemetry/metrics/"
        description="Full list of counters, histograms, and gauges."
      />
      <LinkCard
        title="Tracing"
        href="/queuert/integrations/opentelemetry/tracing/"
        description="Span hierarchy and attributes."
      />
    </CardGrid>

    <h2>Install</h2>
    <Code lang="bash">{`npm install @queuert/otel`}</Code>

    <h2>Setup</h2>
    <p>Create the observability adapter with your OTEL meter and tracer:</p>
    <ExampleCode example="observability-otel" file="src/observability.ts" region="adapter" />
    <p>
      Pass it as the <code>observabilityAdapter</code> option when creating your client:
    </p>
    <ExampleCode example="observability-otel" file="src/index.ts" region="client" />

    <h2>Configuration</h2>
    <FieldList
      title="createOtelObservabilityAdapter options"
      idPrefix="option"
      items={[
        {
          name: "meter",
          chips: [{ label: "Meter", mono: true }, "optional"],
          description: "Metrics disabled if omitted.",
        },
        {
          name: "tracer",
          chips: [{ label: "Tracer", mono: true }, "optional"],
          description: "Tracing disabled if omitted.",
        },
      ]}
    />

    <h2>What it emits</h2>
    <FieldList
      proseNames
      items={[
        {
          name: "Counters",
          description: "Worker lifecycle, job attempts, completions, errors.",
        },
        {
          name: "Histograms",
          description: "Job duration, chain duration, attempt duration.",
        },
        {
          name: "Gauges",
          description: "Idle workers per job type, jobs being processed.",
        },
        {
          name: "Spans",
          description:
            "PRODUCER spans for job creation and CONSUMER spans for processing, with span kinds modeled on OpenTelemetry messaging conventions.",
        },
      ]}
    />

    <h2>Examples</h2>
    <ExampleRows title="OpenTelemetry" names={["observability-otel"]} />
  </>
);

export default Page;
