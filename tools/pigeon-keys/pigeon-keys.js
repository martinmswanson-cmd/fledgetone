// Pigeons on the keys. Part of Fledgetone (https://fledgetone.com), © Martin Swanson, MIT licence.
// Source code: https://github.com/martinmswanson-cmd/fledgetone
//
// Draws a song as low-poly pigeons playing a big piano keyboard, on a canvas (WebGL): give it the
// notes once, then ask for the picture at any time. Every picture is drawn from the time alone, so
// you can draw frames in any order: along with playing audio, while scrubbing, or one by one for a
// video. No two pigeons ever touch.
import { PigeonScene, PIGEON_BACKGROUNDS, PIGEON_CAMERAS, everyBars } from './pigeon-scene.js';

// The backgrounds and camera angles there are ({ id, name, blurb, ... } each), and the times of
// every Nth bar line: everyBars(barTimes, n), for backgroundAt and cameraAt
export { PIGEON_BACKGROUNDS, PIGEON_CAMERAS, everyBars };

/** The colours tracks get when they aren't given their own */
export const TRACK_COLORS = ['#a855f7', '#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#ec4899'];

const number = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Make the pigeons of `song` for `canvas`.
 *
 * canvas         A canvas nothing has drawn on yet (it's given a WebGL context).
 * song.notes     [{ start, end, pitch, track?, drum? }]: seconds, a MIDI note number (60 is middle
 *                C), and which track (an index into song.tracks; 0 if left out). Notes with
 *                `drum: true` are left out: the birds play pitched notes.
 * song.tracks    The tracks, for the colour their keys light up in: a CSS colour each, or
 *                { color } (optional; TRACK_COLORS in turn if left out).
 * song.duration  The song's length in seconds (if left out: when the last note ends).
 *
 * options.shape         'tall' (the keys run up the canvas), 'wide' (across it), or 'auto': tall
 *                       when the canvas is taller than it's wide ('auto' if left out).
 * options.backgrounds   The backgrounds to use, by id, in the order they appear: 'plaza', 'park',
 *                       'sunset', 'night', 'snow', 'space', 'neon', 'clouds', 'beach' (['plaza']
 *                       if left out; PIGEON_BACKGROUNDS lists them).
 * options.backgroundAt  When it changes to the next background, in seconds (round and round the
 *                       list, each fading into the next). Never, if left out.
 * options.cameras       The camera angles to use, by id, in order: 'diagonal', 'above', 'low',
 *                       'behind', 'close' (['diagonal'] if left out; PIGEON_CAMERAS lists them).
 * options.cameraAt      When it cuts to the next angle, in seconds. Never, if left out.
 * options.floor         A floor colour of your own (any CSS colour) in place of the backgrounds'.
 * options.across        How many white keys fit across the canvas's narrow side at the closest
 *                       the camera comes (each angle has its own, about 16): a smaller number
 *                       makes everything bigger.
 * options.centerY       Where the keyboard's middle sits, from the top of the canvas, 0 to 1 (0.5).
 */
export function createPigeons(canvas, song, options = {}) {
  const colors = (Array.isArray(song.tracks) ? song.tracks : []).map((t, i) => (typeof t === 'string' ? t : t && typeof t.color === 'string' ? t.color : TRACK_COLORS[i % TRACK_COLORS.length]));
  const notes = [];
  let lastEnd = 0;
  for (const n of song.notes ?? []) {
    const start = number(n.start, NaN);
    const end = Math.max(number(n.end, start), start + 0.01);
    const midi = Math.round(number(n.pitch, NaN));
    const track = Math.max(0, Math.floor(number(n.track, 0)));
    if (!Number.isFinite(start) || !Number.isFinite(midi) || midi < 0 || midi > 127 || n.drum) continue;
    notes.push({ start, end, midi, track, color: colors[track] ?? TRACK_COLORS[track % TRACK_COLORS.length], drum: false });
    if (end > lastEnd) lastEnd = end;
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const duration = number(song.duration, lastEnd);
  const isTall = () => (options.shape === 'tall' ? true : options.shape === 'wide' ? false : canvas.height > canvas.width);
  let width = canvas.width;
  let height = canvas.height;
  let tall = isTall();
  const look = { backgrounds: options.backgrounds, backgroundAt: options.backgroundAt, cameras: options.cameras, cameraAt: options.cameraAt };
  const scene = new PigeonScene({ notes, tracks: [], bars: [] }, { canvas, width, height, tall, across: options.across, centerY: options.centerY, floor: options.floor, look });

  return {
    duration,
    /** Draw the picture at `time` (seconds from the song's start), at the size the canvas has now */
    draw(time) {
      if (canvas.width !== width || canvas.height !== height || isTall() !== tall) {
        width = canvas.width;
        height = canvas.height;
        tall = isTall();
        scene.frame(width, height, tall);
      }
      scene.render(number(time, 0));
    },
    /** How many pigeons are standing on a key, playing it, at `time` */
    onKeys(time) {
      return scene.onKeys(number(time, 0));
    },
    /** Change the backgrounds or camera angles, or when they change ({ backgrounds, backgroundAt, cameras, cameraAt }: only what you give); the next draw uses them */
    setLook(changes) {
      scene.setLook(changes);
    },
    /** Whether the floor is dark at `time` (to choose a colour for anything you draw over it) */
    isDark(time) {
      return scene.darkAt(number(time, 0));
    },
    /** A floor colour of your own in place of the backgrounds' (null: theirs again); the next draw uses it */
    setFloor(color) {
      scene.setFloor(color);
    },
    /** Let go of the WebGL context and everything made for it (the canvas can't be drawn on again) */
    dispose() {
      scene.dispose();
    },
  };
}
