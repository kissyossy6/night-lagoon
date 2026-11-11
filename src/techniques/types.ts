import type * as THREE from 'three';

export interface FrameInfo {
  time: number;
  pxPerMetre: number;
  viewport: THREE.Vector2;
  camera: THREE.PerspectiveCamera;
}

export interface Technique {
  object: THREE.Object3D;
  update(f: FrameInfo): void;
  dispose(): void;
}
