import { extendWithPostgres } from "@queuert/testcontainers";
import postgres from "postgres";
import { it as baseIt } from "vitest";

import { postgresJsNotifyAdapterSpecs } from "./postgres-js-conformance.spec-helper.js";

const it = extendWithPostgres(baseIt, import.meta.url);

// NOTE: hack for vitest plugin
it("index");

postgresJsNotifyAdapterSpecs({ it, createSql: postgres, label: "postgres.js v4" });
