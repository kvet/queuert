const cell = 24;
const square = 18;

const litPattern = (columns: number, rows: number, cells: [number, number][]) => ({
  width: columns * cell,
  height: rows * cell,
  cells,
});

const lit = [
  litPattern(7, 5, [
    [1, 1],
    [4, 3],
    [6, 0],
  ]),
  litPattern(11, 6, [
    [2, 4],
    [8, 1],
    [9, 5],
  ]),
];

const heroMask = "[mask-image:radial-gradient(ellipse_80%_70%_at_70%_40%,black,transparent_75%)]";

/**
 * A grid of faint squares with a few brighter ones, behind the home hero and the site footer.
 * `id` keeps each instance's SVG patterns apart; `mask` sets where the grid fades out.
 */
export const HeroSquares = (props: { id?: string; mask?: string }) => {
  const id = () => props.id ?? "hero-squares";
  return (
    <svg
      aria-hidden="true"
      class={`pointer-events-none absolute inset-0 size-full text-fg ${props.mask ?? heroMask}`}
    >
      <defs>
        <pattern id={`${id()}-grid`} width={cell} height={cell} patternUnits="userSpaceOnUse">
          <rect width={square} height={square} rx="2" fill="currentColor" opacity="0.045" />
        </pattern>
        {lit.map((pattern, index) => (
          <pattern
            id={`${id()}-lit-${index}`}
            width={pattern.width}
            height={pattern.height}
            patternUnits="userSpaceOnUse"
          >
            {pattern.cells.map(([column, row]) => (
              <rect
                x={column * cell}
                y={row * cell}
                width={square}
                height={square}
                rx="2"
                fill="currentColor"
                opacity="0.09"
              />
            ))}
          </pattern>
        ))}
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id()}-grid)`} />
      {lit.map((_, index) => (
        <rect width="100%" height="100%" fill={`url(#${id()}-lit-${index})`} />
      ))}
    </svg>
  );
};
