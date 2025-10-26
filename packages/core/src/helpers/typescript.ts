declare const __brand: unique symbol;

type Brand<B> = { [__brand]: B };
export type Branded<T extends string, B> = T & Brand<B>;
