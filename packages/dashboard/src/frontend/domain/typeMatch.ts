// Scoring after fzf's v1 algorithm, so type search feels like fzf in the shell.
const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;
const BONUS_BOUNDARY = 8;
const BONUS_BOUNDARY_WHITE = BONUS_BOUNDARY + 2;
const BONUS_BOUNDARY_DELIMITER = BONUS_BOUNDARY + 1;
const BONUS_NON_WORD = BONUS_BOUNDARY;
const BONUS_CAMEL = BONUS_BOUNDARY + SCORE_GAP_EXTENSION;
const BONUS_CONSECUTIVE = -(SCORE_GAP_START + SCORE_GAP_EXTENSION);
const BONUS_FIRST_CHAR_MULTIPLIER = 2;

type CharClass = "white" | "delimiter" | "nonWord" | "lower" | "upper" | "number";

const charClass = (char: string): CharClass => {
  if (/\s/.test(char)) return "white";
  if (/[/,:;|]/.test(char)) return "delimiter";
  if (/\p{Nd}/u.test(char)) return "number";
  if (/\p{Lu}/u.test(char)) return "upper";
  if (/\p{L}/u.test(char)) return "lower";
  return "nonWord";
};

const isWord = (charClassValue: CharClass) =>
  charClassValue === "lower" || charClassValue === "upper" || charClassValue === "number";

/** How much a match at `index` is worth for where it sits: a word start beats the middle of one. */
const positionBonus = (name: string, index: number): number => {
  const previous = index === 0 ? "white" : charClass(name[index - 1]);
  const current = charClass(name[index]);
  if (isWord(current)) {
    if (previous === "white") return BONUS_BOUNDARY_WHITE;
    if (previous === "delimiter") return BONUS_BOUNDARY_DELIMITER;
    if (previous === "nonWord") return BONUS_BOUNDARY;
  }
  if (
    (previous === "lower" && current === "upper") ||
    (previous !== "number" && current === "number")
  )
    return BONUS_CAMEL;
  if (current === "nonWord" || current === "delimiter") return BONUS_NON_WORD;
  if (current === "white") return BONUS_BOUNDARY_WHITE;
  return 0;
};

/**
 * Scores one search term against `name` the way fzf's v1 algorithm does, or returns `undefined`
 * when the term's characters do not all appear in order. The term is case-insensitive unless it
 * contains an uppercase letter (smart case).
 */
const scoreTerm = (name: string, term: string): number | undefined => {
  const caseSensitive = term !== term.toLowerCase();
  // Lowercase one code unit at a time, so indexes into `text` stay valid for `name`.
  const text = caseSensitive
    ? name
    : Array.from(name.split(""), (char) => {
        const lower = char.toLowerCase();
        return lower.length === 1 ? lower : char;
      }).join("");

  // Forward pass: the earliest end of a full in-order match.
  let termIndex = 0;
  let end = -1;
  for (let index = 0; index < text.length && termIndex < term.length; index++) {
    if (text[index] === term[termIndex]) {
      termIndex++;
      if (termIndex === term.length) end = index;
    }
  }
  if (end < 0) return undefined;

  // Backward pass: the latest start for that end, which gives the shortest window.
  let start = end;
  termIndex = term.length - 1;
  for (let index = end; index >= 0; index--) {
    if (text[index] === term[termIndex]) {
      start = index;
      if (--termIndex < 0) break;
    }
  }

  let score = 0;
  let consecutive = 0;
  let firstBonus = 0;
  let inGap = false;
  termIndex = 0;
  for (let index = start; index <= end; index++) {
    if (text[index] === term[termIndex]) {
      let bonus = positionBonus(name, index);
      if (consecutive === 0) firstBonus = bonus;
      else {
        if (bonus >= BONUS_BOUNDARY && bonus > firstBonus) firstBonus = bonus;
        bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
      }
      score += SCORE_MATCH + (termIndex === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus);
      consecutive++;
      inGap = false;
      termIndex++;
    } else {
      score += inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START;
      consecutive = 0;
      firstBonus = 0;
      inGap = true;
    }
  }
  return score;
};

/**
 * Scores `name` against fzf-style search text, or returns `undefined` when it does not match.
 * Whitespace splits the text into terms that must all match, in any order; the score is their sum.
 */
export const scoreTypeName = (name: string, query: string): number | undefined => {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return undefined;
  let total = 0;
  for (const term of terms) {
    const score = scoreTerm(name, term);
    if (score === undefined) return undefined;
    total += score;
  }
  return total;
};

/**
 * The type names matching `query`, best first like fzf: highest score, then the shorter name, then
 * the order of `names`.
 */
export const matchTypeNames = (
  names: string[],
  query: string,
  limit: number = Infinity,
): string[] => {
  return names
    .flatMap((name) => {
      const score = scoreTypeName(name, query);
      return score === undefined ? [] : [{ name, score }];
    })
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, limit)
    .map((match) => match.name);
};
