/**
 * Pocket's "bounce a section to a pad": the section (everything playing, or one track) rendered
 * onto a Drum Rack pad (see bounceToPadActions.ts), with what it says as it goes, and the drawer
 * then showing that pad. Used by the section sheet and the Pads tool.
 */
import { useTimelineStore } from '../store/timelineStore';
import { bounceName } from '../store/bounceToPad';
import { bounceRangeToPad, placedMessage, type PadPlaced } from '../store/bounceToPadActions';
import { showToast } from '../components/timeline/toastStore';
import type { PocketSection } from './pocketSections';
import { usePocket } from './pocketStore';

/**
 * Bounce a section (the whole mix, or only `trackId`) onto a pad: `target`'s, else the first
 * empty one, else a new Bounces track. Says how it went. Resolves to where it went, or null.
 */
export async function bounceSection(sec: PocketSection, trackId?: string, target?: { trackId: string; pad?: number }): Promise<PadPlaced | null> {
  const only = trackId ? useTimelineStore.getState().tracks.find((t) => t.id === trackId) : undefined;
  const name = bounceName(sec.from, sec.to, `${sec.name} (${sec.letter})`, only?.name);
  try {
    const placed = await bounceRangeToPad({ from: sec.from, to: sec.to, trackId, name, target });
    if (placed) {
      showToast(placedMessage(`"${name}"`, placed));
      // Its pads open on the new sound
      usePocket.getState().set({ trackId: placed.trackId, rackPad: placed.pad, tool: 'sound', mixAll: false });
    }
    return placed;
  } catch (err) {
    showToast(`Couldn't bounce ${sec.letter}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
