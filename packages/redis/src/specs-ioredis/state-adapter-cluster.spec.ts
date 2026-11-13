// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedisCluster } from "@queuert/testcontainers";
import { Cluster } from "ioredis";
import {
  endToEndBaseGroups,
  stateAdapterConcurrentTransactionGroups,
} from "queuert/conformance-internal";
import { it as baseIt, describe } from "vitest";

import {
  createRedisStateProviderConformanceContext,
  redisStateProviderConformanceGroups,
  withoutLockWaitCases,
} from "../conformance/state-provider-conformance.ts";
import { createIoredisClusterStateProvider } from "./state-provider.ioredis-cluster.ts";

const redisCluster = await acquireRedisCluster("redis:6");

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const cluster = new Cluster(redisCluster.rootNodes.map((node) => node.url));
  onCleanup(async () => {
    await cluster.quit();
  });
  return createRedisStateProviderConformanceContext({
    createStateProvider: async () => createIoredisClusterStateProvider({ cluster }),
  });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis Cluster State Provider Conformance (ioredis)", () => {
  conformanceTestSuite({
    mode: "async",
    it,
    groups: [
      ...redisStateProviderConformanceGroups,
      ...withoutLockWaitCases(stateAdapterConcurrentTransactionGroups),
    ],
  });
});

describe("Redis Cluster End-to-End Conformance (ioredis)", () => {
  conformanceTestSuite({ mode: "async", it, groups: withoutLockWaitCases(endToEndBaseGroups) });
});
