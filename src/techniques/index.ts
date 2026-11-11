import * as THREE from 'three';
import { flightTime, type NozzleSpec, type NozzleUniforms } from '../core/nozzles';
import { MistTechnique } from './mist';
import { ParticleTechnique } from './particles';
import { StrandTechnique } from './strands';
import type { FrameInfo, Technique } from './types';

export type TechId = 'A' | 'B' | 'C' | 'D' | 'E';
export const TECH_IDS: TechId[] = ['A', 'B', 'C', 'D', 'E'];

export const JET_TECH_LABELS: Record<TechId, string> = {
  A: '設計書：点スプライト＋加算合成',
  B: '流れ線パーティクル＋被覆合成',
  C: 'ストランド（流跡線リボン）',
  D: 'ハイブリッド（柱リボン＋飛沫＋霧）',
  E: 'ハイブリッド改（細い柱＋気泡飛沫＋霧）',
};

export const MIST_TECH_LABELS: Record<TechId, string> = {
  A: '設計書：霧スプライト＋加算合成',
  B: '設計書：ノイズ板（ウォータースクリーン）',
  C: '雲状スプライト＋被覆合成',
  D: 'ボリューム・レイマーチ',
  E: 'ノイズ板＋縁の雲スプライト',
};

class Group implements Technique {
  constructor(
    public object: THREE.Object3D,
    private parts: Technique[],
  ) {}
  update(f: FrameInfo) {
    for (const p of this.parts) p.update(f);
  }
  dispose() {
    for (const p of this.parts) p.dispose();
  }
}

export function createTechnique(
  id: TechId,
  spec: NozzleSpec,
  u: NozzleUniforms,
  image: THREE.Texture,
): Technique {
  if (spec.type === 'mist') {
    if (id === 'E') {
      const sheet = new MistTechnique(u, spec, 'sheet', image);
      const edge = new MistTechnique(u, spec, 'cloud-sprites', image, { count: 2500, cover: 0.05, edgeOnly: true });
      const g = new THREE.Group();
      g.add(sheet.object, edge.object);
      return new Group(g, [sheet, edge]);
    }
    const mode = ({ A: 'points-additive', B: 'sheet', C: 'cloud-sprites', D: 'volume' } as const)[id];
    return new MistTechnique(u, spec, mode, image);
  }
  const life = flightTime(spec);
  // rough per-jet budget so fan/ring get similar density per stream
  const jets = spec.jets;
  const bore = spec.bore / 0.06;
  switch (id) {
    case 'A':
      u.uLightModel.value = 0;
      return new ParticleTechnique(u, {
        mode: 'points',
        count: 60000,
        mistFraction: 0.2,
        life,
        cover: 0.35,
        mistCover: 0.03,
        dropSize: 0.05,
        mistSize: 0.5,
        shutter: 1 / 30,
      });
    case 'B':
      return new ParticleTechnique(u, {
        mode: 'streaks',
        count: 60000,
        mistFraction: 0.15,
        life,
        cover: 0.55,
        mistCover: 0.05,
        dropSize: 0.04,
        mistSize: 0.45,
        shutter: 1 / 30,
      });
    case 'C':
      return new StrandTechnique(u, {
        strands: Math.min(120 * jets, 900),
        segments: 96,
        life,
        cover: 0.22,
        width: 0.07 * bore,
      });
    case 'D': {
      const group = new THREE.Group();
      const column = new StrandTechnique(u, {
        strands: 6 * jets,
        segments: 96,
        life,
        cover: 0.55,
        width: 0.16 * bore,
        column: true,
        coreBias: 0.35,
      });
      const spray = new ParticleTechnique(u, {
        mode: 'streaks',
        count: 50000,
        mistFraction: 0,
        life,
        cover: 0.6,
        mistCover: 0,
        dropSize: 0.035,
        mistSize: 0,
        shutter: 1 / 30,
        cohCover: 0,
        sparkle: 3,
      });
      const mist = new ParticleTechnique(u, {
        mode: 'streaks',
        count: 6000,
        mistFraction: 1,
        life: life * 1.3,
        cover: 0,
        mistCover: 0.06,
        dropSize: 0,
        mistSize: 0.9 * Math.sqrt(bore),
        shutter: 1 / 30,
        cloudy: true,
        mistBias: 2.0,
      });
      group.add(mist.object, spray.object, column.object);
      return new Group(group, [column, spray, mist]);
    }
    case 'E': {
      // Refined hybrid: a thin glassy core that keeps the bore width, aerated
      // drops riding along the column for body, spray after break-up, and a
      // mist halo that only appears once the water has broken up.
      const group = new THREE.Group();
      const column = new StrandTechnique(u, {
        strands: 4 * jets,
        segments: 112,
        life,
        cover: 0.45,
        width: 0.11 * bore,
        column: true,
        coreBias: 0.3,
        aerWiden: false,
      });
      const spray = new ParticleTechnique(u, {
        mode: 'streaks',
        count: 80000,
        mistFraction: 0,
        life,
        cover: 0.55,
        mistCover: 0,
        dropSize: 0.035,
        mistSize: 0,
        shutter: 1 / 30,
        cohCover: 0.25 + 0.5 * spec.aeration,
        sparkle: 3,
      });
      const mist = new ParticleTechnique(u, {
        mode: 'streaks',
        count: 7000,
        mistFraction: 1,
        life: life * 1.3,
        cover: 0,
        mistCover: 0.05,
        dropSize: 0,
        mistSize: 0.8 * Math.sqrt(bore),
        shutter: 1 / 30,
        cloudy: true,
        mistBias: 1.6,
        mistFadeIn: 1.2,
      });
      group.add(mist.object, spray.object, column.object);
      return new Group(group, [column, spray, mist]);
    }
  }
}
