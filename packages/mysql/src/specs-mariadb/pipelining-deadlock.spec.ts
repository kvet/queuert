import { sleep } from "@queuert/helpers/sleep";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mariadb";
import { describe, expect, it } from "vitest";

import { createMariadbPoolProvider } from "../state-provider/state-provider.mariadb-pool.spec-helper.ts";

const servers = ["mysql:8.4", "mariadb:11.4"];
const acquired = await Promise.all(
  servers.map(async (image) => ({
    image,
    ...(await acquireMysql(image, `${import.meta.url}-${image}`)),
  })),
);

const textStatement = (sql: string) => ({
  sql,
  params: [],
  paramTypes: {},
  columnTypes: {},
  readOnly: false,
});

for (const { image, connectionOptions } of acquired) {
  describe(`${image} pipelined transactions`, () => {
    it("a deadlock mid-batch leaves the statements after it uncommitted", async () => {
      const pool = createPool({
        ...connectionOptions,
        connectionLimit: 3,
        allowPublicKeyRetrieval: true,
      });
      const stateProvider = createMariadbPoolProvider({ pool });
      try {
        for (const table of ["deadlock_lock", "deadlock_probe", "deadlock_ballast"]) {
          await pool.query(
            `CREATE TABLE IF NOT EXISTS ${table} (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
          );
          await pool.query(`DELETE FROM ${table}`);
        }
        await pool.query("INSERT INTO deadlock_lock (id) VALUES (1), (2)");

        const other = await pool.getConnection();
        try {
          const victim = stateProvider.withTransaction(async (txCtx) => {
            await stateProvider.executeStatements({
              txCtx,
              statements: [textStatement("SELECT id FROM deadlock_lock WHERE id = 1 FOR UPDATE")],
            });
            await other.query("START TRANSACTION");
            await other.query(
              `INSERT INTO deadlock_ballast (id) VALUES ${Array.from({ length: 50 }, (_, index) => `(${index})`).join(", ")}`,
            );
            await other.query("SELECT id FROM deadlock_lock WHERE id = 2 FOR UPDATE");

            const batch = Promise.allSettled([
              stateProvider.executeStatements({
                txCtx,
                statements: [
                  textStatement("SELECT id FROM deadlock_lock WHERE id = 2 FOR UPDATE"),
                  textStatement("INSERT INTO deadlock_probe (id) VALUES (1)"),
                ],
              }),
            ]);
            await sleep(300);
            await other.query("SELECT id FROM deadlock_lock WHERE id = 1 FOR UPDATE");
            const [outcome] = await batch;
            if (outcome.status === "rejected") throw outcome.reason;
            return outcome.value;
          });
          await expect(victim).rejects.toMatchObject({ errno: 1213 });
          await other.query("ROLLBACK");
        } finally {
          await other.release();
        }

        const probeRows: unknown[] = await pool.query("SELECT id FROM deadlock_probe");
        expect(probeRows).toHaveLength(0);
      } finally {
        await pool.end();
      }
    });
  });
}
