/**
 * Keeping a song's processed sounds up to date as the processing gets better. An audio clip moved
 * into another key plays a re-pitched copy of its sound (flipActions.ts); one made by an older
 * re-pitch (shiftVersion.ts) is made again from its original with the current one, in the
 * background (a Worker does the work), one clip at a time, and swapped in with no undo step: the
 * song is the same, it just sounds cleaner. A clip whose original isn't in this browser is left as
 * it is. (Time-stretched clips need nothing: their stretched copies are made as they play, by the
 * current stretch.)
 */
import { useTimelineStore } from './timelineStore';
import { SHIFT_VERSION, staleShifts } from './shiftVersion';
import { shiftedSound } from './flipActions';
import { soundStatus } from '../audio/soundLibrary';

/** Sounds made again this session, by original and shift: clips sharing them share the new copy. */
const made = new Map<string, Promise<string>>();
/** Originals that couldn't be read: not tried again this session. */
const failed = new Set<string>();
let busy = false;

async function upgradeOne(): Promise<void> {
  const s = useTimelineStore.getState();
  const next = staleShifts(s.clips).find((c) => !failed.has(c.from) && soundStatus(c.from) !== 'missing' && soundStatus(c.from) !== 'error');
  if (!next) return;
  busy = true;
  const key = `${next.from}|${next.shift}`;
  try {
    let promise = made.get(key);
    if (!promise) {
      const clip = s.clips.find((c) => c.id === next.clipId);
      promise = shiftedSound(next.from, next.shift, clip?.name ?? 'Audio').then((m) => m.id);
      made.set(key, promise);
    }
    const soundId = await promise;
    // Swapped in only if the clip still plays what it did (not edited meanwhile); no undo step
    useTimelineStore.setState((st) => ({
      clips: st.clips.map((c) =>
        c.id === next.clipId && c.audio?.soundId === next.soundId && c.audio.shiftedFrom === next.from && c.audio.shift === next.shift
          ? { ...c, audio: { ...c.audio, soundId, shiftVersion: SHIFT_VERSION } }
          : c
      ),
    }));
  } catch {
    made.delete(key);
    failed.add(next.from);
  } finally {
    busy = false;
  }
}

/** Start keeping the song's key-moved clips up to date; returns the stop. */
export function startSoundUpgrade(): () => void {
  const timer = window.setInterval(() => {
    if (!busy) void upgradeOne();
  }, 3000);
  return () => window.clearInterval(timer);
}
