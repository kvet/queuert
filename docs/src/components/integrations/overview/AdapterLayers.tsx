import { Box, Chip } from "@queuert/ui/components";
import { A } from "@solidjs/router";
import { For } from "solid-js";

type AdapterColumn = {
  kind: string;
  options: string[];
  required: boolean;
  href: string;
  backing: string;
  items: string[];
};

const columns: AdapterColumn[] = [
  {
    kind: "state",
    options: ["stateAdapter"],
    required: true,
    href: "/integrations/state-adapters/",
    backing: "database",
    items: ["PostgreSQL", "SQLite", "MySQL / MariaDB", "Redis", "in-process"],
  },
  {
    kind: "notify",
    options: ["notifyAdapter"],
    required: false,
    href: "/integrations/notify-adapters/",
    backing: "broker",
    items: ["LISTEN/NOTIFY", "Redis", "NATS", "in-process"],
  },
  {
    kind: "observability",
    options: ["log", "observabilityAdapter"],
    required: false,
    href: "/integrations/observability/",
    backing: "telemetry",
    items: ["console", "Pino", "Winston", "OpenTelemetry"],
  },
  {
    kind: "validation",
    options: ["jobTypes"],
    required: true,
    href: "/integrations/validation/",
    backing: "schema library, optional",
    items: ["Zod", "Valibot", "TypeBox", "ArkType"],
  },
];

const DownArrow = (props: { label?: string; class?: string }) => (
  <div
    class={`flex items-center justify-center gap-2 py-2 text-fg-subtle ${props.class ?? ""}`}
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 12 24"
      class="h-6 w-3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M6 1v21M2 18l4 4 4-4" />
    </svg>
    {props.label === undefined ? null : (
      <span class="font-mono text-[13px] text-fg-subtle">{props.label}</span>
    )}
  </div>
);

const ChipRow = (props: { items: string[]; mono?: boolean }) => (
  <p class="m-0 flex flex-wrap gap-1.5">
    <For each={props.items}>
      {(item) => (
        <>
          {" "}
          <Chip mono={props.mono}>{item}</Chip>
        </>
      )}
    </For>
  </p>
);

/**
 * The integration layers: your code calls the client and worker runner, which talk only to the four
 * adapter kinds, each backed by a database, broker or library you choose. Each adapter box names
 * the `createClient` option(s) it plugs into.
 */
export const AdapterLayers = () => (
  <figure
    class="my-8"
    aria-label="Your application code calls the Queuert client and worker runner. They use a state adapter (required), a notify adapter (optional), observability through a log function and an observability adapter (optional), and job types (required), optionally validated by a schema library. Each adapter is backed by a database, broker or library you choose: PostgreSQL, SQLite, MySQL / MariaDB, Redis or in-process for state; PostgreSQL LISTEN/NOTIFY, Redis, NATS or in-process for notify; console, Pino, Winston or OpenTelemetry for observability; optionally Zod, Valibot, TypeBox or ArkType for validation."
  >
    <Box title="your app" bodyClass="px-4 pt-3 pb-3">
      <ChipRow mono items={["client.createChain(…)", "attemptHandler", "complete(…)"]} />
    </Box>
    <DownArrow label="calls" />
    <Box title="queuert" bodyClass="px-4 pt-3 pb-3">
      <ChipRow mono items={["createClient", "createWorkerRunner"]} />
    </Box>
    <DownArrow label="uses" />
    <ul class="row-list m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
      <For each={columns}>
        {(column) => (
          <li class="m-0 flex min-w-0">
            <A
              href={column.href}
              class="unstyled group flex w-full no-underline"
              aria-label={`${column.kind} adapters`}
            >
              <Box
                title={column.kind}
                class="flex w-full flex-col transition-colors group-hover:border-border-strong"
                bodyClass="flex flex-1 flex-col"
              >
                <div class="flex min-h-[5.25rem] min-w-0 flex-col px-3 pt-3 pb-2.5">
                  <For each={column.options}>
                    {(option) => (
                      <span class="font-mono text-[13px] leading-5 font-semibold [overflow-wrap:anywhere] text-fg group-hover:text-accent-fg">
                        {option}
                      </span>
                    )}
                  </For>
                  <span class="mt-1 text-xs text-fg-subtle">
                    {column.required ? "required" : "optional"}
                  </span>
                </div>
                <div class="flex-1 border-t border-dashed border-border px-3 pt-2 pb-3">
                  <div class="mb-1 font-mono text-[10px] tracking-wider text-fg-subtle uppercase">
                    {column.backing}
                  </div>
                  <ul class="row-list m-0 list-none p-0">
                    <For each={column.items}>
                      {(item) => <li class="m-0 text-[13px] leading-6 text-fg-muted">{item}</li>}
                    </For>
                  </ul>
                </div>
              </Box>
            </A>
          </li>
        )}
      </For>
    </ul>
  </figure>
);
