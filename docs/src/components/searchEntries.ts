import type MiniSearch from "minisearch";

import type { SearchEntry } from "../../plugins/search-index.ts";

export const fetchSearchEntries = async (
  url: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<SearchEntry[]> => {
  const response = await fetchImplementation(url);
  if (!response.ok) throw new Error(`Search index request failed: HTTP ${response.status}`);
  return (await response.json()) as SearchEntry[];
};

const queryStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "with",
]);

export const createSearchIndex = (
  MiniSearchClass: typeof MiniSearch,
  entries: SearchEntry[],
): MiniSearch<SearchEntry> => {
  const index = new MiniSearchClass<SearchEntry>({
    fields: ["title", "heading", "text"],
    storeFields: ["title", "heading", "section", "href", "text"],
    searchOptions: {
      boost: { title: 5, heading: 3 },
      boostDocument: (_id, _term, stored) =>
        typeof stored?.section === "string" && stored.section.startsWith("API") ? 0.5 : 1,
      prefix: true,
      fuzzy: 0.15,
      combineWith: "AND",
      processTerm: (term) => {
        const lower = term.toLowerCase();
        return queryStopWords.has(lower) ? null : lower;
      },
    },
  });
  index.addAll(entries);
  return index;
};
