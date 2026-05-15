const ROMAN_1_10 = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

/** CoD-style round label: Roman I–X for waves 1–10, Arabic from 11 onward. */
export function formatWaveRound(wave: number): string {
  if (wave <= 0) return "0";
  if (wave <= 10) return ROMAN_1_10[wave]!;
  return String(wave);
}
