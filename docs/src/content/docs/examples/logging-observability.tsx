import { ExampleDetail, ExampleRows } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "Logging & Observability",
  description: "Runnable examples for logging, OpenTelemetry, and the dashboard.",
};

const Page = () => (
  <>
    <p>
      These examples run without Docker: the logging and OpenTelemetry ones keep state in the
      in-process adapters, and the dashboard one in a SQLite file.
    </p>
    <h2 id="logging">Logging</h2>
    <ExampleRows title="Loggers" names={["log-console", "log-pino", "log-winston"]} />
    <h2 id="observability-otel">OpenTelemetry</h2>
    <ExampleDetail name="observability-otel" />
    <h2 id="dashboard">Dashboard</h2>
    <ExampleDetail name="dashboard" />
  </>
);

export default Page;
