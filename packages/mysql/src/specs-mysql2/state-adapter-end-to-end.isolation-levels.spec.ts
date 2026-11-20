// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import { createMysql2PoolAtLevel } from "../state-provider/state-provider.mysql2-pool.spec-helper.ts";
import { capabilityGroups, createEndToEndContext } from "./state-adapter-end-to-end.spec-helper.ts";

const suites = await Promise.all(
  [
    { image: "mysql:8.4", dialect: "mysql" as const },
    { image: "mariadb:11.4", dialect: "mariadb" as const },
  ].flatMap(({ image, dialect }) =>
    (["REPEATABLE READ", "SERIALIZABLE"] as const).map(async (level) => {
      const { connectionOptions } = await acquireMysql(image, `${import.meta.url}-${level}`);
      const it = baseIt
        .extend("pool", { scope: "file" }, async ({}, { onCleanup }) => {
          const pool = createMysql2PoolAtLevel(
            { ...connectionOptions, connectionLimit: 10 },
            level,
          );
          onCleanup(async () => pool.end());
          return pool;
        })
        .extend("conformance", { scope: "file" }, async ({ pool }) =>
          createEndToEndContext(pool, dialect, async () => noopNotifyAdapter),
        );
      return { label: `${image} End-to-End Conformance, noop notify, ${level}`, it };
    }),
  ),
);

// NOTE: hack for vitest plugin
baseIt("index");

for (const { label, it } of suites) {
  describe(label, () => {
    conformanceTestSuite({
      it,
      groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...capabilityGroups],
    });
  });
}
