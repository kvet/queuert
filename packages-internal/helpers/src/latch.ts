export type Latch = {
  readonly tripped: boolean;
  trip: () => boolean;
  throwIfTripped: (message?: string) => void;
};

export type ResettableLatch = Latch & {
  reset: () => void;
};

export const createResettableLatch = (defaultMessage = "Latch is tripped"): ResettableLatch => {
  let tripped = false;
  return {
    get tripped() {
      return tripped;
    },
    trip: () => {
      if (tripped) return false;
      tripped = true;
      return true;
    },
    throwIfTripped: (message = defaultMessage) => {
      if (tripped) throw new Error(message);
    },
    reset: () => {
      tripped = false;
    },
  };
};

export const createLatch = (defaultMessage?: string): Latch => {
  const latch = createResettableLatch(defaultMessage);
  return {
    get tripped() {
      return latch.tripped;
    },
    trip: latch.trip,
    throwIfTripped: latch.throwIfTripped,
  };
};
