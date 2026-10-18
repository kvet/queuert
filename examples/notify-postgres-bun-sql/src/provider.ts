import { type PgNotifyProvider } from "@queuert/postgres";
import { type SQL } from "bun";

export const createBunSqlNotifyProvider = ({ sql }: { sql: SQL }): PgNotifyProvider => {
  return {
    publish: async (channel, message) => {
      await sql.notify(channel, message);
    },
    subscribe: async (channel, onMessage) => {
      const subscription = await sql.listen(channel, onMessage);
      return async () => {
        await subscription.unlisten();
      };
    },
  };
};
