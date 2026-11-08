for (const name of ["dispose", "asyncDispose"]) {
  if (!(name in Symbol)) {
    Object.defineProperty(Symbol, name, { value: Symbol.for(`Symbol.${name}`) });
  }
}
