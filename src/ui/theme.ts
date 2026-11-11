/**
 * The look tokens (src/styles/tokens.css) for code that paints a canvas
 * instead of using CSS: the editor timeline and the player's scope. One
 * field per custom property.
 */
const TOKENS = {
  // shared
  fontCanvas: '--font-canvas',
  fontMono: '--font-mono',
  fontPlayer: '--font-player',
  fs2xs: '--fs-2xs',
  fsXs: '--fs-xs',
  fsSm: '--fs-sm',
  fsMd: '--fs-md',
  accent: '--accent',
  fwBold: '--fw-bold',
  // timeline
  tlBg: '--c-tl-bg',
  tlRowA: '--c-tl-row-a',
  tlRowB: '--c-tl-row-b',
  tlHead: '--c-tl-head',
  tlLaneA: '--c-tl-lane-a',
  tlLaneB: '--c-tl-lane-b',
  tlLaneName: '--c-tl-lane-name',
  tlTextDim: '--c-tl-text-dim',
  tlDivider: '--c-tl-divider',
  tlRuler: '--c-tl-ruler',
  tlSectionNone: '--c-tl-section-none',
  tlSectionText: '--c-tl-section-text',
  tlGrid: '--c-tl-grid',
  tlGridStrong: '--c-tl-grid-strong',
  tlGridFaint: '--c-tl-grid-faint',
  tlSelFill: '--c-tl-sel-fill',
  tlSelLine: '--c-tl-sel-line',
  tlWave: '--c-tl-wave',
  tlTick: '--c-tl-tick',
  tlTickStrong: '--c-tl-tick-strong',
  tlTickText: '--c-tl-tick-text',
  tlMarker: '--c-tl-marker',
  tlMarkerStrong: '--c-tl-marker-strong',
  tlShade: '--c-tl-shade',
  tlCorner: '--c-tl-corner',
  tlCornerText: '--c-tl-corner-text',
  tlOk: '--c-ok',
  tlCaution: '--c-caution',
  tlPlayhead: '--c-tl-playhead',
  tlScroll: '--c-tl-scroll',
  tlRamp: '--c-tl-ramp',
  tlBlockMark: '--c-tl-block-mark',
  tlBlockInvalid: '--c-tl-block-invalid',
  tlBlockPrimary: '--c-tl-block-primary',
  tlBlockSelected: '--c-tl-block-selected',
  tlBlockShadow: '--c-tl-block-shadow',
  tlLabelDark: '--c-tl-label-dark',
  tlLabelLight: '--c-tl-label-light',
  tlLabelSubDark: '--c-tl-label-sub-dark',
  tlLabelSubLight: '--c-tl-label-sub-light',
  tlHandle: '--c-tl-handle',
  tlNavBg: '--c-tl-nav-bg',
  tlNavView: '--c-tl-nav-view',
  tlNavViewFill: '--c-tl-nav-view-fill',
  // player scope
  scopeBg: '--c-scope-bg',
  scopeLabelBg: '--c-scope-label-bg',
  scopeLabel: '--c-scope-label',
  scopeGrid: '--c-scope-grid',
  scopeText: '--c-scope-text',
  scopeSection: '--c-scope-section',
  scopeWavePast: '--c-scope-wave-past',
  scopeWave: '--c-scope-wave',
  scopeOnsetRgb: '--c-scope-onset',
  scopeGeyser: '--c-scope-geyser',
  scopePlayhead: '--c-scope-playhead',
  overviewPast: '--c-overview-past',
  overview: '--c-overview',
  // venue editor top view
  vnBg: '--c-vn-bg',
  vnWater: '--c-vn-water',
  vnWaterLine: '--c-vn-water-line',
  vnGrid: '--c-vn-grid',
  vnGridStrong: '--c-vn-grid-strong',
  vnText: '--c-vn-text',
  vnSeat: '--c-vn-seat',
  vnSkipped: '--c-vn-skipped',
  vnSel: '--c-vn-sel',
  vnHover: '--c-vn-hover',
  vnHandle: '--c-vn-handle',
  vnStop: '--c-vn-stop',
  vnDanger: '--c-vn-danger',
  vnNote: '--c-vn-note',
} as const;

export type Theme = { [K in keyof typeof TOKENS]: string };

const NOT_COLOUR = /^(font|fs|fw)/;

/**
 * A colour token as plain rgb()/rgba() a canvas takes: tokens are written
 * with var() and color-mix(), so they are resolved through a probe element.
 */
function resolveColour(probe: HTMLElement, prop: string): string {
  probe.style.color = `var(${prop})`;
  const c = getComputedStyle(probe).color;
  // color-mix() computes to color(srgb r g b / a), with 0–1 channels
  const m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(c);
  if (!m) return c;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.round(Number(x) * 255));
  return `rgba(${r}, ${g}, ${b}, ${m[4] ?? 1})`;
}

/** Read every token from the document's computed style. */
export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.documentElement.appendChild(probe);
  const t = Object.fromEntries(
    Object.entries(TOKENS).map(([k, v]) => [k, NOT_COLOUR.test(k) ? cs.getPropertyValue(v).trim() : resolveColour(probe, v)]),
  ) as Record<string, string>;
  probe.remove();
  // the scope draws onsets at several alphas from one colour: give it as "r,g,b"
  t.scopeOnsetRgb = (/\d+,\s*\d+,\s*\d+/.exec(t.scopeOnsetRgb)?.[0] ?? '235,235,230').replace(/\s/g, '');
  return t as Theme;
}

let current: Theme | null = null;
const listeners: ((t: Theme) => void)[] = [];

const cssLoaded = () => getComputedStyle(document.documentElement).getPropertyValue('--c-tl-bg').trim() !== '';

/** The tokens, read once the stylesheet is in (an unstyled read is not kept). */
export function theme(): Theme {
  if (current) return current;
  const t = readTheme();
  if (cssLoaded()) current = t;
  return t;
}

/** Call fn with the new tokens whenever a 'themechange' event fires on window. */
export function onThemeChange(fn: (t: Theme) => void): void {
  listeners.push(fn);
}

// the typeface files load after the first paint; redraw canvases once they are in
document.fonts?.addEventListener('loadingdone', () => window.dispatchEvent(new Event('themechange')));

window.addEventListener('themechange', () => {
  current = readTheme();
  for (const fn of listeners) fn(current);
});
