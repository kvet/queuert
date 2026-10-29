import type postgres from "postgres";

import { type PgNotifyProvider } from "./notify-provider.pg.js";

export const createPostgresJsNotifyProvider = ({
  sql,
}: {
  sql: postgres.Sql;
}): PgNotifyProvider => ({
  publish: async (channel, messages) => {
    await sql`SELECT pg_notify(${channel}, message) FROM json_array_elements_text(${JSON.stringify(messages)}::text::json) AS message`;
  },

  subscribe: async (channel, onMessage) => {
    const listenMeta = await sql.listen(channel, onMessage);
    return async () => {
      await listenMeta.unlisten();
    };
  },
});
