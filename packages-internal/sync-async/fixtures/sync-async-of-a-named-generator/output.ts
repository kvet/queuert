import { syncAsync } from "@queuert/sync-async";

function* findRowSteps(db, key) {
  const [row] = yield db.query(key);
  return row;
}

export const findRow = syncAsync(findRowSteps);
