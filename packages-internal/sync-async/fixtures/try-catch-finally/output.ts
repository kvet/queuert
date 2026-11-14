import { syncStep as __syncStep } from "@queuert/sync-async";

export const deleteChain = {
  sync: function (db, chainId) {
    try {
      __syncStep(db.execute("DELETE FROM job WHERE chain_id = ?", [chainId]));
      return true;
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      return false;
    } finally {
      __syncStep(db.release());
    }
  },
  async: async function (db, chainId) {
    try {
      await db.execute("DELETE FROM job WHERE chain_id = ?", [chainId]);
      return true;
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      return false;
    } finally {
      await db.release();
    }
  },
};
