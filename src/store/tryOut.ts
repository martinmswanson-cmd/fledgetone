/**
 * The game preview's wiring: which of the song's states, stingers and sound effects each moment of
 * the little game plays (calm, fight, victory; a coin, a hit, a footstep), guessed from their names
 * and kinds so a song usually works with no setup, and changed in the preview's panel. Also the
 * enemy's distance-to-intensity rule. No audio, three.js or store here, so Node can unit-test it.
 */

/** What the preview needs from a game kit's manifest. */
export interface TryOutSong {
  states: ReadonlyArray<{ name: string }>;
  stingers: ReadonlyArray<{ name: string; kind: string }>;
  sfx?: ReadonlyArray<{ name: string; loop: boolean }>;
}

/** Each game moment and what it plays ('' plays nothing; a sound effect falls back to the preview's own). */
export interface TryOutMap {
  /** States: exploring, an enemy chasing, the enemy beaten */
  calm: string;
  fight: string;
  win: string;
  /** Stingers */
  coinStinger: string;
  winStinger: string;
  loseStinger: string;
  /** Sound effects */
  coinSfx: string;
  stepSfx: string;
  hurtSfx: string;
  jumpSfx: string;
  bonkSfx: string;
}

export const TRY_OUT_MOMENTS: ReadonlyArray<{ key: keyof TryOutMap; label: string; what: 'state' | 'stinger' | 'sfx' }> = [
  { key: 'calm', label: 'Exploring', what: 'state' },
  { key: 'fight', label: 'Enemy chasing', what: 'state' },
  { key: 'win', label: 'Enemy beaten', what: 'state' },
  { key: 'coinStinger', label: 'Coin (stinger)', what: 'stinger' },
  { key: 'winStinger', label: 'Win (stinger)', what: 'stinger' },
  { key: 'loseStinger', label: 'Lose (stinger)', what: 'stinger' },
  { key: 'coinSfx', label: 'Coin (sound)', what: 'sfx' },
  { key: 'stepSfx', label: 'Footstep', what: 'sfx' },
  { key: 'jumpSfx', label: 'Jump', what: 'sfx' },
  { key: 'hurtSfx', label: 'Hurt', what: 'sfx' },
  { key: 'bonkSfx', label: 'Bonk the enemy', what: 'sfx' },
];

const CALM = /explor|calm|day|sneak|town|village|title|menu|level|browse|think|race|intro|verse|ambient|peace|idle/i;
const FIGHT = /fight|battle|combat|danger|ambush|alert|spotted|chase|boss|phase|attack|final|drop|chorus|almost|bargain|underground/i;
const WIN = /victor|win|defeat|clear|complete|finale|outro|end/i;

/** The first name matching `re` that isn't taken, else the `fallback`-th one, else ''. */
function pick(names: readonly string[], re: RegExp | null, fallback: number, taken: ReadonlyArray<string> = []): string {
  const free = names.filter((n) => !taken.includes(n));
  return (re && free.find((n) => re.test(n))) ?? free[Math.min(fallback, free.length - 1)] ?? names[0] ?? '';
}

/** A good first guess for each moment, from the song's names and stinger kinds. */
export function guessTryOutMap(song: TryOutSong): TryOutMap {
  const states = song.states.map((s) => s.name);
  const calm = pick(states, CALM, 0);
  const fight = pick(states, FIGHT, 0, [calm]);
  // Winning gets its own state only when there's one that sounds like it
  const win = states.find((n) => WIN.test(n) && n !== calm && n !== fight) ?? '';
  const stinger = (kinds: string[], re: RegExp) => song.stingers.find((s) => kinds.includes(s.kind))?.name ?? song.stingers.find((s) => re.test(s.name))?.name ?? '';
  const sfx = (re: RegExp) => song.sfx?.find((s) => !s.loop && re.test(s.name))?.name ?? '';
  return {
    calm,
    fight: fight === calm ? '' : fight,
    win,
    coinStinger: stinger(['item'], /item|coin|pickup|collect/i),
    winStinger: stinger(['victory', 'levelUp'], /victor|win|level/i),
    loseStinger: stinger(['gameOver'], /game.?over|lose|death|fail/i),
    coinSfx: sfx(/coin|gem|pickup|collect|purchase/i),
    stepSfx: sfx(/step|foot|walk/i),
    hurtSfx: sfx(/hurt|hit|damage|punch|ouch/i),
    jumpSfx: sfx(/jump|hop/i),
    bonkSfx: sfx(/bonk|bounce|boing|impact|slash|sword|hit/i),
  };
}

/**
 * How intense the music is with the enemy `distance` away: a floor while exploring, rising as it
 * closes in from `notice` to `touch` (straight in between), 1 when it's on you.
 */
export function intensityFor(distance: number, chasing: boolean, notice = 7, touch = 1.2, floor = 0.3): number {
  if (!chasing) return floor;
  const x = (notice - distance) / (notice - touch);
  return Math.max(floor, Math.min(1, floor + (1 - floor) * x));
}
