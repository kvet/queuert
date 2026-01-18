import { createClient, RedisClientType } from "redis";

export const createRedis = async ({ url }: { url: string }) => {
  const client = createClient({
    url,
  });

  client.on("error", (err) => {
    console.error("Redis Client Error", err);
  });

  await client.connect();

  return client as RedisClientType;
};

export type Redis = Awaited<ReturnType<typeof createRedis>>;
