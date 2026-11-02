/**
 * Colour themes. The colours themselves live in src/app/premium.css under html[data-palette="…"];
 * this list only names them for the picker. "mode" is the light/dark setting a theme opens in
 * (the moon/sun button can still change it afterwards).
 */
export const PALETTE_KEY = "fieldnotes-palette";

export const PALETTES = [
  { id: "royal", en: "Royal Purple", hi: "रॉयल पर्पल", tagline: "Velvet, gold leaf & serif", mode: "light", font: "'Cormorant Garamond', serif", swatch: ["#43128a", "#7e22ce", "#c9a227"] },
  { id: "jungle", en: "Jungle", hi: "जंगल", tagline: "Canopy, leaves & soft curves", mode: "light", font: "Outfit, sans-serif", swatch: ["#14532d", "#16a34a", "#bef264"] },
  { id: "ocean", en: "Ocean Blue", hi: "ओशन ब्लू", tagline: "Waves, glass & caustic light", mode: "light", font: "Sora, sans-serif", swatch: ["#1d4ed8", "#06b6d4", "#bae6fd"] },
  { id: "lava", en: "Red Lava", hi: "रेड लावा", tagline: "Obsidian, embers & molten edges", mode: "dark", font: "'Space Grotesk', sans-serif", swatch: ["#250a07", "#dc2626", "#f59e0b"] },
  { id: "graphite", en: "Graphite Rose", hi: "ग्रेफ़ाइट रोज़", tagline: "Brushed metal, hairlines & rose", mode: "light", font: "'Inter Tight', sans-serif", swatch: ["#18181b", "#52525b", "#e11d48"] },
  { id: "neon", en: "Neon Blue", hi: "नियॉन ब्लू", tagline: "Cyber HUD, glow & synthwave", mode: "dark", font: "Orbitron, sans-serif", swatch: ["#03060f", "#22d3ee", "#a855f7"] },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];
export const DEFAULT_PALETTE: PaletteId = "royal";

export function isPalette(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTES.some((palette) => palette.id === value);
}

/** Runs before the page paints (inline in the root layout), so a saved theme never flashes the default first. */
export const PALETTE_BOOT_SCRIPT = `(function(){var p="royal";try{var s=localStorage.getItem("${PALETTE_KEY}");if(s&&/^[a-z]+$/.test(s))p=s}catch(e){}document.documentElement.setAttribute("data-palette",p)})()`;

export function applyPalette(id: PaletteId) {
  document.documentElement.setAttribute("data-palette", id);
  try { window.localStorage.setItem(PALETTE_KEY, id); } catch { /* storage blocked: the theme still applies for this visit */ }
}

export function currentPalette(): PaletteId {
  const value = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-palette");
  return isPalette(value) ? value : DEFAULT_PALETTE;
}
