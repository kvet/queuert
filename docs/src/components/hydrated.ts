import { type Accessor, createSignal, onSettled } from "solid-js";

/**
 * `false` while the calling component claims its prerendered markup, `true` once it has settled.
 * `createSyncedTabs` and `createPickedStack` gate the synced tabs and the stack filter on it, so
 * the hydrating render matches the prerendered page and the reader's pick applies right after.
 */
export const createHydrated = (): Accessor<boolean> => {
  const [hydrated, setHydrated] = createSignal(false);
  onSettled(() => {
    setHydrated(true);
  });
  return hydrated;
};
