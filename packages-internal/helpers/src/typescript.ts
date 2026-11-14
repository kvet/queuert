type UnionToIntersection<U> = (U extends any ? (x: U) => 0 : never) extends (x: infer I) => 0
  ? I
  : never;
export type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;
