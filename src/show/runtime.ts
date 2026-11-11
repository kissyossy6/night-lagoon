import * as THREE from 'three';
import { LIGHT_MODEL, nozzleUniforms, type LightingMode } from '../core/nozzles';
import { NOZZLES } from '../fixtures';
import { Stage } from '../core/stage';
import { MistTechnique } from '../techniques/mist';
import { Fireworks, PYRO_GAIN, PYRO_LAB_OFF, PYRO_LOOK } from '../techniques/fireworks';
import { Smoke } from '../techniques/smoke';
import { compileShow, screenAt, CH, type CompiledShow, type ScreenFrame } from './cues';
import { ParamHistory } from './history';
import { PROJECTOR_MAX } from './projector';
import { JetField } from './jetfield';
import { QUALITY_SCALE, buildLayout, zoneAt, zonesOfScreen, type Layout, type Quality, type ScreenUnit } from './layout';
import type { ShowFile } from './types';
import { getVenue, type Venue } from '../venues';
import { GRAPHICS_DEFAULT, GRAPHICS_OFF, sameGraphics, type Graphics } from './graphics';

/** Side of the ripple / foam map per quality tier (techniques/impact.ts). */
const IMPACT_MAP: Record<Quality, number> = { high: 2048, medium: 1536, low: 1024, export: 4096 };

/**
 * Projector brightness on the mist. Rear projection scatters forward, toward
 * the audience, so the same projector reads brighter than from the front;
 * this keeps the picture at the level of the show footage instead of
 * outshining the fountains.
 */
const PROJECTOR_GAIN = 0.62;

export interface ScreenContent {
  texture: THREE.Texture;
  /** Draw what the projector shows (see screenAt). */
  render(frame: ScreenFrame): void;
  /** No screen is up: stop whatever runs on its own (videos). */
  idle?(): void;
  /** Wait until render(frame) can draw exactly that frame (offline export: video seeks). */
  prepare?(frame: ScreenFrame): Promise<void>;
  /** Mean colour of the last frame (0..1). */
  averageColor(): [number, number, number];
}

/**
 * Everything that turns a show file into pixels: stage, fixtures, parameter
 * history, water, and the water screen. Shared by the player and the editor.
 */
export class ShowRuntime {
  readonly stage: Stage;
  layout!: Layout;
  history!: ParamHistory;
  jets!: JetField;
  show!: CompiledShow;
  private screens: { unit: ScreenUnit; parts: MistTechnique[]; uniforms: ReturnType<typeof nozzleUniforms> }[] = [];
  file!: ShowFile;
  private viewport = new THREE.Vector2();
  private lighting: LightingMode = 'real';
  /** Where the show stands; set from the show file (ShowFile.venue). */
  venue: Venue;
  private quality: Quality;
  /** Fireworks and their smoke (src/pyro/, stage 2); nothing is drawn without fire cues. */
  readonly fireworks: Fireworks;
  readonly smoke: Smoke;
  private pyroLight = new THREE.Vector3();
  /** Stage 7's new water looks (show/graphics.ts); on by default, all off is the picture from before. */
  private gfx: Graphics = { ...GRAPHICS_DEFAULT };
  /** Whether the built water screens have H4's fine mist. */
  private screensFine = false;

  constructor(
    container: HTMLElement,
    private screen: ScreenContent,
    quality: Quality = 'high',
    pixelRatio?: number,
    venue: Venue = getVenue(),
  ) {
    this.venue = venue;
    this.quality = quality;
    // a full lagoon is far brighter than one lab fixture: a higher bloom
    // threshold keeps the big white hits from greying the whole sky
    // whitened LED cores and a wider halo match the show footage (R3)
    this.stage = new Stage(container, {
      pixelRatio,
      exposure: 1.0,
      bloom: { strength: 0.5, radius: 0.75, threshold: 0.7 },
      highlightWhite: 0.6,
    });
    this.fireworks = new Fireworks(venue.wind);
    this.smoke = new Smoke(venue.wind);
    this.stage.scene.add(this.fireworks.object, this.smoke.object);
    this.build(quality);
  }

  get qualityTier(): Quality {
    return this.quality;
  }

  /** (Re)build fixtures for a quality tier. Keeps the loaded show. */
  build(quality: Quality) {
    this.quality = quality;
    if (this.jets) {
      this.stage.scene.remove(this.jets.object);
      this.jets.dispose();
    }
    this.layout = buildLayout(this.venue, quality);
    this.history = new ParamHistory(this.layout.channels);
    const g = this.drawnGraphics;
    this.jets = new JetField(this.layout, this.history, {
      impact: g.impact ? { scale: QUALITY_SCALE[quality], mapSize: IMPACT_MAP[quality] } : undefined,
    });
    const imp = this.jets.impact;
    this.stage.setImpact(imp ? imp.map : null, imp?.box);
    this.stage.setSurface(g.surface);
    this.stage.setFilm(g.film);
    this.fireworks.setLab(g.pyro ? PYRO_LOOK : PYRO_LAB_OFF);
    if (this.screens.length && this.screensFine !== g.mist) this.dropScreens();
    this.jets.lightModel.value = LIGHT_MODEL[this.lighting];
    this.stage.scene.add(this.jets.object);
    if (this.screens.length === 0) this.buildScreens();
    if (this.file) this.setShow(this.file);
  }

  /** The wide sheet and the three mounds; all project one panorama. */
  private buildScreens() {
    const layout = buildLayout(this.venue, 'low');
    const wide = layout.screen;
    // rear projection: the projectors stand behind the screens, low, and
    // throw one panorama through the mist toward the audience
    const projector = new THREE.Vector3(...layout.projectorAt);
    for (const unit of layout.screens) {
      const spec = {
        ...NOZZLES.mist,
        origin: unit.center,
        height: unit.height,
        mist: { width: unit.width, depth: 2.5 },
      };
      const uniforms = nozzleUniforms(spec);
      // the projected frame is fixed in space, like the projector: mist that
      // rises or falls only reveals or loses part of the picture
      const frame = { centerX: wide.center[0], width: wide.width, height: wide.height, projector };
      const fine = this.drawnGraphics.mist;
      this.screensFine = fine;
      const sheet = new MistTechnique(uniforms, spec, 'sheet', this.screen.texture, { frame, dome: unit.dome, rear: true, fine });
      // H4: finer mist at the edges, more and smaller puffs
      const edge = new MistTechnique(uniforms, spec, 'cloud-sprites', this.screen.texture, {
        count: Math.round(((fine ? 7500 : 3000) * unit.width) / wide.width) + (unit.dome ? (fine ? 750 : 300) : 0),
        cover: 0.06,
        size: fine ? 0.6 : undefined,
        edgeOnly: true,
        vertexLit: true,
        frame,
        dome: unit.dome,
        rear: true,
      });
      const parts = [sheet, edge];
      for (const p of parts) this.stage.scene.add(p.object);
      this.screens.push({ unit, parts, uniforms });
    }
  }

  /** Load or hot-reload a show; the picture follows on the next frame. */
  setShow(file: ShowFile) {
    this.file = file;
    const venue = getVenue(file.venue);
    if (venue !== this.venue) {
      // another venue (the venue editor's 3Dで見る): rebuild the fixtures and
      // the screens, whose cue channels follow the fixtures
      this.venue = venue;
      this.dropScreens();
      this.build(this.quality);
      return;
    }
    this.show = compileShow(file, this.layout);
    this.history.setShow(this.show);
    this.fireworks.setBursts(this.show.bursts, QUALITY_SCALE[this.quality]);
    this.smoke.setBursts(this.show.bursts);
    if (!this.fireworks.hasBursts) {
      // a show without fireworks after one with them: no light left behind
      this.stage.setSkyLights([], false);
      this.jets.haze.setPyro(this.pyroLight.set(0, 0, 0), false);
    }
  }

  /**
   * Mist in a curtain at t: the cue level, or what is left of the mist from
   * the last few seconds, which hangs and fades over about a second and a half.
   */
  private mistAt(index: number, t: number): number {
    let m = this.history.current(index, CH.pressure, t);
    for (let k = 1; k <= 12; k++) {
      const dt = k * 0.25;
      m = Math.max(m, this.history.current(index, CH.pressure, t - dt) * Math.exp(-dt / 1.5));
    }
    return m;
  }

  /** The projector's zones as brightness shares across the panorama, or undefined when all alike. */
  private projectorMask(level: number[], top: number): number[] | undefined {
    if (top <= 0 || level.every((v) => v >= top - 1e-4)) return undefined;
    const { center, width } = this.layout.screen;
    return Array.from({ length: 117 }, (_, i) => zoneAt(this.layout.projector, level, center[0] - width / 2 + (i / 116) * width) / top);
  }

  /** How bright the picture on one screen is: the zone at its centre, the mean over the zones for one that spans several. */
  private screenBright(unit: ScreenUnit, level: number[]): number {
    const zones = this.layout.projector;
    if (!zones.length || !unit.lit) return 0;
    const over = zonesOfScreen(zones, unit);
    if (over.length > 1) return over.reduce((a, z) => a + level[z.index - zones[0].index], 0) / over.length;
    return zoneAt(zones, level, unit.center[0]);
  }

  /** Turn stage 7's water looks on or off (rebuilds the water when it changes). */
  setGraphics(g: Graphics) {
    if (sameGraphics(g, this.gfx)) return;
    this.gfx = { ...g };
    this.build(this.quality);
  }

  /**
   * The looks actually drawn. The lowest tier ('low', where the player drops
   * to when drawing is too heavy) draws none of them, whatever is set.
   */
  get drawnGraphics(): Graphics {
    return this.quality === 'low' ? { ...GRAPHICS_OFF } : { ...this.gfx };
  }

  private dropScreens() {
    for (const { parts } of this.screens) {
      for (const p of parts) {
        this.stage.scene.remove(p.object);
        p.dispose();
      }
    }
    this.screens = [];
  }

  get graphics(): Graphics {
    return { ...this.gfx };
  }

  setLighting(mode: LightingMode) {
    this.lighting = mode;
    this.jets.lightModel.value = LIGHT_MODEL[mode];
    this.fireworks.setGain(PYRO_GAIN[mode]);
  }

  get lightingMode() {
    return this.lighting;
  }

  /** Before render(t) of a frame that must be exact (export): let the projector catch up. */
  async prepare(t: number) {
    await this.screen.prepare?.(screenAt(this.show, t));
  }

  render(t: number) {
    const s = this.stage;
    this.advance(t);
    this.aim(t, s.camera, s.pxPerMetre(), s.viewport());
    s.render(t);
  }

  /**
   * Water for a camera at show time t (after advance(t)). A 180° frame aims
   * once per eye: its cube faces share the eye position and pixel scale.
   */
  aim(t: number, camera: THREE.PerspectiveCamera, pxPerMetre: number, viewport: THREE.Vector2) {
    this.viewport.copy(viewport);
    this.jets.update(this.stage.renderer, t, camera, pxPerMetre, this.viewport);
    this.fireworks.aim(pxPerMetre, this.viewport);
    for (const { parts } of this.screens) for (const p of parts) p.update({ time: t, pxPerMetre: 0, viewport: this.viewport, camera });
  }

  /** Everything at show time t that does not depend on the camera. */
  advance(t: number) {
    const s = this.stage;
    this.history.update(t);

    // water screens: the height comes from each screen's cue channel, the
    // picture from the projector behind them (its zones' brightness, and the
    // clip a cue chose or the one that belongs to the show time); the mist
    // catches the picture wherever it is, and the image lights the mist base
    // and the water in front of it
    const levels = this.screens.map(({ unit }) => this.mistAt(unit.index, t));
    const up = levels.some((l) => l > 0.01);
    const zones = this.layout.projector;
    const zoneLevel = zones.map((z) => Math.min(PROJECTOR_MAX, Math.max(0, this.history.current(z.index, CH.intensity, t))));
    const top = Math.max(0, ...zoneLevel);
    // the projector only runs while a screen is up
    if (up) this.screen.render({ ...screenAt(this.show, t), mask: this.projectorMask(zoneLevel, top) });
    else this.screen.idle?.();
    const avg = up ? this.screen.averageColor() : ([0, 0, 0] as [number, number, number]);
    const poolPos: THREE.Vector3[] = [];
    const poolW: number[] = [];
    this.screens.forEach(({ unit, parts, uniforms: u }, k) => {
      const level = levels[k];
      // the brightness of the picture on this screen: the projector's at its
      // centre, or across it for the wide sheet
      const bright = this.screenBright(unit, zoneLevel);
      // the curtain rises with its water whips, but when they stop it thins
      // out and sinks slowly instead of dropping like a blind
      const now = this.history.current(unit.index, CH.pressure, t);
      u.uHeight.value = Math.max(0.01, Math.max(now, Math.sqrt(level) * 0.95)) * unit.height;
      u.uLightColor.value.setRGB(avg[0], avg[1], avg[2]);
      u.uLightI.value = level * bright * 0.6;
      for (const p of parts) {
        p.object.visible = level > 0.01;
        p.setDensity(Math.min(1, level * 1.4));
        // the projector runs at its own brightness; how much of the picture
        // is seen depends only on how much mist there is to catch it
        // a screen the projector does not light catches no picture
        p.setProjection(unit.lit ? top * PROJECTOR_GAIN : 0);
      }
      if (level > 0.01) {
        const n = Math.max(2, Math.round((12 * unit.width) / this.layout.screen.width));
        for (let j = 0; j < n; j++) {
          poolPos.push(new THREE.Vector3(unit.center[0] + ((j + 0.5) / n - 0.5) * unit.width, 0, unit.center[2] + 3));
          poolW.push(level * bright);
        }
      }
    });
    s.setPools(poolPos, new THREE.Color(avg[0], avg[1], avg[2]), 2.5, poolW);
    this.advancePyro(t);
    s.setTime(t);
  }

  /** Fireworks at t, and the light they throw on the water, the haze and their smoke. */
  private advancePyro(t: number) {
    const fw = this.fireworks;
    if (!fw.hasBursts) return;
    fw.advance(t);
    this.smoke.advance(t, fw.lights);
    this.stage.setSkyLights(fw.lights, true);
    // the mist over the lagoon: light falls off with the distance from the stage
    const L = this.pyroLight.set(0, 0, 0);
    for (const l of fw.lights) {
      const d2 = l.pos.x * l.pos.x + (l.pos.y - 15) * (l.pos.y - 15) + l.pos.z * l.pos.z;
      L.addScaledVector(l.col, 4000 / (d2 + 4000));
    }
    this.jets.haze.setPyro(L.multiplyScalar(0.05));
  }
}
