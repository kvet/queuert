import { type SearchEntry } from "../../plugins/search-index.ts";

export const fetchSearchEntries = async (
  url: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<SearchEntry[]> => {
  const response = await fetchImplementation(url);
  if (!response.ok) throw new Error(`Search index request failed: HTTP ${response.status}`);
  return (await response.json()) as SearchEntry[];
};
