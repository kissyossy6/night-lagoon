import type { Vec3 } from './types';

/** Ways to lay fixtures out on the water, shared by every venue. */

export function line(n: number, x0: number, x1: number, z: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / Math.max(1, n - 1), 0, z]);
}

/**
 * A band of two staggered rows (WoC's 2.44 m lattice, offset by half a
 * pitch), indexed left to right so a band reads as one line in stagger
 * orders like 'center' and 'edges'.
 */
export function band(n: number, x0: number, x1: number, z: number, pitch: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / Math.max(1, n - 1), 0, z - (i % 2) * pitch * 0.5]);
}

export function arc(n: number, cx: number, cz: number, r: number, a0: number, a1: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / Math.max(1, n - 1);
    return [cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r];
  });
}
