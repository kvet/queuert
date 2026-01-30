import type mysql from "mysql2/promise";
import { type MysqlStateProvider } from "../state-provider/state-provider.mysql.js";

export type MysqlPoolContext = { connection: mysql.PoolConnection };
export type MysqlPoolProvider = MysqlStateProvider<MysqlPoolContext>;

export const createMysqlPoolProvider = ({ pool }: { pool: mysql.Pool }): MysqlPoolProvider => {
  return {
    executeSql: async ({ txContext, sql, params }) => {
      if (txContext) {
        const [rows] = await txContext.connection.query(sql, params);
        return rows as any[];
      }
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query(sql, params);
        return rows as any[];
      } finally {
        connection.release();
      }
    },
    runInTransaction: async (fn) => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await fn({ connection });
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
  };
};
