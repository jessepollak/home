// Brand-asset exceptions for home/no-literal-jsx-colors.
// Keys are `apps/web`-relative file paths; values are the exact raw color
// literals that file may use. Keep entries narrowly scoped to a real brand mark.
export const jsxColorExceptions = new Map([
  // Designed ETH diamond (brand purple disc + white facets); original geometry, not a themed surface.
  ["components/currency-mark.tsx", new Set(["#627eea", "#fff"])],
]);
