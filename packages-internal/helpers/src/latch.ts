export type Latch = {
  readonly tripped: boolean;
  trip: () => boolean;
  throwIfTripped: (message?: string) => void;
};

export type ResettableLatch = Latch & {
  reset: () => void;
};

class OneShotLatch implements Latch {
  tripped = false;
  private readonly defaultMessage: string;

  constructor(defaultMessage: string) {
    this.defaultMessage = defaultMessage;
  }

  trip(): boolean {
    if (this.tripped) return false;
    this.tripped = true;
    return true;
  }

  throwIfTripped(message = this.defaultMessage): void {
    if (this.tripped) throw new Error(message);
  }
}

class ResettableLatchImpl extends OneShotLatch implements ResettableLatch {
  reset(): void {
    this.tripped = false;
  }
}

export const createResettableLatch = (defaultMessage = "Latch is tripped"): ResettableLatch =>
  new ResettableLatchImpl(defaultMessage);

export const createLatch = (defaultMessage = "Latch is tripped"): Latch =>
  new OneShotLatch(defaultMessage);
