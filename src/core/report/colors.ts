export interface Palette {
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  gray: (s: string) => string;
  bold: (s: string) => string;
}

const wrap = (open: string) => (s: string) => `\x1b[${open}m${s}\x1b[0m`;

export const ansi: Palette = {
  green: wrap("32"),
  red: wrap("31"),
  yellow: wrap("33"),
  gray: wrap("90"),
  bold: wrap("1"),
};

/** Identity palette — keeps rendered output diffable in tests and in pipes. */
export const plain: Palette = {
  green: (s) => s,
  red: (s) => s,
  yellow: (s) => s,
  gray: (s) => s,
  bold: (s) => s,
};

export function paletteFor(color: boolean): Palette {
  return color ? ansi : plain;
}
