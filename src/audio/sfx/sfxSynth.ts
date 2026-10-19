/**
 * The sound effects maker's synth: game sounds from a few layers of simple sources (waves, noise,
 * FM, bells, crackle), each with its own pitch movement, filter and envelope, then drive, echo and
 * reverb over the whole. About sixty kinds of sound (retro, UI, combat, movement, rewards, magic
 * and sci-fi, jingles, ambience loops) each have a recipe that rolls new settings from a seed, so
 * the same seed always gives the same sound. A set (a game's UI sounds, say) shares a style seed,
 * so its sounds belong together. Sounds are levelled to a loudness for their kind, trimmed and
 * faded; loops render seamless. Rendering is plain maths into a Float32Array, with no Web Audio,
 * so Node can unit-test it and the files are the same everywhere.
 *
 * Two engines. Classic (the Retro kinds, and every sound saved before the modern engine) renders
 * mono as it always has. Modern (`modern` on: the other kinds as generated now) adds what makes a
 * sound sound like now rather than a 1980s console (sfxModern.ts): band-limited waves, natural
 * (exponential) decays, material bodies, recorded layers, stereo (each layer panned and moving,
 * noise spread wide) and a stereo space with early reflections.
 */
import { loopChunk } from '../wavCues';
import { bodyRing, ModalBody, polyBlep, recordingFor, stereoSpace, SFX_MATERIALS, type SfxMaterial } from './sfxModern';

export const SFX_WAVES = ['square', 'saw', 'triangle', 'sine', 'noise', 'pink', 'brown', 'fm', 'metal', 'crackle', 'rec'] as const;
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
  rec: 'recording',
};
/** Sources with no pitch of their own (their Pitch does nothing, or sets a rate) */
export const UNPITCHED: ReadonlySet<SfxWave> = new Set(['noise', 'pink', 'brown', 'crackle', 'rec']);

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
  // ---- Modern engine only (a classic sound ignores them) ----
  /** A recording (a group in sfxRecordings.ts) for the Recording source; the seed picks the take */
  rec?: string;
  /** What the sound strikes: a body of this material ringing at the layer's pitch */
  body?: SfxMaterial;
  /** How long the body rings, times the material's own (0.2 to 3); how much of it is heard, 0 to 1 */
  ring?: number;
  bodyMix?: number;
  /** Where it sits, -1 (left) to 1 (right), and where it ends up (a sound moving past) */
  pan?: number;
  panTo?: number;
  /** Stereo spread, 0 to 1: the right channel's noise is its own, so noise sounds wide */
  width?: number;
  /**
   * Gusts, 0 to 1: the layer coming and going at random, as wind does (Wobble then moves the filter
   * with the gusts instead of evenly), about `gustRate` times a second. Every layer of a sound gusts
   * together; at 1 the lulls between gusts are silent, lower keeps some of the layer there throughout
   */
  gust?: number;
  gustRate?: number;
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
  /** The modern engine (stereo, material bodies, recordings); off: the classic one */
  modern?: boolean;
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
  { name: 'Foley', kinds: ['doorOpen', 'doorClose', 'pageTurn', 'bookPlace', 'cardDeal', 'diceRoll', 'glassBreak', 'bubble', 'slime', 'sciFiDoor'] },
  { name: 'Loops', kinds: ['engineHum', 'wind', 'windGusty', 'windStorm', 'windHowl', 'fire', 'rain', 'alarm', 'forceField', 'spaceship', 'water'] },
  { name: 'Nature', kinds: ['forest', 'night', 'trees', 'river', 'ocean', 'rainHeavy', 'thunderstorm', 'thunder', 'cave'] },
  { name: 'Places', kinds: ['city', 'cafe', 'market'] },
  { name: 'Creatures', kinds: ['songbird', 'crow', 'owl', 'seagull', 'dog', 'cat', 'catPurr', 'wolf', 'frog', 'horse', 'cow', 'rooster', 'chicken', 'sheep', 'pig', 'bee', 'flies', 'monsterRoar', 'zombie', 'goblin', 'squeak'] },
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
  wind: 'Breeze',
  fire: 'Fire',
  rain: 'Rain',
  alarm: 'Alarm',
  forceField: 'Force field',
  spaceship: 'Spaceship hum',
  water: 'Stream',
  windGusty: 'Gusty wind',
  windStorm: 'Storm',
  windHowl: 'Howling wind',
  doorOpen: 'Door opens',
  doorClose: 'Door closes',
  pageTurn: 'Page turn',
  bookPlace: 'Book',
  cardDeal: 'Card dealt',
  diceRoll: 'Dice roll',
  glassBreak: 'Glass breaks',
  bubble: 'Bubble',
  slime: 'Slime',
  sciFiDoor: 'Sci-fi door',
  forest: 'Forest',
  night: 'Night',
  trees: 'Wind in trees',
  river: 'River',
  ocean: 'Ocean waves',
  rainHeavy: 'Downpour',
  thunderstorm: 'Thunderstorm',
  thunder: 'Thunder',
  cave: 'Cave',
  city: 'City street',
  cafe: 'Cafe',
  market: 'Market',
  songbird: 'Songbird',
  crow: 'Crow',
  owl: 'Owl',
  seagull: 'Seagull',
  dog: 'Dog',
  cat: 'Cat',
  catPurr: 'Purring cat',
  wolf: 'Wolf',
  frog: 'Frog',
  horse: 'Horse',
  cow: 'Cow',
  rooster: 'Rooster',
  chicken: 'Chicken',
  sheep: 'Sheep',
  pig: 'Pig',
  bee: 'Bee',
  flies: 'Flies',
  monsterRoar: 'Monster roar',
  zombie: 'Zombie',
  goblin: 'Goblin',
  squeak: 'Squeak',
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
  { id: 'ambience', name: 'Ambience loops', folder: 'ambience', kinds: ['wind', 'windStorm', 'rain', 'fire', 'water', 'spaceship', 'engineHum', 'forceField'] },
  { id: 'nature', name: 'Nature & places', folder: 'nature', kinds: ['forest', 'night', 'trees', 'river', 'ocean', 'rainHeavy', 'thunderstorm', 'thunder', 'cave', 'city', 'cafe', 'market'] },
  { id: 'creatures', name: 'Animals & creatures', folder: 'creatures', kinds: ['songbird', 'crow', 'owl', 'dog', 'cat', 'wolf', 'horse', 'cow', 'rooster', 'sheep', 'pig', 'monsterRoar', 'zombie', 'goblin'] },
  { id: 'foley', name: 'Foley & props', folder: 'foley', kinds: ['doorOpen', 'doorClose', 'pageTurn', 'bookPlace', 'cardDeal', 'diceRoll', 'glassBreak', 'footstep', 'land', 'unlock'] },
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

export const MAX_LAYERS = 6;

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
  /** A low thump with a fast pitch drop */
  const thump = (freq: number, decay: number, gain = 1, delay = 0) => L({ wave: 'sine', freq, slide: -between(8, 14), curve: 0.9, hold: 0, decay, punch: 0.7, gain, delay });
  const bell = (freq: number, decay: number, gain = 1, delay = 0, extra: Partial<SfxLayer> = {}) => L({ wave: 'metal', freq, hold: 0, decay, gain, delay, ...extra });
  const tone = (patch: Partial<SfxLayer>) => L({ wave: S.tone, fmRatio: S.ratio, fmIndex: between(0.8, 2.5), duty: 0.35, ...patch });
  const major = [0, 4, 7, 12];
  // ---- The modern engine's pieces ----
  const M = (layers: SfxLayer[], patch: Partial<Omit<SfxSound, 'layers'>> = {}): SfxSound => sound(layers, { ...patch, modern: true });
  /** A recording, played through (Hold covers it), its speed nudged a little */
  const rec = (group: string, patch: Partial<SfxLayer> = {}) => L({ wave: 'rec', rec: group, freq: 440 * 2 ** (between(-1, 1) / 12), hold: 4, decay: 0.05, ...patch });
  /** A field recording looped as it was (its pitch untouched), opened out a little */
  const field = (group: string, patch: Partial<SfxLayer> = {}) => rec(group, { freq: 440, width: 0.5, ...patch });
  /** A place: its recording, a 20-second loop */
  const place = (group: string, patch: Partial<SfxLayer> = {}, level: SfxSound['level'] = 'soft') => M([field(group, patch)], { level, loop: true, loopLength: 20 });
  /** An animal's call, pitched a little up or down, in a little of the space it was in */
  const call = (group: string, reverb: number) => M([rec(group)], { reverb, room: 0.5 });
  /** A struck body: a short noise strike ringing `material` at `freq` */
  const strike = (material: SfxMaterial, freq: number, ring: number, gain = 1, delay = 0, patch: Partial<SfxLayer> = {}) =>
    L({ wave: 'pink', lowpass: 9000, hold: 0, decay: between(0.005, 0.009), punch: 0.5, body: material, ring, bodyMix: 0.9, freq, gain, delay, ...patch });
  /** Air moving past: wide noise through a sweeping band, from one side to the other */
  const air = (from: number, octaves: number, attack: number, decay: number, gain = 1, delay = 0) => {
    const side = r() < 0.5 ? -1 : 1;
    return L({ wave: 'pink', bandpass: true, lowpass: from, lpSweep: octaves, reso: between(0.3, 0.55), attack, hold: between(0.01, 0.05), decay, gain, delay, width: 0.7, pan: -0.6 * side, panTo: 0.6 * side });
  };
  /** The set's tone for UI and rewards, never a raw square */
  const mtone = (patch: Partial<SfxLayer>) => tone({ ...(S.tone === 'square' ? { wave: 'triangle' as const } : {}), ...patch });

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

    // ---- UI (modern from here on: clean tones, real clicks, glass and plastic, stereo) ----
    case 'uiClick':
      return M([rec('ui-click', { gain: 0.8 }), strike('plastic', between(1800, 3200) * S.reg, 0.6, 0.35)], { level: 'soft', reverb: S.space * 0.3, room: 0.15 });
    case 'uiHover':
      return M([mtone({ freq: between(900, 1500) * S.reg, attack: 0.003, hold: 0.004, decay: between(0.04, 0.07), fmIndex: between(0.3, 0.8) }), strike('glass', between(2500, 3500) * S.reg, 0.3, 0.15)], { level: 'soft', volume: 0.7, reverb: S.space * 0.4, room: 0.2 });
    case 'uiConfirm': {
      const f = between(600, 900) * S.reg;
      return M([mtone({ freq: f, seq: [0, pick([4, 5, 7, 12])], seqStep: between(0.05, 0.08), hold: 0.09, decay: between(0.15, 0.25) }), rec('ui-select', { gain: 0.45 }), strike('glass', f * 2, 0.5, 0.25, between(0.05, 0.08))], { reverb: Math.max(0.1, S.space), room: 0.3 });
    }
    case 'uiBack':
      return M([mtone({ freq: between(600, 850) * S.reg, seq: [0, -pick([3, 5, 7])], seqStep: between(0.05, 0.07), hold: 0.07, decay: between(0.12, 0.2), lowpass: 4000 }), rec('ui-switch', { gain: 0.4, lowpass: 5000 })], { level: 'soft', reverb: S.space, room: 0.3 });
    case 'uiError': {
      const f = between(140, 220);
      const buzz = (delay: number) => L({ wave: 'saw', freq: f, lowpass: between(900, 1400), reso: 0.25, hold: 0.07, decay: 0.05, delay });
      return M([buzz(0), buzz(between(0.11, 0.14)), strike('plastic', f * 4, 0.5, 0.3)], { reverb: S.space * 0.5, room: 0.3 });
    }
    case 'uiOpen':
      return M([air(between(600, 900), between(2, 3), 0.03, between(0.12, 0.16), 0.8), mtone({ freq: between(600, 800) * S.reg, slide: between(4, 7), hold: 0.02, decay: 0.1, gain: 0.5, delay: 0.05 })], { level: 'soft', reverb: S.space, room: 0.3 });
    case 'uiClose':
      return M([air(between(3000, 4500), -between(2, 3), 0.01, between(0.12, 0.16), 0.8), mtone({ freq: between(700, 900) * S.reg, slide: -between(4, 7), hold: 0.02, decay: 0.1, gain: 0.5, delay: 0.02 })], { level: 'soft', reverb: S.space, room: 0.3 });
    case 'uiToggle': {
      const f = between(1000, 1800) * S.reg;
      return M([rec('ui-switch', { gain: 0.8 }), L({ wave: 'sine', freq: f * pick([0.75, 1.5]), hold: 0, decay: 0.04, delay: between(0.02, 0.04), gain: 0.4 })], { level: 'soft' });
    }
    case 'uiNotify': {
      const f = between(700, 1300) * S.reg;
      return M([strike('glass', f, between(1, 1.5)), strike('glass', f * 2 ** (pick([5, 7, 12]) / 12), between(1, 1.6), 0.8, between(0.08, 0.12), { pan: 0.3 })], { reverb: Math.max(0.2, S.space), room: 0.45 });
    }
    case 'uiType':
      return M([rec('ui-click', { freq: between(380, 520), gain: 0.9 }), strike('plastic', between(1800, 2800), 0.4, 0.25)], { level: 'soft', volume: 0.8 });
    case 'uiPurchase': {
      const f = between(1500, 2100);
      return M([rec('coins', { gain: 0.7 }), strike('metal', f, 0.7, 0.6), strike('metal', f * 2 ** (7 / 12), 0.9, 0.55, 0.07, { pan: 0.25 })], { reverb: Math.max(0.15, S.space), room: 0.35 });
    }
    case 'uiSwipe':
      return M([air(between(1500, 2500), between(1, 1.6), 0.02, between(0.1, 0.14))], { level: 'soft', reverb: S.space * 0.5, room: 0.2 });

    // ---- Combat ----
    case 'swordSwing':
      return M([rec('swish'), air(between(500, 900), between(1.5, 2.5), between(0.03, 0.06), between(0.14, 0.2), 0.6), strike('metal', between(2500, 4000), 0.4, 0.12, 0.04)], { reverb: 0.08, room: 0.3 });
    case 'slash':
      return M([rec('blade-slice'), rec('swish', { gain: 0.5 }), strike('metal', between(1500, 2200), 0.5, 0.35, 0.05), thump(between(110, 160), 0.1, 0.5, 0.05)], { level: 'loud', drive: 0.15, reverb: 0.08, room: 0.3 });
    case 'punch':
      return M([rec('punch'), thump(between(90, 130), between(0.1, 0.15), 0.8), strike('skin', between(110, 160), 0.6, 0.4)], { level: 'loud', drive: between(0.15, 0.3), reverb: 0.05, room: 0.2 });
    case 'impactHeavy':
      return M([rec(pick(['soft', 'punch'])), thump(between(45, 70), between(0.4, 0.6)), rec('stone-hit', { gain: 0.35, delay: 0.005 }), L({ wave: 'brown', lowpass: between(400, 700), lpSweep: -1.5, hold: 0.02, decay: between(0.4, 0.7), punch: 0.6, gain: 0.6, width: 0.6 })], { level: 'loud', drive: between(0.25, 0.4), reverb: 0.18, room: 0.55 });
    case 'block':
      return M([rec('metal-heavy'), strike('metal', between(600, 1100), between(0.8, 1.2), 0.5), thump(between(160, 220), 0.08, 0.4)], { level: 'loud', reverb: 0.12, room: 0.35 });
    case 'arrow': {
      const side = pick([-1, 1]);
      return M([L({ wave: 'pink', bandpass: true, lowpass: between(2500, 3500), lpSweep: -1, reso: 0.4, attack: 0.01, hold: 0.02, decay: 0.12, gain: 0.7, width: 0.5, pan: -0.8 * side, panTo: 0.5 * side }), rec('wood-light', { delay: between(0.18, 0.25) }), strike('wood', between(180, 260), 0.8, 0.5, between(0.18, 0.25), { pan: 0.5 * side })], { reverb: 0.1, room: 0.35 });
    }
    case 'gunshot':
      return M([L({ wave: 'pink', lowpass: between(5000, 8000), lpSweep: -2, hold: 0, decay: between(0.15, 0.25), punch: 1, width: 0.4 }), thump(between(60, 90), 0.15), rec('explosion', { freq: between(600, 760), gain: 0.55, decay: 0.3, hold: 0.25 }), click(0.6)], { level: 'loud', drive: between(0.4, 0.6), reverb: between(0.2, 0.35), room: between(0.65, 0.9) });
    case 'reload': {
      const second = between(0.18, 0.28);
      return M([rec('latch'), strike('metal', between(1800, 2600), 0.25, 0.3), rec('latch', { delay: second, seed: (seed + 17) >>> 0 }), strike('metal', between(1300, 1900), 0.3, 0.3, second)], { reverb: 0.06, room: 0.2 });
    }
    case 'magicBolt':
      return M([L({ wave: 'fm', freq: between(800, 1200), fmRatio: between(2.5, 4), fmIndex: between(2, 4), slide: -between(10, 20), curve: 0.6, hold: 0.05, decay: between(0.3, 0.45), vibDepth: 0.3, vibRate: 20, width: 0.3 }), air(between(1500, 2500), -1.5, 0.01, 0.3, 0.45), strike('glass', between(2500, 3500), 0.8, 0.2)], { echo: 0.2, echoTime: between(0.08, 0.12), echoFeedback: 0.3, reverb: 0.3, room: 0.55 });
    case 'heal': {
      const f = between(500, 700);
      return M([L({ wave: pick(['sine', 'triangle'] as const), freq: f, seq: [0, 4, 7, 12, 16], seqStep: between(0.05, 0.07), hold: 0.3, decay: 0.5 }), strike('glass', f * 4, 1.2, 0.3, 0.1, { pan: -0.3 }), strike('glass', f * 4 * 2 ** (7 / 12), 1.2, 0.25, 0.18, { pan: 0.3 })], { level: 'soft', reverb: 0.4, room: 0.65 });
    }
    case 'hurt':
      return M([rec('punch', { gain: 0.7 }), L({ wave: 'saw', freq: between(250, 400), slide: -between(5, 10), vibDepth: between(0.5, 1.2), vibRate: between(25, 40), bandpass: true, lowpass: between(700, 1000), reso: 0.4, hold: 0.04, decay: between(0.15, 0.25), gain: 0.6 }), thump(between(110, 150), 0.08, 0.5)], { drive: 0.2, reverb: 0.06, room: 0.25 });

    // ---- Movement ----
    case 'whoosh':
      return M([rec(pick(['whoosh', 'swish', 'swish'])), air(between(250, 500), between(1.5, 2.5), between(0.08, 0.14), between(0.2, 0.32), 0.6), L({ wave: 'brown', lowpass: 400, attack: 0.08, hold: 0.02, decay: 0.2, gain: 0.3 })], { reverb: 0.08, room: 0.35 });
    case 'dash':
      return M([rec('swish', { freq: between(480, 600) }), air(between(800, 1200), between(1, 2), 0.02, between(0.1, 0.15), 0.6), L({ wave: 'sine', freq: between(200, 300), slide: -12, curve: 0.7, hold: 0, decay: 0.12, gain: 0.25 })]);
    case 'jumpSoft':
      return M([rec('cloth', { gain: 0.8 }), L({ wave: pick(['sine', 'triangle'] as const), freq: between(220, 340), slide: between(5, 9), curve: 0.6, hold: 0.03, decay: between(0.1, 0.15), gain: 0.5 })], { level: 'soft' });
    case 'land':
      return M([rec(pick(['soft', 'step-dirt'])), thump(between(70, 100), 0.12, 0.7), rec('cloth', { gain: 0.35, delay: 0.01 })], { level: 'normal', reverb: 0.05, room: 0.25 });
    case 'footstep': {
      const surface = pick(['stone', 'grass', 'snow', 'wood', 'carpet', 'dirt'] as const);
      return M([rec(`step-${surface}`), ...(surface === 'wood' ? [strike('wood', between(140, 220), 0.6, 0.25)] : surface === 'stone' ? [strike('stone', between(200, 400), 1, 0.2)] : [])], { level: 'soft', reverb: 0.06, room: 0.3 });
    }
    case 'splash':
      return M([rec('splash'), L({ wave: 'pink', lowpass: between(2500, 4000), lpSweep: -1, attack: 0.01, hold: 0.03, decay: between(0.4, 0.6), gain: 0.35, width: 0.8 }), L({ wave: 'sine', freq: between(250, 400), slide: -12, curve: 0.8, hold: 0, decay: 0.1, gain: 0.25 })], { reverb: 0.1, room: 0.4 });
    case 'bounce':
      return M([rec('soft', { gain: 0.6 }), L({ wave: 'sine', freq: between(180, 280) * S.reg, slide: between(7, 12), curve: 0.4, vibDepth: between(0.3, 0.7), vibRate: between(10, 16), hold: 0.04, decay: between(0.18, 0.28) }), strike('skin', between(90, 130), 0.8, 0.4)], { reverb: 0.08, room: 0.3 });

    // ---- Rewards ----
    case 'coinModern': {
      const f = between(1500, 2100) * S.reg;
      return M([strike('metal', f, 0.6), strike('metal', f * 2 ** (pick([5, 7]) / 12), 1, 1, between(0.05, 0.07), { pan: 0.2 }), rec('coins', { gain: 0.3 })], { level: 'soft', reverb: Math.max(0.12, S.space), room: 0.35 });
    }
    case 'gem': {
      const f = between(1800, 2600) * S.reg;
      return M([strike('glass', f, between(1.2, 1.6)), strike('glass', f * 2 ** (pick([7, 12]) / 12), between(1.2, 1.8), 0.8, between(0.05, 0.08), { pan: 0.3 }), L({ wave: 'crackle', freq: between(150, 300), highpass: 6000, hold: 0.1, decay: 0.4, gain: 0.2, width: 1 })], { reverb: 0.3, room: 0.55 });
    }
    case 'healthPickup': {
      const f = between(500, 700) * S.reg;
      return M([mtone({ freq: f, seq: [0, 7, 12], seqStep: between(0.045, 0.06), hold: 0.12, decay: 0.25 }), strike('glass', f * 4, 1, 0.25, 0.1, { pan: 0.25 })], { reverb: Math.max(0.18, S.space), room: 0.45 });
    }
    case 'unlock': {
      const second = between(0.07, 0.1);
      return M([rec('latch'), rec('latch', { delay: second, seed: (seed + 29) >>> 0, gain: 0.8 }), strike('metal', between(250, 350), 0.4, 0.4, second), strike('glass', between(1200, 1800), 1.2, 0.6, between(0.15, 0.2))], { reverb: 0.18, room: 0.45 });
    }
    case 'levelUp': {
      const f = between(400, 600);
      const run = pick([major, [0, 4, 7, 12, 16], [0, 5, 7, 12]]);
      return M([L({ wave: pick(['saw', 'triangle'] as const), freq: f, seq: run, seqStep: between(0.06, 0.08), lowpass: 3500, reso: 0.15, hold: 0.35, decay: 0.45, width: 0.2 }), L({ wave: 'triangle', freq: f * 2, seq: major, seqStep: 0.07, hold: 0.35, decay: 0.45, gain: 0.3, pan: 0.3 }), strike('glass', f * 4, 1.4, 0.35, 0.28, { pan: -0.3 })], { reverb: 0.25, room: 0.55 });
    }
    case 'achievement': {
      const f = between(330, 440);
      const run = [0, 4, 7, 12, 7, 12];
      return M([L({ wave: 'saw', freq: f, seq: run, seqStep: between(0.09, 0.11), lowpass: 2600, reso: 0.2, hold: 0.55, decay: 0.6, vibDepth: 0.15, vibRate: 5.5, width: 0.2 }), L({ wave: 'saw', freq: f / 2, seq: run, seqStep: 0.1, lowpass: 1200, hold: 0.55, decay: 0.6, gain: 0.4 }), strike('metal', f * 4, 1.5, 0.3, 0.5)], { reverb: 0.3, room: 0.6 });
    }
    case 'collectAll': {
      const f = between(500, 700) * S.reg;
      return M([mtone({ freq: f, seq: [0, 2, 4, 7, 9, 12, 16, 19, 24], seqStep: between(0.035, 0.05), hold: 0.4, decay: 0.45 }), strike('glass', f * 4, 1.6, 0.3, 0.35, { pan: 0.3 })], { reverb: 0.3, room: 0.55 });
    }

    // ---- Magic & sci-fi ----
    case 'laserModern':
      return M([rec('laser'), L({ wave: 'fm', freq: between(1200, 2200), fmRatio: pick([0.5, 1.5, 2]), fmIndex: between(3, 6), slide: -between(18, 30), curve: 0.9, hold: 0.01, decay: between(0.15, 0.25), punch: 0.4, gain: 0.6 })], { echo: between(0.2, 0.35), echoTime: between(0.07, 0.11), echoFeedback: 0.3, reverb: 0.12, room: 0.45 });
    case 'teleport':
      return M([L({ wave: 'saw', freq: between(200, 350), slide: between(20, 30), curve: 0, repeat: between(8, 14), hold: between(0.3, 0.45), decay: 0.15, lowpass: 3000, reso: 0.2, width: 0.4 }), air(between(400, 700), 3, 0.15, 0.3, 0.5), strike('glass', between(2000, 3000), 1.4, 0.3, 0.35)], { reverb: 0.35, room: 0.65 });
    case 'chargeUp':
      return M([L({ wave: 'saw', freq: between(90, 160), slide: between(20, 28), curve: 0, attack: 0.05, hold: between(0.9, 1.4), decay: 0.08, lowpass: between(600, 900), lpSweep: 3, reso: 0.45, vibDepth: 0.2, vibRate: 8, width: 0.3 }), L({ wave: 'sine', freq: between(180, 320), slide: between(20, 28), curve: 0, attack: 0.05, hold: between(0.9, 1.4), decay: 0.08, trem: 0.5, tremRate: 14, gain: 0.4 }), L({ wave: 'pink', bandpass: true, lowpass: 500, lpSweep: 3.5, reso: 0.5, attack: 0.6, hold: between(0.3, 0.8), decay: 0.08, gain: 0.3, width: 1 })], { reverb: 0.12, room: 0.4 });
    case 'spell': {
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const steps = Array.from({ length: 6 + Math.floor(r() * 4) }, () => pick(scale));
      return M([bell(between(900, 1400), 0.6, 1, 0, { seq: steps, seqStep: between(0.035, 0.05), hold: steps.length * 0.04, width: 0.3 }), L({ wave: 'crackle', freq: between(200, 400), highpass: 5000, hold: 0.25, decay: 0.4, gain: 0.25, width: 1 }), air(between(1000, 1500), 1.5, 0.05, 0.3, 0.3)], { reverb: 0.45, room: 0.75 });
    }
    case 'shieldUp':
      return M([L({ wave: 'fm', freq: between(150, 250), fmRatio: 1.5, fmIndex: between(3, 5), slide: between(10, 14), curve: 0.5, hold: 0.3, decay: 0.35, trem: 0.4, tremRate: between(16, 24), width: 0.3 }), rec('force-field', { gain: 0.4, hold: 0.5, decay: 0.2 })], { reverb: 0.25, room: 0.5 });
    case 'powerDown':
      return M([L({ wave: 'saw', freq: between(500, 800), slide: -between(20, 30), curve: 0.3, hold: 0.3, decay: 0.45, lowpass: 3000, lpSweep: -3, reso: 0.2, vibDepth: 0.4, vibRate: 7, width: 0.2 }), rec('computer', { gain: 0.25, hold: 0.4, decay: 0.2, freq: between(300, 380) })], { reverb: 0.18, room: 0.45 });
    case 'robotBeep': {
      const notes = Array.from({ length: 3 + Math.floor(r() * 3) }, () => pick([0, 3, 5, 7, 10, 12, 15]));
      return M([L({ wave: pick(['square', 'sine'] as const), duty: pick([0.25, 0.5]), freq: between(500, 1000), seq: notes, seqStep: between(0.05, 0.08), hold: notes.length * 0.065, decay: 0.04, lowpass: 4000 }), rec('computer', { gain: 0.2, hold: notes.length * 0.065, decay: 0.05 })], { level: 'soft', reverb: 0.08, room: 0.3 });
    }
    case 'scan':
      return M([L({ wave: 'sine', freq: between(1000, 1600), slide: between(6, 12), curve: 0, repeat: between(2, 4), hold: between(0.6, 0.9), decay: 0.1, trem: 0.3, tremRate: 30, pan: -0.5, panTo: 0.5 })], { level: 'soft', echo: 0.3, echoTime: 0.12, echoFeedback: 0.4 });

    // ---- Jingles: short tunes (Tune to key puts them in the song's key) ----
    case 'victory': {
      const f = between(330, 470);
      const run = pick([
        [0, 4, 7, 12, 12],
        [0, 0, 0, 4, 7, 12],
        [0, 4, 7, 9, 12],
      ]);
      const long = run.length * 0.11 + 0.3;
      return M([L({ wave: 'saw', freq: f, seq: run, seqStep: between(0.1, 0.13), hold: long, decay: 0.5, lowpass: 3200, reso: 0.15, vibDepth: 0.12, vibRate: 6, width: 0.2 }), L({ wave: 'triangle', freq: f / 2, seq: run.map((s) => (s >= 7 ? 7 : 0)), seqStep: 0.12, hold: long, decay: 0.5, gain: 0.6 }), strike('metal', f * 4, 1.5, 0.25, run.length * 0.11, { pan: 0.3 })], { reverb: 0.25, room: 0.55 });
    }
    case 'gameOver': {
      const f = between(300, 440);
      return M([L({ wave: pick(['saw', 'triangle'] as const), freq: f, seq: [0, -1, -2, -3, -4], seqStep: between(0.28, 0.34), hold: 1.4, decay: 0.7, vibDepth: 0.25, vibRate: 5, lowpass: 2400 }), L({ wave: 'triangle', freq: f / 2, seq: [0, -1, -2, -3, -4], seqStep: 0.31, hold: 1.4, decay: 0.7, gain: 0.5 })], { reverb: 0.3, room: 0.65 });
    }
    case 'questComplete': {
      const f = between(400, 550);
      return M([bell(f * 2, 1.2, 0.6, 0, { seq: [0, 7, 12, 16], seqStep: 0.12, width: 0.2 }), L({ wave: 'triangle', freq: f, seq: [0, 4, 7, 12], seqStep: 0.12, hold: 0.6, decay: 0.7 }), strike('glass', f * 4, 1.5, 0.3, 0.36, { pan: 0.3 })], { reverb: 0.4, room: 0.65 });
    }
    case 'secret': {
      const f = between(500, 700);
      return M([L({ wave: pick(['triangle', 'sine'] as const), freq: f, seq: [0, 6, 11, 15, 12, 8, 13, 17], seqStep: between(0.07, 0.09), hold: 0.75, decay: 0.4, lowpass: 5000, pan: -0.3, panTo: 0.3 }), strike('glass', f * 2, 1.4, 0.3, 0.6)], { reverb: 0.3, room: 0.55 });
    }
    case 'countdown': {
      const f = between(600, 900);
      const beep = (delay: number) => L({ wave: 'sine', freq: f, hold: 0.12, decay: 0.1, delay });
      return M([beep(0), beep(0.5), beep(1), L({ wave: 'sine', freq: f * 2, hold: 0.4, decay: 0.35, delay: 1.5 }), strike('glass', f * 4, 1, 0.25, 1.5)], { level: 'normal', reverb: 0.12, room: 0.35 });
    }

    // ---- Foley: recorded things being handled ----
    case 'doorOpen':
      return M([rec('door-open'), thump(between(80, 110), 0.1, 0.3)], { reverb: 0.12, room: 0.45 });
    case 'doorClose':
      return M([rec('door-close'), thump(between(60, 90), 0.15, 0.5), strike('wood', between(90, 140), 0.8, 0.3)], { reverb: 0.15, room: 0.5 });
    case 'pageTurn':
      return M([rec('page')], { level: 'soft', reverb: 0.05, room: 0.25 });
    case 'bookPlace':
      return M([rec('book'), strike('wood', between(150, 250), 0.6, 0.25)], { level: 'soft', reverb: 0.06, room: 0.3 });
    case 'cardDeal':
      return M([rec('card')], { level: 'soft', reverb: 0.05, room: 0.25 });
    case 'diceRoll':
      return M([rec('dice')], { reverb: 0.08, room: 0.3 });
    case 'glassBreak':
      return M([rec('glass-heavy'), rec('glass', { delay: between(0.03, 0.06), gain: 0.6 }), thump(between(80, 120), 0.08, 0.3)], { level: 'loud', reverb: 0.15, room: 0.5 });
    case 'bubble':
      return M([rec('bubble'), L({ wave: 'sine', freq: between(500, 900), slide: between(8, 14), curve: 0.6, hold: 0, decay: 0.06, gain: 0.3 })], { level: 'soft', reverb: 0.1, room: 0.35 });
    case 'slime':
      return M([rec('slime')], { reverb: 0.06, room: 0.3 });
    case 'sciFiDoor':
      return M([rec('scifi-door'), air(between(400, 700), 1, 0.05, 0.25, 0.4)], { reverb: 0.15, room: 0.5 });

    // ---- Loops: seamless, for engines and places ----
    case 'engineHum': {
      const f = between(40, 65);
      return M([rec('engine'), L({ wave: 'saw', freq: f, lowpass: between(300, 500), reso: 0.3, trem: between(0.15, 0.3), tremRate: f / 4, gain: 0.4 }), L({ wave: 'brown', lowpass: 300, gain: 0.3, width: 0.6 })], { loop: true, loopLength: 4 });
    }
    // Wind: a bed of air (wide noise), its gusts swelling at random; a whistle where it catches an
    // edge (a narrow resonant band whose pitch rises with each gust); a rumble; a recording of real
    // wind under it all
    // Wind: air (wide noise) coming and going in gusts, every layer together; a soft whistle where
    // it catches an edge, rising as it blows harder; a recording of real wind gusting with it
    case 'wind': {
      // A breeze: gusts come and go over air that never quite stops
      const rate = between(0.18, 0.26);
      return M([
        rec('wind', { gain: 0.35, lowpass: 2500, gust: 0.75, gustRate: rate }),
        L({ wave: 'pink', lowpass: between(500, 750), gust: 0.8, gustRate: rate, width: 1 }),
        L({ wave: 'pink', bandpass: true, lowpass: between(320, 450), reso: 0.2, wobble: 0.4, gust: 0.85, gustRate: rate, gain: 0.3, width: 0.8 }),
        L({ wave: 'pink', lowpass: 450, gust: 0.4, gustRate: rate, gain: 0.3, width: 1 }),
      ], { level: 'soft', loop: true, loopLength: 28 });
    }
    case 'windGusty': {
      const rate = between(0.28, 0.36);
      return M([
        rec('wind', { gain: 0.4, lowpass: 3000, gust: 0.8, gustRate: rate }),
        L({ wave: 'pink', lowpass: between(900, 1300), gust: 0.85, gustRate: rate, width: 1 }),
        L({ wave: 'pink', bandpass: true, lowpass: between(500, 700), reso: 0.45, wobble: 0.5, gust: 0.9, gustRate: rate, gain: 0.1, pan: -0.3 }),
        L({ wave: 'brown', lowpass: 220, gust: 0.7, gustRate: rate, gain: 0.45, width: 0.7 }),
        L({ wave: 'pink', lowpass: 500, gust: 0.4, gustRate: rate, gain: 0.3, width: 1 }),
      ], { level: 'soft', loop: true, loopLength: 24 });
    }
    case 'windStorm': {
      // A storm never stops, it only rises and falls
      const rate = between(0.28, 0.36);
      const howl = between(420, 600);
      return M([
        rec('wind', { gain: 0.45, lowpass: 3000, gust: 0.6, gustRate: rate }),
        L({ wave: 'brown', lowpass: between(220, 300), gust: 0.5, gustRate: rate, gain: 0.9, width: 0.8 }),
        L({ wave: 'pink', lowpass: between(1400, 2000), gust: 0.65, gustRate: rate, gain: 0.55, width: 1 }),
        L({ wave: 'pink', bandpass: true, lowpass: howl, reso: 0.55, wobble: 0.5, gust: 0.8, gustRate: rate, gain: 0.1, pan: -0.4 }),
        L({ wave: 'pink', bandpass: true, lowpass: howl * between(1.6, 1.9), reso: 0.55, wobble: 0.5, gust: 0.8, gustRate: rate, gain: 0.05, pan: 0.45 }),
      ], { level: 'normal', loop: true, loopLength: 24 });
    }
    case 'windHowl': {
      const rate = between(0.14, 0.2);
      const f = between(300, 450);
      return M([
        L({ wave: 'pink', lowpass: 800, gust: 0.55, gustRate: rate, gain: 0.6, width: 1 }),
        L({ wave: 'pink', bandpass: true, lowpass: f, reso: 0.7, wobble: 0.5, gust: 0.85, gustRate: rate, gain: 0.3, pan: -0.25 }),
        L({ wave: 'pink', bandpass: true, lowpass: f * 1.5, reso: 0.68, wobble: 0.5, gust: 0.85, gustRate: rate, gain: 0.15, pan: 0.3 }),
        rec('wind', { gain: 0.3, lowpass: 2200, gust: 0.7, gustRate: rate }),
      ], { level: 'soft', reverb: 0.3, room: 0.8, loop: true, loopLength: 28 });
    }
    case 'fire':
      return M([rec('fire'), L({ wave: 'crackle', freq: between(15, 30), highpass: 1500, gain: 0.5, width: 1 }), L({ wave: 'brown', lowpass: between(300, 450), gain: 0.5, trem: 0.25, tremRate: 1, width: 0.6 })], { level: 'soft', loop: true, loopLength: 4 });
    case 'rain':
      return M([rec('rain'), L({ wave: 'pink', lowpass: between(5000, 7000), gain: 0.35, width: 1 }), L({ wave: 'crackle', freq: between(800, 1500), bandpass: true, lowpass: between(3500, 5000), gain: 0.3, width: 1 })], { level: 'soft', loop: true, loopLength: 6 });
    case 'alarm':
      return M([L({ wave: pick(['square', 'saw'] as const), duty: 0.4, freq: between(600, 900), seq: [0, pick([3, 5, 7])], seqStep: 0.25, lowpass: 2500, reso: 0.2 })], { loop: true, loopLength: 1, reverb: 0.2, room: 0.5 });
    case 'forceField': {
      const f = between(90, 130);
      return M([rec('force-field'), L({ wave: 'saw', freq: f, lowpass: between(800, 1400), reso: 0.4, wobble: 0.6, wobbleRate: 4, trem: 0.25, tremRate: 8, gain: 0.5, pan: -0.3 }), L({ wave: 'saw', freq: f * 1.01, lowpass: 1000, gain: 0.4, pan: 0.3 })], { level: 'soft', loop: true, loopLength: 2 });
    }
    case 'spaceship': {
      const f = between(45, 65);
      return M([rec('spaceship'), L({ wave: 'sine', freq: f, gain: 0.4 }), L({ wave: 'pink', bandpass: true, lowpass: 2000, reso: 0.6, gain: 0.08, wobble: 1, wobbleRate: 0.25, width: 1 })], { level: 'soft', loop: true, loopLength: 4 });
    }
    case 'water':
      return M([rec('water'), L({ wave: 'crackle', freq: between(150, 300), bandpass: true, lowpass: between(1500, 2500), reso: 0.6, gain: 0.4, width: 1 })], { level: 'soft', loop: true, loopLength: 4 });

    // ---- Nature and places: field recordings (20 s takes), as they were, each variation a
    // different stretch; a touch of width and air so a mono recording opens out ----
    case 'forest':
      return place('forest');
    case 'night':
      return place('night');
    case 'trees':
      return place('trees', { gust: 0.35, gustRate: between(0.12, 0.2) });
    case 'river':
      return place('river');
    case 'ocean':
      return place('waves');
    case 'rainHeavy':
      return place('rain-heavy', {}, 'normal');
    case 'thunderstorm':
      return place('storm', {}, 'normal');
    case 'cave':
      return M([field('cave')], { level: 'soft', loop: true, loopLength: 20, reverb: 0.35, room: 0.85 });
    case 'city':
      return place('city');
    case 'cafe':
      return place('crowd');
    case 'market':
      return place('market');
    case 'thunder':
      // A real clap and its roll, a deep rumble under it, from one side of the sky
      return M([rec('thunder', { freq: 440 * 2 ** (between(-2, 0.5) / 12), hold: 9, pan: between(-0.4, 0.4), width: 0.8 }), L({ wave: 'brown', lowpass: between(90, 140), attack: between(0.05, 0.2), hold: between(0.5, 1.5), decay: between(2.5, 4), gain: 0.5, width: 0.6 })], { level: 'loud', reverb: 0.25, room: 0.9 });

    // ---- Creatures: recorded calls, a little higher or lower each time (another animal) ----
    case 'songbird':
      return M([rec('songbird', { width: 0.3, pan: between(-0.5, 0.5) })], { level: 'soft', reverb: 0.15, room: 0.6 });
    case 'crow':
      return call('crow', 0.25);
    case 'owl':
      return M([rec('owl', { freq: 440 * 2 ** (between(-1, 1) / 12), hold: 5 })], { level: 'soft', reverb: 0.3, room: 0.8 });
    case 'seagull':
      return call('gull', 0.3);
    case 'dog':
      return call('dog', 0.12);
    case 'cat':
      return call('cat', 0.08);
    case 'catPurr':
      return M([field('purr', { width: 0.2 })], { level: 'soft', loop: true, loopLength: 12 });
    case 'wolf':
      return M([rec('wolf', { hold: 9 })], { reverb: 0.35, room: 0.9 });
    case 'frog':
      return call('frog', 0.1);
    case 'horse':
      return call('horse', 0.15);
    case 'cow':
      return call('cow', 0.2);
    case 'rooster':
      return call('rooster', 0.2);
    case 'chicken':
      return call('chicken', 0.1);
    case 'sheep':
      return call('sheep', 0.15);
    case 'pig':
      return call('pig', 0.08);
    case 'bee':
      return M([rec('bee', { pan: -0.5 * (r() < 0.5 ? -1 : 1), panTo: 0.5 * (r() < 0.5 ? -1 : 1) })], { level: 'soft' });
    case 'flies':
      return M([field('flies', { width: 0.6 })], { level: 'soft', loop: true, loopLength: 12 });
    case 'monsterRoar':
      // A beast's roar, deeper than life, with a low growl under it
      return M([rec('roar', { freq: 440 * 2 ** (between(-5, 0) / 12), hold: 5 }), L({ wave: 'brown', lowpass: between(120, 200), attack: 0.05, hold: between(0.4, 0.9), decay: 0.6, trem: 0.5, tremRate: between(18, 30), gain: 0.35 })], { level: 'loud', reverb: 0.2, room: 0.6 });
    case 'zombie':
      return M([rec('groan', { freq: 440 * 2 ** (between(-3, 1) / 12) })], { reverb: 0.2, room: 0.5 });
    case 'goblin':
      return M([rec('goblin', { freq: 440 * 2 ** (between(-1, 3) / 12) })], { reverb: 0.12, room: 0.4 });
    case 'squeak':
      return M([rec('squeak', { freq: 440 * 2 ** (between(-2, 4) / 12) })], { level: 'soft', reverb: 0.08, room: 0.3 });
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
      // (A struck body has a pitch whatever strikes it; a recording's Pitch is its speed)
      if (l.wave === 'rec' || (UNPITCHED.has(l.wave) && !l.body)) return l;
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

/** When a layer ends, seconds from the start (modern: a recording when it runs out, a body once it's rung out). */
function layerEnd(l: SfxLayer, modern = false): number {
  let length = l.attack + l.hold + l.decay;
  if (modern && l.wave === 'rec' && l.rec) {
    const r = recordingFor(l.rec, l.seed);
    length = r ? Math.min(length, r.samples.length / r.sampleRate / recRate(l)) : 0.005;
  }
  if (modern && l.body) length += bodyRing(l.body, l.ring ?? 1);
  return l.delay + length;
}

/** How fast a recording plays (Pitch 440 Hz: as recorded) */
const recRate = (l: SfxLayer) => clamp(l.freq / 440, 0.25, 4);

/** How long the dry sound lasts, seconds (a loop: its length). */
export function dryLength(s: SfxSound): number {
  if (s.loop) return s.loopLength;
  return Math.max(0.005, ...s.layers.filter((l) => l.on).map((l) => layerEnd(l, !!s.modern)));
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

/**
 * One layer through the modern engine, dry and mono (the stereo renderer pans it): band-limited
 * square and saw, a recording as a source, natural (exponential) decays, and the struck body
 * ringing on after the layer's own sound has stopped. `seedXor` gives the right channel of a wide
 * layer its own noise.
 */
function renderLayerModern(l: SfxLayer, s: SfxSound, length: number, sampleRate: number, seedXor = 0): Float32Array {
  const out = new Float32Array(length);
  const noise = rng((l.seed ^ 0x9e3779b9 ^ seedXor) >>> 0);
  const start = Math.round(l.delay * sampleRate);
  let total = s.loop ? s.loopLength : l.attack + l.hold + l.decay;
  const shift = 2 ** (s.pitch / 12);
  const svf = new Svf();
  const filtered = l.lowpass < 19999 || l.lpSweep !== 0 || l.bandpass || l.wobble > 0;
  const rec = l.wave === 'rec' && l.rec ? recordingFor(l.rec, l.seed) : undefined;
  if (l.wave === 'rec' && !rec) return out;
  if (rec && !s.loop) total = Math.min(total, rec.samples.length / rec.sampleRate / (recRate(l) * shift));
  const body = l.body ? new ModalBody(l.body, l.freq * shift, l.ring ?? 1, sampleRate, rng((l.seed * 7 + 3) >>> 0)) : null;
  const bodyMix = l.body ? clamp(l.bodyMix ?? 0.7, 0, 1) : 0;
  const ringFor = l.body && !s.loop ? bodyRing(l.body, l.ring ?? 1) : 0;
  // Gusts: separate gusts at random: random gaps (some close together, some apart), lengths,
  // strengths and shapes (some build slowly, some arrive at once), overlapping where they meet,
  // about `gustRate` a second. Placed from the sound's seed, so its layers gust together as one
  // wind; each layer also flutters a little on its own; in a loop they all go round with it.
  const gust = clamp(l.gust ?? 0, 0, 1);
  const gustRate = clamp(l.gustRate ?? 0.3, 0.02, 4);
  const span = s.loop ? s.loopLength : length / sampleRate;
  const gusts: Array<{ at: number; long: number; strength: number; up: number }> = [];
  if (gust > 0) {
    const gr = rng((s.seed ^ 0x6a09e667) >>> 0);
    for (let at = (gr() * 0.8) / gustRate; at < span; at += (0.2 - Math.log(1 - gr() * 0.95) * 0.75) / gustRate)
      gusts.push({ at, long: (0.4 + gr() * 1.3) / gustRate, strength: 0.35 + gr() * 0.65, up: 0.2 + gr() * 0.45 });
  }
  const gustOne = (t: number, g: { at: number; long: number; strength: number; up: number }) => {
    const x = (t - g.at) / g.long;
    if (x <= 0 || x >= 1) return 0;
    const k = x < g.up ? x / g.up : 1 - (x - g.up) / (1 - g.up);
    return g.strength * k * k * (3 - 2 * k);
  };
  const gustAt = (t: number) => {
    // Overlapping gusts add up softly (two strong ones don't make one twice as strong)
    let quiet = 1;
    for (const g of gusts) {
      quiet *= 1 - gustOne(t, g);
      if (s.loop) quiet *= (1 - gustOne(t + span, g)) * (1 - gustOne(t - span, g));
    }
    return 1 - quiet;
  };
  // The layer's own flutter: quick small changes inside a gust (value noise, round the loop)
  const flutterKnots = gust > 0 ? Float32Array.from({ length: Math.max(4, Math.round(span * 1.7)) }, rng((l.seed ^ 0x3c6ef372) >>> 0)) : null;
  const flutterAt = (t: number) => {
    const n = flutterKnots!.length;
    const x = ((t / span) * n) % n;
    const k = Math.floor(x);
    const w = (1 - Math.cos(Math.PI * (x - k))) / 2;
    return flutterKnots![k] * (1 - w) + flutterKnots![(k + 1) % n] * w;
  };
  const knots = gusts.length ? gusts : null;
  const gustFloor = (1 - gust) * (1 - gust);
  let phase = 0;
  let modPhase = 0;
  let recPos = 0;
  const partials = new Float64Array(METAL_RATIOS.length);
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
    if (!s.loop && t > total + ringFor) break;
    const sounding = s.loop || t <= total;
    let dry = 0;
    if (sounding) {
      const x = Math.min(1, t / Math.max(1e-6, total));
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
      const dt = f / sampleRate;
      phase = (phase + dt) % 1;
      let v: number;
      switch (l.wave) {
        case 'rec': {
          // The recording at its speed (and the sound's pitch and slide), read between samples
          const len = rec!.samples.length;
          const p = s.loop ? recPos % len : recPos;
          const k = Math.floor(p);
          const a = rec!.samples[k] ?? 0;
          const b = rec!.samples[s.loop ? (k + 1) % len : k + 1] ?? 0;
          v = a + (b - a) * (p - k);
          recPos += (rec!.sampleRate / sampleRate) * recRate(l) * shift * Math.pow(2, semis / 12);
          break;
        }
        case 'square': {
          v = phase < l.duty ? 1 : -1;
          v += polyBlep(phase, dt) - polyBlep((phase - l.duty + 1) % 1, dt);
          break;
        }
        case 'saw':
          v = 2 * phase - 1 - polyBlep(phase, dt);
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
            const fade = s.loop ? 1 : Math.exp(-t * (2 + k * 6));
            v += METAL_LEVELS[k] * fade * Math.sin(2 * Math.PI * partials[k]);
          }
          v *= 0.6;
          break;
        }
        case 'pink': {
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
          if (noise() < f / sampleRate) pop = (noise() * 2 - 1) * (0.4 + 0.6 * noise());
          v = pop;
          pop *= 0.92;
          break;
        default:
          // (The 8-bit noise has no place in a modern sound: plain white noise)
          v = noise() * 2 - 1;
      }
      const g = knots ? gustAt(s.loop ? t % span : t) : 0;
      if (filtered) {
        if ((i - start) % 8 === 0) {
          const move = !l.wobble ? 0 : knots ? l.wobble * (g * 2 - 1) : l.wobble * Math.sin(2 * Math.PI * l.wobbleRate * t);
          svf.set(l.lowpass * Math.pow(2, l.lpSweep * (s.loop ? 0 : x) + move), l.reso, sampleRate);
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
      // A gust brings the layer in and takes it away again; between gusts, a lull (as quiet as Gusts
      // asks); a little flutter of the layer's own
      if (knots) v *= (gustFloor + (1 - gustFloor) * g) * (0.82 + 0.36 * flutterAt(s.loop ? t % span : t));
      // Envelope: attack, hold (punch fading over it), then a natural decay to -60 dB
      let env: number;
      if (s.loop) env = 1;
      else if (t < l.attack) env = t / l.attack;
      else if (t < l.attack + l.hold) env = 1 + l.punch * (1 - (t - l.attack) / Math.max(1e-6, l.hold));
      else {
        const u = Math.min(1, (t - l.attack - l.hold) / Math.max(1e-6, l.decay));
        // (Exponential, eased to zero over the last tenth so it ends without a step)
        env = Math.exp(-6.9 * u) * Math.min(1, (1 - u) * 10);
      }
      // A recording ends on its own: a short fade where the layer cuts it off early
      if (rec && !s.loop) env *= Math.min(1, (total - t) * 200);
      if (l.trem) env *= 1 - l.trem * (0.5 + 0.5 * Math.sin(2 * Math.PI * l.tremRate * t));
      dry = v * env * l.gain;
    }
    out[i] = body ? dry * (1 - bodyMix) + body.run(dry) * bodyMix * 2 : dry;
  }
  return out;
}

/** The sound through the modern engine: [left, right], dry (the space is added after). */
function modernDry(s: SfxSound, length: number, sampleRate: number, loop: boolean): [Float32Array, Float32Array] {
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  for (const l of s.layers.filter((x) => x.on)) {
    const layer = loop ? { ...l, delay: 0 } : l;
    const a = renderLayerModern(layer, s, length, sampleRate);
    const width = clamp(l.width ?? 0, 0, 1);
    const b = width > 0 ? renderLayerModern(layer, s, length, sampleRate, 0x5bd1e995) : a;
    const p0 = clamp(l.pan ?? 0, -1, 1);
    const p1 = clamp(l.panTo ?? p0, -1, 1);
    const start = Math.round(layer.delay * sampleRate);
    const span = Math.max(1, Math.round((layerEnd(layer, true) - layer.delay) * sampleRate));
    for (let i = start; i < length; i++) {
      const va = a[i];
      const vb = b[i];
      if (va === 0 && vb === 0) continue;
      const p = loop ? p0 : p0 + (p1 - p0) * Math.min(1, (i - start) / span);
      // Equal-power pan; a wide layer's right side its own noise
      const angle = ((p + 1) * Math.PI) / 4;
      L[i] += va * Math.cos(angle) * Math.SQRT2;
      R[i] += (va * (1 - width) + vb * width) * Math.sin(angle) * Math.SQRT2;
    }
  }
  return [L, R];
}

/** Soft clipping over a channel, as Drive does in the classic engine */
function driveChannel(x: Float32Array, drive: number): void {
  if (drive <= 0) return;
  const g = 1 + drive * 8;
  const norm = Math.tanh(g);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * g) / norm;
}

/** The modern engine's render: stereo, trimmed, faded and levelled as renderSfx does mono. */
function renderModern(s: SfxSound, sampleRate: number): [Float32Array, Float32Array] {
  let L: Float32Array;
  let R: Float32Array;
  const space = { echo: s.echo, echoTime: s.echoTime, echoFeedback: s.echoFeedback, reverb: s.reverb, room: s.room };
  if (s.loop) {
    const len = Math.max(1, Math.round(s.loopLength * sampleRate));
    const xf = Math.min(Math.round(len / 4), Math.round(0.3 * sampleRate));
    const [dl, dr] = modernDry(s, len + xf, sampleRate, true);
    const fold = (dry: Float32Array) => {
      const loop = dry.slice(0, len);
      for (let i = 0; i < xf; i++) {
        const a = i / xf;
        loop[i] = dry[len + i] * Math.cos((a * Math.PI) / 2) + dry[i] * Math.sin((a * Math.PI) / 2);
      }
      const twice = new Float32Array(len * 2);
      twice.set(loop, 0);
      twice.set(loop, len);
      driveChannel(twice, s.drive);
      return twice;
    };
    const tl = fold(dl);
    const tr = fold(dr);
    stereoSpace(tl, tr, space, sampleRate);
    L = tl.slice(len);
    R = tr.slice(len);
  } else {
    const length = Math.max(1, Math.round(sfxLength(s) * sampleRate));
    [L, R] = modernDry(s, length, sampleRate, false);
    driveChannel(L, s.drive);
    driveChannel(R, s.drive);
    stereoSpace(L, R, space, sampleRate);
    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    let end = L.length;
    while (end > 1 && Math.abs(L[end - 1]) < peak * 0.002 && Math.abs(R[end - 1]) < peak * 0.002) end--;
    const keep = Math.min(L.length, end + Math.round(0.005 * sampleRate));
    L = L.slice(0, keep);
    R = R.slice(0, keep);
    const fade = Math.min(keep >> 1, Math.round(0.002 * sampleRate));
    for (const x of [L, R])
      for (let i = 0; i < fade; i++) {
        x[i] *= i / fade;
        x[x.length - 1 - i] *= i / fade;
      }
  }
  // Level: a one-shot's loudest 50 ms to the level's loudness; a loop (ambience, there the whole
  // time) its loudest second, much lower, so even its strongest gust sits under the game instead
  // of over it. The peak stays under the ceiling.
  const mid = new Float32Array(L.length);
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    mid[i] = Math.sqrt((L[i] * L[i] + R[i] * R[i]) / 2);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const rms = s.loop ? loudestRms(mid, sampleRate, 1) : loudestRms(mid, sampleRate);
  const target = s.loop ? LOOP_DB[s.level] : LEVEL_DB[s.level];
  if (peak > 0 && rms > 0) {
    const gain = Math.min(10 ** (target / 20) / rms, SFX_CEILING / peak) * clamp(s.volume, 0, 1);
    for (let i = 0; i < L.length; i++) {
      L[i] *= gain;
      R[i] *= gain;
    }
  }
  return [L, R];
}

/**
 * The sound as channels: a classic sound mono ([one]), a modern one stereo ([left, right]). What
 * exports use; renderSfx is the mono mix of it.
 */
export function renderSfxStereo(s: SfxSound, sampleRate = 44100): Float32Array[] {
  return s.modern ? renderModern(s, sampleRate) : [renderSfx(s, sampleRate)];
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
/** A modern loop's average loudness (RMS, dBFS): ambience sits well under music and dialogue */
const LOOP_DB: Record<SfxLevel, number> = { soft: -36, normal: -32, loud: -28 };
/** The highest a sample goes: -1 dBFS */
export const SFX_CEILING = 0.89;

/** RMS of the loudest `seconds` (50 ms unless given). */
function loudestRms(x: Float32Array, sampleRate: number, seconds = 0.05): number {
  const win = Math.max(1, Math.round(seconds * sampleRate));
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
  if (s.modern) {
    const [L, R] = renderModern(s, sampleRate);
    const mono = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
    return mono;
  }
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

/** A WAV of `channels` (mono or stereo) at `bits` (16 or 24); a loop gets a 'smpl' chunk marking the whole file. */
export function sfxWavChannels(channels: Float32Array[], sampleRate = 44100, loop = false, bits: 16 | 24 = 24): Uint8Array {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const bytesPer = bits / 8;
  const smpl = loop ? loopChunk(sampleRate, 0, n) : new Uint8Array(0);
  const data = n * ch * bytesPer;
  const bytes = new Uint8Array(44 + data + smpl.length);
  const view = new DataView(bytes.buffer);
  const text = (at: number, t: string) => [...t].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + data + smpl.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * ch * bytesPer, true);
  view.setUint16(32, ch * bytesPer, true);
  view.setUint16(34, bits, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  const full = bits === 24 ? 8388607 : 32767;
  let at = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.round(clamp(channels[c][i], -1, 1) * full);
      if (bits === 24) {
        view.setUint8(at, v & 0xff);
        view.setUint8(at + 1, (v >> 8) & 0xff);
        view.setUint8(at + 2, (v >> 16) & 0xff);
      } else view.setInt16(at, v, true);
      at += bytesPer;
    }
  bytes.set(smpl, 44 + data);
  return bytes;
}

/** The file for a sound: a classic one 16-bit mono, as before; a modern one 24-bit stereo. */
export function sfxFile(s: SfxSound, sampleRate = 44100): Uint8Array {
  return s.modern ? sfxWavChannels(renderSfxStereo(s, sampleRate), sampleRate, s.loop, 24) : sfxWav(renderSfx(s, sampleRate), sampleRate, s.loop);
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
      ...(typeof l.rec === 'string' && /^[a-z0-9-]{1,40}$/.test(l.rec) ? { rec: l.rec } : {}),
      ...(SFX_MATERIALS.includes(l.body as SfxMaterial) ? { body: l.body as SfxMaterial, ring: num(l.ring, 1, 0.2, 3), bodyMix: num(l.bodyMix, 0.7, 0, 1) } : {}),
      ...(typeof l.pan === 'number' ? { pan: num(l.pan, 0, -1, 1) } : {}),
      ...(typeof l.panTo === 'number' ? { panTo: num(l.panTo, 0, -1, 1) } : {}),
      ...(typeof l.width === 'number' ? { width: num(l.width, 0, 0, 1) } : {}),
      ...(typeof l.gust === 'number' ? { gust: num(l.gust, 0, 0, 1), gustRate: num(l.gustRate, 0.3, 0.02, 4) } : {}),
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
    ...(o.modern === true ? { modern: true } : {}),
  };
}
