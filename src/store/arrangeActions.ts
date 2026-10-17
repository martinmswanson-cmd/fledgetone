/**
 * The producer arrangement tools' store actions: write a dark melody, drop parts out or stop the
 * beat before a drop, switch the beat (half time, double time or a new pattern) in a copy of a
 * section, a riser or reverse cymbal into a drop, lay a loop out as a whole song (song form), and
 * place the producer tag. Each is one undo step, and all of them only change clips, tracks and
 * markers, so live playback and every export hear them the same. The maths is in darkMelody.ts,
 * beatSwitch.ts, songForm.ts and producerTag.ts; this file applies it.
 */
import { songTempo, splitClipAt, useTimelineStore } from './timelineStore';
import type { Clip, InstrumentKey, Marker, NoteEvent, Track } from './timelineTypes';
import { TOTAL_BARS, barsToDuration, uid } from './timelineTypes';
import { darkMelody, DARK_SOUNDS, DARK_STYLES, type DarkMelodyOptions, type DarkSound } from './darkMelody';
import { cutGap, silenceDip, stopSpan, switchedNotes, trackRole, SWITCH_MODES, type SwitchMode, type TrackRole } from './beatSwitch';
import { planSongForm, preHookDrop, repeatLoop, SECTION_RECIPES, treatPart, type SectionLengths } from './songForm';
import { parseTag, TAG_DUCK_DB, TAG_STORAGE_KEY, TAG_TRACK_NAME, tagBars, trimSilence, fadeEdges, type ProducerTag } from './producerTag';
import { drummer, type DrumStyle } from './smartTools';
import { fitToInstrument } from './smartActions';
import { createMarker, retimeMarkers } from './markers';
import { songEnd } from './cutToLength';
import { FX_NOTES, isAudioKind, isFxKind } from '../audio/instrumentCatalog';
import { tempoAt } from '../audio/tempoMap';
import { AUTOMATION, laneOf } from '../audio/automation';
import { secondsPerBar } from './audioClips';
import { decodeSound, ensureSound, importSoundFile, useSoundLibrary } from '../audio/soundLibrary';
import { encodeChannels } from '../audio/exportWav';

const tl = () => useTimelineStore.getState();
const newId = () => uid('note');
const EPS = 1e-6;
/** An audio clip cut by a drop-out or stop fades this long at the cut, so it doesn't click. */
const CUT_FADE = 0.005;

/**
 * Run `edit` as one undo step: one snapshot before it, and whatever store actions it calls (an
 * insert of bars, a new track) fold into that one.
 */
function oneStep<T>(edit: () => T): T {
  tl().checkpoint();
  const past = tl().past;
  const result = edit();
  useTimelineStore.setState({ past, future: [] });
  return result;
}

/** A track's clips between `from` and `to`, cut at both ends. */
function partsOf(clips: readonly Clip[], trackId: string, from: number, to: number): Clip[] {
  const tempo = songTempo(tl());
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.trackId !== trackId || c.startBar >= to - EPS || c.startBar + c.lengthBars <= from + EPS) continue;
    let part: Clip | null = c;
    if (part.startBar < from - EPS) part = splitClipAt(part, from, tempo)?.[1] ?? null;
    if (part && part.startBar + part.lengthBars > to + EPS) part = splitClipAt(part, to, tempo)?.[0] ?? null;
    if (part) out.push(part);
  }
  return out.sort((a, b) => a.startBar - b.startBar);
}

/** The notes of a track's note clips as one list, positions in bars from `from` (only notes their clips play). */
function mergedNotes(parts: readonly Clip[], from: number): NoteEvent[] {
  return parts
    .filter((p) => !p.audio)
    .flatMap((p) => p.notes.filter((n) => n.startOffset >= -EPS && n.startOffset < p.lengthBars - EPS).map((n) => ({ ...n, startOffset: Math.round((n.startOffset + p.startBar - from) * 1920) / 1920 })))
    .sort((a, b) => a.startOffset - b.startOffset);
}

/** A note clip made like `template` (its swing and wobble), with new notes. */
function noteClip(template: Clip | undefined, trackId: string, name: string, startBar: number, lengthBars: number, notes: NoteEvent[]): Clip {
  return {
    id: uid('clip'),
    trackId,
    name,
    startBar,
    lengthBars,
    notes,
    isSelected: false,
    ...(template?.groove ? { groove: template.groove } : {}),
    ...(template?.wobble ? { wobble: template.wobble } : {}),
  };
}

const copyAt = (c: Clip, startBar: number): Clip => ({ ...c, id: uid('clip'), startBar, isSelected: false, notes: c.notes.map((n) => ({ ...n, id: newId() })) });

/** Markers with one more at `bar` (replacing one already there). */
function withMarker(markers: readonly Marker[], bar: number, name: string): Marker[] {
  const tempo = songTempo(tl());
  return [...markers.filter((m) => !(m.anchor === 'bar' && Math.abs(m.bar - bar) < EPS)), createMarker(bar, tempo, name)];
}

// ---------- Dark melody ----------

/**
 * Write a dark melody: onto `trackId` at `atBar` (a new clip), onto a new track of `sound` (after
 * the selected track), or in place of the notes of `replaceClipId` (the "New idea" button after a
 * first write). One undo step. Returns the clip's id and track's id.
 */
export function writeDarkMelody(o: DarkMelodyOptions, where: { trackId?: string; sound?: DarkSound; replaceClipId?: string }, atBar: number): { clipId: string; trackId: string } | null {
  const s = tl();
  const style = DARK_STYLES.find((d) => d.id === o.style)!;
  const name = `Dark melody (${style.name.toLowerCase()})`;
  const raw = darkMelody(o, newId);
  const replace = where.replaceClipId ? s.clips.find((c) => c.id === where.replaceClipId && !c.audio) : undefined;
  if (replace) {
    const track = s.tracks.find((t) => t.id === replace.trackId);
    if (track) {
      const notes = fitToInstrument(raw, track.instrumentKey);
      oneStep(() => useTimelineStore.setState((st) => ({ clips: st.clips.map((c) => (c.id === replace.id ? { ...c, notes, lengthBars: o.bars, name } : c)) })));
      return { clipId: replace.id, trackId: track.id };
    }
  }
  const at = Math.max(1, Math.min(TOTAL_BARS + 1 - o.bars, Math.round(atBar)));
  const existing = where.trackId ? s.tracks.find((t) => t.id === where.trackId) : undefined;
  if (existing && (isAudioKind(existing.instrumentKey) || trackRole(existing) === 'drums' || trackRole(existing) === 'mix' || trackRole(existing) === 'fx')) return null;
  const clipId = uid('clip');
  let trackId = existing?.id ?? '';
  oneStep(() => {
    if (!existing) {
      const def = DARK_SOUNDS.find((d) => d.id === (where.sound ?? style.sound))!;
      const after = tl().selectedTrackId;
      trackId = tl().addTrack(def.instrument, `${def.name} melody`);
      // Under the selected track, where the person is working
      useTimelineStore.setState((st) => {
        const made = st.tracks.find((t) => t.id === trackId)!;
        const rest = st.tracks.filter((t) => t.id !== trackId);
        const i = after ? rest.findIndex((t) => t.id === after) : -1;
        return { tracks: i >= 0 ? [...rest.slice(0, i + 1), made, ...rest.slice(i + 1)] : st.tracks };
      });
    }
    const track = tl().tracks.find((t) => t.id === trackId)!;
    const notes = fitToInstrument(raw, track.instrumentKey as InstrumentKey);
    useTimelineStore.setState((st) => ({
      clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), { ...noteClip(undefined, trackId, name, at, o.bars, notes), id: clipId, isSelected: true }],
      selectedTrackId: trackId,
    }));
  });
  return { clipId, trackId };
}

// ---------- Drop-outs and stops ----------

/** Cut [from, to) out of the given tracks' clips (notes, and audio clips split around it). Returns how many clips changed. */
function cutTracks(trackIds: ReadonlySet<string>, from: number, to: number): number {
  const s = tl();
  const tempo = songTempo(s);
  let changed = 0;
  const clips: Clip[] = [];
  for (const c of s.clips) {
    const end = c.startBar + c.lengthBars;
    if (!trackIds.has(c.trackId) || end <= from + EPS) {
      clips.push(c);
      continue;
    }
    if (c.audio) {
      if (c.startBar >= to - EPS) {
        clips.push(c);
        continue;
      }
      changed++;
      // The part before the gap fades out at it; the part after fades in
      if (c.startBar < from - EPS) {
        const left = splitClipAt(c, from, tempo)?.[0];
        if (left?.audio) clips.push({ ...left, audio: { ...left.audio, fadeOut: Math.max(left.audio.fadeOut, CUT_FADE) } });
      }
      if (end > to + EPS) {
        const right = splitClipAt(c, to, tempo)?.[1];
        if (right?.audio) clips.push({ ...right, audio: { ...right.audio, fadeIn: Math.max(right.audio.fadeIn, CUT_FADE) } });
      }
      continue;
    }
    const notes = cutGap(c.notes, from - c.startBar, to - c.startBar);
    if (notes.length !== c.notes.length || notes.some((n, i) => n !== c.notes[i])) changed++;
    clips.push(notes === c.notes ? c : { ...c, notes });
  }
  // The tracks' volume dips to silence over the gap too, so releases and echoes stop with the notes
  const tracks = s.tracks.map((t) => {
    if (!trackIds.has(t.id)) return t;
    const lane = laneOf(t, 'volume');
    const points = silenceDip(lane?.points ?? [], from, to, AUTOMATION.volume.toNorm(t.volume));
    const automation = lane ? (t.automation ?? []).map((l) => (l === lane ? { ...l, points } : l)) : [...(t.automation ?? []), { param: 'volume' as const, points }];
    return { ...t, automation };
  });
  useTimelineStore.setState({ clips, tracks });
  return changed;
}

/**
 * Drop out: the chosen tracks go silent from `from` to `to` (bars), the way a beat drops
 * everything but the melody for a bar before the drop. One undo step. Returns a message.
 */
export function dropOut(trackIds: readonly string[], from: number, to: number): string {
  if (!(to > from + EPS)) return 'Pick a range at least a 16th long.';
  if (!trackIds.length) return 'Pick at least one track to drop out.';
  const ids = new Set(trackIds);
  let changed = 0;
  const s = tl();
  if (!s.clips.some((c) => ids.has(c.trackId) && c.startBar < to - EPS && c.startBar + c.lengthBars > from + EPS)) return 'Those tracks play nothing there.';
  oneStep(() => {
    changed = cutTracks(ids, from, to);
  });
  return changed ? `Dropped out ${trackIds.length} track${trackIds.length === 1 ? '' : 's'} from bar ${fmt(from)} to ${fmt(to)}.` : 'Those tracks play nothing there.';
}

/**
 * A stop: every track silent for the last beat (or half beat) of bar `bar`, so the next bar hits
 * out of silence. Long notes ringing into it end where it starts. One undo step.
 */
export function addStop(bar: number, beats: 1 | 0.5): string {
  const [from, to] = stopSpan(bar, beats);
  // Every track, returns and buses too: a return's reverb tail stops with the rest (the shared
  // reverb of the master section isn't a track, so its tail of what came before still rings)
  const ids = new Set(tl().tracks.map((t) => t.id));
  let changed = 0;
  oneStep(() => {
    changed = cutTracks(ids, from, to);
  });
  return changed ? `Stop: silence for ${beats === 1 ? 'the last beat' : 'the last half beat'} of bar ${Math.round(bar)}.` : 'Nothing plays there to stop.';
}

const fmt = (bar: number) => `${Math.round(bar * 100) / 100}`;

// ---------- Risers and reverse cymbals ----------

export type DropFx = 'riser' | 'reverse';

/**
 * A riser (over `bars`) or a reverse cymbal (over the last bar, or less) into the drop at
 * `dropBar`, on an FX track with room there (or a new one). It ends `early` bars before the
 * drop (0, or a beat or half a beat when a stop sits there), peaking right where the silence or
 * the drop begins. One undo step.
 */
export function addDropFx(kind: DropFx, dropBar: number, bars: number, early = 0): string {
  const drop = Math.round(dropBar);
  const len = Math.min(kind === 'reverse' ? Math.min(1, bars) : bars, drop - 1);
  if (len < 0.25) return 'Pick a later bar: there is no room before it.';
  const from = drop - len;
  const s = tl();
  const free = (t: Track) => !s.clips.some((c) => c.trackId === t.id && c.startBar < drop - EPS && c.startBar + c.lengthBars > from + EPS);
  const note = kind === 'riser' ? FX_NOTES.riser : FX_NOTES.reverseCrash;
  const ring = Math.max(1 / 16, len - early);
  oneStep(() => {
    let track = s.tracks.find((t) => isFxKind(t.instrumentKey) && free(t));
    if (!track) {
      const id = tl().addTrack('fx', 'Drop FX');
      track = tl().tracks.find((t) => t.id === id)!;
    }
    const notes: NoteEvent[] = [{ id: newId(), note, startOffset: 0, duration: barsToDuration(ring), velocity: 0.85 }];
    useTimelineStore.setState((st) => ({ clips: [...st.clips, noteClip(undefined, track!.id, kind === 'riser' ? 'Riser' : 'Reverse cymbal', from, len, notes)] }));
  });
  return `${kind === 'riser' ? 'Riser' : 'Reverse cymbal'} into bar ${drop}${early ? `, ending ${early === 0.25 ? 'a beat' : 'half a beat'} early` : ''}.`;
}

// ---------- Beat switch ----------

/**
 * Beat switch: a copy of bars `from` to `to` goes right after them (the rest of the song moves
 * later), with its drums and bass switched (see SWITCH_MODES) and everything else as it was. A
 * "Beat switch" marker names it. One undo step. Returns a message.
 */
export function beatSwitch(from: number, to: number, mode: SwitchMode, drumStyle: DrumStyle = 'trap', seed = 1): string {
  const s = tl();
  const a = Math.round(from);
  const b = Math.round(to);
  const len = b - a;
  if (len < 1) return 'Pick a section at least one bar long.';
  if (songEnd(s.clips) + len > TOTAL_BARS + 1) return `No room: the switch would run past the end of the timeline (bar ${TOTAL_BARS + 1}).`;
  const plan = s.tracks
    .map((t) => ({ t, role: trackRole(t), parts: partsOf(s.clips, t.id, a, b) }))
    .filter((p) => p.parts.length && p.role !== 'mix');
  if (!plan.length) return 'Those bars are empty: nothing to switch.';
  const hasDrums = plan.some((p) => p.role === 'drums' && p.parts.some((c) => !c.audio));
  const hasBass = plan.some((p) => p.role === 'bass' && p.parts.some((c) => !c.audio));
  if (!hasDrums && !hasBass) return 'There are no drums or bass (as notes) in those bars to switch.';
  const newDrums = mode === 'pattern' ? drummer(drumStyle, len, 0.7, Math.min(4, len), seed, newId) : undefined;
  const label = SWITCH_MODES.find((m) => m.id === mode)!.name;
  let error = null as string | null;
  oneStep(() => {
    error = tl().insertBars(b, len);
    if (error) return;
    const made: Clip[] = [];
    for (const { t, role, parts } of plan) {
      const switching = role === 'drums' || role === 'bass';
      const notesParts = parts.filter((c) => !c.audio);
      if (switching && notesParts.length) {
        const notes = switchedNotes(role, mergedNotes(notesParts, a), len, mode, newId, newDrums);
        if (notes.length) made.push(noteClip(notesParts[0], t.id, label, b, len, notes));
        // Audio on a drum or bass track can't change speed: it sits the switch out
        continue;
      }
      for (const c of parts) made.push(copyAt(c, c.startBar + len));
    }
    useTimelineStore.setState((st) => ({ clips: [...st.clips, ...made], markers: retimeMarkers(withMarker(st.markers, b, 'Beat switch'), songTempo(st)) }));
  });
  if (error) {
    tl().undo();
    return error;
  }
  return `Beat switch (${label.toLowerCase()}) at bar ${b}: bars ${a}-${b - 1} again with new drums and bass; the rest of the song moved ${len} bar${len === 1 ? '' : 's'} later.`;
}

// ---------- Song form ----------

/**
 * Lay the loop at `loopFrom` (`loopBars` long) out as a whole song (see songForm.ts): the loop's
 * bars become the sections, one after another, each part dropped in or out by the section's
 * recipe, with a marker naming each section. Everything after the loop moves later to make room.
 * One undo step. Returns a message.
 */
export function layOutSong(loopFrom: number, loopBars: number, lengths: SectionLengths, dropBeforeHooks = true): string {
  const s = tl();
  const from = Math.round(loopFrom);
  const to = from + loopBars;
  const sections = planSongForm(lengths);
  const total = sections.reduce((n, x) => n + x.bars, 0);
  if (!sections.length) return 'Give at least one section some bars.';
  if (total < loopBars) return `The song (${total} bars) is shorter than the loop: give the sections more bars.`;
  if (songEnd(s.clips) + total - loopBars > TOTAL_BARS + 1) return `No room: the song would run past the end of the timeline (bar ${TOTAL_BARS + 1}).`;
  const plan = s.tracks
    .map((t) => ({ t, role: trackRole(t) as TrackRole, parts: partsOf(s.clips, t.id, from, to) }))
    .filter((p) => p.parts.length && p.role !== 'mix');
  if (!plan.length) return `Bars ${from}-${to - 1} are empty: make a loop there first.`;
  let error = null as string | null;
  oneStep(() => {
    if (total > loopBars) error = tl().insertBars(to, total - loopBars);
    if (error) return;
    const tempo = songTempo(tl());
    // The loop's own clips make way for the song (a clip that starts before it keeps its start)
    const kept: Clip[] = [];
    for (const c of tl().clips) {
      if (c.startBar >= to - EPS || c.startBar + c.lengthBars <= from + EPS || !plan.some((p) => p.t.id === c.trackId)) {
        kept.push(c);
        continue;
      }
      if (c.startBar < from - EPS) {
        const left = splitClipAt(c, from, tempo)?.[0];
        if (left) kept.push(left);
      }
      // ...and one that runs past it keeps what's after it (when the song is no longer than the
      // loop, nothing has split it at `to` first)
      if (c.startBar + c.lengthBars > to + EPS) {
        const right = splitClipAt(c, to, tempo)?.[1];
        if (right) kept.push(right);
      }
    }
    const made: Clip[] = [];
    sections.forEach((sec, i) => {
      const start = from + sec.at;
      const hookNext = sections[i + 1]?.kind === 'hook';
      for (const { t, role, parts } of plan) {
        const treatment = SECTION_RECIPES[sec.kind][role];
        if (treatment === 'off') continue;
        const noteParts = parts.filter((c) => !c.audio);
        if (noteParts.length) {
          let notes = treatPart(repeatLoop(mergedNotes(noteParts, from), loopBars, sec.bars, newId), role, treatment);
          if (notes && dropBeforeHooks && hookNext && role === 'drums') notes = preHookDrop(notes, sec.bars);
          if (notes?.length) made.push(noteClip(noteParts[0], t.id, sec.name, start, sec.bars, notes));
        }
        // Audio clips repeat as they are, cut at the section's end
        for (let k = 0; k * loopBars < sec.bars - EPS; k++) {
          for (const c of parts.filter((p) => p.audio)) {
            const at = start + k * loopBars + (c.startBar - from);
            const room = start + sec.bars - at;
            if (room < 1 / 16) continue;
            made.push({ ...copyAt(c, at), lengthBars: Math.min(c.lengthBars, room) });
          }
        }
      }
    });
    useTimelineStore.setState((st) => {
      const end = from + total;
      let markers = st.markers.filter((m) => !(m.anchor === 'bar' && m.bar >= from - EPS && m.bar < end - EPS));
      for (const sec of sections) markers = withMarker(markers, from + sec.at, sec.name);
      return { clips: [...kept.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), ...made], markers: retimeMarkers(markers, songTempo(st)) };
    });
  });
  if (error) {
    tl().undo();
    return error;
  }
  return `Song laid out from bar ${from}: ${sections.map((x) => `${x.name} ${x.bars}`).join(', ')} (${total} bars).`;
}

// ---------- Producer tag ----------

/** The tag remembered in this browser, or null. */
export function loadTag(): ProducerTag | null {
  try {
    return parseTag(localStorage.getItem(TAG_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Remember `tag` as this browser's producer tag (null forgets it). */
export function rememberTag(tag: ProducerTag | null): void {
  try {
    if (tag) localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(tag));
    else localStorage.removeItem(TAG_STORAGE_KEY);
  } catch {
    // Storage blocked (private browsing): the tag lasts for this page only
  }
}

const RATE = 44100;

/** Keep a recording (or an imported file's sound) as the tag: silence trimmed off both ends, faded, stored in the library. */
export async function saveTag(channels: Float32Array[], sampleRate: number, name: string): Promise<ProducerTag> {
  const [a, b] = trimSilence(channels, sampleRate);
  if (b <= a) throw new Error('the recording is silent');
  const kept = channels.map((c) => c.slice(a, b));
  fadeEdges(kept, sampleRate);
  const meta = await importSoundFile(new Blob([encodeChannels(kept, sampleRate, 24)], { type: 'audio/wav' }), `${name.replace(/\.[a-z0-9]+$/i, '')} (tag).wav`);
  const tag: ProducerTag = { soundId: meta.id, name: name.replace(/\.[a-z0-9]+$/i, ''), seconds: meta.seconds };
  rememberTag(tag);
  return tag;
}

/** An imported file as the tag (trimmed like a recording). */
export async function importTag(file: File): Promise<ProducerTag> {
  const meta = await importSoundFile(file, file.name);
  const buffer = await decodeSound(meta.id, RATE);
  return saveTag(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), RATE, file.name);
}

/**
 * Place the tag: at bar `from`, or every `every` bars from there to the song's end (for a
 * beat-store preview), on the Producer tag track (made if needed), which the rest of the beat
 * ducks under by TAG_DUCK_DB. One undo step. Returns a message.
 */
export function placeTag(from: number, every: number): string {
  const tag = loadTag();
  if (!tag) return 'Record or import a tag first.';
  const s = tl();
  if (!useSoundLibrary.getState().metas[tag.soundId]) ensureSound(tag.soundId);
  const tagLength = (bar: number) => tag.seconds / secondsPerBar(tempoAt(bar, songTempo(s)));
  const end = Math.max(songEnd(s.clips.filter((c) => s.tracks.find((t) => t.id === c.trackId)?.name !== TAG_TRACK_NAME)), from + 1);
  const bars = tagBars(from, end, every, tagLength(from)).filter((b) => b + tagLength(b) <= TOTAL_BARS + 1);
  if (!bars.length) return 'No room for the tag there.';
  let count = 0;
  oneStep(() => {
    let track = tl().tracks.find((t) => t.name === TAG_TRACK_NAME && isAudioKind(t.instrumentKey));
    if (!track) {
      const id = tl().addTrack('audio', TAG_TRACK_NAME);
      track = tl().tracks.find((t) => t.id === id)!;
    }
    const trackId = track.id;
    const taken = tl().clips.filter((c) => c.trackId === trackId);
    const clips: Clip[] = [];
    for (const bar of bars) {
      const len = tagLength(bar);
      if (taken.some((c) => c.startBar < bar + len - EPS && c.startBar + c.lengthBars > bar + EPS)) continue;
      clips.push({ id: uid('clip'), trackId, name: tag.name, startBar: bar, lengthBars: len, notes: [], isSelected: false, audio: { soundId: tag.soundId, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 } });
    }
    count = clips.length;
    useTimelineStore.setState((st) => ({
      clips: [...st.clips, ...clips],
      // The beat dips a little under the tag (a proxy: see duck.ts), live and in exports
      tracks: st.tracks.map((t) => (t.id === trackId ? { ...t, duckProxy: { depth: TAG_DUCK_DB }, reverbSend: 0 } : t)),
    }));
  });
  return count ? `Tag placed ${count === 1 ? `at bar ${bars[0]}` : `${count} times, every ${every} bars`}; the beat dips ${TAG_DUCK_DB} dB under it.` : 'The tag is already there.';
}
