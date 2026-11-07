import { AdapterLayers } from "../../../components/integrations/overview/AdapterLayers.tsx";
import { CardGrid, LinkCard } from "../../../components/mdx/Cards.tsx";

export const meta = {
  title: "Integrations",
  description:
    "How Queuert plugs into your database, broker, schema library and telemetry, and what each adapter kind is for.",
};

const kinds = [
  {
    title: "State adapters",
    href: "/queuert/integrations/state-adapters/",
    description:
      "Required. Where chains, jobs and workers are stored. With a database backend, chains start inside your own transaction: if it rolls back, the chain is never created.",
  },
  {
    title: "Notify adapters",
    href: "/queuert/integrations/notify-adapters/",
    description:
      "Optional. Wake workers the moment a job is scheduled, and callers awaiting a chain the moment it completes. Without one, workers poll.",
  },
  {
    title: "Validation",
    href: "/queuert/integrations/validation/",
    description:
      "Job types are required; checking job inputs and outputs at runtime with your schema library (Zod, Valibot, TypeBox, ArkType) is optional.",
  },
  {
    title: "Observability",
    href: "/queuert/integrations/observability/",
    description:
      "Optional. Structured logs through your logger, metrics and traces through OpenTelemetry, and an embeddable web UI for chains, jobs and workers.",
  },
];

const Page = () => (
  <>
    <p>
      Queuert reaches your database, message broker, schema library and telemetry through adapters,
      which <code>createClient</code> and <code>createWorkerRunner</code> consume. This section has
      an overview page per adapter kind and a page per backend.
    </p>
    <AdapterLayers />

    <h2>Adapter kinds</h2>
    <CardGrid>
      {kinds.map((kind) => (
        <LinkCard title={kind.title} href={kind.href} description={kind.description} />
      ))}
    </CardGrid>
  </>
);

export default Page;
