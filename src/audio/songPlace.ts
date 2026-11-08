/**
 * Where in the song a note plays, for what's picked for it by a hash: a recorded hit's level, a
 * drum's detune, the Synth Designer's drift, a strum, a section's spread, a vibrato, and where in
 * its noise a burst starts (noteJitter here, seededNoise.ts noiseStart). For a song's note that's
 * its place in the song, the same live and in every export; for a note played by hand, its time
 * on the audio clock. Plain logic, no Web Audio, so Node's tests cover it.
 *
 * A note's place is seconds from the start of bar 1 along the tempo map to where it plays (its
 * swing, row shift and Human lateness in it), as the scheduler works it out from its tick, live
 * and in a render alike. So a note sounds the same wherever playback began, after a pause, on
 * every pass of a loop, and in every export (the whole song or a range, at any sample rate, a
 * stem or a part of one). Before, the hash took the audio clock's time, which no two plays share
 * and a render's clock never shares with the live one: a recorded hat's level came out up to
 * about 1.5 dB apart, hit by hit, live and in the file (an Expressive kit's up to 4 dB), and a
 * drum's noise was another stretch of noise.
 *
 * A note played by hand (a key, a pad, MIDI, note repeat, a preview) has no place in the song: it
 * keeps its time on the audio clock, so no two presses are quite alike, as a player's aren't.
 */

/** The song's note being played now: the audio time it was asked for, and its place. */
let playing: { at: number; place: number } | null = null;

/**
 * Play (build) a note of the song asked for audio time `at` whose place in the song is `place`
 * (seconds from bar 1), so what's hashed for it is picked by its place (see placeOf).
 */
export function atSongPlace<T>(at: number, place: number, play: () => T): T {
  const was = playing;
  playing = { at, place };
  try {
    return play();
  } finally {
    playing = was;
  }
}

/**
 * The time to hash for something starting at audio time `time`: while a song's note is played
 * (atSongPlace), its place plus how far after the note's time `time` is (a strummed string's or a
 * clap's later slap keeps its own); else `time` itself (a note played by hand).
 */
export function placeOf(time: number): number {
  return playing ? playing.place + (time - playing.at) : time;
}

/**
 * Build a song's note that has been moved `by` seconds later than it was asked for (struck live
 * once the page had been held up past it: native.ts strikeLive), its times still counted from
 * where it was asked for, so it's picked as it would have been on time.
 */
export function struckLater<T>(by: number, build: () => T): T {
  if (!playing || !(by > 0)) return build();
  const was = playing;
  playing = { at: was.at + by, place: was.place };
  try {
    return build();
  } finally {
    playing = was;
  }
}

/**
 * A number from -1 to 1 for `note` at `time` (audio time; see placeOf), the same every time:
 * `salt` picks which of a note's differences it is.
 */
export function noteJitter(note: string, time: number, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  const text = `${note}@${Math.round(placeOf(time) * 1000)}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
