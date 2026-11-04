import { extendWithPostgres } from "@queuert/testcontainers";
import postgres from "postgres-3";
import { it as baseIt } from "vitest";

import {
  type PostgresJsFactory,
  postgresJsNotifyAdapterSpecs,
} from "../specs-postgres-js/postgres-js-conformance.spec-helper.js";

// postgres.js v3 is still supported. Its types differ from v4's, which the
// provider is typed against in this repo, so the factory is cast here.
const it = extendWithPostgres(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

postgresJsNotifyAdapterSpecs({
  it,
  createSql: postgres as unknown as PostgresJsFactory,
  label: "postgres.js v3",
});
