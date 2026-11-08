import { MAX_IDS } from "../../shared/limits.ts";

export const parseIdList = (text: string): { ids: string[]; overLimit: boolean } => {
  const unique = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
  return { ids: unique.slice(0, MAX_IDS), overLimit: unique.length > MAX_IDS };
};
