import { type Pool, type PoolClient } from "pg";
import { type PgNotifyProvider } from "../notify-provider/notify-provider.pg.js";

export type PgPoolNotifyProvider = PgNotifyProvider & {
  close: () => void;
};

export const createPgPoolNotifyProvider = ({ pool }: { pool: Pool }): PgPoolNotifyProvider => {
  let listenClient: PoolClient | null = null;
  let connectingPromise: Promise<PoolClient> | null = null;
  let closed = false;

  const handlers = new Map<string, (message: string) => void>();

  const releaseListenClient = (): void => {
    if (listenClient) {
      listenClient.removeAllListeners("notification");
      listenClient.release();
      listenClient = null;
    }
  };

  const ensureListenClient = async (): Promise<PoolClient> => {
    if (closed) {
      throw new Error("Provider is closed");
    }

    if (listenClient) {
      return listenClient;
    }

    if (connectingPromise) {
      return connectingPromise;
    }

    connectingPromise = pool.connect().then((client) => {
      connectingPromise = null;

      if (closed) {
        client.release();
        throw new Error("Provider is closed");
      }

      listenClient = client;
      listenClient.on("notification", (msg: { channel: string; payload?: string }) => {
        handlers.get(msg.channel)?.(msg.payload ?? "");
      });

      return listenClient;
    });

    return connectingPromise;
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
        try {
          await client.query(`UNLISTEN "${channel}"`);
        } finally {
          if (handlers.size === 0) {
            releaseListenClient();
          }
        }
      };
    },

    close: () => {
      closed = true;
      releaseListenClient();
      handlers.clear();
    },
  };
};
