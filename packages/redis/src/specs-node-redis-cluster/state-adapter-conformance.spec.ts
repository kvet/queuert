// oxlint-disable no-empty-pattern -- vitest fixtures must destructure their context
import { conformanceTestSuite } from "@queuert/helpers/conformance";
import { acquireRedisCluster } from "@queuert/testcontainers";
import {
  endToEndBaseGroups,
  stateAdapterConcurrentTransactionGroups,
} from "queuert/conformance-internal";
import { createCluster, type RedisClusterType } from "redis";
import { it as baseIt, describe } from "vitest";

import {
  createRedisStateProviderConformanceContext,
  redisStateProviderConformanceGroups,
  withoutLockWaitCases,
} from "../conformance/state-provider-conformance.ts";
import { createNodeRedisClusterStateProvider } from "./state-provider.node-redis-cluster.ts";

const redisCluster = await acquireRedisCluster("redis:6");

const it = baseIt.extend("conformance", { scope: "file" }, async ({}, { onCleanup }) => {
  const cluster = createCluster(redisCluster) as RedisClusterType;
  await cluster.connect();
  onCleanup(async () => {
    await cluster.close();
  });
  return createRedisStateProviderConformanceContext({
    createStateProvider: async () => createNodeRedisClusterStateProvider({ cluster }),
  });
});

// NOTE: hack for vitest plugin
baseIt("index");

describe("Redis Cluster State Provider Conformance (node-redis)", () => {
  conformanceTestSuite({
    it,
    groups: [
      ...redisStateProviderConformanceGroups,
      ...withoutLockWaitCases(stateAdapterConcurrentTransactionGroups),
    ],
  });
});

describe("Redis Cluster End-to-End Conformance (node-redis)", () => {
  conformanceTestSuite({ it, groups: withoutLockWaitCases(endToEndBaseGroups) });
});
