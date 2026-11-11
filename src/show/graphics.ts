/**
 * Stage 7 (画質): which of the new looks are on. On by default for every
 * version (the drawing is shared, so all three versions take it); each
 * stays a switch, and all off gives the picture from before stage 7 exactly
 * (0 pixels of difference).
 *
 *   impact   H2 water hitting the water: ripples, splash, foam (techniques/impact.ts)
 *   surface  H3 the water surface: ripples bend the reflection, stronger far off
 *   mist     H4 finer mist on the water screens
 *   pyro     the fireworks look from the reference-page report (2026-11-08):
 *            each star's own burn time, a halo round every star, sparks from
 *            risers and willows, the sky lit a little at each burst
 *            (techniques/fireworks.ts PYRO_LOOK; docs/reports/hanabi-reference.html 1, 4, 5, 2)
 *   film     fine film grain and slightly darker corners over the whole
 *            picture (core/stage.ts; report idea 7); not in the 180° video
 *
 * URL: ?gfx=off (the old look), ?gfx=impact,surface (only those), ?gfx=all.
 */
export interface Graphics {
  impact: boolean;
  surface: boolean;
  mist: boolean;
  pyro: boolean;
  film: boolean;
}

export const GRAPHICS_KEYS = ['impact', 'surface', 'mist', 'pyro', 'film'] as const;
export const GRAPHICS_OFF: Graphics = { impact: false, surface: false, mist: false, pyro: false, film: false };
export const GRAPHICS_ON: Graphics = { impact: true, surface: true, mist: true, pyro: true, film: true };
/** What every version starts with. */
export const GRAPHICS_DEFAULT = GRAPHICS_ON;

export function parseGraphics(s: string | null | undefined): Graphics {
  if (s == null) return { ...GRAPHICS_DEFAULT };
  if (s === '' || s === 'off' || s === 'none') return { ...GRAPHICS_OFF };
  const on = new Set(s.split(',').map((x) => x.trim()));
  const all = on.has('all');
  return Object.fromEntries(GRAPHICS_KEYS.map((k) => [k, all || on.has(k)])) as unknown as Graphics;
}

export function sameGraphics(a: Graphics, b: Graphics) {
  return GRAPHICS_KEYS.every((k) => a[k] === b[k]);
}
