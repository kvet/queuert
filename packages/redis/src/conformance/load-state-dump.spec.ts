import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquireRedis } from "@queuert/testcontainers";
import { Redis } from "ioredis";
import {
  createSeedStateAdapter,
  generateStateDump,
  readStateCounts,
  readStateRows,
  shiftStateDump,
  toStateRows,
} from "queuert/conformance-internal";
import { it as baseIt, expect } from "vitest";

import { createIoredisStateProvider } from "../specs-ioredis/state-provider.ioredis.ts";
import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import { loadStateDump } from "./load-state-dump.ts";

const redis = await acquireRedis("redis:6");

const it = baseIt.extend(
  "resourceLeakCheck",
  { auto: true },
  detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
);

it(
  "loads a dump that the adapter reads back shifted by the offset",
  { timeout: 120_000 },
  async () => {
    const client = new Redis(redis.connectionUrl);
    const stateProvider = createIoredisStateProvider({ client });
    const keyPrefix = `{dump-${crypto.randomUUID()}}:`;
    const stateAdapter = createRedisStateAdapter({ stateProvider, keyPrefix });
    await stateAdapter.migrateToLatest();
    const { dump } = generateStateDump();
    const offsetMs = Date.now() - dump.capturedAt.getTime();
    const reference = createSeedStateAdapter();
    reference.loadState(dump, { offsetMs });

    await loadStateDump(stateProvider, dump, { offsetMs, keyPrefix });

    expect(await readStateRows(stateAdapter)).toEqual(toStateRows(shiftStateDump(dump, offsetMs)));
    expect(await readStateCounts(stateAdapter)).toEqual(readStateCounts(reference.stateAdapter));
    await stateAdapter.close();
    await client.quit();
  },
);
