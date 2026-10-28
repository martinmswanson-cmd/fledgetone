/**
 * The cell Pocket's drawer edits: the selected track in the selected section. Its notes are read
 * relative to the section's start (from whatever clips are there), and the first edit makes the
 * cell one clip spanning the section (pocketSections.cellClip), so every edit after is a plain
 * change of that clip's notes. Also the hooks the screens share: the song's sections, the selected
 * track and section, and the key.
 */
import { useMemo } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import type { Clip, NoteEvent, Track } from '../store/timelineTypes';
import { detectKey, keyOf, type SongKey } from '../store/songKey';
import { cellClip, clipsIn, gridTracks, pocketSections, type PocketSection } from './pocketSections';
import { usePocket } from './pocketStore';
import { foldSteps } from './pocketClips';

const EPS = 1e-6;

/** The song's sections, worked out again when the song changes. */
export function useSections(): PocketSection[] {
  const clips = useTimelineStore((s) => s.clips);
  const markers = useTimelineStore((s) => s.markers);
  const tracks = useTimelineStore((s) => s.tracks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pocketSections(useTimelineStore.getState()), [clips, markers, tracks]);
}

/** The selected track (else the first Pocket shows) and section (kept inside the song). */
export function useSelection(): { track: Track | null; sec: PocketSection; index: number; sections: PocketSection[] } {
  const sections = useSections();
  const tracks = useTimelineStore((s) => s.tracks);
  const trackId = usePocket((p) => p.trackId);
  const wanted = usePocket((p) => p.section);
  const shown = gridTracks(tracks);
  const track = shown.find((t) => t.id === trackId) ?? shown[0] ?? null;
  const index = Math.max(0, Math.min(sections.length - 1, wanted));
  return { track, sec: sections[index], index, sections };
}

/** The key the note editors follow: the one picked, else the song's (worked out from its notes), else A minor. */
export function useSongKey(): SongKey {
  const picked = usePocket((p) => p.key);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  return useMemo(() => picked ?? detectKey(clips, tracks) ?? keyOf(9, 'minor'), [picked, clips, tracks]);
}

/** What a track plays in a section, as notes relative to the section's start (those sounding from earlier left out). */
export function sectionNotes(clips: readonly Clip[], trackId: string, sec: Pick<PocketSection, 'from' | 'to'>): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const c of clipsIn(clips, trackId, sec.from, sec.to)) {
    if (c.audio) continue;
    for (const n of c.notes) {
      const at = c.startBar + n.startOffset;
      if (at < sec.from - EPS || at >= sec.to - EPS || n.startOffset >= c.lengthBars - EPS) continue;
      out.push({ ...n, startOffset: at - sec.from });
    }
  }
  return out;
}

/**
 * Run `edit` as one undo step at most: the steps its store actions push (making the cell's clip,
 * then changing it) fold into the first, the song as it was before.
 */
export function inOneStep<T>(edit: () => T): T {
  const before = useTimelineStore.getState().past;
  const result = edit();
  const past = foldSteps(before, useTimelineStore.getState().past);
  if (past) useTimelineStore.setState({ past });
  return result;
}

/**
 * Change the cell's notes: `edit` gets them (relative to the section) and returns the new ones.
 * Makes the cell one clip first when it isn't. `undo`: make this its own undo step (false for the
 * moves of a gesture that checkpointed when it began). Either way, making the clip and the change
 * are one step.
 */
export function editCell(trackId: string, sec: Pick<PocketSection, 'from' | 'to'>, edit: (notes: NoteEvent[]) => NoteEvent[], undo = true): void {
  inOneStep(() => {
    const id = cellClip(trackId, sec, true);
    if (!id) return;
    const s = useTimelineStore.getState();
    const clip = s.clips.find((c) => c.id === id);
    if (!clip) return;
    if (undo) s.checkpoint();
    s.setClipNotes(id, edit(clip.notes));
  });
}
