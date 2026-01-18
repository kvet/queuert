import { Redis } from "ioredis";

export const createRedis = ({ url }: { url: string }): Redis => {
  const client = new Redis(url);

  client.on("error", (err: Error) => {
    console.error("Redis Client Error", err);
  });

  return client;
};

export { Redis };
