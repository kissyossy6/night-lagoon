import * as THREE from 'three';

export type NozzleType = 'vertical' | 'shooter' | 'oscillating' | 'fan' | 'ring' | 'mist';

export const TYPE_ID: Record<NozzleType, number> = {
  vertical: 0,
  shooter: 1,
  oscillating: 2,
  fan: 3,
  ring: 4,
  mist: 5,
};

/**
 * Whether a nozzle of this type sits on a turning head, as the default for
 * the fixture table: a whip (oscillating) and a fan do. A grid jet, a
 * geyser, a chaser, a mist line and the desk / garden / plaza jets are fixed
 * upright: pan and tilt do not lean their water (the real pump on the desk
 * cannot). A flower (ring) stays upright too and reads tilt as how far it
 * opens (2026-11-12). A kind can say otherwise (NozzleUse.turns: the
 * garden's small fan is a fan whose head is fixed); the rest of the code
 * reads Fixture.turns (show/layout.ts), not this.
 */
export function headTurns(type: NozzleType): boolean {
  return type === 'oscillating' || type === 'fan';
}

/** Physical description of one nozzle (or one fixture with several sub-jets). */
export interface NozzleSpec {
  type: NozzleType;
  origin: [number, number, number];
  height: number; // apex at full pressure (m)
  pressure: number;
  jets: number;
  p: [number, number, number, number];
  p2: [number, number, number, number];
  spread: number; // rad
  bore: number; // nozzle diameter (m)
  /** LED ring: full beam angle at half intensity (deg) and on-axis intensity relative to 20,000 cd. */
  beam: number;
  candela: number;
  aeration: number;
  breakup: number; // s
  kCol: number;
  kDrop: number;
  kMist: number;
  turb: number;
  color: THREE.ColorRepresentation;
  intensity: number;
  /**
   * Real lighting: the colour thins along the water's path, 1/e every
   * fadeLen metres, after the eye's compression (which otherwise flattens
   * a 30x falloff into an evenly lit rod). 0 or unset: no extra fade.
   */
  fadeLen?: number;
  /**
   * Real lighting: water hanging down after the top of its arc loses the
   * light faster, 1/e every fallFade metres it has fallen. The ring's beam
   * no longer reaches it and the light carried inside the column is mostly
   * gone. 0 or unset: no extra fade.
   */
  fallFade?: number;
  /**
   * Real lighting: how much of the ring's light the unbroken column carries
   * along inside it (1 = as made for World of Color in 2026-10, 0 = none).
   * Aerated water scatters the light within a few metres, so an aerated whip
   * carries little: it is brightest just above the nozzle and thins on the
   * way up (the user and the footage, 2026-11-06). Unset: 1.
   */
  guide?: number;
  /** Mist only: screen width and thickness (m). */
  mist?: { width: number; depth: number };
}

/** Flight time to splash-down for the tallest element (s), used as particle life. */
export function flightTime(spec: NozzleSpec): number {
  const g = 9.81;
  const k = spec.kCol;
  // exit speed for apex under column drag (same Newton as GLSL)
  const h = spec.height * spec.pressure;
  let U = Math.sqrt(2 * g * h);
  for (let i = 0; i < 4; i++) {
    const f = U / k - (g / (k * k)) * Math.log(1 + (k * U) / g) - h;
    const df = U / g / (1 + (k * U) / g);
    U -= f / df;
  }
  let y = 0;
  let v = U;
  let t = 0;
  const dt = 1 / 240;
  while (t < 30) {
    v += (-k * v - g) * dt;
    y += v * dt;
    t += dt;
    if (y < 0) break;
  }
  return t * 1.25; // broken-up drops fall slower than the column
}

export function nozzleUniforms(spec: NozzleSpec) {
  return {
    uTime: { value: 0 },
    uType: { value: TYPE_ID[spec.type] },
    uOrigin: { value: new THREE.Vector3(...spec.origin) },
    uHeight: { value: spec.height },
    uPressure: { value: spec.pressure },
    uJets: { value: spec.jets },
    uP: { value: new THREE.Vector4(...spec.p) },
    uP2: { value: new THREE.Vector4(...spec.p2) },
    uSpread: { value: spec.spread },
    uBore: { value: spec.bore },
    uAer: { value: spec.aeration },
    uBreak: { value: spec.breakup },
    uKCol: { value: spec.kCol },
    uKDrop: { value: spec.kDrop },
    uKMist: { value: spec.kMist },
    uTurb: { value: spec.turb },
    uWind: { value: new THREE.Vector3(0.6, 0, 0) },
    uWindC: { value: 0.15 },
    uLightColor: { value: new THREE.Color(spec.color) },
    uLightI: { value: spec.intensity },
    uLightModel: { value: 1 },
    uBeam: { value: THREE.MathUtils.degToRad(spec.beam / 2) },
    uGuideLen: { value: 30 },
    uCandela: { value: spec.candela },
  };
}

export type NozzleUniforms = ReturnType<typeof nozzleUniforms>;

/**
 * The two lighting looks the show can switch between.
 *   real:  as built. One coaxial LED ring per nozzle (World of Color
 *          hardware), inverse-square beam cone, falloff compressed for the eye
 *   ideal: looks first. Colour carried evenly up the whole column; not backed
 *          by real hardware
 */
export type LightingMode = 'real' | 'ideal';
export const LIGHT_MODEL: Record<LightingMode, number> = { real: 4, ideal: 1 };

/** Positions of the underwater lights (one per sub-jet), for water-surface pools. */
export function lightPositions(spec: NozzleSpec): THREE.Vector3[] {
  const o = new THREE.Vector3(...spec.origin);
  const out: THREE.Vector3[] = [];
  const n = spec.jets;
  for (let j = 0; j < n; j++) {
    const lane = j - (n - 1) / 2;
    const p = o.clone();
    if (spec.type === 'ring') {
      const a = (2 * Math.PI * j) / n;
      p.x += Math.cos(a) * spec.p[0];
      p.z += Math.sin(a) * spec.p[0];
    } else if (spec.type === 'vertical' || spec.type === 'oscillating') {
      p.x += lane * spec.p[spec.type === 'vertical' ? 0 : 3];
    } else if (spec.type === 'shooter') {
      p.x += lane * spec.p[3];
    }
    out.push(p);
  }
  if (spec.type === 'mist' && spec.mist) {
    out.length = 0;
    for (let i = 0; i < 8; i++) out.push(o.clone().add(new THREE.Vector3((i / 7 - 0.5) * spec.mist.width, 0, 0)));
  }
  return out;
}
