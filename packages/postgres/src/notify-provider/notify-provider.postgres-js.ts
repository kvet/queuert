import type postgres from "postgres";

import { type PgNotifyProvider } from "./notify-provider.pg.js";

export const createPostgresJsNotifyProvider = ({
  sql,
}: {
  sql: postgres.Sql;
}): PgNotifyProvider => ({
  publish: async (channel, message) => {
    await sql`SELECT pg_notify(${channel}, ${message})`;
  },

  subscribe: async (channel, onMessage) => {
    const listenMeta = await sql.listen(channel, onMessage);
    return async () => {
      await listenMeta.unlisten();
    };
  },
});
