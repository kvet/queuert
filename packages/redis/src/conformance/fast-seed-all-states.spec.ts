import { detectResourceLeaks } from "@queuert/helpers/testing";
import { TESTCONTAINERS_RESOURCE_TYPES, acquireRedis } from "@queuert/testcontainers";
import { type ChainableCommander, Redis } from "ioredis";
import { seedAllStates } from "queuert/conformance-internal";
import { it as baseIt, describe, expect } from "vitest";

import { createIoredisStateProvider } from "../specs-ioredis/state-provider.ioredis.ts";
import { decodeRecord } from "../state-adapter/redis-transaction.ts";
import { createRedisStateAdapter } from "../state-adapter/state-adapter.redis.ts";
import { fastSeedAllStates } from "./fast-seed-all-states.ts";

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const timestampFields = [
  "createdAt",
  "scheduledAt",
  "completedAt",
  "attemptAt",
  "lastAttemptAt",
  "chainCompletedAt",
] as const;

const escapeGlob = (text: string): string => text.replaceAll(/[*?[\]\\]/g, "\\$&");

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const scanKeys = async (client: Redis, keyPrefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.scan(
      cursor,
      "MATCH",
      `${escapeGlob(keyPrefix)}*`,
      "COUNT",
      1000,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
};

const dropKeys = async (client: Redis, keyPrefix: string): Promise<void> => {
  const keys = await scanKeys(client, keyPrefix);
  for (let start = 0; start < keys.length; start += 1000) {
    await client.unlink(...keys.slice(start, start + 1000));
  }
};

const assertTemporalRelationships = (jobs: Record<string, unknown>[], label: string) => {
  for (const job of jobs) {
    const ctx = `${label} [${job.typeName as string} ${JSON.stringify(job.input)}]`;
    for (const field of timestampFields) {
      if (field === "createdAt" || job[field] === null || job[field] === undefined) continue;
      expect(
        (job[field] as number) >= (job.createdAt as number),
        `${ctx}: ${field} >= createdAt`,
      ).toBe(true);
    }
  }
};

const pipelined = async (
  client: Redis,
  keys: string[],
  queue: (pipeline: ChainableCommander, key: string, index: number) => void,
): Promise<unknown[]> => {
  const values: unknown[] = [];
  for (let start = 0; start < keys.length; start += 5000) {
    const pipeline = client.pipeline();
    for (const [offset, key] of keys.slice(start, start + 5000).entries()) {
      queue(pipeline, key, start + offset);
    }
    for (const [error, value] of (await pipeline.exec())!) {
      if (error) throw error;
      values.push(value);
    }
  }
  return values;
};

const readKeyspace = async (client: Redis, keyPrefix: string) => {
  const keys = await scanKeys(client, keyPrefix);
  const types = (await pipelined(client, keys, (pipeline, key) => pipeline.type(key))) as string[];
  const values = await pipelined(client, keys, (pipeline, key, index) => {
    const type = types[index];
    if (type === "hash") pipeline.hgetall(key);
    else if (type === "zset") pipeline.zrange(key, "0", "-1");
    else if (type === "set") pipeline.smembers(key);
    else if (type === "string") pipeline.get(key);
    else pipeline.echo(type);
  });

  const jobKeyPrefix = `${keyPrefix}job:`;
  const isRecordKey = (key: string) =>
    key.startsWith(jobKeyPrefix) || key.startsWith(`${keyPrefix}worker:`);
  const records = new Map<string, Record<string, unknown>>();
  const jobLabels = new Map<string, string>();
  for (const [index, key] of keys.entries()) {
    if (!isRecordKey(key)) continue;
    const { d, u } = values[index] as Record<string, string>;
    const record = decodeRecord(d, u) as Record<string, unknown>;
    records.set(key, record);
    if (key.startsWith(jobKeyPrefix)) {
      const input = JSON.stringify(record.input).replaceAll('"', "");
      jobLabels.set(
        record.id as string,
        `${record.typeName as string}#${String(record.chainIndex)}#${input}`,
      );
    }
  }
  expect(jobLabels.size, "every job has a unique label").toBe(
    keys.filter((key) => key.startsWith(jobKeyPrefix)).length,
  );

  const label = (text: string): string =>
    text.replaceAll(uuidPattern, (id) => jobLabels.get(id) ?? id);
  const labelValue = (value: unknown): unknown => JSON.parse(label(JSON.stringify(value)));
  const labelMember = (member: string): string =>
    label(member.includes("|") ? member.slice(member.indexOf("|") + 1) : member);

  const nowMs = Date.now();
  const keyspace: [string, unknown][] = [];
  for (const [index, key] of keys.entries()) {
    const name = label(key.slice(keyPrefix.length));
    const value = values[index];
    const record = records.get(key);
    if (record !== undefined) {
      const { seq: _seq, token, attemptToken, startedAt: _startedAt, leaseUntil, ...rest } = record;
      const normalized: Record<string, unknown> = { ...rest };
      for (const field of timestampFields) {
        if (field in normalized) normalized[field] = normalized[field] !== null;
      }
      if (attemptToken !== undefined) normalized.attemptToken = attemptToken !== null;
      if (token !== undefined) normalized.token = token !== null;
      if (leaseUntil !== undefined) normalized.live = (leaseUntil as number) > nowMs;
      keyspace.push([name, labelValue(normalized)]);
    } else if (types[index] === "zset") {
      keyspace.push([name, (value as string[]).map(labelMember).toSorted(compareText)]);
    } else if (types[index] === "set") {
      keyspace.push([name, (value as string[]).map(label).toSorted(compareText)]);
    } else if (types[index] === "hash") {
      const isSetVersions = key === `${keyPrefix}set-versions`;
      const fields = Object.entries(value as Record<string, string>).map(
        ([field, fieldValue]) =>
          [
            label(field.startsWith(keyPrefix) ? field.slice(keyPrefix.length) : field),
            isSetVersions ? "version" : fieldValue,
          ] as const,
      );
      keyspace.push([name, Object.fromEntries(fields.toSorted(([a], [b]) => compareText(a, b)))]);
    } else if (key !== `${keyPrefix}sequence` && !key.startsWith(`${keyPrefix}commit:`)) {
      keyspace.push([name, value]);
    }
  }
  return {
    keyspace: Object.fromEntries(keyspace.toSorted(([a], [b]) => compareText(a, b))),
    jobs: [...records.entries()]
      .filter(([key]) => key.startsWith(jobKeyPrefix))
      .map(([, record]) => record),
    labelValue,
  };
};

const redis = await acquireRedis("redis:6");

const it = baseIt.extend(
  "resourceLeakCheck",
  { auto: true },
  detectResourceLeaks({ additionalAllowedTypes: TESTCONTAINERS_RESOURCE_TYPES }),
);

describe("fast seed conformance", { timeout: 300_000 }, () => {
  for (const scale of [1, 2]) {
    it(`produces identical data to seedAllStates at scale ${scale}`, async () => {
      const client = new Redis(redis.connectionUrl);
      const provider = createIoredisStateProvider({ client });

      const correctPrefix = `{correct-${crypto.randomUUID()}}:`;
      const correctAdapter = createRedisStateAdapter({
        stateProvider: provider,
        keyPrefix: correctPrefix,
      });
      await correctAdapter.migrateToLatest();
      const correctSentinels = await seedAllStates(correctAdapter, { scale });
      const correct = await readKeyspace(client, correctPrefix);
      await correctAdapter.close();
      await dropKeys(client, correctPrefix);

      const fastPrefix = `{fast-${crypto.randomUUID()}}:`;
      const fastAdapter = createRedisStateAdapter({
        stateProvider: provider,
        keyPrefix: fastPrefix,
      });
      await fastAdapter.migrateToLatest();
      const fastSentinels = await fastSeedAllStates(provider, { scale, keyPrefix: fastPrefix });
      const fast = await readKeyspace(client, fastPrefix);
      await fastAdapter.close();
      await dropKeys(client, fastPrefix);

      expect(fast.keyspace, `scale=${scale} keyspace`).toEqual(correct.keyspace);
      expect(fast.labelValue(fastSentinels), `scale=${scale} sentinels`).toEqual(
        correct.labelValue(correctSentinels),
      );

      assertTemporalRelationships(correct.jobs, `scale=${scale} correct`);
      assertTemporalRelationships(fast.jobs, `scale=${scale} fast`);

      await client.quit();
    });
  }
});
