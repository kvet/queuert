import { type UUID, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { expectTypeOf, it, onTestFinished } from "vitest";

import {
  type PgPoolContext,
  createPgPoolProvider,
} from "../state-provider/state-provider.pg-pool.ts";
import { type PgStateAdapter, createPgStateAdapter } from "./state-adapter.pg.ts";

it("infers custom ID types", () => {
  const pool = new Pool();
  onTestFinished(async () => pool.end());

  expectTypeOf(
    createPgStateAdapter({
      stateProvider: createPgPoolProvider({ pool }),
      jobIdType: "text",
      generateJobId: (): `job.${UUID}` => `job.${randomUUID()}`,
    }),
  ).toEqualTypeOf<PgStateAdapter<PgPoolContext, `job.${UUID}`>>();
});
