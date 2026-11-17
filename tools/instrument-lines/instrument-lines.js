// Instrument lines. Part of Fledgetone (https://fledgetone.com), © Martin Swanson, MIT licence.
// Source code: https://github.com/martinmswanson-cmd/fledgetone
//
// Draws a song as one glowing line per instrument on a canvas: give it the notes once, then ask
// for the picture at any time. Every picture is drawn from the time alone, so you can draw frames
// in any order: along with playing audio, while scrubbing, or one by one for a video.
import { drawLines, linesData, DEFAULT_LINES_LOOK } from './lines-draw.js';

export { DEFAULT_LINES_LOOK };

const number = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Make the lines of `song` for `canvas`.
 *
 * song.notes     [{ start, end, pitch, track, drum?, kick? }]: seconds, a MIDI note number (60 is
 *                middle C), and which track (an index into song.tracks). `drum: true` puts a hit
 *                in the drum row instead of on a line; `kick: true` draws it fat and flashes.
 * song.tracks    The tracks' names, shown beside their dots (optional).
 * song.bars      When each bar line falls, in seconds (optional).
 * song.sections  [{ at, name }]: the song's sections, for the song map and the section's name (optional).
 * song.chords    [{ at, end, name }]: chord names to show (optional; this doesn't work chords out).
 * song.duration  The song's length in seconds (if left out: when the last note ends).
 *
 * options.look         { map, chord, drums, rings, ahead }: which extras to draw (all, if left out).
 * options.section      Draw the section's name (true if left out).
 * options.secondsShown How many seconds of the song the picture is wide (11, or 6 on a tall canvas).
 * options.headAt       Where "now" is across the picture, 0 to 1 (0.7, or 0.6 on a tall canvas).
 * options.background   A CSS colour painted behind the lines, or null to leave the canvas as it is
 *                      (to draw over your own background). '#0a0b10' if left out.
 * options.unitsWide    The lines are designed 1280 units wide (720 on a tall canvas): a smaller
 *                      number makes everything bigger.
 * options.padding      Room left around the picture, in those units (40 if left out).
 */
export function createLines(canvas, song, options = {}) {
  const g = canvas.getContext('2d');
  if (!g) throw new Error('createLines needs a canvas with a 2d context');
  const names = Array.isArray(song.tracks) ? song.tracks.map(String) : [];
  const notes = [];
  let lastEnd = 0;
  for (const n of song.notes ?? []) {
    const start = number(n.start, NaN);
    const end = Math.max(number(n.end, start), start + 0.01);
    const midi = number(n.pitch, NaN);
    const track = Math.max(0, Math.floor(number(n.track, 0)));
    if (!Number.isFinite(start) || !Number.isFinite(midi)) continue;
    notes.push({ start, end, midi, track, color: '', drum: !!(n.drum || n.kick), ...(n.kick ? { kick: true } : {}) });
    while (names.length <= track) names.push('');
    if (end > lastEnd) lastEnd = end;
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const data = linesData({ notes, tracks: names.map((name) => ({ name, color: '' })), bars: [...(song.bars ?? [])].sort((a, b) => a - b), low: 60, high: 72, drumRows: [] });
  const sections = [...(song.sections ?? [])].map((s) => ({ at: number(s.at, 0), name: String(s.name ?? '') })).sort((a, b) => a.at - b.at);
  const chords = [...(song.chords ?? [])].map((c) => ({ at: number(c.at, 0), end: number(c.end, 0), name: String(c.name ?? '') })).filter((c) => c.end > c.at && c.name).sort((a, b) => a.at - b.at);
  const duration = number(song.duration, lastEnd);
  let opts = { ...options };

  return {
    /** The lines' own data (each track's runs), if you want to read it */
    data,
    duration,
    /** Change options (the same ones createLines takes); the next draw uses them */
    set(changes) {
      opts = { ...opts, ...changes };
    },
    /** Draw the picture at `time` (seconds from the song's start), filling the canvas at its current size */
    draw(time) {
      const tall = canvas.height > canvas.width;
      const units = number(opts.unitsWide, tall ? 720 : 1280);
      const scale = canvas.width / units;
      const pad = number(opts.padding, 40);
      const background = opts.background === undefined ? '#0a0b10' : opts.background;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (background) {
        g.fillStyle = background;
        g.fillRect(0, 0, canvas.width, canvas.height);
      }
      g.setTransform(scale, 0, 0, scale, 0, 0);
      drawLines(g, data, { x: pad, y: pad, w: units - 2 * pad, h: canvas.height / scale - 2 * pad }, number(time, 0), {
        secondsShown: number(opts.secondsShown, tall ? 6 : 11),
        headAt: number(opts.headAt, tall ? 0.6 : 0.7),
        look: { ...DEFAULT_LINES_LOOK, ...(opts.look ?? {}) },
        section: opts.section !== false,
        sections,
        chords,
        duration,
      });
      g.restore();
    },
  };
}
