import { createHash } from "node:crypto";

import type { RedisClientType } from "redis";

import type { RedisStateProvider } from "../state-provider/state-provider.redis.ts";

export const createNodeRedisStateProvider = ({
  client,
}: {
  client: RedisClientType;
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
        return await client.evalSha(sha, { keys, arguments: args });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("NOSCRIPT")) throw error;
        return client.eval(script, { keys, arguments: args });
      }
    },
  };
};
