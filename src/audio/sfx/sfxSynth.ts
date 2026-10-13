/**
 * The sound effects maker's synth: game sounds from a few layers of simple sources (waves, noise,
 * FM, bells, crackle), each with its own pitch movement, filter and envelope, then drive, echo and
 * reverb over the whole. About sixty kinds of sound (retro, UI, combat, movement, rewards, magic
 * and sci-fi, jingles, ambience loops) each have a recipe that rolls new settings from a seed, so
 * the same seed always gives the same sound. A set (a game's UI sounds, say) shares a style seed,
 * so its sounds belong together. Sounds are levelled to a loudness for their kind, trimmed and
 * faded; loops render seamless. Rendering is plain maths into a Float32Array, with no Web Audio,
 * so Node can unit-test it and the files are the same everywhere.
 */
import { loopChunk } from '../wavCues';

export const SFX_WAVES = ['square', 'saw', 'triangle', 'sine', 'noise', 'pink', 'brown', 'fm', 'metal', 'crackle'] as const;
export type SfxWave = (typeof SFX_WAVES)[number];
export const SFX_WAVE_LABELS: Record<SfxWave, string> = {
  square: 'square',
  saw: 'saw',
  triangle: 'triangle',
  sine: 'sine',
  noise: '8-bit noise',
  pink: 'soft noise',
  brown: 'deep noise',
  fm: 'FM',
  metal: 'bell',
  crackle: 'crackle',
};
/** Sources with no pitch of their own (their Pitch does nothing, or sets a rate) */
export const UNPITCHED: ReadonlySet<SfxWave> = new Set(['noise', 'pink', 'brown', 'crackle']);

/** One layer: a source with its pitch movement, filter and envelope. */
export interface SfxLayer {
  wave: SfxWave;
  /** Starting pitch, Hz (8-bit noise: how fast it changes; crackle: pops a second) */
  freq: number;
  /** Pitch change over the sound, semitones (-48 to +48) */
  slide: number;
  /** 0: an even glide; 1: most of the glide at the start */
  curve: number;
  /** A jump in pitch partway through, semitones (0: none), as in a coin */
  arp: number;
  /** When the jump comes, 0 to 1 of the way through */
  arpAt: number;
  /** Notes in turn, semitones from the pitch (empty: none), each `seqStep` seconds: arpeggios, jingles */
  seq: number[];
  seqStep: number;
  /** Vibrato depth in semitones and speed in Hz */
  vibDepth: number;
  vibRate: number;
  /** Square wave width, 0.05 to 0.5 (0.5: a plain square) */
  duty: number;
  /** FM: the modulator's pitch as a ratio of the note's, and how much it bends the tone (0 to 10) */
  fmRatio: number;
  fmIndex: number;
  /** Envelope, seconds */
  attack: number;
  hold: number;
  decay: number;
  /** Extra level at the start, 0 to 1 */
  punch: number;
  /** Filter cutoff, Hz; how far it moves over the sound, octaves (-4 to +4); resonance 0 to 1 */
  lowpass: number;
  lpSweep: number;
  reso: number;
  /** The filter passes a band around the cutoff instead of everything below it */
  bandpass: boolean;
  /** The cutoff wobbling, octaves, at `vibRate`'s partner: `wobbleRate` Hz */
  wobble: number;
  wobbleRate: number;
  /** High-pass cutoff, Hz */
  highpass: number;
  /** Bit crush, 0 (clean) to 1 (2-bit) */
  crush: number;
  /** Restart the pitch this many times a second (0: never), as in a power-up warble */
  repeat: number;
  /** Tremolo depth 0 to 1, speed Hz */
  trem: number;
  tremRate: number;
  /** Level of this layer, 0 to 1, and when it starts, seconds */
  gain: number;
  delay: number;
  /** Off: kept, not heard */
  on: boolean;
  /** For noise, so the same sound renders the same */
  seed: number;
}

export const SFX_LEVELS = ['soft', 'normal', 'loud'] as const;
export type SfxLevel = (typeof SFX_LEVELS)[number];

/** A sound: its layers and what goes over the whole. */
export interface SfxSound {
  layers: SfxLayer[];
  /** Pitch of every layer, semitones */
  pitch: number;
  /** Soft clipping, 0 to 1 */
  drive: number;
  /** Echo mix 0 to 1, time seconds, feedback 0 to 0.9 */
  echo: number;
  echoTime: number;
  echoFeedback: number;
  /** Reverb mix 0 to 1 and room size 0 to 1 */
  reverb: number;
  room: number;
  /** How loud it's made: soft (UI), normal, loud (impacts, explosions) */
  level: SfxLevel;
  /** 0 to 1 on top of the level */
  volume: number;
  /** A seamless loop of `loopLength` seconds (an engine, the wind) instead of a one-shot */
  loop: boolean;
  loopLength: number;
  seed: number;
}

/** Earlier sound settings (one layer, no `layers`): what the maker made before layers. */
export type SfxParams = Omit<SfxLayer, 'seq' | 'seqStep' | 'fmRatio' | 'fmIndex' | 'reso' | 'bandpass' | 'wobble' | 'wobbleRate' | 'trem' | 'tremRate' | 'gain' | 'delay' | 'on'> & { volume: number };

export const SFX_GROUPS = [
  { name: 'Retro', kinds: ['jump', 'coin', 'laser', 'hit', 'powerUp', 'explosion', 'blip', 'retroSelect', 'retroDeath', 'retroBounce'] },
  { name: 'UI', kinds: ['uiClick', 'uiHover', 'uiConfirm', 'uiBack', 'uiError', 'uiOpen', 'uiClose', 'uiToggle', 'uiNotify', 'uiType', 'uiPurchase', 'uiSwipe'] },
  { name: 'Combat', kinds: ['swordSwing', 'slash', 'punch', 'impactHeavy', 'block', 'arrow', 'gunshot', 'reload', 'magicBolt', 'heal', 'hurt'] },
  { name: 'Movement', kinds: ['whoosh', 'dash', 'jumpSoft', 'land', 'footstep', 'splash', 'bounce'] },
  { name: 'Rewards', kinds: ['coinModern', 'gem', 'healthPickup', 'unlock', 'levelUp', 'achievement', 'collectAll'] },
  { name: 'Magic & Sci-fi', kinds: ['laserModern', 'teleport', 'chargeUp', 'spell', 'shieldUp', 'powerDown', 'robotBeep', 'scan'] },
  { name: 'Jingles', kinds: ['victory', 'gameOver', 'questComplete', 'secret', 'countdown'] },
  { name: 'Loops', kinds: ['engineHum', 'wind', 'fire', 'rain', 'alarm', 'forceField', 'spaceship', 'water'] },
] as const;

export type SfxCategory = (typeof SFX_GROUPS)[number]['kinds'][number];
export const SFX_CATEGORIES: readonly SfxCategory[] = SFX_GROUPS.flatMap((g) => g.kinds);

export const SFX_LABELS: Record<SfxCategory, string> = {
  jump: 'Jump',
  coin: 'Coin',
  laser: 'Laser',
  hit: 'Hit',
  powerUp: 'Power-up',
  explosion: 'Explosion',
  blip: 'Blip',
  retroSelect: 'Select',
  retroDeath: 'Lose a life',
  retroBounce: 'Boing',
  uiClick: 'Click',
  uiHover: 'Hover',
  uiConfirm: 'Confirm',
  uiBack: 'Back',
  uiError: 'Error',
  uiOpen: 'Open menu',
  uiClose: 'Close menu',
  uiToggle: 'Toggle',
  uiNotify: 'Notification',
  uiType: 'Text blip',
  uiPurchase: 'Purchase',
  uiSwipe: 'Swipe',
  swordSwing: 'Sword swing',
  slash: 'Sword hit',
  punch: 'Punch',
  impactHeavy: 'Heavy impact',
  block: 'Block',
  arrow: 'Arrow',
  gunshot: 'Gunshot',
  reload: 'Reload',
  magicBolt: 'Magic bolt',
  heal: 'Heal',
  hurt: 'Hurt',
  whoosh: 'Whoosh',
  dash: 'Dash',
  jumpSoft: 'Jump (soft)',
  land: 'Land',
  footstep: 'Footstep',
  splash: 'Splash',
  bounce: 'Bounce',
  coinModern: 'Coin (bright)',
  gem: 'Gem',
  healthPickup: 'Health pickup',
  unlock: 'Unlock',
  levelUp: 'Level up',
  achievement: 'Achievement',
  collectAll: 'All collected',
  laserModern: 'Blaster',
  teleport: 'Teleport',
  chargeUp: 'Charge up',
  spell: 'Spell',
  shieldUp: 'Shield up',
  powerDown: 'Power down',
  robotBeep: 'Robot',
  scan: 'Scanner',
  victory: 'Victory',
  gameOver: 'Game over',
  questComplete: 'Quest complete',
  secret: 'Secret found',
  countdown: 'Countdown',
  engineHum: 'Engine',
  wind: 'Wind',
  fire: 'Fire',
  rain: 'Rain',
  alarm: 'Alarm',
  forceField: 'Force field',
  spaceship: 'Spaceship hum',
  water: 'Stream',
};

/** The group a kind of sound is in. */
export const groupOf = (c: SfxCategory): string => SFX_GROUPS.find((g) => (g.kinds as readonly string[]).includes(c))!.name;

/** Matching sets of sounds, made in one go with one style. */
export const SFX_SETS = [
  { id: 'ui', name: 'Menus & UI', folder: 'ui', kinds: ['uiClick', 'uiHover', 'uiConfirm', 'uiBack', 'uiError', 'uiOpen', 'uiClose', 'uiToggle', 'uiNotify', 'uiType', 'uiPurchase', 'uiSwipe'] },
  { id: 'platformer', name: 'Retro platformer', folder: 'platformer', kinds: ['jump', 'coin', 'powerUp', 'hit', 'explosion', 'blip', 'retroSelect', 'retroDeath', 'retroBounce', 'laser'] },
  { id: 'rpg', name: 'Action RPG', folder: 'rpg', kinds: ['swordSwing', 'slash', 'block', 'hurt', 'impactHeavy', 'magicBolt', 'heal', 'footstep', 'gem', 'levelUp', 'questComplete', 'gameOver'] },
  { id: 'shooter', name: 'Sci-fi shooter', folder: 'scifi', kinds: ['laserModern', 'gunshot', 'reload', 'chargeUp', 'shieldUp', 'powerDown', 'teleport', 'robotBeep', 'scan', 'alarm', 'impactHeavy'] },
  { id: 'casual', name: 'Casual & puzzle', folder: 'casual', kinds: ['uiClick', 'uiConfirm', 'coinModern', 'gem', 'bounce', 'whoosh', 'collectAll', 'secret', 'countdown', 'victory', 'gameOver'] },
  { id: 'ambience', name: 'Ambience loops', folder: 'ambience', kinds: ['wind', 'rain', 'fire', 'water', 'spaceship', 'engineHum', 'forceField'] },
] as const satisfies ReadonlyArray<{ id: string; name: string; folder: string; kinds: readonly SfxCategory[] }>;
export type SfxSetId = (typeof SFX_SETS)[number]['id'];

/** A seeded random number generator (mulberry32): numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BASE_LAYER: SfxLayer = {
  wave: 'square',
  freq: 440,
  slide: 0,
  curve: 0.5,
  arp: 0,
  arpAt: 0.3,
  seq: [],
  seqStep: 0.08,
  vibDepth: 0,
  vibRate: 6,
  duty: 0.5,
  fmRatio: 2,
  fmIndex: 2,
  attack: 0,
  hold: 0.05,
  decay: 0.2,
  punch: 0,
  lowpass: 20000,
  lpSweep: 0,
  reso: 0,
  bandpass: false,
  wobble: 0,
  wobbleRate: 0.5,
  highpass: 20,
  crush: 0,
  repeat: 0,
  trem: 0,
  tremRate: 6,
  gain: 1,
  delay: 0,
  on: true,
  seed: 1,
};

const BASE_SOUND: Omit<SfxSound, 'layers'> = {
  pitch: 0,
  drive: 0,
  echo: 0,
  echoTime: 0.15,
  echoFeedback: 0.35,
  reverb: 0,
  room: 0.5,
  level: 'normal',
  volume: 1,
  loop: false,
  loopLength: 2,
  seed: 1,
};

export const MAX_LAYERS = 4;

/** A sound's shared character in a set: its tone, register and space. */
interface Style {
  /** The pitched source UI and reward sounds use */
  tone: 'sine' | 'triangle' | 'fm' | 'square';
  /** Register, as a pitch ratio (0.8 to 1.25) */
  reg: number;
  /** Reverb for the set */
  space: number;
  /** FM modulator ratio for the set's FM tones */
  ratio: number;
}

function styleOf(seed: number): Style {
  const r = rng(seed ^ 0x51ed27);
  return {
    tone: (['sine', 'triangle', 'fm', 'sine', 'fm', 'square'] as const)[Math.floor(r() * 6)],
    reg: 0.8 + r() * 0.45,
    space: r() * 0.25,
    ratio: [1, 2, 3, 3.5, 4][Math.floor(r() * 5)],
  };
}

/** A new sound of a kind, rolled from `seed`; in a set, `styleSeed` is the set's (the sound's own seed otherwise). */
export function generateSfx(category: SfxCategory, seed: number, styleSeed = seed): SfxSound {
  const r = rng(seed);
  const S = styleOf(styleSeed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  let n = 0;
  const L = (patch: Partial<SfxLayer>): SfxLayer => ({ ...BASE_LAYER, seed: (seed + 7919 * ++n) >>> 0, ...patch });
  const sound = (layers: SfxLayer[], patch: Partial<Omit<SfxSound, 'layers'>> = {}): SfxSound => ({ ...BASE_SOUND, seed, ...patch, layers });
  /** A short bright tick, the front of many sounds */
  const click = (gain: number, delay = 0, freq = between(2500, 6000)) => L({ wave: 'pink', bandpass: true, lowpass: freq, reso: 0.3, hold: 0, decay: between(0.006, 0.014), gain, delay });
  /** A noise swish through a sweeping band-pass */
  const swish = (from: number, octaves: number, attack: number, decay: number, gain = 1, delay = 0) =>
    L({ wave: 'pink', bandpass: true, lowpass: from, lpSweep: octaves, reso: between(0.35, 0.65), attack, hold: between(0.01, 0.05), decay, gain, delay });
  /** A low thump with a fast pitch drop */
  const thump = (freq: number, decay: number, gain = 1, delay = 0) => L({ wave: 'sine', freq, slide: -between(8, 14), curve: 0.9, hold: 0, decay, punch: 0.7, gain, delay });
  const bell = (freq: number, decay: number, gain = 1, delay = 0, extra: Partial<SfxLayer> = {}) => L({ wave: 'metal', freq, hold: 0, decay, gain, delay, ...extra });
  const tone = (patch: Partial<SfxLayer>) => L({ wave: S.tone, fmRatio: S.ratio, fmIndex: between(0.8, 2.5), duty: 0.35, ...patch });
  const major = [0, 4, 7, 12];

  switch (category) {
    // ---- Retro: the classic 8-bit generator's kinds ----
    case 'jump':
      return sound([L({ wave: pick(['square', 'square', 'sine', 'triangle'] as const), freq: between(260, 600), slide: between(5, 14), curve: between(0.3, 0.8), duty: between(0.25, 0.5), hold: between(0.02, 0.08), decay: between(0.12, 0.28), punch: between(0, 0.3) })]);
    case 'coin':
      return sound([L({ wave: pick(['square', 'square', 'saw', 'triangle'] as const), freq: between(800, 1500), arp: pick([5, 7, 12, 12]), arpAt: between(0.08, 0.25), duty: between(0.3, 0.5), hold: between(0.04, 0.12), decay: between(0.18, 0.45), punch: between(0.3, 0.7) })], { level: 'soft' });
    case 'laser':
      return sound([L({ wave: pick(['saw', 'square', 'square', 'sine'] as const), freq: between(700, 2200), slide: -between(18, 40), curve: between(0.5, 0.95), duty: between(0.1, 0.5), hold: between(0, 0.05), decay: between(0.1, 0.3), punch: between(0, 0.4), vibDepth: r() < 0.3 ? between(0.2, 1) : 0, vibRate: between(10, 30) })]);
    case 'hit':
      return sound([L({ wave: pick(['noise', 'noise', 'saw', 'square'] as const), freq: between(120, 500), slide: -between(6, 18), curve: between(0.4, 0.9), hold: between(0, 0.03), decay: between(0.08, 0.22), punch: between(0.3, 0.8), lowpass: between(2500, 9000), crush: r() < 0.4 ? between(0.2, 0.6) : 0 })], { level: 'loud' });
    case 'powerUp':
      return sound([L({ wave: pick(['square', 'triangle', 'saw', 'square'] as const), freq: between(180, 520), slide: between(10, 26), curve: between(0, 0.4), duty: between(0.3, 0.5), hold: between(0.15, 0.35), decay: between(0.2, 0.5), repeat: r() < 0.6 ? between(5, 12) : 0, vibDepth: r() < 0.4 ? between(0.2, 0.8) : 0, vibRate: between(8, 18) })]);
    case 'explosion':
      return sound([L({ wave: 'noise', freq: between(30, 110), slide: -between(6, 20), curve: between(0.3, 0.8), attack: between(0, 0.01), hold: between(0.05, 0.25), decay: between(0.5, 1.4), punch: between(0.4, 0.9), lowpass: between(2000, 9000), lpSweep: -between(1, 3), crush: r() < 0.3 ? between(0.1, 0.4) : 0 })], { level: 'loud' });
    case 'blip':
      return sound([L({ wave: pick(['square', 'square', 'sine', 'triangle'] as const), freq: between(500, 1600), duty: between(0.25, 0.5), hold: between(0.01, 0.05), decay: between(0.04, 0.1), arp: r() < 0.3 ? pick([7, 12]) : 0, arpAt: between(0.3, 0.6) })], { level: 'soft' });
    case 'retroSelect':
      return sound([L({ wave: 'square', duty: pick([0.125, 0.25, 0.5]), freq: between(600, 1100), seq: [0, pick([7, 12])], seqStep: between(0.03, 0.05), hold: 0.06, decay: 0.05 })], { level: 'soft' });
    case 'retroDeath':
      return sound([L({ wave: pick(['square', 'triangle'] as const), duty: 0.5, freq: between(500, 800), seq: [0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12].filter((_, i) => i % 2 === 0 || r() < 0.5), seqStep: between(0.06, 0.09), hold: 0.5, decay: 0.3, vibDepth: 0.3, vibRate: 9 })]);
    case 'retroBounce':
      return sound([L({ wave: pick(['square', 'triangle'] as const), freq: between(150, 260), slide: between(14, 24), curve: 0.2, vibDepth: between(0.8, 2), vibRate: between(14, 22), hold: 0.05, decay: between(0.2, 0.35) })]);

    // ---- UI ----
    case 'uiClick':
      return sound([L({ wave: 'sine', freq: between(1800, 3200) * S.reg, slide: -between(6, 14), curve: 0.85, hold: 0, decay: between(0.012, 0.03), punch: 0.5 }), click(between(0.25, 0.5))], { level: 'soft', reverb: S.space * 0.4, room: 0.2 });
    case 'uiHover':
      return sound([tone({ freq: between(900, 1500) * S.reg, attack: 0.003, hold: 0.004, decay: between(0.03, 0.06), fmIndex: between(0.3, 1) })], { level: 'soft', volume: 0.7, reverb: S.space * 0.4, room: 0.2 });
    case 'uiConfirm':
      return sound([tone({ freq: between(600, 900) * S.reg, seq: [0, pick([4, 5, 7, 12])], seqStep: between(0.05, 0.08), hold: 0.09, decay: between(0.12, 0.2) }), click(0.3)], { reverb: S.space, room: 0.3 });
    case 'uiBack':
      return sound([tone({ freq: between(600, 850) * S.reg, seq: [0, -pick([3, 5, 7])], seqStep: between(0.05, 0.07), hold: 0.07, decay: between(0.1, 0.16), lowpass: 4000 }), click(0.25)], { level: 'soft', reverb: S.space, room: 0.3 });
    case 'uiError': {
      const f = between(140, 220);
      const buzz = (delay: number) => L({ wave: pick(['square', 'saw'] as const), freq: f, duty: 0.4, lowpass: between(1200, 2000), reso: 0.3, hold: 0.07, decay: 0.03, delay });
      return sound([buzz(0), buzz(between(0.11, 0.14))], { reverb: S.space * 0.5, room: 0.3 });
    }
    case 'uiOpen':
      return sound([swish(between(600, 900), between(2, 3), 0.03, between(0.1, 0.14)), tone({ freq: between(600, 800) * S.reg, slide: between(4, 7), hold: 0.02, decay: 0.08, gain: 0.5, delay: 0.05 })], { level: 'soft', reverb: S.space, room: 0.3 });
    case 'uiClose':
      return sound([swish(between(3000, 4500), -between(2, 3), 0.01, between(0.1, 0.14)), tone({ freq: between(700, 900) * S.reg, slide: -between(4, 7), hold: 0.02, decay: 0.08, gain: 0.5, delay: 0.02 })], { level: 'soft', reverb: S.space, room: 0.3 });
    case 'uiToggle': {
      const f = between(1000, 1800) * S.reg;
      return sound([L({ wave: 'sine', freq: f, hold: 0, decay: 0.02, punch: 0.6 }), L({ wave: 'sine', freq: f * pick([0.75, 1.5]), hold: 0, decay: 0.03, delay: between(0.03, 0.05), gain: 0.8 }), click(0.3)], { level: 'soft' });
    }
    case 'uiNotify': {
      const f = between(700, 1300) * S.reg;
      return sound([bell(f, between(0.5, 0.9)), bell(f * 2 ** (pick([5, 7, 12]) / 12), between(0.6, 1.0), 0.8, between(0.08, 0.12))], { reverb: Math.max(0.15, S.space), room: 0.4 });
    }
    case 'uiType':
      return sound([L({ wave: pick(['square', 'sine', 'triangle'] as const), duty: 0.25, freq: between(400, 900) * S.reg, hold: 0, decay: between(0.02, 0.035), crush: r() < 0.4 ? 0.4 : 0 })], { level: 'soft', volume: 0.8 });
    case 'uiPurchase': {
      const f = between(1500, 2100);
      return sound([bell(f, 0.35), bell(f * 2 ** (7 / 12), 0.6, 0.9, 0.07), L({ wave: 'crackle', freq: between(250, 400), highpass: 4000, hold: 0.1, decay: 0.2, gain: 0.3 })], { reverb: Math.max(0.12, S.space), room: 0.3 });
    }
    case 'uiSwipe':
      return sound([swish(between(1500, 2500), between(1, 1.6), 0.02, between(0.08, 0.12))], { level: 'soft', reverb: S.space * 0.5, room: 0.2 });

    // ---- Combat ----
    case 'swordSwing':
      return sound([swish(between(500, 900), between(1.5, 2.5), between(0.03, 0.06), between(0.12, 0.2)), bell(between(2500, 4000), between(0.25, 0.4), 0.2, 0.05, { highpass: 2000 })]);
    case 'slash':
      return sound([swish(between(1000, 1600), between(1, 1.8), 0.01, 0.07), bell(between(1500, 2200), between(0.2, 0.35), 0.5, 0.06), L({ wave: 'pink', lowpass: 4000, hold: 0, decay: 0.08, punch: 0.8, gain: 0.8, delay: 0.06 }), thump(between(110, 160), 0.1, 0.6, 0.06)], { level: 'loud', drive: 0.2 });
    case 'punch':
      return sound([thump(between(110, 160), between(0.1, 0.15)), L({ wave: 'brown', lowpass: between(1500, 2500), hold: 0, decay: between(0.05, 0.08), punch: 0.8, gain: 0.7 }), click(0.4)], { level: 'loud', drive: between(0.2, 0.4) });
    case 'impactHeavy':
      return sound([thump(between(50, 75), between(0.4, 0.6)), L({ wave: 'brown', lowpass: between(700, 1100), lpSweep: -1.5, hold: 0.02, decay: between(0.3, 0.5), punch: 0.6, gain: 0.9 }), click(0.4, 0, 2500)], { level: 'loud', drive: between(0.3, 0.5), reverb: 0.15, room: 0.5 });
    case 'block':
      return sound([bell(between(600, 1100), between(0.4, 0.7)), click(0.6, 0, 3000), thump(between(180, 240), 0.08, 0.4)], { level: 'loud', reverb: 0.1, room: 0.3 });
    case 'arrow':
      return sound([swish(between(2500, 3500), -1, 0.01, 0.12, 0.8), thump(between(150, 210), 0.08, 0.8, between(0.18, 0.25)), L({ wave: 'brown', lowpass: 1200, hold: 0, decay: 0.05, gain: 0.5, delay: between(0.18, 0.25) })]);
    case 'gunshot':
      return sound([L({ wave: 'pink', lowpass: between(5000, 8000), lpSweep: -2, hold: 0, decay: between(0.2, 0.3), punch: 1 }), thump(between(70, 100), 0.15), click(0.6)], { level: 'loud', drive: between(0.4, 0.6), reverb: between(0.15, 0.3), room: between(0.6, 0.85) });
    case 'reload': {
      const metal = (delay: number, f: number) => [L({ wave: 'metal', freq: f, hold: 0, decay: 0.06, highpass: 1500, gain: 0.7, delay }), click(0.6, delay, between(2000, 4000))];
      return sound([...metal(0, between(1800, 2600)), ...metal(between(0.18, 0.28), between(1300, 1900))], { reverb: 0.05, room: 0.2 });
    }
    case 'magicBolt':
      return sound([L({ wave: 'fm', freq: between(800, 1200), fmRatio: between(2.5, 4), fmIndex: between(2, 4), slide: -between(10, 20), curve: 0.6, hold: 0.05, decay: between(0.25, 0.4), vibDepth: 0.3, vibRate: 20 }), swish(between(1500, 2500), -1.5, 0.01, 0.3, 0.4)], { reverb: 0.25, room: 0.5 });
    case 'heal':
      return sound([L({ wave: pick(['sine', 'triangle'] as const), freq: between(500, 700), seq: [0, 4, 7, 12, 16], seqStep: between(0.05, 0.07), hold: 0.3, decay: 0.4 }), bell(between(2000, 3000), 0.6, 0.3, 0.1, { seq: [0, 7, 12], seqStep: 0.08 })], { level: 'soft', reverb: 0.35, room: 0.6 });
    case 'hurt':
      return sound([L({ wave: pick(['saw', 'square'] as const), freq: between(250, 400), slide: -between(5, 10), vibDepth: between(0.5, 1.2), vibRate: between(25, 40), lowpass: between(1800, 3000), hold: 0.04, decay: between(0.15, 0.25) }), thump(between(120, 160), 0.08, 0.6)], { drive: 0.2 });

    // ---- Movement ----
    case 'whoosh':
      return sound([swish(between(250, 500), between(1.5, 2.5), between(0.08, 0.14), between(0.18, 0.3)), L({ wave: 'brown', lowpass: 400, attack: 0.08, hold: 0.02, decay: 0.2, gain: 0.4 })]);
    case 'dash':
      return sound([swish(between(800, 1200), between(1, 2), 0.02, between(0.1, 0.15)), L({ wave: 'sine', freq: between(200, 300), slide: -12, curve: 0.7, hold: 0, decay: 0.12, gain: 0.35 })]);
    case 'jumpSoft':
      return sound([L({ wave: pick(['sine', 'triangle'] as const), freq: between(220, 340), slide: between(5, 9), curve: 0.6, hold: 0.03, decay: between(0.1, 0.15) }), swish(between(800, 1200), 1, 0.01, 0.08, 0.35)], { level: 'soft' });
    case 'land':
      return sound([L({ wave: 'brown', lowpass: between(500, 800), hold: 0, decay: between(0.1, 0.14), punch: 0.6 }), thump(between(80, 110), 0.1, 0.7)], { level: 'normal' });
    case 'footstep': {
      const surface = pick(['stone', 'grass', 'wood'] as const);
      const layers =
        surface === 'stone'
          ? [click(0.7, 0, between(1500, 3000)), L({ wave: 'brown', lowpass: between(800, 1200), hold: 0, decay: between(0.05, 0.08), gain: 0.8 })]
          : surface === 'grass'
            ? [L({ wave: 'crackle', freq: between(1500, 3000), highpass: 2000, attack: 0.005, hold: 0.01, decay: between(0.07, 0.11) }), L({ wave: 'brown', lowpass: 500, hold: 0, decay: 0.06, gain: 0.6 })]
            : [thump(between(140, 200), 0.06), L({ wave: 'pink', bandpass: true, lowpass: between(600, 900), reso: 0.5, hold: 0, decay: 0.05, gain: 0.6 })];
      return sound(layers, { level: 'soft', reverb: 0.05, room: 0.3 });
    }
    case 'splash':
      return sound([L({ wave: 'pink', lowpass: between(2500, 4000), lpSweep: -1, attack: 0.01, hold: 0.03, decay: between(0.4, 0.6) }), L({ wave: 'crackle', freq: between(1000, 2000), bandpass: true, lowpass: 3000, attack: 0.01, decay: 0.5, gain: 0.6 }), L({ wave: 'sine', freq: between(250, 400), slide: -12, curve: 0.8, hold: 0, decay: 0.1, gain: 0.35 })]);
    case 'bounce':
      return sound([L({ wave: 'sine', freq: between(180, 280) * S.reg, slide: between(7, 12), curve: 0.4, vibDepth: between(0.5, 1), vibRate: between(10, 16), hold: 0.04, decay: between(0.15, 0.25) }), thump(between(90, 120), 0.06, 0.5)]);

    // ---- Rewards ----
    case 'coinModern': {
      const f = between(1500, 2100) * S.reg;
      return sound([bell(f, 0.25), bell(f * 2 ** (pick([5, 7]) / 12), 0.5, 1, between(0.05, 0.07))], { level: 'soft', reverb: Math.max(0.1, S.space), room: 0.3 });
    }
    case 'gem': {
      const f = between(1800, 2600) * S.reg;
      return sound([bell(f, between(0.6, 0.9)), bell(f * 2 ** (pick([7, 12]) / 12), between(0.6, 1), 0.8, between(0.05, 0.08)), L({ wave: 'crackle', freq: between(150, 300), highpass: 6000, hold: 0.1, decay: 0.4, gain: 0.25 })], { reverb: 0.3, room: 0.5 });
    }
    case 'healthPickup':
      return sound([tone({ freq: between(500, 700) * S.reg, seq: [0, 7, 12], seqStep: between(0.045, 0.06), hold: 0.12, decay: 0.2 }), bell(between(2500, 3500), 0.4, 0.25, 0.1)], { reverb: Math.max(0.15, S.space), room: 0.4 });
    case 'unlock':
      return sound([click(0.8, 0, 2500), click(0.7, between(0.07, 0.1), 1800), thump(between(250, 350), 0.04, 0.4, 0.08), bell(between(1200, 1800), 0.5, 0.7, between(0.15, 0.2))], { reverb: 0.15, room: 0.4 });
    case 'levelUp':
      return sound([L({ wave: pick(['square', 'triangle'] as const), duty: 0.35, freq: between(400, 600), seq: pick([major, [0, 4, 7, 12, 16], [0, 5, 7, 12]]), seqStep: between(0.06, 0.08), hold: 0.35, decay: 0.35 }), L({ wave: 'triangle', freq: between(400, 600) * 2, seq: major, seqStep: 0.07, hold: 0.35, decay: 0.35, gain: 0.3 })], { reverb: 0.2, room: 0.5 });
    case 'achievement': {
      const f = between(330, 440);
      const run = [0, 4, 7, 12, 7, 12];
      return sound([L({ wave: 'saw', freq: f, seq: run, seqStep: between(0.09, 0.11), lowpass: 2800, reso: 0.2, hold: 0.55, decay: 0.5, vibDepth: 0.15, vibRate: 5.5 }), L({ wave: 'square', duty: 0.3, freq: f / 2, seq: run, seqStep: 0.1, lowpass: 1500, hold: 0.55, decay: 0.5, gain: 0.45 }), bell(f * 4, 0.8, 0.25, 0.5)], { reverb: 0.3, room: 0.6 });
    }
    case 'collectAll':
      return sound([tone({ freq: between(500, 700) * S.reg, seq: [0, 2, 4, 7, 9, 12, 16, 19, 24], seqStep: between(0.035, 0.05), hold: 0.4, decay: 0.4 }), bell(between(2500, 3200), 0.9, 0.3, 0.35)], { reverb: 0.3, room: 0.5 });

    // ---- Magic & sci-fi ----
    case 'laserModern':
      return sound([L({ wave: 'fm', freq: between(1200, 2200), fmRatio: pick([0.5, 1.5, 2]), fmIndex: between(3, 6), slide: -between(18, 30), curve: 0.9, hold: 0.01, decay: between(0.15, 0.25), punch: 0.4 }), click(0.3)], { echo: between(0.2, 0.35), echoTime: between(0.07, 0.11), echoFeedback: 0.3, reverb: 0.1, room: 0.4 });
    case 'teleport':
      return sound([L({ wave: pick(['square', 'saw'] as const), duty: 0.3, freq: between(200, 350), slide: between(20, 30), curve: 0, repeat: between(8, 14), hold: between(0.3, 0.45), decay: 0.15, lowpass: 3500 }), swish(between(400, 700), 3, 0.15, 0.3, 0.5)], { reverb: 0.3, room: 0.6 });
    case 'chargeUp':
      return sound([L({ wave: 'saw', freq: between(90, 160), slide: between(20, 28), curve: 0, attack: 0.05, hold: between(0.9, 1.4), decay: 0.08, lowpass: between(600, 900), lpSweep: 3, reso: 0.45, vibDepth: 0.2, vibRate: 8 }), L({ wave: 'sine', freq: between(180, 320), slide: between(20, 28), curve: 0, attack: 0.05, hold: between(0.9, 1.4), decay: 0.08, trem: 0.5, tremRate: 14, gain: 0.4 })]);
    case 'spell': {
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const steps = Array.from({ length: 6 + Math.floor(r() * 4) }, () => pick(scale));
      return sound([bell(between(900, 1400), 0.6, 1, 0, { seq: steps, seqStep: between(0.035, 0.05), hold: steps.length * 0.04 }), L({ wave: 'crackle', freq: between(200, 400), highpass: 5000, hold: 0.25, decay: 0.4, gain: 0.3 }), swish(between(1000, 1500), 1.5, 0.05, 0.3, 0.3)], { reverb: 0.4, room: 0.7 });
    }
    case 'shieldUp':
      return sound([L({ wave: 'fm', freq: between(150, 250), fmRatio: 1.5, fmIndex: between(3, 5), slide: between(10, 14), curve: 0.5, hold: 0.3, decay: 0.3, trem: 0.4, tremRate: between(16, 24) })], { reverb: 0.25, room: 0.5 });
    case 'powerDown':
      return sound([L({ wave: 'saw', freq: between(500, 800), slide: -between(20, 30), curve: 0.3, hold: 0.3, decay: 0.4, lowpass: 3000, lpSweep: -3, vibDepth: 0.4, vibRate: 7 })], { reverb: 0.15, room: 0.4 });
    case 'robotBeep': {
      const notes = Array.from({ length: 3 + Math.floor(r() * 3) }, () => pick([0, 3, 5, 7, 10, 12, 15]));
      return sound([L({ wave: 'square', duty: pick([0.25, 0.5]), freq: between(500, 1000), seq: notes, seqStep: between(0.05, 0.08), hold: notes.length * 0.065, decay: 0.03, crush: between(0.2, 0.4), lowpass: 5000 })], { level: 'soft' });
    }
    case 'scan':
      return sound([L({ wave: 'sine', freq: between(1000, 1600), slide: between(6, 12), curve: 0, repeat: between(2, 4), hold: between(0.6, 0.9), decay: 0.1, trem: 0.3, tremRate: 30 })], { level: 'soft', echo: 0.3, echoTime: 0.12, echoFeedback: 0.4 });

    // ---- Jingles: short tunes (Tune to key puts them in the song's key) ----
    case 'victory': {
      const f = between(330, 470);
      const run = pick([
        [0, 4, 7, 12, 12],
        [0, 0, 0, 4, 7, 12],
        [0, 4, 7, 9, 12],
      ]);
      return sound([L({ wave: 'square', duty: 0.3, freq: f, seq: run, seqStep: between(0.1, 0.13), hold: run.length * 0.11 + 0.3, decay: 0.4, lowpass: 4000, vibDepth: 0.12, vibRate: 6 }), L({ wave: 'triangle', freq: f / 2, seq: run.map((s) => (s >= 7 ? 7 : 0)), seqStep: 0.12, hold: run.length * 0.11 + 0.3, decay: 0.4, gain: 0.6 })], { reverb: 0.2, room: 0.5 });
    }
    case 'gameOver': {
      const f = between(300, 440);
      return sound([L({ wave: pick(['square', 'triangle'] as const), duty: 0.4, freq: f, seq: [0, -1, -2, -3, -4], seqStep: between(0.28, 0.34), hold: 1.4, decay: 0.6, vibDepth: 0.25, vibRate: 5, lowpass: 3000 }), L({ wave: 'triangle', freq: f / 2, seq: [0, -1, -2, -3, -4], seqStep: 0.31, hold: 1.4, decay: 0.6, gain: 0.5 })], { reverb: 0.25, room: 0.6 });
    }
    case 'questComplete': {
      const f = between(400, 550);
      return sound([bell(f * 2, 1.2, 0.6, 0, { seq: [0, 7, 12, 16], seqStep: 0.12 }), L({ wave: 'triangle', freq: f, seq: [0, 4, 7, 12], seqStep: 0.12, hold: 0.6, decay: 0.6 })], { reverb: 0.35, room: 0.6 });
    }
    case 'secret': {
      const f = between(500, 700);
      return sound([L({ wave: pick(['square', 'triangle'] as const), duty: 0.25, freq: f, seq: [0, 6, 11, 15, 12, 8, 13, 17], seqStep: between(0.07, 0.09), hold: 0.75, decay: 0.3, lowpass: 5000 })], { reverb: 0.25, room: 0.5 });
    }
    case 'countdown': {
      const f = between(600, 900);
      const beep = (delay: number, up: number) => L({ wave: 'sine', freq: f * 2 ** (up / 12), hold: 0.12, decay: 0.08, delay });
      return sound([beep(0, 0), beep(0.5, 0), beep(1, 0), L({ wave: 'sine', freq: f * 2, hold: 0.4, decay: 0.3, delay: 1.5 })], { level: 'normal', reverb: 0.1, room: 0.3 });
    }

    // ---- Loops: seamless, for engines and places ----
    case 'engineHum': {
      const f = between(40, 65);
      return sound([L({ wave: 'saw', freq: f, lowpass: between(300, 500), reso: 0.3, trem: between(0.15, 0.3), tremRate: f / 4 }), L({ wave: 'square', freq: f * 2, lowpass: 600, gain: 0.3 }), L({ wave: 'brown', lowpass: 300, gain: 0.4 })], { loop: true, loopLength: 2 });
    }
    case 'wind':
      return sound([L({ wave: 'pink', bandpass: true, lowpass: between(400, 700), reso: between(0.4, 0.6), wobble: between(0.8, 1.4), wobbleRate: 0.5 }), L({ wave: 'brown', lowpass: 350, gain: 0.5, trem: 0.3, tremRate: 0.25 })], { level: 'soft', loop: true, loopLength: 4 });
    case 'fire':
      return sound([L({ wave: 'crackle', freq: between(25, 50), highpass: 1500 }), L({ wave: 'brown', lowpass: between(300, 450), gain: 0.6, trem: 0.25, tremRate: 1 }), L({ wave: 'pink', bandpass: true, lowpass: 900, reso: 0.2, gain: 0.25, wobble: 0.5, wobbleRate: 0.5 })], { level: 'soft', loop: true, loopLength: 4 });
    case 'rain':
      return sound([L({ wave: 'crackle', freq: between(1500, 2500), bandpass: true, lowpass: between(3500, 5000), gain: 0.6 }), L({ wave: 'pink', lowpass: between(5000, 7000), gain: 0.7 }), L({ wave: 'brown', lowpass: 300, gain: 0.3 })], { level: 'soft', loop: true, loopLength: 4 });
    case 'alarm':
      return sound([L({ wave: pick(['square', 'saw'] as const), duty: 0.4, freq: between(600, 900), seq: [0, pick([3, 5, 7])], seqStep: 0.25, lowpass: 3000 })], { loop: true, loopLength: 1, reverb: 0.15, room: 0.4 });
    case 'forceField': {
      const f = between(90, 130);
      return sound([L({ wave: 'saw', freq: f, lowpass: between(800, 1400), reso: 0.4, wobble: 0.6, wobbleRate: 4, trem: 0.25, tremRate: 8 }), L({ wave: 'saw', freq: f * 1.01, lowpass: 1000, gain: 0.7 }), L({ wave: 'sine', freq: f / 2, gain: 0.5 })], { level: 'soft', loop: true, loopLength: 2 });
    }
    case 'spaceship': {
      const f = between(45, 65);
      return sound([L({ wave: 'brown', lowpass: between(250, 400), gain: 1 }), L({ wave: 'sine', freq: f, gain: 0.5 }), L({ wave: 'sine', freq: f * 2, gain: 0.25, trem: 0.3, tremRate: 0.5 }), L({ wave: 'pink', bandpass: true, lowpass: 2000, reso: 0.6, gain: 0.08, wobble: 1, wobbleRate: 0.25 })], { level: 'soft', loop: true, loopLength: 4 });
    }
    case 'water':
      return sound([L({ wave: 'crackle', freq: between(150, 300), bandpass: true, lowpass: between(1500, 2500), reso: 0.6, gain: 0.8 }), L({ wave: 'pink', bandpass: true, lowpass: between(1200, 1800), reso: 0.3, gain: 0.6, wobble: 0.4, wobbleRate: 0.75 })], { level: 'soft', loop: true, loopLength: 4 });
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Small random changes to every layer, for "like this, but different". */
export function mutateSfx(s: SfxSound, seed: number): SfxSound {
  const r = rng(seed);
  const wiggle = (v: number, amount: number) => v * (1 + (r() * 2 - 1) * amount);
  return {
    ...s,
    seed,
    layers: s.layers.map((l, i) => ({
      ...l,
      seed: (seed + 101 * (i + 1)) >>> 0,
      freq: clamp(wiggle(l.freq, 0.12), 20, 8000),
      slide: clamp(l.slide + (r() * 2 - 1) * 3, -48, 48),
      duty: clamp(l.duty + (r() * 2 - 1) * 0.08, 0.05, 0.5),
      hold: clamp(wiggle(l.hold, 0.2), 0, 3),
      decay: clamp(wiggle(l.decay, 0.2), 0.005, 3),
      punch: clamp(l.punch + (r() * 2 - 1) * 0.1, 0, 1),
      lowpass: clamp(wiggle(l.lowpass, 0.15), 100, 20000),
      fmIndex: clamp(wiggle(l.fmIndex, 0.2), 0, 10),
    })),
  };
}

/**
 * Variation `i` of a sound, for a game to pick from so a sound heard often doesn't repeat itself:
 * the pitch moved by up to `spread` semitones each way, timings by a few percent, new noise.
 * Variation 0 is the sound itself.
 */
export function varySfx(s: SfxSound, i: number, spread = 1): SfxSound {
  if (i === 0) return s;
  const r = rng((s.seed * 31 + i * 7477) >>> 0);
  const t = () => 1 + (r() * 2 - 1) * 0.06 * Math.min(1, spread);
  return {
    ...s,
    seed: (s.seed + i * 977) >>> 0,
    pitch: s.pitch + (r() * 2 - 1) * spread,
    layers: s.layers.map((l, k) => ({ ...l, seed: (l.seed + i * 131 + k) >>> 0, hold: l.hold * t(), decay: l.decay * t(), gain: clamp(l.gain * (1 + (r() * 2 - 1) * 0.08 * Math.min(1, spread)), 0, 1) })),
  };
}

/** A sound made before layers (one set of settings), as a sound. */
export function fromParams(p: SfxParams): SfxSound {
  const { volume, ...layer } = p;
  return { ...BASE_SOUND, seed: p.seed, volume, layers: [{ ...BASE_LAYER, ...layer }] };
}

/** Move a frequency to the nearest note of a scale (`root` 0 = C; `steps` semitones above it). */
export function snapToScale(freq: number, root: number, steps: readonly number[]): number {
  const midi = 69 + 12 * Math.log2(freq / 440);
  let best = Math.round(midi);
  let bestGap = Infinity;
  for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) {
    if (!steps.includes((((m - root) % 12) + 12) % 12)) continue;
    const gap = Math.abs(m - midi);
    if (gap < bestGap) {
      bestGap = gap;
      best = m;
    }
  }
  return 440 * Math.pow(2, (best - 69) / 12);
}

/** The sound with every pitched layer's notes (pitch, jump, tune) on notes of a key. */
export function tuneSfx(s: SfxSound, root: number, steps: readonly number[]): SfxSound {
  const shift = 2 ** (s.pitch / 12);
  const toKey = (f: number, semis: number) => snapToScale(f * 2 ** (semis / 12), root, steps);
  const semisBetween = (a: number, b: number) => Math.round(12 * Math.log2(b / a));
  return {
    ...s,
    layers: s.layers.map((l) => {
      if (UNPITCHED.has(l.wave)) return l;
      // The heard pitch includes the sound's Pitch: snap that, then take the Pitch back out
      const freq = snapToScale(l.freq * shift, root, steps) / shift;
      const heard = freq * shift;
      return {
        ...l,
        freq,
        arp: l.arp ? semisBetween(heard, toKey(heard, l.arp)) : 0,
        seq: l.seq.map((n) => semisBetween(heard, toKey(heard, n))),
      };
    }),
  };
}

/** When a layer ends, seconds from the start. */
const layerEnd = (l: SfxLayer) => l.delay + l.attack + l.hold + l.decay;

/** How long the dry sound lasts, seconds (a loop: its length). */
export function dryLength(s: SfxSound): number {
  if (s.loop) return s.loopLength;
  return Math.max(0.005, ...s.layers.filter((l) => l.on).map(layerEnd));
}

/** How much the echo and reverb add after the dry sound, seconds. */
function tailOf(s: SfxSound): number {
  if (s.loop) return 0;
  const echo = s.echo > 0 ? Math.min(3, s.echoTime * Math.ceil(Math.log(0.01) / Math.log(Math.max(0.05, s.echoFeedback)))) : 0;
  const reverb = s.reverb > 0 ? 0.3 + s.room * 3 : 0;
  return Math.max(echo, reverb);
}

/** At most how long a sound is, seconds (before silence at the end is trimmed). */
export const sfxLength = (s: SfxSound) => dryLength(s) + tailOf(s);

/** A resonant state-variable filter (TPT), low-pass or band-pass. */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1.4;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  set(cutoff: number, reso: number, sampleRate: number) {
    this.g = Math.tan((Math.PI * clamp(cutoff, 20, sampleRate * 0.45)) / sampleRate);
    this.k = 2 - 1.9 * clamp(reso, 0, 1);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  run(v: number, band: boolean): number {
    const v3 = v - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return band ? v1 * this.k : v2;
  }
}

const METAL_RATIOS = [1, 2.76, 5.4, 8.93, 13.34];
const METAL_LEVELS = [1, 0.6, 0.4, 0.25, 0.15];

/** One layer, dry, `length` samples long. In a loop the envelope is flat and the notes go round. */
function renderLayer(l: SfxLayer, s: SfxSound, length: number, sampleRate: number): Float32Array {
  const out = new Float32Array(length);
  const noise = rng(l.seed ^ 0x9e3779b9);
  const start = Math.round(l.delay * sampleRate);
  const total = s.loop ? s.loopLength : l.attack + l.hold + l.decay;
  const shift = 2 ** (s.pitch / 12);
  const svf = new Svf();
  const filtered = l.lowpass < 19999 || l.lpSweep !== 0 || l.bandpass || l.wobble > 0;
  let phase = 0;
  let modPhase = 0;
  const partials = new Float64Array(METAL_RATIOS.length);
  let noiseValue = 0;
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    brown = 0,
    pop = 0;
  let hpIn = 0,
    hpOut = 0;
  const repeatEvery = l.repeat > 0 ? 1 / l.repeat : Infinity;
  const steps = l.seq.length;
  for (let i = start; i < length; i++) {
    const t = (i - start) / sampleRate;
    if (!s.loop && t > total) break;
    const x = Math.min(1, t / Math.max(1e-6, total));
    // Pitch: the slide (restarted by Repeat), the jump, the notes in turn and vibrato, in semitones
    const tr = l.repeat > 0 ? t % repeatEvery : t;
    const span = l.repeat > 0 ? repeatEvery : total;
    const xr = Math.min(1, tr / Math.max(1e-6, span));
    let semis = l.slide * (l.curve > 0 ? 1 - Math.pow(1 - xr, 1 + l.curve * 4) : xr);
    if (l.arp && t >= l.arpAt * total) semis += l.arp;
    if (steps) {
      const at = Math.floor(t / Math.max(0.005, l.seqStep));
      semis += l.seq[s.loop ? at % steps : Math.min(steps - 1, at)];
    }
    if (l.vibDepth) semis += l.vibDepth * Math.sin(2 * Math.PI * l.vibRate * t);
    const f = clamp(l.freq * shift * Math.pow(2, semis / 12), 5, sampleRate / 2.2);

    const prev = phase;
    phase = (phase + f / sampleRate) % 1;
    let v: number;
    switch (l.wave) {
      case 'square':
        v = phase < l.duty ? 1 : -1;
        break;
      case 'saw':
        v = 2 * phase - 1;
        break;
      case 'triangle':
        v = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
        break;
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      case 'fm': {
        modPhase = (modPhase + (f * l.fmRatio) / sampleRate) % 1;
        const index = l.fmIndex * (s.loop ? 1 : 1 - 0.7 * x);
        v = Math.sin(2 * Math.PI * phase + index * Math.sin(2 * Math.PI * modPhase));
        break;
      }
      case 'metal': {
        v = 0;
        for (let k = 0; k < partials.length; k++) {
          const fk = f * METAL_RATIOS[k];
          if (fk >= sampleRate / 2.2) continue;
          partials[k] = (partials[k] + fk / sampleRate) % 1;
          // Higher partials die away faster, as on a struck bar
          const fade = s.loop ? 1 : Math.exp(-t * (2 + k * 6));
          v += METAL_LEVELS[k] * fade * Math.sin(2 * Math.PI * partials[k]);
        }
        v *= 0.6;
        break;
      }
      case 'pink': {
        // Paul Kellet's economy pink noise
        const w = noise() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        v = (b0 + b1 + b2 + w * 0.1848) * 0.25;
        break;
      }
      case 'brown':
        brown = (brown + 0.02 * (noise() * 2 - 1)) / 1.02;
        v = brown * 3.5;
        break;
      case 'crackle':
        // Pops: about `f` a second, each a short decaying spike
        if (noise() < f / sampleRate) pop = (noise() * 2 - 1) * (0.4 + 0.6 * noise());
        v = pop;
        pop *= 0.92;
        break;
      default:
        // 8-bit noise: a new random level 32 times a cycle, so its pitch still means something
        if (Math.floor(phase * 32) !== Math.floor(prev * 32) || phase < prev) noiseValue = noise() * 2 - 1;
        v = noiseValue;
    }

    if (filtered) {
      if ((i - start) % 8 === 0) {
        const sweep = l.lpSweep * (s.loop ? 0 : x) + (l.wobble ? l.wobble * Math.sin(2 * Math.PI * l.wobbleRate * t) : 0);
        svf.set(l.lowpass * Math.pow(2, sweep), l.reso, sampleRate);
      }
      v = svf.run(v, l.bandpass);
    }
    if (l.highpass > 20) {
      const rc = 1 / (2 * Math.PI * l.highpass);
      const hpA = rc / (rc + 1 / sampleRate);
      hpOut = hpA * (hpOut + v - hpIn);
      hpIn = v;
      v = hpOut;
    }
    if (l.crush > 0) {
      const levels = Math.pow(2, Math.round(16 - l.crush * 14)) / 2;
      v = Math.round(v * levels) / levels;
    }

    // Envelope: attack, hold (with punch fading over it), decay; a loop stays level
    let env: number;
    if (s.loop) env = 1;
    else if (t < l.attack) env = t / l.attack;
    else if (t < l.attack + l.hold) env = 1 + l.punch * (1 - (t - l.attack) / Math.max(1e-6, l.hold));
    else env = Math.pow(1 - Math.min(1, (t - l.attack - l.hold) / Math.max(1e-6, l.decay)), 2);
    if (l.trem) env *= 1 - l.trem * (0.5 + 0.5 * Math.sin(2 * Math.PI * l.tremRate * t));
    out[i] = v * env * l.gain;
  }
  return out;
}

/** Feedback echo and a small Freeverb-style reverb, in place over `x` (whose end is room for the tail). */
function effects(x: Float32Array, s: SfxSound, sampleRate: number): void {
  if (s.drive > 0) {
    const g = 1 + s.drive * 8;
    const norm = Math.tanh(g);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * g) / norm;
  }
  if (s.echo > 0) {
    const d = Math.max(1, Math.round(s.echoTime * sampleRate));
    const line = new Float32Array(d);
    for (let i = 0, p = 0; i < x.length; i++, p = (p + 1) % d) {
      const delayed = line[p];
      line[p] = x[i] + delayed * s.echoFeedback;
      x[i] += delayed * s.echo;
    }
  }
  if (s.reverb > 0) {
    const scale = (sampleRate / 44100) * (0.5 + s.room * 0.8);
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => ({ buf: new Float32Array(Math.max(1, Math.round(n * scale))), p: 0, low: 0 }));
    const alls = [556, 441, 341, 225].map((n) => ({ buf: new Float32Array(Math.max(1, Math.round(n * (sampleRate / 44100)))), p: 0 }));
    const feedback = 0.7 + s.room * 0.28;
    const damp = 0.25;
    for (let i = 0; i < x.length; i++) {
      const input = x[i] * 0.15;
      let wet = 0;
      for (const c of combs) {
        const y = c.buf[c.p];
        c.low = y * (1 - damp) + c.low * damp;
        c.buf[c.p] = input + c.low * feedback;
        c.p = (c.p + 1) % c.buf.length;
        wet += y;
      }
      for (const a of alls) {
        const y = a.buf[a.p];
        a.buf[a.p] = wet + y * 0.5;
        a.p = (a.p + 1) % a.buf.length;
        wet = y - wet;
      }
      x[i] = x[i] * (1 - s.reverb * 0.5) + wet * s.reverb;
    }
  }
}

/** Loudness each level is made to, as the RMS of its loudest 50 ms (dBFS) */
const LEVEL_DB: Record<SfxLevel, number> = { soft: -20, normal: -16, loud: -12 };
/** The highest a sample goes: -1 dBFS */
export const SFX_CEILING = 0.89;

/** RMS of the loudest 50 ms. */
function loudestRms(x: Float32Array, sampleRate: number): number {
  const win = Math.max(1, Math.round(0.05 * sampleRate));
  let sum = 0;
  let best = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    if (i >= win) sum -= x[i - win] * x[i - win];
    best = Math.max(best, sum);
  }
  return Math.sqrt(Math.max(0, best) / Math.min(win, x.length));
}

/**
 * Render the sound, mono: levelled to its loudness, never above -1 dBFS, silence after it trimmed
 * and the ends faded so it never clicks. A loop renders exactly `loopLength` long and joins up.
 */
export function renderSfx(s: SfxSound, sampleRate = 44100): Float32Array {
  const layers = s.layers.filter((l) => l.on);
  let out: Float32Array;
  if (s.loop) {
    // The loop plus a crossfade's worth, then the end folded into the start so it joins up
    const len = Math.max(1, Math.round(s.loopLength * sampleRate));
    const xf = Math.min(Math.round(len / 4), Math.round(0.3 * sampleRate));
    const dry = new Float32Array(len + xf);
    for (const l of layers) {
      const y = renderLayer({ ...l, delay: 0 }, s, len + xf, sampleRate);
      for (let i = 0; i < y.length; i++) dry[i] += y[i];
    }
    const loop = dry.slice(0, len);
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      loop[i] = dry[len + i] * Math.cos((a * Math.PI) / 2) + dry[i] * Math.sin((a * Math.PI) / 2);
    }
    // Effects over two turns of the loop, keeping the second, so the echo and reverb carry over the join
    const twice = new Float32Array(len * 2);
    twice.set(loop, 0);
    twice.set(loop, len);
    effects(twice, s, sampleRate);
    out = twice.slice(len);
  } else {
    const length = Math.max(1, Math.round(sfxLength(s) * sampleRate));
    out = new Float32Array(length);
    for (const l of layers) {
      const y = renderLayer(l, s, length, sampleRate);
      for (let i = 0; i < length; i++) out[i] += y[i];
    }
    effects(out, s, sampleRate);
    // Trim the silence after the sound (below -60 dB from its peak)
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    let end = out.length;
    while (end > 1 && Math.abs(out[end - 1]) < peak * 0.002) end--;
    out = out.slice(0, Math.min(out.length, end + Math.round(0.005 * sampleRate)));
    const fade = Math.min(out.length >> 1, Math.round(0.002 * sampleRate));
    for (let i = 0; i < fade; i++) {
      out[i] *= i / fade;
      out[out.length - 1 - i] *= i / fade;
    }
  }
  // Level: to the loudness for its level, then down if the peak would go over the ceiling
  const rms = loudestRms(out, sampleRate);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0 && rms > 0) {
    const gain = Math.min(10 ** (LEVEL_DB[s.level] / 20) / rms, SFX_CEILING / peak) * clamp(s.volume, 0, 1);
    for (let i = 0; i < out.length; i++) out[i] *= gain;
  }
  return out;
}

/** A 16-bit mono WAV file of `samples`; a loop gets a 'smpl' chunk marking the whole file as the loop. */
export function sfxWav(samples: Float32Array, sampleRate = 44100, loop = false): Uint8Array {
  const smpl = loop ? loopChunk(sampleRate, 0, samples.length) : new Uint8Array(0);
  const data = samples.length * 2;
  const bytes = new Uint8Array(44 + data + smpl.length);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + data + smpl.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(clamp(samples[i], -1, 1) * 32767), true);
  bytes.set(smpl, 44 + data);
  return bytes;
}

/** A file name for games: lower case, words joined by underscores ("ui_open_menu_02"). */
export function sfxFileName(name: string, variation?: number): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'sound';
  return variation === undefined ? base : `${base}_${String(variation).padStart(2, '0')}`;
}

/** Read a sound back from saved JSON (My sounds, a .json file): null if it isn't one. */
export function parseSfx(v: unknown): SfxSound | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? clamp(x, lo, hi) : d);
  const layer = (x: unknown): SfxLayer | null => {
    if (!x || typeof x !== 'object') return null;
    const l = x as Record<string, unknown>;
    const wave = SFX_WAVES.includes(l.wave as SfxWave) ? (l.wave as SfxWave) : 'square';
    return {
      wave,
      freq: num(l.freq, 440, 5, 12000),
      slide: num(l.slide, 0, -48, 48),
      curve: num(l.curve, 0.5, 0, 1),
      arp: num(l.arp, 0, -24, 24),
      arpAt: num(l.arpAt, 0.3, 0, 1),
      seq: Array.isArray(l.seq) ? l.seq.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(0, 32).map((n) => clamp(Math.round(n), -36, 36)) : [],
      seqStep: num(l.seqStep, 0.08, 0.01, 1),
      vibDepth: num(l.vibDepth, 0, 0, 4),
      vibRate: num(l.vibRate, 6, 0.1, 60),
      duty: num(l.duty, 0.5, 0.05, 0.5),
      fmRatio: num(l.fmRatio, 2, 0.1, 16),
      fmIndex: num(l.fmIndex, 2, 0, 10),
      attack: num(l.attack, 0, 0, 2),
      hold: num(l.hold, 0.05, 0, 5),
      decay: num(l.decay, 0.2, 0.005, 5),
      punch: num(l.punch, 0, 0, 1),
      lowpass: num(l.lowpass, 20000, 50, 20000),
      lpSweep: num(l.lpSweep, 0, -6, 6),
      reso: num(l.reso, 0, 0, 1),
      bandpass: l.bandpass === true,
      wobble: num(l.wobble, 0, 0, 4),
      wobbleRate: num(l.wobbleRate, 0.5, 0.05, 30),
      highpass: num(l.highpass, 20, 20, 8000),
      crush: num(l.crush, 0, 0, 1),
      repeat: num(l.repeat, 0, 0, 40),
      trem: num(l.trem, 0, 0, 1),
      tremRate: num(l.tremRate, 6, 0.05, 60),
      gain: num(l.gain, 1, 0, 1),
      delay: num(l.delay, 0, 0, 5),
      on: l.on !== false,
      seed: num(l.seed, 1, 0, 2 ** 32 - 1) >>> 0,
    };
  };
  // A sound from before layers: one layer's settings at the top
  if (!Array.isArray(o.layers)) {
    const one = layer(o);
    return one ? { ...BASE_SOUND, seed: one.seed, volume: num(o.volume, 0.8, 0, 1), layers: [one] } : null;
  }
  const layers = o.layers.map(layer).filter((l): l is SfxLayer => !!l).slice(0, MAX_LAYERS);
  if (!layers.length) return null;
  return {
    layers,
    pitch: num(o.pitch, 0, -24, 24),
    drive: num(o.drive, 0, 0, 1),
    echo: num(o.echo, 0, 0, 1),
    echoTime: num(o.echoTime, 0.15, 0.01, 1),
    echoFeedback: num(o.echoFeedback, 0.35, 0, 0.9),
    reverb: num(o.reverb, 0, 0, 1),
    room: num(o.room, 0.5, 0, 1),
    level: SFX_LEVELS.includes(o.level as SfxLevel) ? (o.level as SfxLevel) : 'normal',
    volume: num(o.volume, 1, 0, 1),
    loop: o.loop === true,
    loopLength: num(o.loopLength, 2, 0.25, 30),
    seed: num(o.seed, 1, 0, 2 ** 32 - 1) >>> 0,
  };
}
