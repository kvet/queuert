import type { Redis } from "ioredis";

import type { ServerStats } from "./utils.ts";

const mainThreadCpuUsec = async (client: Redis): Promise<number> => {
  const info = String(await client.call("INFO", "cpu"));
  let seconds = 0;
  for (const line of info.split("\n")) {
    const match = /^used_cpu_(?:user|sys)_main_thread:([\d.]+)/.exec(line.trim());
    if (match) seconds += Number(match[1]);
  }
  return seconds * 1_000_000;
};

export const createRedisServerStats = (client: Redis): ServerStats => {
  let baseline = 0;
  return {
    reset: async () => {
      baseline = await mainThreadCpuUsec(client);
    },
    usec: async () => (await mainThreadCpuUsec(client)) - baseline,
  };
};
