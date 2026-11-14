import { syncAsync } from "@queuert/sync-async";

export const findRow = syncAsync(function* (db, key) {
  const [row] = yield db.query(key);
  return row;
});
