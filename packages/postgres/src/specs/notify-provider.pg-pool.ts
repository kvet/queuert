import { type Pool, type PoolClient } from "pg";
import { type PgNotifyProvider } from "../notify-provider/notify-provider.pg.js";

export const createPgPoolNotifyProvider = ({ pool }: { pool: Pool }): PgNotifyProvider => {
  // Dedicated listen connection managed internally
  let listenClient: PoolClient | null = null;
  const handlers = new Map<string, (message: string) => void>();

  const ensureListenClient = async (): Promise<PoolClient> => {
    if (!listenClient) {
      listenClient = await pool.connect();
      listenClient.on("notification", (msg: { channel: string; payload?: string }) => {
        const handler = handlers.get(msg.channel);
        if (handler) {
          handler(msg.payload ?? "");
        }
      });
    }
    return listenClient;
  };

  return {
    publish: async (channel, message) => {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_notify($1, $2)", [channel, message]);
      } finally {
        client.release();
      }
    },

    subscribe: async (channel, onMessage) => {
      const client = await ensureListenClient();
      handlers.set(channel, onMessage);
      await client.query(`LISTEN "${channel}"`);

      return async () => {
        handlers.delete(channel);
        await client.query(`UNLISTEN "${channel}"`);
        // Release listen client when no more handlers
        if (handlers.size === 0 && listenClient) {
          listenClient.removeAllListeners("notification");
          listenClient.release();
          listenClient = null;
        }
      };
    },
  };
};
