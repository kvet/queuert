// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { startLatencyProxy } from "@queuert/helpers/latency-proxy";
import { acquirePostgres } from "@queuert/testcontainers";
import { Pool } from "pg";
import { it as baseIt, describe, expect } from "vitest";

import { createPgPoolProvider } from "../state-provider/state-provider.pg-pool.ts";

const ROUND_TRIP_MS = 100;

const pg = await acquirePostgres("postgres:14", import.meta.url);

const it = baseIt.extend(
  "proxiedConnectionString",
  { scope: "file" },
  async ({}, { onCleanup }) => {
    const target = new URL(pg.connectionString);
    const proxy = await startLatencyProxy({
      targetHost: target.hostname,
      targetPort: Number(target.port),
      roundTripMs: ROUND_TRIP_MS,
    });
    onCleanup(async () => proxy.close());
    target.hostname = proxy.host;
    target.port = String(proxy.port);
    return target.toString();
  },
);

const timeThreeStatementBatch = async (pool: Pool): Promise<number> => {
  const stateProvider = createPgPoolProvider({ pool });
  return stateProvider.withTransaction(async (txCtx) => {
    const startedAt = performance.now();
    const results = await stateProvider.executeStatements({
      txCtx,
      statements: [1, 2, 3].map((value) => ({
        id: `queuert_latency_${value}`,
        sql: `SELECT $1::integer AS value`,
        params: [value],
        paramTypes: {},
        columnTypes: {},
        readOnly: true,
      })),
    });
    const elapsedMs = performance.now() - startedAt;
    expect(results).toEqual([[{ value: 1 }], [{ value: 2 }], [{ value: 3 }]]);
    return elapsedMs;
  });
};

baseIt("index");

describe("executeStatements over a connection with a fixed round trip", () => {
  it("a pipelined pool sends a three-statement batch in one round trip", async ({
    proxiedConnectionString,
  }) => {
    const pool = new Pool({ connectionString: proxiedConnectionString, pipeline: true });
    try {
      const elapsedMs = await timeThreeStatementBatch(pool);
      expect(elapsedMs).toBeGreaterThanOrEqual(ROUND_TRIP_MS * 0.9);
      expect(elapsedMs).toBeLessThan(ROUND_TRIP_MS * 2);
    } finally {
      await pool.end();
    }
  });

  it("a pool without pipelining spends a round trip per statement", async ({
    proxiedConnectionString,
  }) => {
    const pool = new Pool({ connectionString: proxiedConnectionString });
    try {
      const elapsedMs = await timeThreeStatementBatch(pool);
      expect(elapsedMs).toBeGreaterThanOrEqual(ROUND_TRIP_MS * 3);
    } finally {
      await pool.end();
    }
  });
});
