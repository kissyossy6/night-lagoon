/**
 * How loud each sound of the show plays, in one place: the music, the water
 * (src/audio/splash.ts) and the fireworks (src/audio/pyro.ts). The player's
 * 音量 menu shows each as a percentage of MIX: 100% plays the sound at its
 * MIX gain. A viewer's own levels are kept in the browser; the video export
 * mixes with the same gains. The sum goes through a limiter (src/audio/limit.ts)
 * so it never clips.
 */
export type SoundLayer = 'music' | 'water' | 'pyro';

export const SOUND_LAYERS: { id: SoundLayer; label: string }[] = [
  { id: 'music', label: '音楽' },
  { id: 'water', label: '水音' },
  { id: 'pyro', label: '花火' },
];

/**
 * The gain each sound plays at when its slider shows 100%: the balance the
 * user chose by ear (2026-11-03: music 75%, water 50%, fireworks 150% of the
 * sounds as rendered).
 */
export const MIX: Record<SoundLayer, number> = { music: 0.75, water: 0.5, pyro: 1.5 };

/** The sliders a new viewer starts with (1 = 100% = MIX). */
export const DEFAULT_LEVELS: Record<SoundLayer, number> = { music: 1, water: 1, pyro: 1 };

/** The menu's sliders run 0..LEVEL_MAX (x MIX). */
export const LEVEL_MAX = 2;

/** The gain a slider position plays at. */
export const gainOf = (layer: SoundLayer, level: number) => MIX[layer] * level;

/** The loudest the summed sound may reach (the limiter's ceiling). */
export const OUTPUT_CEILING = 0.95;
