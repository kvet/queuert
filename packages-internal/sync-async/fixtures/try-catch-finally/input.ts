import { syncAsync, step } from "@queuert/sync-async";

export const deleteChain = syncAsync(function* (db, chainId) {
  try {
    yield* step(db.execute("DELETE FROM job WHERE chain_id = ?", [chainId]));
    return true;
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return false;
  } finally {
    yield* step(db.release());
  }
});
