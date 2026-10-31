/** The plain arithmetic of hearing a stretch of a song (listen.ts) and a suggestion before and after (auditionPlayer.ts). */
import { barToSeconds, secondsToBar, type Tempo, type TempoPoint } from './tempoMap';
import { durationToBars, type Clip, type NoteEvent, type Track } from '../store/timelineTypes';
import { audibleIds } from '../store/buses';
import { sustainNotes } from '../store/expression';
import { HELD_CLIP, keepContentKey } from '../store/noteChance';
import { INSTRUMENTS } from './instrumentCatalog';

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

/**
 * Where a clip stops sounding (a song bar, before any release or effect tail): its end, or later
 * where a note begun in it runs on past its end. A note that starts inside a clip plays its whole
 * length, live and in an export (the scheduler plays it so, as the Drop pad's moves do), so every
 * end the studio works out (where the music ends, where a change is heard, the run-in, how long an
 * export rings out) counts that overhang too.
 */
export function clipSoundEnd(c: Pick<Clip, 'startBar' | 'lengthBars'> & Partial<Pick<Clip, 'notes' | 'expression'>>): number {
  let end = c.startBar + c.lengthBars;
  if (!c.notes?.length) return end;
  for (const { note, bars } of soundingNotes({ notes: c.notes, lengthBars: c.lengthBars, expression: c.expression })) end = Math.max(end, c.startBar + note.startOffset + bars);
  return end;
}

/** Where the music ends: the last clip of a track that sounds, or a note of one running on past it (clipSoundEnd; at least bar 2). */
export function musicEnd(song: { tracks: Track[]; clips: ReadonlyArray<Pick<Clip, 'trackId' | 'startBar' | 'lengthBars'> & Partial<Pick<Clip, 'notes' | 'expression'>>> }): number {
  const ids = audibleIds(song.tracks);
  return Math.max(2, ...song.clips.filter((c) => ids.has(c.trackId)).map(clipSoundEnd));
}

/** The longest run-in rendered before a range: bars, and seconds. */
export const PRE_ROLL_MAX_BARS = 8;
export const PRE_ROLL_MAX_SECONDS = 20;

/**
 * How long a note of `track` rings on after it ends (seconds): a recorded instrument's ring as the
 * track sets it, else its recordings' release, else RELEASE_ALLOWANCE_SECONDS (a synth's release,
 * a plugin's: not known here).
 */
export const RELEASE_ALLOWANCE_SECONDS = 2;
export function releaseSeconds(track: Pick<Track, 'instrumentKey' | 'ring'> | undefined): number {
  const samples = track ? INSTRUMENTS[track.instrumentKey]?.samples : undefined;
  const release = samples ? (track?.ring ?? samples.release) : undefined;
  return typeof release === 'number' && release >= 0 ? release : RELEASE_ALLOWANCE_SECONDS;
}

/**
 * How long a let-go note of `track` with its own bend keeps that bend, on an instrument that bends
 * as a whole (seconds): a recorded instrument's release as the track sets it (and a little more); a
 * synth's or a plugin's isn't known, so long enough for the longest (going back later is never
 * heard: its next note goes back first). Live (an MPE note let go, liveInput.ts) and in the song
 * (scheduler.ts) alike.
 */
export const UNKNOWN_BEND_TAIL_SECONDS = 8;
export function bendTailSeconds(track: Pick<Track, 'instrumentKey' | 'ring'> | undefined): number {
  return track && INSTRUMENTS[track.instrumentKey]?.samples ? releaseSeconds(track) + 0.5 : UNKNOWN_BEND_TAIL_SECONDS;
}

/**
 * Where to start rendering to hear bars from `fromBar` as they sound in the song: the start of the
 * earliest note still sounding at `fromBar` (a held pad, a long bass note, or one that ended just
 * before it and is still ringing out: its release, see releaseSeconds), at most PRE_ROLL_MAX_BARS
 * and PRE_ROLL_MAX_SECONDS earlier; `fromBar` itself if nothing is held over.
 */
export function preRollStart(song: { tracks: Track[]; clips: readonly Clip[]; bpm: number; tempoPoints?: readonly TempoPoint[] }, fromBar: number): number {
  const ids = audibleIds(song.tracks);
  const tempo = { bpm: song.bpm, points: [...(song.tempoPoints ?? [])] };
  const fromSeconds = barToSeconds(fromBar, tempo);
  const trackOf = new Map(song.tracks.map((t) => [t.id, t]));
  let start = fromBar;
  for (const c of song.clips) {
    if (!ids.has(c.trackId) || c.startBar >= fromBar) continue;
    const release = releaseSeconds(trackOf.get(c.trackId));
    // (a clip over well before the range, its notes too: none of them can ring into it)
    if (barToSeconds(clipSoundEnd(c), tempo) + release <= fromSeconds) continue;
    for (const { note, bars } of soundingNotes(c)) {
      const at = c.startBar + note.startOffset;
      if (at >= start) continue;
      // Sounding past fromBar, or ringing out into it
      // (a note runs its whole length, past its clip's end too)
      const end = at + bars;
      if (end > fromBar || barToSeconds(end, tempo) + release > fromSeconds) start = at;
    }
  }
  if (start >= fromBar) return fromBar;
  const bySeconds = secondsToBar(Math.max(0, fromSeconds - PRE_ROLL_MAX_SECONDS), tempo);
  return Math.max(1, start, fromBar - PRE_ROLL_MAX_BARS, bySeconds);
}

/** Tone ticks in a bar (4/4), for writing a length in bars as a duration ("384i"). */
const TICKS_PER_BAR = 768;

/**
 * Where to start rendering to hear bars from `fromBar` of each of `songs` alike (the before and
 * after of a suggestion): the earliest of their run-ins (preRollStart), on the whole tick at or
 * before it, as a render's Transport starts on a tick (see exportWav.ts). Rendered from one start
 * and trimmed the same, two versions line up sample for sample, so only what changed differs
 * (each from its own run-in, they were up to half a tick apart: every bar "sounded different").
 * `fromBar` itself if neither has a run-in.
 */
export function sharedRunIn(songs: ReadonlyArray<Parameters<typeof preRollStart>[0]>, fromBar: number): number {
  const start = Math.min(fromBar, ...songs.map((s) => preRollStart(s, fromBar)));
  if (start >= fromBar) return fromBar;
  return Math.max(1, Math.floor((start - 1) * TICKS_PER_BAR + 1e-6) / TICKS_PER_BAR + 1);
}

/**
 * How many frames of a render begun at bar `start` (before `fromBar`) come before `fromBar`: from
 * the tick its Transport starts on (the nearest to `start`), so the trimmed render starts exactly at
 * `fromBar`. 0 when it starts at `fromBar` (no run-in).
 */
export function runInFrames(start: number, fromBar: number, tempo: Tempo, sampleRate: number): number {
  if (start >= fromBar) return 0;
  const onTick = Math.max(0, Math.round((start - 1) * TICKS_PER_BAR)) / TICKS_PER_BAR + 1;
  return Math.max(0, Math.round((barToSeconds(fromBar, tempo) - barToSeconds(onTick, tempo)) * sampleRate));
}

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
  const out = clips.flatMap((c): Clip[] => {
    if (c.startBar >= at || !c.notes?.length || clipSoundEnd(c) <= at) return [c];
    // (as the scheduler hears them: a note hidden by a trim stays as it is, and doesn't play; the
    // sustain pedal's hold counts, and the note begun again ends where the pedal lets it go; a note
    // runs its whole length, past its clip's end too)
    const sounding = new Map(soundingNotes(c).map((x) => [x.note, x.bars]));
    const again = new Map<NoteEvent, NoteEvent>();
    for (const n of c.notes) {
      const bars = sounding.get(n);
      if (bars === undefined) continue;
      const start = c.startBar + n.startOffset;
      const end = start + bars;
      if (start >= at - eps || end <= fromBar + eps) continue;
      again.set(n, { ...n, startOffset: at - c.startBar, duration: `${Math.max(1, Math.round((end - at) * TICKS_PER_BAR))}i`, heldFrom: n.heldFrom ?? start });
    }
    if (!again.size) return [c];
    changed = true;
    // Still playing at `at`: begun again there in the clip itself. Over by then (a note running on
    // past its clip's end): in a clip of their own there with nothing else of it (the scheduler
    // plays only the notes that start inside a clip; no lanes, so none of the clip's own move twice)
    // (Either way it stays where it was in its run of copies, for its notes that play on some
    // passes only: see keepContentKey)
    const kept = (notes: NoteEvent[]) => (keepContentKey(notes, c), notes);
    if (c.startBar + c.lengthBars > at + eps) return [{ ...c, notes: kept(c.notes.map((n) => again.get(n) ?? n)) }];
    const held = [...again.values()].map((n) => ({ ...n, startOffset: 0 }));
    // (Its groove kept: a feel's accent goes by where each note really begins; its id says whose
    // notes they are, for their chance, drift and passes: see ownClipId)
    const { pattern: _p, expression: _e, stepLanes: _s, takes: _t, comp: _c, ...rest } = c;
    return [
      { ...c, notes: kept(c.notes.filter((n) => !again.has(n))) },
      { ...rest, id: `${c.id}${HELD_CLIP}`, startBar: at, lengthBars: Math.max(1 / 16, ...held.map((n) => durationToBars(n.duration))), notes: held } as Clip,
    ];
  });
  return changed ? out : (clips as Clip[]);
}

/** How long the end of a looped stretch crossfades into what leads into its start (seconds). */
export const LOOP_FADE_SECONDS = 0.015;

/**
 * A render's channels from frame `trim` on, made to loop without a click: its last `fade` frames
 * crossfade (equal power) into the `fade` frames just before `trim`, the music that leads into the
 * stretch's start, so going round from its last frame to its first is a step the song itself takes.
 * (Before frame 0 there's silence: a stretch rendered with no run-in fades out into it.) The render
 * must end without a fade of its own.
 */
export function loopChannels(channels: readonly Float32Array<ArrayBuffer>[], trim: number, fade: number): Float32Array<ArrayBuffer>[] {
  return channels.map((data) => {
    const out = data.slice(Math.max(0, trim));
    const n = Math.min(Math.max(0, Math.round(fade)), Math.floor(out.length / 2));
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n) * (Math.PI / 2);
      const k = out.length - n + i;
      const lead = trim - n + i;
      out[k] = out[k] * Math.cos(t) + (lead >= 0 ? data[lead] : 0) * Math.sin(t);
    }
    return out;
  });
}

/** One stretch of a sequence, rendered: its channels from its first bar on, and the `fade` frames that lead into that bar in the song (silence where none were rendered). */
export interface RenderedStretch {
  channels: Float32Array<ArrayBuffer>[];
  lead: Float32Array<ArrayBuffer>[];
}

/** A render's channels split for a sequence: from frame `trim` on, and the `fade` frames before it (zeros before frame 0). */
export function stretchOf(channels: readonly Float32Array<ArrayBuffer>[], trim: number, fade: number): RenderedStretch {
  const t = Math.max(0, trim);
  const n = Math.max(0, Math.round(fade));
  return {
    channels: channels.map((d) => d.slice(t)),
    lead: channels.map((d) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const at = t - n + i;
        out[i] = at >= 0 && at < d.length ? d[at] : 0;
      }
      return out;
    }),
  };
}

/**
 * Stretches of a song played one after another, looped as one (the before or after of a
 * suggestion whose changes sit in several places): each stretch's last `fade` frames crossfade
 * (equal power) into the music leading into the next one's start (the first's, after the last),
 * so going from one to the next is a step the song itself takes into that bar, never a click.
 * With one stretch it's loopChannels. `starts`: where each stretch begins in the result, frames.
 */
export function joinStretches(parts: readonly RenderedStretch[], fade: number): { channels: Float32Array<ArrayBuffer>[]; starts: number[] } {
  const count = Math.max(0, ...parts.map((p) => p.channels.length));
  const starts: number[] = [];
  let length = 0;
  for (const p of parts) {
    starts.push(length);
    length += p.channels[0]?.length ?? 0;
  }
  const channels = Array.from({ length: count }, () => new Float32Array(Math.max(1, length)));
  parts.forEach((p, i) => {
    const next = parts[(i + 1) % parts.length];
    for (let c = 0; c < count; c++) {
      const data = p.channels[Math.min(c, p.channels.length - 1)];
      if (!data) continue;
      const out = data.slice();
      const lead = next.lead[Math.min(c, next.lead.length - 1)] ?? new Float32Array(0);
      const n = Math.min(Math.max(0, Math.round(fade)), Math.floor(out.length / 2), lead.length);
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n) * (Math.PI / 2);
        const at = out.length - n + k;
        out[at] = out[at] * Math.cos(t) + lead[lead.length - n + k] * Math.sin(t);
      }
      channels[c].set(out, starts[i]);
    }
  });
  return { channels, starts };
}

/** A side of a sequence for switching (sequenceOffset): its tempo, where each stretch begins in it (seconds) and its whole length (seconds). */
export interface SequenceSide {
  tempo: Tempo;
  starts: readonly number[];
  seconds: number;
}

/**
 * Where in `to`'s sequence the music is when `from`'s has played `elapsed` seconds: the same
 * stretch, and in it the same bar (and part of a bar) by each side's own tempo (sameBarOffset), so
 * a switch between before and after keeps its place even when they're of different lengths.
 */
export function sequenceOffset(elapsed: number, plays: ReadonlyArray<{ fromBar: number }>, from: SequenceSide, to: SequenceSide): number {
  if (!plays.length || from.seconds <= 0) return 0;
  const into = ((elapsed % from.seconds) + from.seconds) % from.seconds;
  let i = 0;
  while (i + 1 < from.starts.length && from.starts[i + 1] <= into + 1e-9) i++;
  const end = (side: SequenceSide, k: number) => (k + 1 < side.starts.length ? side.starts[k + 1] : side.seconds);
  const inStretch = sameBarOffset(into - from.starts[i], plays[i].fromBar, { tempo: from.tempo, seconds: end(from, i) - from.starts[i] }, { tempo: to.tempo, seconds: end(to, i) - (to.starts[i] ?? 0) });
  return Math.max(0, Math.min(Math.max(0, to.seconds - 0.001), (to.starts[i] ?? 0) + inStretch));
}

/**
 * What B played as song bars: each span of its buffer in the stretch it lies in (`plays`, starting
 * at `starts`, seconds), by B's own tempo. Parts of bars too; joined.
 */
export function playedBars(spans: ReadonlyArray<readonly [number, number]>, plays: ReadonlyArray<{ fromBar: number; toBar: number }>, starts: readonly number[], seconds: number, tempo: Tempo): Array<{ fromBar: number; toBar: number }> {
  const out: Array<{ fromBar: number; toBar: number }> = [];
  plays.forEach((r, i) => {
    const s0 = starts[i] ?? 0;
    const s1 = i + 1 < starts.length ? starts[i + 1] : seconds;
    const t0 = barToSeconds(r.fromBar, tempo);
    for (const [a, b] of spans) {
      const x = Math.max(a, s0);
      const y = Math.min(b, s1);
      if (y <= x) continue;
      // (the stretch's end, reached, is its last bar's end: frames rounded off don't leave a sliver unplayed)
      const toBar = y >= s1 - 1e-3 ? r.toBar : Math.min(r.toBar, secondsToBar(t0 + (y - s0), tempo));
      out.push({ fromBar: x <= s0 + 1e-3 ? r.fromBar : Math.max(r.fromBar, secondsToBar(t0 + (x - s0), tempo)), toBar });
    }
  });
  out.sort((x, y) => x.fromBar - y.fromBar);
  const joined: Array<{ fromBar: number; toBar: number }> = [];
  for (const r of out) {
    const last = joined.at(-1);
    if (last && r.fromBar <= last.toBar + 1e-6) last.toBar = Math.max(last.toBar, r.toBar);
    else joined.push({ ...r });
  }
  return joined;
}
