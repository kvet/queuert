declare const __brand: unique symbol;

type Brand<B> = { [__brand]: B };
// oxlint-disable-next-line no-unnecessary-type-constraint
export type Branded<T extends any, B> = T & Brand<B>;

export type UnionToIntersection<U> = (U extends any ? (x: U) => 0 : never) extends (x: infer I) => 0
  ? I
  : never;
export type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;
