import type { Pool, PoolClient } from "pg";
import type { PgNotifyProvider } from "../notify-provider/notify-provider.pg.js";

export type PgPoolNotifyContext = {
  client: PoolClient;
  handlers: Map<string, (message: string) => void>;
};

export const createPgPoolNotifyProvider = ({
  pool,
}: {
  pool: Pool;
}): PgNotifyProvider<PgPoolNotifyContext> => {
  return {
    provideContext: async (type, fn) => {
      const client = await pool.connect();
      const handlers = new Map<string, (message: string) => void>();

      if (type === "listen") {
        const notificationHandler = (msg: { channel: string; payload?: string }): void => {
          const handler = handlers.get(msg.channel);
          if (handler) {
            handler(msg.payload ?? "");
          }
        };

        client.on("notification", notificationHandler);

        try {
          return await fn({ client, handlers });
        } finally {
          client.off("notification", notificationHandler);
          client.release();
        }
      }

      // publish
      try {
        return await fn({ client, handlers });
      } finally {
        client.release();
      }
    },

    publish: async ({ client }, channel, message) => {
      await client.query("SELECT pg_notify($1, $2)", [channel, message]);
    },

    subscribe: async ({ client, handlers }, channel, onMessage) => {
      handlers.set(channel, onMessage);
      await client.query(`LISTEN "${channel}"`);

      return async () => {
        handlers.delete(channel);
        await client.query(`UNLISTEN "${channel}"`);
      };
    },
  };
};
