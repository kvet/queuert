import { InvalidJobIdError } from "../errors.js";

export type IdValidator<TIdType extends string> = {
  /** Validates a caller- or generator-supplied ID; throws {@link InvalidJobIdError} on failure. */
  validateId: (id: TIdType, source: "generator" | "caller") => void;
  /** Produces a new ID via the configured generator and validates it. */
  generateId: () => TIdType;
};

export const createIdValidator = <TIdType extends string>({
  generateIdOption,
  validateIdOption,
}: {
  generateIdOption: () => TIdType;
  validateIdOption?: (id: TIdType) => boolean;
}): IdValidator<TIdType> => {
  const validateId = (id: TIdType, source: "generator" | "caller"): void => {
    if (validateIdOption && !validateIdOption(id)) {
      throw new InvalidJobIdError(
        `Invalid job ID "${id}" from ${source} — failed validateId predicate`,
        { id, source },
      );
    }
  };
  const generateId = (): TIdType => {
    const id = generateIdOption();
    validateId(id, "generator");
    return id;
  };
  return { validateId, generateId };
};
