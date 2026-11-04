import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { extendWithResourceLeakDetection } from "queuert/testing";
import { it as baseIt } from "vitest";

import { postgresJsStateAdapterSpecs } from "./postgres-js-conformance.spec-helper.js";

const it = extendWithResourceLeakDetection(
  extendWithPostgres(baseIt, import.meta.url, { expectedTestContexts: 2 }),
  {
    additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
  },
);

it("index");

postgresJsStateAdapterSpecs({ it, createSql: postgres, label: "postgres.js v4" });
