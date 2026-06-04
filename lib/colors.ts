/** Fallback palette for categories that have no saved color. */
export const CATEGORY_PALETTE = [
  "#0a84ff",
  "#34c759",
  "#ff9f0a",
  "#5e5ce6",
  "#ff375f",
  "#64d2ff",
  "#bf5af2",
  "#98989d",
] as const;

/** Grey used for the uncategorized / no-color swatch. */
export const NO_CATEGORY_COLOR = "#52525b";

type ColorByName = Record<string, string | null | undefined>;

/**
 * Color for a category by name: its saved color if present, else a deterministic
 * palette color chosen by `index` (so adjacent chart slices stay distinct).
 */
export function categoryColor(
  name: string,
  index: number,
  colorByName: ColorByName,
  palette: readonly string[] = CATEGORY_PALETTE,
): string {
  const saved = colorByName[name];
  if (saved) return saved;
  return palette[index % palette.length];
}

/** Swatch color for a single row's category: saved color, else the no-category grey. */
export function swatchColor(name: string | null, colorByName: ColorByName): string {
  if (!name) return NO_CATEGORY_COLOR;
  return colorByName[name] ?? NO_CATEGORY_COLOR;
}
