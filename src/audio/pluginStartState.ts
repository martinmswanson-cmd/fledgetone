/**
 * Which settings a plugin starts from when it's built again: the ones last read from it live, or
 * the ones its track holds. Live reads win (a knob just turned, read as the old instance was let
 * go, is newer than the track's copy the rebuild began with), unless the track's settings were
 * changed from outside since: a song's settings put on the track by the store (a script, a
 * restore) that no live read and no earlier build ever saw. Those are the newer ones, and the
 * stale live read is dropped. wamHost.ts keeps one of these; plain logic, so Node tests it
 * (scripts/pluginStartState.test.mjs).
 */

/** How many settings per plugin are remembered as seen (a rebuild only ever starts from one of the last few). */
const KEEP = 16;

/** A short fingerprint of settings as JSON (their length and an FNV-1a hash), so long settings aren't kept twice. */
function fingerprint(json: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${json.length}:${h.toString(36)}`;
}

export interface StartStates {
  /** Settings `json` of plugin `id` are known: read live, or what a build started from. */
  seen: (id: string, json: string) => void;
  /**
   * What plugin `id` starts from: 'live' (its last live read, `liveJson`) or 'saved' (the track's,
   * `savedJson`; undefined: none). 'saved' when there's no live read, or when the track's
   * settings are ones never seen (changed from outside since the live read).
   */
  choose: (id: string, savedJson: string | undefined, liveJson: string | undefined) => 'live' | 'saved';
  /** Forget everything (a project replaced). */
  clear: () => void;
}

export function createStartStates(): StartStates {
  const known = new Map<string, string[]>();
  const seen = (id: string, json: string) => {
    const f = fingerprint(json);
    const list = known.get(id) ?? [];
    const at = list.indexOf(f);
    if (at >= 0) list.splice(at, 1);
    list.push(f);
    if (list.length > KEEP) list.shift();
    known.set(id, list);
  };
  return {
    seen,
    choose: (id, savedJson, liveJson) => {
      if (liveJson === undefined) return 'saved';
      if (savedJson === undefined || savedJson === liveJson) return 'live';
      return known.get(id)?.includes(fingerprint(savedJson)) ? 'live' : 'saved';
    },
    clear: () => known.clear(),
  };
}

/**
 * When the track's settings win (choose gave 'saved'), what becomes of the plugin's live settings:
 * with an instance of it still playing live, the track's are put on it ('push'), else an offline
 * render (an export, a freeze, a loudness match, stems) would play the track's settings while the
 * live instance kept the old ones, and the next live read (every 3 s) would write those back over
 * the track; with none live, the stale read is simply forgotten ('forget').
 */
export const whenSavedWins = (liveUp: boolean): 'push' | 'forget' => (liveUp ? 'push' : 'forget');
