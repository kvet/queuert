import { type PgNotifyProvider } from "@queuert/postgres";
import type postgres from "postgres";

export const createPostgresJsNotifyProvider = ({
  sql,
}: {
  sql: postgres.Sql;
}): PgNotifyProvider => {
  return {
    publish: async (channel, messages) => {
      await sql`SELECT pg_notify(${channel}, message) FROM json_array_elements_text(${JSON.stringify(messages)}::text::json) AS message`;
    },
    subscribe: async (channel, onMessage) => {
      const subscription = await sql.listen(channel, onMessage);
      return async () => {
        await subscription.unlisten();
      };
    },
  };
};
