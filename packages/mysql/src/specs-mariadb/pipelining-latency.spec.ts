import { startLatencyProxy } from "@queuert/helpers/latency-proxy";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool as createMariadbPool } from "mariadb";
import { createPool as createMysql2Pool } from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { createMariadbPoolProvider } from "../state-provider/state-provider.mariadb-pool.spec-helper.ts";
import type { MysqlStateProvider } from "../state-provider/state-provider.mysql.ts";
import { createMysql2PoolProvider } from "../state-provider/state-provider.mysql2-pool.ts";

const ROUND_TRIP_MS = 100;

const servers = ["mysql:8.4", "mariadb:11.4"];
const acquired = await Promise.all(
  servers.map(async (image) => ({
    image,
    ...(await acquireMysql(image, `${import.meta.url}-${image}`)),
  })),
);

const statements = (id: string | undefined) =>
  [1, 2, 3].map((value) => ({
    id: id === undefined ? undefined : `${id}:${value}`,
    sql: `SELECT ? + ${value} AS value`,
    params: [0],
    paramTypes: {},
    columnTypes: {},
    readOnly: true,
  }));

const timeBatchInTransaction = async (
  stateProvider: MysqlStateProvider<any>,
  batch: ReturnType<typeof statements>,
): Promise<number> =>
  stateProvider.withTransaction(async (txCtx) => {
    const startedAt = performance.now();
    const results = await stateProvider.executeStatements({ txCtx, statements: batch });
    const elapsedMs = performance.now() - startedAt;
    expect(
      results.map((rows) => (rows as { value: unknown }[]).map((row) => Number(row.value))),
    ).toEqual([[1], [2], [3]]);
    return elapsedMs;
  });

for (const { image, connectionOptions } of acquired) {
  describe(`${image} pipelining through a ${ROUND_TRIP_MS} ms round trip`, () => {
    it("the mariadb connector runs a three-statement batch in about one round trip", async () => {
      const proxy = await startLatencyProxy({
        targetHost: connectionOptions.host,
        targetPort: connectionOptions.port,
        roundTripMs: ROUND_TRIP_MS,
      });
      const pool = createMariadbPool({
        ...connectionOptions,
        host: proxy.host,
        port: proxy.port,
        connectionLimit: 1,
        allowPublicKeyRetrieval: true,
      });
      try {
        const stateProvider = createMariadbPoolProvider({ pool });

        const textMs = await timeBatchInTransaction(stateProvider, statements(undefined));
        expect(textMs).toBeGreaterThanOrEqual(ROUND_TRIP_MS * 0.9);
        expect(textMs).toBeLessThan(ROUND_TRIP_MS * 1.8);

        await timeBatchInTransaction(stateProvider, statements("latency"));
        const preparedMs = await timeBatchInTransaction(stateProvider, statements("latency"));
        expect(preparedMs).toBeGreaterThanOrEqual(ROUND_TRIP_MS * 0.9);
        expect(preparedMs).toBeLessThan(ROUND_TRIP_MS * 1.8);
      } finally {
        await pool.end();
        await proxy.close();
      }
    });

    it("mysql2 runs the same batch one round trip per statement", async () => {
      const proxy = await startLatencyProxy({
        targetHost: connectionOptions.host,
        targetPort: connectionOptions.port,
        roundTripMs: ROUND_TRIP_MS,
      });
      const pool = createMysql2Pool({
        ...connectionOptions,
        host: proxy.host,
        port: proxy.port,
        connectionLimit: 1,
      });
      try {
        const elapsedMs = await timeBatchInTransaction(
          createMysql2PoolProvider({ pool }),
          statements(undefined),
        );
        expect(elapsedMs).toBeGreaterThanOrEqual(ROUND_TRIP_MS * 2.7);
      } finally {
        await pool.end();
        await proxy.close();
      }
    });
  });
}
