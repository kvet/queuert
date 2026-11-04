import { TESTCONTAINERS_RESOURCE_TYPES, extendWithPostgres } from "@queuert/testcontainers";
import postgres from "postgres-3";
import { extendWithResourceLeakDetection } from "queuert/testing";
import { it as baseIt } from "vitest";

import {
  type PostgresJsFactory,
  postgresJsStateAdapterSpecs,
} from "../specs-postgres-js/postgres-js-conformance.spec-helper.js";

// postgres.js v3 is still supported. Its types differ from v4's, which the
// provider is typed against in this repo, so the factory is cast here.
const it = extendWithResourceLeakDetection(
  extendWithPostgres(baseIt, import.meta.url, { expectedTestContexts: 2 }),
  {
    additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES,
  },
);

it("index");

postgresJsStateAdapterSpecs({
  it,
  createSql: postgres as unknown as PostgresJsFactory,
  label: "postgres.js v3",
});
