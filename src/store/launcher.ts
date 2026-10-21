import { songTempo, splitClipAt, useTimelineStore } from './timelineStore';
import type { Clip, LauncherSlot, SlotClip, Track } from './timelineTypes';
import { TOTAL_BARS, uid } from './timelineTypes';
import { isMixTrack } from './buses';
import { songSections } from './cutToLength';
import { songMeterOf } from './timelineStore';
import { launcherActive, queuedAfter, segmentAt, slotAt, slotCopies, useLauncher } from './launcherView';
import type { Segment } from './launcherView';
import { getScheduledPositionBar } from '../audio/transport';

/**
 * The clip launcher: a grid of clips, a column per track and a row per scene, to play loops live
 * and jam an arrangement together. Launching a slot plays its clip on its track over and over from
 * the next bar line, in place of the track's arrangement; launching a scene launches its whole row.
 * Stop the transport and the song plays its arrangement again. What was played can be written into
 * the arrangement.
 *
 * Slots are kept on their tracks (Track.slots: saved, and undone with everything else); what is
 * playing is in useLauncher (launcherView.ts), which the live engine follows.
 */

const EPS = 1e-6;
/** Scenes shown at least (more appear as they fill up) */
export const MIN_SCENES = 8;
/** Scenes at most */
export const MAX_SCENES = 64;

const tl = () => useTimelineStore.getState();

/** The rows the grid shows: at least MIN_SCENES, and one empty row after the last one used. */
export function sceneCount(tracks: readonly Track[]): number {
  let last = -1;
  for (const t of tracks) for (const s of t.slots ?? []) last = Math.max(last, s.scene);
  return Math.min(MAX_SCENES, Math.max(MIN_SCENES, last + 2));
}

/** The bar the next launch lands on: the next multiple of the quantize while playing (with a little room to schedule), else the playhead's bar. */
export function nextLaunchBar(): number {
  const s = tl();
  const q = useLauncher.getState().quantize;
  if (!s.isPlaying) return Math.max(1, Math.floor(s.playheadPosition + EPS));
  const pos = getScheduledPositionBar();
  return Math.min(TOTAL_BARS, 1 + Math.ceil((pos - 1 + 0.01) / q - EPS) * q);
}

/** Put `seg` on each of `trackIds` (replacing whatever was waiting there), then start playing if stopped. */
function schedule(trackIds: readonly string[], make: (trackId: string) => Segment | null): void {
  if (!trackIds.length) return;
  const at = nextLaunchBar();
  const wasPlaying = tl().isPlaying;
  const L = useLauncher.getState();
  const segments = { ...L.segments };
  for (const id of trackIds) {
    const seg = make(id);
    if (!seg) continue;
    const kept = (segments[id] ?? []).filter((s) => s.from < at - EPS);
    segments[id] = [...kept, { ...seg, from: at } as Segment];
  }
  useLauncher.setState({ segments, start: L.start ?? at });
  if (!wasPlaying) {
    tl().seek(at);
    void tl().play();
  }
}

const playable = (t: Track) => !isMixTrack(t);

/** Launch a track's slot (from the next bar line). */
export function launchSlot(trackId: string, scene: number): void {
  const track = tl().tracks.find((t) => t.id === trackId);
  if (!track || !slotAt(track, scene)) return;
  schedule([trackId], () => ({ from: 0, kind: 'slot', scene }));
}

/** Launch a whole scene: its tracks play their slots, every other track stops. */
export function launchScene(scene: number): void {
  // Every track is in a scene: one with nothing in this row stops
  const tracks = tl().tracks.filter(playable);
  const ids = tracks.map((t) => t.id);
  schedule(ids, (id) => (slotAt(tracks.find((t) => t.id === id)!, scene) ? { from: 0, kind: 'slot', scene } : { from: 0, kind: 'stop' }));
}

/** Stop a track's slot (at the next bar line): it plays nothing until launched again. */
export function stopSlot(trackId: string): void {
  if (!tl().isPlaying) return;
  schedule([trackId], () => ({ from: 0, kind: 'stop' }));
}

/** Stop every slot at the next bar line. */
export function stopAllSlots(): void {
  if (!tl().isPlaying) return;
  schedule(Object.keys(useLauncher.getState().segments), () => ({ from: 0, kind: 'stop' }));
}

/** Every track plays its arrangement again, from the next bar line. */
export function backToArrangement(): void {
  const ids = Object.keys(useLauncher.getState().segments);
  if (!tl().isPlaying) {
    useLauncher.setState({ segments: {}, start: null });
    return;
  }
  schedule(ids, () => ({ from: 0, kind: 'arr' }));
}

/** What a track is doing at `bar`: the scene it's playing (or null), and what's waiting for its bar line. */
export function trackState(trackId: string, bar: number): { playing: number | null; stopped: boolean; queued: Segment | null } {
  const segs = useLauncher.getState().segments[trackId];
  const now = segmentAt(segs, bar);
  return {
    playing: now?.kind === 'slot' ? now.scene : null,
    stopped: now?.kind === 'stop',
    queued: queuedAfter(segs, bar)[0] ?? null,
  };
}

// ---------- Filling slots (one undo step each) ----------

function setSlots(trackId: string, change: (slots: LauncherSlot[]) => LauncherSlot[]): void {
  tl().checkpoint();
  useTimelineStore.setState((s) => ({
    tracks: s.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const slots = change(t.slots ?? []).sort((a, b) => a.scene - b.scene);
      const { slots: _old, ...rest } = t;
      return slots.length ? { ...rest, slots } : rest;
    }),
  }));
}

/** One slot clip from clips of one track: everything from the first start to the last end. */
export function slotFromClips(clips: readonly Clip[], name?: string): SlotClip | null {
  if (!clips.length) return null;
  const from = Math.min(...clips.map((c) => c.startBar));
  const to = Math.max(...clips.map((c) => c.startBar + c.lengthBars));
  const audio = clips.find((c) => c.audio);
  // An audio slot plays one sound: the first
  if (audio) return { name: name ?? audio.name, lengthBars: audio.lengthBars, notes: [], audio: audio.audio, ...(audio.wobble ? { wobble: audio.wobble } : {}) };
  const notes = clips.flatMap((c) => c.notes.filter((n) => n.startOffset < c.lengthBars - EPS).map((n) => ({ ...n, id: uid('note'), startOffset: n.startOffset + c.startBar - from })));
  const one = clips.length === 1 ? clips[0] : null;
  return {
    name: name ?? clips[0].name,
    lengthBars: Math.max(1 / 16, to - from),
    notes,
    ...(clips[0].wobble ? { wobble: clips[0].wobble } : {}),
    ...(clips[0].groove ? { groove: clips[0].groove } : {}),
    ...(one?.expression ? { expression: one.expression } : {}),
    ...(one?.stepLanes ? { stepLanes: one.stepLanes } : {}),
  };
}

/** Put a slot clip in `scene` of a track (replacing what was there). */
export function setSlot(trackId: string, scene: number, clip: SlotClip): void {
  setSlots(trackId, (slots) => [...slots.filter((s) => s.scene !== scene), { scene, clip }]);
}

/** Empty a slot. */
export function clearSlot(trackId: string, scene: number): void {
  const track = tl().tracks.find((t) => t.id === trackId);
  if (!track || !slotAt(track, scene)) return;
  setSlots(trackId, (slots) => slots.filter((s) => s.scene !== scene));
}

/** Move (or with `copy`, copy) a slot to another scene and/or another track of the same kind of sound. */
export function moveSlot(fromTrack: string, fromScene: number, toTrack: string, toScene: number, copy = false): boolean {
  const s = tl();
  const src = s.tracks.find((t) => t.id === fromTrack);
  const dst = s.tracks.find((t) => t.id === toTrack);
  const slot = src && slotAt(src, fromScene);
  if (!slot || !dst || isMixTrack(dst) || (fromTrack === toTrack && fromScene === toScene)) return false;
  // Audio plays only on Audio tracks, notes only on instruments
  if (!!slot.clip.audio !== (dst.instrumentKey === 'audio')) return false;
  s.checkpoint();
  useTimelineStore.setState((st) => ({
    tracks: st.tracks.map((t) => {
      let slots = t.slots ?? [];
      if (t.id === fromTrack && !copy) slots = slots.filter((x) => x.scene !== fromScene);
      if (t.id === toTrack) slots = [...slots.filter((x) => x.scene !== toScene), { scene: toScene, clip: slot.clip }].sort((a, b) => a.scene - b.scene);
      if (slots === t.slots) return t;
      const { slots: _old, ...rest } = t;
      return slots.length ? { ...rest, slots } : rest;
    }),
  }));
  return true;
}

/** The selected clips into the launcher: each track's into its first empty slot (or `scene`). Returns how many slots were filled. */
export function sendSelectionToLauncher(scene?: number): number {
  const s = tl();
  const byTrack = new Map<string, Clip[]>();
  for (const c of s.clips) if (c.isSelected) byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c]);
  if (!byTrack.size) return 0;
  s.checkpoint();
  let filled = 0;
  useTimelineStore.setState((st) => ({
    tracks: st.tracks.map((t) => {
      const clips = byTrack.get(t.id);
      const clip = clips && slotFromClips(clips);
      if (!clip || isMixTrack(t)) return t;
      const used = new Set((t.slots ?? []).map((x) => x.scene));
      let at = scene ?? 0;
      if (scene === undefined) while (used.has(at) && at < MAX_SCENES - 1) at++;
      filled++;
      return { ...t, slots: [...(t.slots ?? []).filter((x) => x.scene !== at), { scene: at, clip }].sort((a, b) => a.scene - b.scene) };
    }),
  }));
  return filled;
}

/** The clips of a track between `from` and `to`, cut at both ends. */
function clipsBetween(s: ReturnType<typeof tl>, trackId: string, from: number, to: number): Clip[] {
  const tempo = songTempo(s);
  const out: Clip[] = [];
  for (const c of s.clips) {
    if (c.trackId !== trackId || c.startBar >= to - EPS || c.startBar + c.lengthBars <= from + EPS) continue;
    let part: Clip | null = c;
    if (part.startBar < from - EPS) part = splitClipAt(part, from, tempo)?.[1] ?? null;
    if (part && part.startBar + part.lengthBars > to + EPS) part = splitClipAt(part, to, tempo)?.[0] ?? null;
    if (part) out.push(part);
  }
  return out;
}

/**
 * A stretch of the arrangement as one scene: each track with something there gets a slot of
 * exactly that length (its clips there, cut at the edges). Returns how many slots were filled.
 */
export function sceneFromRange(from: number, to: number, scene: number, name?: string): number {
  const s = tl();
  const slots = new Map<string, SlotClip>();
  for (const t of s.tracks) {
    if (isMixTrack(t)) continue;
    const parts = clipsBetween(s, t.id, from, to);
    const clip = slotFromClips(parts, name);
    if (!clip || (!clip.audio && !clip.notes.length)) continue;
    // The scene's length, so every slot of it loops together
    if (clip.audio) {
      const a = parts.find((p) => p.audio)!;
      // An audio clip starting late in the stretch would loop from its own start: keep it only when it starts with the stretch
      if (Math.abs(a.startBar - from) > EPS) continue;
    } else {
      clip.lengthBars = to - from;
      const first = Math.min(...parts.map((p) => p.startBar));
      if (first > from + EPS) clip.notes = clip.notes.map((n) => ({ ...n, startOffset: n.startOffset + first - from }));
    }
    slots.set(t.id, clip);
  }
  if (!slots.size) return 0;
  s.checkpoint();
  useTimelineStore.setState((st) => ({
    tracks: st.tracks.map((t) => {
      const clip = slots.get(t.id);
      if (!clip) return t;
      return { ...t, slots: [...(t.slots ?? []).filter((x) => x.scene !== scene), { scene, clip }].sort((a, b) => a.scene - b.scene) };
    }),
  }));
  return slots.size;
}

/** Every section of the song (between its markers, or every 4 or 8 bars) as a scene, in order. Returns how many scenes. */
export function scenesFromSections(): number {
  const s = tl();
  const sections = songSections(s.clips, s.markers, songMeterOf(s)).slice(0, MAX_SCENES);
  if (!sections.length) return 0;
  // One undo step for them all: the song before them, whatever the history held
  s.checkpoint();
  const past = tl().past;
  let made = 0;
  sections.forEach((sec, i) => {
    if (sceneFromRange(sec.from, sec.to, i, sec.name)) made++;
  });
  // (none made: no step at all)
  useTimelineStore.setState(made ? { past, future: [] } : { past: past.slice(0, -1) });
  return made;
}

/** Empty a whole scene row. */
export function clearScene(scene: number): void {
  const s = tl();
  if (!s.tracks.some((t) => slotAt(t, scene))) return;
  s.checkpoint();
  useTimelineStore.setState((st) => ({
    tracks: st.tracks.map((t) => {
      if (!slotAt(t, scene)) return t;
      const slots = t.slots!.filter((x) => x.scene !== scene);
      const { slots: _old, ...rest } = t;
      return slots.length ? { ...rest, slots } : rest;
    }),
  }));
}

// ---------- Writing a session into the arrangement ----------

/**
 * What was played in the launcher, from its first launch to where it stopped, written into the
 * arrangement (one undo step): where a track played a slot, copies of its clip; where it was
 * stopped, nothing; where it played its arrangement, that stays. Returns the bars written, or
 * null if there's no session.
 */
export function writeSessionToArrangement(): { from: number; to: number } | null {
  const L = useLauncher.getState();
  const s = tl();
  const live = launcherActive(L.segments) && L.start !== null;
  const session = live ? { segments: L.segments, start: L.start!, end: Math.max(L.start!, getScheduledPositionBar()) } : L.last;
  if (!session || session.end <= session.start + EPS) return null;
  const { segments, start } = session;
  // To the end of the bar it stopped in
  const end = Math.min(TOTAL_BARS + 1, Math.ceil(session.end - EPS));
  const tempo = songTempo(s);
  const add: Clip[] = [];
  const cut = new Map<string, Array<[number, number]>>();
  for (const [trackId, segs] of Object.entries(segments)) {
    const track = s.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    segs.forEach((seg, i) => {
      const from = Math.max(seg.from, start);
      const to = Math.min(segs[i + 1]?.from ?? end, end);
      if (to <= from + EPS || seg.kind === 'arr') return;
      cut.set(trackId, [...(cut.get(trackId) ?? []), [from, to]]);
      const slot = seg.kind === 'slot' ? slotAt(track, seg.scene) : undefined;
      if (!slot) return;
      for (const c of slotCopies(trackId, slot.clip, seg.from, to, 'w')) {
        if (c.startBar + c.lengthBars <= from + EPS) continue;
        add.push({ ...c, id: uid('clip'), notes: c.notes.map((n) => ({ ...n, id: uid('note') })), isSelected: true });
      }
    });
  }
  if (!cut.size) return null;
  // The arrangement's clips where slots played (or tracks were stopped) make way: cut at the edges
  const kept: Clip[] = [];
  for (const c of s.clips) {
    const spans = cut.get(c.trackId);
    if (!spans) {
      kept.push(c.isSelected ? { ...c, isSelected: false } : c);
      continue;
    }
    let pieces: Clip[] = [{ ...c, isSelected: false }];
    for (const [from, to] of spans) {
      pieces = pieces.flatMap((p) => {
        const end2 = p.startBar + p.lengthBars;
        if (end2 <= from + EPS || p.startBar >= to - EPS) return [p];
        const out: Clip[] = [];
        if (p.startBar < from - EPS) {
          const left = splitClipAt(p, from, tempo)?.[0];
          if (left) out.push(left);
        }
        if (end2 > to + EPS) {
          const right = splitClipAt(p, to, tempo)?.[1];
          if (right) out.push(right);
        }
        return out;
      });
    }
    kept.push(...pieces);
  }
  s.checkpoint();
  useTimelineStore.setState({ clips: [...kept, ...add] });
  return { from: start, to: end };
}

// When the transport stops, the session ends: the song plays its arrangement again (Write to arrangement can still write it)
useTimelineStore.subscribe((state, prev) => {
  if (!prev.isPlaying || state.isPlaying) return;
  const L = useLauncher.getState();
  if (!launcherActive(L.segments)) return;
  useLauncher.setState({ segments: {}, start: null, last: L.start !== null ? { segments: L.segments, start: L.start, end: Math.max(L.start, prev.playheadPosition) } : L.last });
});

// A deleted track leaves the launcher
useTimelineStore.subscribe((state, prev) => {
  if (state.tracks === prev.tracks) return;
  const L = useLauncher.getState();
  const gone = Object.keys(L.segments).filter((id) => !state.tracks.some((t) => t.id === id));
  if (!gone.length) return;
  const segments = { ...L.segments };
  for (const id of gone) delete segments[id];
  useLauncher.setState({ segments });
});
