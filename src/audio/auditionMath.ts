/** The plain arithmetic of hearing a stretch of a song (listen.ts) and a suggestion before and after (auditionPlayer.ts). */
import { barToSeconds, secondsToBar, type Tempo, type TempoPoint } from './tempoMap';
import { durationToBars, type Clip, type NoteEvent, type Track } from '../store/timelineTypes';
import { audibleIds } from '../store/buses';
import { sustainNotes } from '../store/expression';

/**
 * The notes of a clip that sound, each with how long it sounds (bars), as the scheduler plays
 * them (scheduler.ts groupClipNotes): notes hidden by a trim (starting before the clip's start
 * or at or past its end) left out, and each held by the clip's sustain pedal until it's let up.
 * (Chance and conditions are left to the render: a held note begun again keeps where it really
 * begins, so it plays on the same passes. A feel or swing moves notes by less than a 16th.)
 */
export function soundingNotes(c: Pick<Clip, 'notes' | 'lengthBars' | 'expression'>): Array<{ note: NoteEvent; bars: number }> {
  const out: Array<{ note: NoteEvent; bars: number }> = [];
  for (const note of c.notes ?? []) {
    if (!(note.startOffset >= -1e-6 && note.startOffset < c.lengthBars - 1e-6)) continue;
    const [held] = sustainNotes([note], c.expression?.sustain, c.lengthBars);
    out.push({ note, bars: durationToBars(held.duration) });
  }
  return out;
}

/**
 * Where in `to`'s loop the music is when `from`'s loop has played `elapsed` seconds: the same bar
 * (and part of a bar) of the range, by each side's own tempo.
 */
export function sameBarOffset(elapsed: number, fromBar: number, from: { tempo: Tempo; seconds: number }, to: { tempo: Tempo; seconds: number }): number {
  const into = from.seconds > 0 ? ((elapsed % from.seconds) + from.seconds) % from.seconds : 0;
  const bar = secondsToBar(barToSeconds(fromBar, from.tempo) + into, from.tempo);
  const at = barToSeconds(bar, to.tempo) - barToSeconds(fromBar, to.tempo);
  return Math.max(0, Math.min(Math.max(0, to.seconds - 0.001), at));
}

/** The longest run-in rendered before a range: bars, and seconds. */
export const PRE_ROLL_MAX_BARS = 8;
export const PRE_ROLL_MAX_SECONDS = 20;

/**
 * Where to start rendering to hear bars from `fromBar` as they sound in the song: the start of the
 * earliest note still sounding at `fromBar` (a held pad, a long bass note), at most
 * PRE_ROLL_MAX_BARS and PRE_ROLL_MAX_SECONDS earlier; `fromBar` itself if nothing is held over.
 */
export function preRollStart(song: { tracks: Track[]; clips: readonly Clip[]; bpm: number; tempoPoints?: readonly TempoPoint[] }, fromBar: number): number {
  const ids = audibleIds(song.tracks);
  let start = fromBar;
  for (const c of song.clips) {
    if (!ids.has(c.trackId) || c.startBar >= fromBar || c.startBar + c.lengthBars <= fromBar) continue;
    for (const { note, bars } of soundingNotes(c)) {
      const at = c.startBar + note.startOffset;
      if (at < start && at + bars > fromBar) start = at;
    }
  }
  if (start >= fromBar) return fromBar;
  const tempo = { bpm: song.bpm, points: [...(song.tempoPoints ?? [])] };
  const bySeconds = secondsToBar(Math.max(0, barToSeconds(fromBar, tempo) - PRE_ROLL_MAX_SECONDS), tempo);
  return Math.max(1, start, fromBar - PRE_ROLL_MAX_BARS, bySeconds);
}

/** Tone ticks in a bar (4/4), for writing a length in bars as a duration ("384i"). */
const TICKS_PER_BAR = 768;

/**
 * `clips` with every note held over bar `at` (begun before it) and still sounding at `fromBar`
 * begun again at `at` for what's left of it: rendered from `at`, a drone or pad held from long
 * before (longer than any run-in) still sounds, its attack inside the run-in that's trimmed away.
 * A note over before `fromBar` (a cymbal's tail) isn't struck again. Each keeps where it really
 * begins (`heldFrom`), so its Human drift, chance and accent are its own. The same array if no
 * note is held over.
 */
export function restartHeldNotes(clips: readonly Clip[], at: number, fromBar: number): Clip[] {
  const eps = 1e-6;
  let changed = false;
  const out = clips.map((c) => {
    const clipEnd = c.startBar + c.lengthBars;
    if (c.startBar >= at || clipEnd <= at || !c.notes?.length) return c;
    let held = false;
    // (as the scheduler hears them: a note hidden by a trim stays as it is, and doesn't play; the
    // sustain pedal's hold counts, and the note begun again ends where the pedal lets it go)
    const sounding = new Map(soundingNotes(c).map((x) => [x.note, x.bars]));
    const notes = c.notes.map((n) => {
      const bars = sounding.get(n);
      if (bars === undefined) return n;
      const start = c.startBar + n.startOffset;
      const end = Math.min(clipEnd, start + bars);
      if (start >= at - eps || end <= fromBar + eps) return n;
      held = true;
      return { ...n, startOffset: at - c.startBar, duration: `${Math.max(1, Math.round((end - at) * TICKS_PER_BAR))}i`, heldFrom: n.heldFrom ?? start };
    });
    if (!held) return c;
    changed = true;
    return { ...c, notes };
  });
  return changed ? out : (clips as Clip[]);
}
