// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireMysql } from "@queuert/testcontainers";
import { createPool } from "mariadb";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  noopNotifyAdapter,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  capabilityGroups,
  createProviderEndToEndContext,
} from "../specs/state-adapter-end-to-end.spec-helper.ts";
import {
  createMariadbPoolProvider,
  withMariadbPoolNonTransactionContext,
  withMariadbPoolSavepoint,
} from "../state-provider/state-provider.mariadb-pool.spec-helper.ts";

const { connectionOptions } = await acquireMysql("mariadb:11.4", import.meta.url);

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const pool = createPool({
    ...connectionOptions,
    connectionLimit: 20,
    allowPublicKeyRetrieval: true,
  });
  onCleanup(async () => pool.end());
  return createProviderEndToEndContext({
    createStateProvider: () => createMariadbPoolProvider({ pool }),
    dialect: "mariadb",
    withNonTransactionContext: withMariadbPoolNonTransactionContext(pool),
    withSavepoint: withMariadbPoolSavepoint,
    createNotifyAdapter: async () => noopNotifyAdapter,
  });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("mariadb:11.4 End-to-End Conformance, noop notify, pipelining mariadb connector", () => {
  conformanceTestSuite({
    it,
    groups: [...endToEndBaseGroups, ...endToEndAsyncGroups, ...capabilityGroups],
  });
});
