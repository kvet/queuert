type TripArgs<T> = [T] extends [true] ? [value?: T] : [value: T];

export type Latch<T = true> = {
  readonly tripped: boolean;
  readonly value: T | undefined;
  trip: (...args: TripArgs<T>) => boolean;
  throwIfTripped: (message?: string) => void;
};

export type ResettableLatch<T = true> = Latch<T> & {
  reset: () => void;
};

class OneShotLatch<T> implements Latch<T> {
  tripped = false;
  value: T | undefined = undefined;
  private readonly defaultMessage: string;

  constructor(defaultMessage: string) {
    this.defaultMessage = defaultMessage;
  }

  trip(...[value = true as T]: TripArgs<T>): boolean {
    if (this.tripped) return false;
    this.tripped = true;
    this.value = value;
    return true;
  }

  throwIfTripped(message = this.defaultMessage): void {
    if (this.tripped) throw new Error(message);
  }
}

class ResettableLatchImpl<T> extends OneShotLatch<T> implements ResettableLatch<T> {
  reset(): void {
    this.tripped = false;
    this.value = undefined;
  }
}

export const createResettableLatch = <T = true>(
  defaultMessage = "Latch is tripped",
): ResettableLatch<T> => new ResettableLatchImpl<T>(defaultMessage);

export const createLatch = <T = true>(defaultMessage = "Latch is tripped"): Latch<T> =>
  new OneShotLatch<T>(defaultMessage);
