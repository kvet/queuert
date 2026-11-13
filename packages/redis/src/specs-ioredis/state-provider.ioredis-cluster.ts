import { createHash } from "node:crypto";

import type { Cluster } from "ioredis";

import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

export const createIoredisClusterStateProvider = ({
  cluster,
}: {
  cluster: Cluster;
}): RedisStateProvider => {
  const scriptShas = new Map<string, string>();
  return {
    eval: async (script, keys, args) => {
      let sha = scriptShas.get(script);
      if (sha === undefined) {
        sha = createHash("sha1").update(script).digest("hex");
        scriptShas.set(script, sha);
      }
      try {
        return await cluster.evalsha(sha, keys.length, ...keys, ...args);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("NOSCRIPT")) throw error;
        return cluster.eval(script, keys.length, ...keys, ...args);
      }
    },
  };
};
