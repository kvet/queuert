import { type PgNotifyProvider } from "@queuert/postgres";
import type postgres from "postgres";

export const createPostgresJsNotifyProvider = ({
  sql,
}: {
  sql: postgres.Sql;
}): PgNotifyProvider => {
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
