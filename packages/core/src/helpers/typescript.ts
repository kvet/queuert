declare const __brand: unique symbol;

type Brand<B> = { [__brand]: B };
export type Branded<T extends any, B> = T & Brand<B>;

export type UnionToIntersection<U> = (
  U extends any ? (x: U) => 0 : never
) extends (x: infer I) => 0
  ? I
  : never;
export type IsUnion<T> = T extends any
  ? [T] extends [UnionToIntersection<T>]
    ? false
    : true
  : never;

type UnionToTupleLastOf<U> =
  UnionToIntersection<U extends any ? (x: U) => 0 : never> extends (
    x: infer L,
  ) => 0
    ? L
    : never;
type UnionToTuplePush<T extends any[], V> = [...T, V];
export type UnionToTuple<U, R extends any[] = []> = [U] extends [never]
  ? R
  : UnionToTuple<
      Exclude<U, UnionToTupleLastOf<U>>,
      UnionToTuplePush<R, UnionToTupleLastOf<U>>
    >;

export type Without<T, U> = { [K in Exclude<keyof T, keyof U>]?: never };
export type XOR<T, U> = (T & Without<U, T>) | (U & Without<T, U>);
