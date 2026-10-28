/**
 * Pocket's song as sections: the stretches between the song's bar markers (or every 4 or 8 bars
 * when it has none, as the studio's Cut to length reads them), each lettered by what's in it, so
 * two sections playing the same thing share a letter (A A B A). A cell of Pocket's grid is one
 * track in one section, edited as one clip spanning the section (cellClip makes it so).
 *
 * The arranging works on the arrangement itself, as the studio's ripple edits do: copying a
 * section after itself, moving one, taking one out. Copies are linked clips (patterns.ts), so
 * editing an A changes every A until one is made its own. Each action is one undo step, and the
 * song opens on a computer as an ordinary arrangement with a marker at each section.
 */
import { songTempo, splitClipAt, useTimelineStore, songMeterOf } from '../store/timelineStore';
import { uid, type Clip, type Track } from '../store/timelineTypes';
import { songEnd, songSections } from '../store/cutToLength';
import { createMarker, retimeMarkers } from '../store/markers';
import { isMixTrack } from '../store/buses';
import { canLink, unlinked } from '../store/patterns';
import { showToast } from '../components/timeline/toastStore';
import { mergePieces, sectionCopy } from './pocketClips';

const EPS = 1e-6;
const tl = () => useTimelineStore.getState();

export interface PocketSection {
  from: number;
  to: number;
  /** Its marker's name ("Verse"), or "Bars 1-4" when the song has no markers */
  name: string;
  /** A, B, C…: sections with the same content share a letter */
  letter: string;
}

/** A new song's first section, before anything is written: 4 bars. */
export const FIRST_SECTION_BARS = 4;

/** The tracks Pocket shows: everything but buses and returns. */
export const gridTracks = (tracks: readonly Track[]): Track[] => tracks.filter((t) => !isMixTrack(t));

/** What a track plays in a stretch, as text: its notes (and recordings) relative to the stretch's start. */
function contentOf(clips: readonly Clip[], trackId: string, from: number, to: number): string {
  const out: string[] = [];
  for (const c of clips) {
    if (c.trackId !== trackId || c.startBar >= to - EPS || c.startBar + c.lengthBars <= from + EPS) continue;
    if (c.audio) {
      out.push(`a${Math.round((c.startBar - from) * 64)}:${c.audio.soundId}:${Math.round((c.audio.offset ?? 0) * 1000)}`);
      continue;
    }
    for (const n of c.notes) {
      const at = c.startBar + n.startOffset;
      if (at < from - EPS || at >= to - EPS || n.startOffset >= c.lengthBars - EPS) continue;
      out.push(`${Math.round((at - from) * 64)}${n.note}${n.duration}`);
    }
  }
  return out.sort().join(',');
}

/** The song's sections, in order, lettered. A song with nothing in it has one, of FIRST_SECTION_BARS. */
export function pocketSections(s = tl()): PocketSection[] {
  const found = songSections(s.clips, s.markers, songMeterOf(s));
  const sections = found.length ? found.map((x) => ({ from: x.from, to: x.to, name: x.name })) : [{ from: 1, to: 1 + FIRST_SECTION_BARS, name: 'Start' }];
  const tracks = gridTracks(s.tracks);
  const letters = new Map<string, string>();
  return sections.map((sec) => {
    const key = `${Math.round((sec.to - sec.from) * 64)}|` + tracks.map((t) => contentOf(s.clips, t.id, sec.from, sec.to)).join('|');
    if (!letters.has(key)) letters.set(key, String.fromCharCode(65 + (letters.size % 26)) + (letters.size >= 26 ? String(Math.floor(letters.size / 26) + 1) : ''));
    return { ...sec, letter: letters.get(key)! };
  });
}

/** A track's clips touching a stretch. */
export const clipsIn = (clips: readonly Clip[], trackId: string, from: number, to: number): Clip[] =>
  clips.filter((c) => c.trackId === trackId && c.startBar < to - EPS && c.startBar + c.lengthBars > from + EPS).sort((a, b) => a.startBar - b.startBar);

/** Run `edit` as one undo step (one snapshot before it; store actions inside fold into it). */
function oneStep<T>(edit: () => T): T {
  tl().checkpoint();
  const past = tl().past;
  const result = edit();
  useTimelineStore.setState({ past, future: [] });
  return result;
}

/**
 * A marker at every section's start (but bar 1, unless `start`), so the sections stay where they are while the
 * song changes around them (a song without markers is cut every 4 or 8 bars only until then).
 * No undo step of its own.
 */
function pinSections(sections: readonly PocketSection[], start = false): void {
  const s = tl();
  const tempo = songTempo(s);
  const add = sections.filter((x, i) => (i > 0 || start) && !s.markers.some((m) => m.anchor === 'bar' && Math.abs(m.bar - x.from) < EPS));
  if (!add.length) return;
  let n = s.markers.length;
  const made = add.map((x) => createMarker(x.from, tempo, x.from <= 1 + EPS ? 'Start' : `Section ${++n}`));
  useTimelineStore.setState((st) => ({ markers: retimeMarkers([...st.markers, ...made], songTempo(st)) }));
}

/**
 * The clip a cell edits: the track's one clip spanning the section exactly. Clips across its edges
 * are cut there, and several inside it become one (their notes kept where they play), as one undo
 * step; with nothing there and `create`, an empty clip the section's length. Null for an audio
 * track or an empty cell (without `create`), and (saying why) for clips that can't be one clip
 * as they sound (pocketClips.ts).
 */
export function cellClip(trackId: string, sec: Pick<PocketSection, 'from' | 'to'>, create: boolean): string | null {
  const s = tl();
  const track = s.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const inside = clipsIn(s.clips, trackId, sec.from, sec.to).filter((c) => !c.audio);
  const len = sec.to - sec.from;
  if (inside.length === 1 && Math.abs(inside[0].startBar - sec.from) < EPS && Math.abs(inside[0].lengthBars - len) < EPS) return inside[0].id;
  if (!inside.length) {
    if (!create) return null;
    if (s.clips.some((c) => c.trackId === trackId && c.audio && c.startBar < sec.to - EPS && c.startBar + c.lengthBars > sec.from + EPS)) return null;
    // (Without taking the studio's clip selection: a cell isn't chosen there)
    const chosen = new Set(s.clips.filter((c) => c.isSelected).map((c) => c.id));
    const id = s.createEmptyClip(trackId, sec.from, len);
    useTimelineStore.setState((st) => ({
      clips: st.clips.map((c) => {
        const want = c.id !== id && chosen.has(c.id);
        return c.isSelected === want ? c : { ...c, isSelected: want };
      }),
    }));
    return id;
  }
  const tempo = songTempo(s);
  const keep: Clip[] = [];
  const mids: Clip[] = [];
  for (const c of inside) {
    let mid: Clip | null = c;
    if (mid.startBar < sec.from - EPS) {
      const halves = splitClipAt(mid, sec.from, tempo);
      if (halves) {
        keep.push(halves[0]);
        mid = halves[1];
      }
    }
    if (mid && mid.startBar + mid.lengthBars > sec.to + EPS) {
      const halves = splitClipAt(mid, sec.to, tempo);
      if (halves) {
        mid = halves[0];
        keep.push(halves[1]);
      }
    }
    if (mid) mids.push(mid);
  }
  const first = mids[0];
  const one = mids.length === 1 && Math.abs(first.startBar - sec.from) < EPS;
  // Each piece's notes and lanes, where they play in the section (or why they can't be one clip)
  const content = one ? { notes: first.notes.filter((n) => n.startOffset < first.lengthBars - EPS) } : mergePieces(mids, sec.from, () => uid('note'));
  if (typeof content === 'string') {
    showToast(content);
    return null;
  }
  const { expression: _e, stepLanes: _l, groove: _g, wobble: _w, takes: _t, comp: _c, ...frame } = unlinked(first);
  return oneStep(() => {
    const merged: Clip = { ...(one ? first : frame), ...content, id: one ? first.id : uid('clip'), startBar: sec.from, lengthBars: len, isSelected: false };
    const gone = new Set(inside.map((c) => c.id));
    useTimelineStore.setState((st) => ({ clips: [...st.clips.filter((c) => !gone.has(c.id)), ...keep, merged] }));
    return merged.id;
  });
}

/** The clips of a stretch, cut at its edges, moved by `shift` bars; note clips that sit wholly inside are linked to their copies. */
function copiesOf(from: number, to: number, shift: number): { copies: Clip[]; linked: Map<string, string> } {
  const s = tl();
  const tempo = songTempo(s);
  const copies: Clip[] = [];
  const linked = new Map<string, string>();
  for (const c of s.clips) {
    if (c.startBar >= to - EPS || c.startBar + c.lengthBars <= from + EPS) continue;
    const t = s.tracks.find((x) => x.id === c.trackId);
    if (!t || isMixTrack(t)) continue;
    const whole = c.startBar >= from - EPS && c.startBar + c.lengthBars <= to + EPS;
    let part: Clip | null = c;
    if (!whole) {
      if (part.startBar < from - EPS) part = splitClipAt(part, from, tempo)?.[1] ?? null;
      if (part && part.startBar + part.lengthBars > to + EPS) part = splitClipAt(part, to, tempo)?.[0] ?? null;
    }
    if (!part) continue;
    const link = whole && canLink(c);
    const pattern = link ? (c.pattern ?? uid('pattern')) : undefined;
    if (link && !c.pattern) linked.set(c.id, pattern!);
    copies.push(sectionCopy(part, shift, uid('clip'), link ? pattern : undefined, () => uid('note')));
  }
  return { copies, linked };
}

/** Put the copies in, and the originals they're linked to into their patterns. */
function addCopies({ copies, linked }: ReturnType<typeof copiesOf>): void {
  useTimelineStore.setState((st) => ({ clips: [...st.clips.map((c) => (linked.has(c.id) ? { ...c, pattern: linked.get(c.id) } : c)), ...copies] }));
}

/** A marker at `bar` named `name` (when none is there yet). */
function markAt(bar: number, name: string): void {
  const st = tl();
  if (st.markers.some((m) => m.anchor === 'bar' && Math.abs(m.bar - bar) < EPS)) return;
  useTimelineStore.setState((x) => ({ markers: retimeMarkers([...x.markers, createMarker(bar, songTempo(x), name)], songTempo(x)) }));
}

/** The name of the marker at `bar`, or `fallback` (no marker there, or one Pocket numbered). */
const markerNameAt = (bar: number, fallback: string) => {
  const name = tl().markers.find((m) => m.anchor === 'bar' && Math.abs(m.bar - bar) < EPS)?.name;
  // (Pocket's own numbered names follow the section's new place; a name someone gave stays)
  return name && !/^(Section \d+|Start)$/.test(name) ? name : fallback;
};

/** Copy section `i` to right after itself (linked), moving the rest of the song later. Returns a message when it can't. */
export function copySection(i: number): string | null {
  const sections = pocketSections();
  const sec = sections[i];
  if (!sec) return null;
  const len = sec.to - sec.from;
  // A song with nothing in it yet has nothing to copy
  if (songEnd(tl().clips) <= 1 + EPS) return 'Write something in this section first, then copy it.';
  let error: string | null = null;
  oneStep(() => {
    pinSections(sections);
    const copies = copiesOf(sec.from, sec.to, len);
    error = tl().insertBars(sec.to, len);
    if (error) return;
    addCopies(copies);
    // A copy of a named section ("Verse") is named the same; one with no marker after its place in the song
    markAt(sec.to, markerNameAt(sec.from, `Section ${i + 2}`));
  });
  if (error) {
    tl().undo();
    return error;
  }
  return null;
}

/** Take section `i` out of the song: its bars go, and the rest of the song moves up. */
export function removeSection(i: number): string | null {
  const sections = pocketSections();
  const sec = sections[i];
  if (!sec) return null;
  if (sections.length < 2) return "It's the only section: there'd be no song left.";
  let error: string | null = null;
  oneStep(() => {
    pinSections(sections);
    error = tl().removeBars(sec.from, sec.to);
  });
  if (error) {
    tl().undo();
    return error;
  }
  return null;
}

/** Swap section `i` with the one before (-1) or after (+1) it. */
export function moveSection(i: number, dir: -1 | 1): string | null {
  const sections = pocketSections();
  const a = sections[dir < 0 ? i - 1 : i];
  const b = sections[dir < 0 ? i : i + 1];
  if (!a || !b) return null;
  const lenB = b.to - b.from;
  let error: string | null = null;
  oneStep(() => {
    pinSections(sections, true);
    const name = markerNameAt(b.from, `Section ${(dir < 0 ? i : i + 1) + 1}`);
    // B's bars copied to where A starts, after making room there; then B's own bars (now
    // later by its length) taken out. The copies keep B's links to sections elsewhere.
    const { copies } = copiesOf(b.from, b.to, a.from - b.from);
    for (const c of copies) if (!tl().clips.some((o) => o.pattern && o.pattern === c.pattern && (o.startBar < b.from - EPS || o.startBar >= b.to - EPS))) delete c.pattern;
    error = tl().insertBars(a.from, lenB);
    if (error) return;
    addCopies({ copies, linked: new Map() });
    error = tl().removeBars(b.from + lenB, b.to + lenB);
    if (error) return;
    markAt(a.from, name);
  });
  if (error) {
    tl().undo();
    return error;
  }
  return null;
}

/** Make section `i`'s clips its own: edits to it no longer change the sections it was copied from or to. */
export function unlinkSection(i: number): void {
  const sec = pocketSections()[i];
  if (!sec) return;
  const s = tl();
  const ids = s.clips.filter((c) => c.pattern && c.startBar >= sec.from - EPS && c.startBar < sec.to - EPS).map((c) => c.id);
  s.makeClipsUnique(ids);
}

/** Whether any clip in section `i` is linked to clips elsewhere. */
export function sectionIsLinked(sec: Pick<PocketSection, 'from' | 'to'>, clips: readonly Clip[]): boolean {
  const inside = clips.filter((c) => c.pattern && c.startBar >= sec.from - EPS && c.startBar < sec.to - EPS);
  return inside.some((c) => clips.some((o) => o.id !== c.id && o.pattern === c.pattern && (o.startBar < sec.from - EPS || o.startBar >= sec.to - EPS)));
}
