import type { AutomationParam, Clip, FrozenTrack, Track } from './timelineTypes';
import { defaultTrackFx } from './timelineTypes';
import { isDrumKind } from '../audio/instrumentCatalog';
import { barToSeconds, secondsToBar, type TempoMap, type TempoPoint } from '../audio/tempoMap';

/**
 * Freezing a track: its instrument, inserts and EQ are rendered once to a sound, and live
 * playback plays that instead, so a frozen track costs about as much as one audio clip.
 *
 * The live engine never knows: liveView() hands it each frozen track as an Audio track with one
 * audio clip of the frozen sound, inserts off and EQ flat (they're in the sound). Volume, pan and
 * the sends, and their automation, stay live, so a frozen track can still be mixed.
 *
 * Anything else that went into the render (notes, instrument, inserts, EQ and their automation,
 * tempo, swing, and the kicks a kick-triggered Pump follows) is summed up in a fingerprint. Once
 * it no longer matches, the freeze is out of date: the track plays live again until it's frozen
 * anew. Nothing ever plays stale audio.
 */

/** A track as the live engine gets it: a frozen one says what it was, so its kicks still drive Pumps. */
export type LiveTrackView = Track & { frozenFrom?: Track['instrumentKey'] };

/** Settings that stay live on a frozen track (not rendered into it). */
export const LIVE_PARAMS: ReadonlySet<AutomationParam> = new Set(['volume', 'pan', 'reverbSend', 'delaySend']);

/** FNV-1a over a string, as 8 hex digits. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const clipContent = (c: Clip) => ({
  startBar: c.startBar,
  lengthBars: c.lengthBars,
  wobble: c.wobble,
  audio: c.audio,
  notes: c.notes.map((n) => [n.note, n.startOffset, n.duration, n.velocity]),
  // (Only when present, so freezes made before these existed stay current)
  ...(c.expression ? { expression: c.expression } : {}),
  ...(c.takes?.length ? { comp: c.comp, takes: c.takes.map((t) => t.audio ?? null) } : {}),
});

/** The last fingerprint of each track object, with the arrangement it was taken from (see freezeFingerprint). */
const fingerprints = new WeakMap<Track, { tracks: Track[]; clips: Clip[]; bpm: number; swing: number; tempoPoints?: TempoPoint[]; value: string }>();

/** What a freeze of `track` depends on, as a short hash. Cached until the track or arrangement changes. */
export function freezeFingerprint(track: Track, all: { tracks: Track[]; clips: Clip[]; bpm: number; swing: number; tempoPoints?: TempoPoint[] }): string {
  const hit = fingerprints.get(track);
  if (hit && hit.clips === all.clips && hit.tracks === all.tracks && hit.bpm === all.bpm && hit.swing === all.swing && hit.tempoPoints === all.tempoPoints) return hit.value;
  const value = computeFingerprint(track, all);
  fingerprints.set(track, { tracks: all.tracks, clips: all.clips, bpm: all.bpm, swing: all.swing, tempoPoints: all.tempoPoints, value });
  return value;
}

function fxPrint(fx: Track['fx']): Partial<Track['fx']> {
  const { peq, mbc, ...rest } = fx;
  return { ...rest, ...(peq?.on ? { peq } : {}), ...(mbc?.on ? { mbc } : {}) };
}

function computeFingerprint(track: Track, all: { tracks: Track[]; clips: Clip[]; bpm: number; swing: number; tempoPoints?: TempoPoint[] }): string {
  const own = all.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.startBar - b.startBar || a.id.localeCompare(b.id));
  const followsKick = track.fx.pump.on && track.fx.pump.trigger === 'kick';
  // A kick-triggered Pump ducks on the kicks of the drum tracks that sound (as live playback
  // does), so those are part of the sound too: muting or soloing them changes it
  const anySolo = all.tracks.some((t) => t.isSoloed);
  const kickers = new Set(all.tracks.filter((t) => isDrumKind(t.instrumentKey) && !t.isMuted && (!anySolo || t.isSoloed)).map((t) => t.id));
  const kicks = followsKick
    ? all.clips
        .filter((c) => kickers.has(c.trackId))
        .flatMap((c) => c.notes.filter((n) => n.note === 'C1').map((n) => +(c.startBar + n.startOffset).toFixed(6)))
        .sort((a, b) => a - b)
    : [];
  // A Pump that follows a track ducks on that track's notes, muted or not
  const source = track.fx.pump.on && track.fx.pump.trigger === 'track' ? track.fx.pump.source : undefined;
  const sourceNotes = source
    ? all.clips
        .filter((c) => c.trackId === source)
        .flatMap((c) => c.notes.filter((n) => n.startOffset < c.lengthBars).map((n) => +(c.startBar + n.startOffset).toFixed(6)))
        .sort((a, b) => a - b)
    : [];
  return hash(
    JSON.stringify({
      key: track.instrumentKey,
      sample: track.sample,
      slicer: track.slicer,
      synth: track.synth,
      ...(track.plugin ? { plugin: track.plugin } : {}),
      ...(track.pluginFx?.length ? { pluginFx: track.pluginFx } : {}),
      // (The newer inserts only while on, so tracks frozen before they existed stay frozen)
      fx: fxPrint(track.fx),
      eq: track.eq,
      automation: (track.automation ?? []).filter((l) => !LIVE_PARAMS.has(l.param)),
      clips: own.map(clipContent),
      bpm: all.bpm,
      ...(all.tempoPoints?.length ? { tempoPoints: all.tempoPoints.map((p) => [p.bar, p.bpm, p.ramp]) } : {}),
      swing: all.swing,
      kicks,
      sourceNotes,
    })
  );
}

/** The track as the freeze renders it: centred, at 0 dB, no sends (those stay live). */
export function trackForFreezing(track: Track): Track {
  return {
    ...track,
    volume: 0,
    pan: 0,
    reverbSend: 0,
    delaySend: 0,
    isMuted: false,
    isSoloed: false,
    automation: (track.automation ?? []).filter((l) => !LIVE_PARAMS.has(l.param)),
    frozen: undefined,
    // Rendered to the master, not through its bus: live, the frozen sound still plays into the bus
    output: undefined,
  };
}

/** Whether a track's freeze still matches what it was rendered from (and its sound is there). */
export function freezeIsCurrent(
  track: Track,
  all: { tracks: Track[]; clips: Clip[]; bpm: number; swing: number; tempoPoints?: TempoPoint[] },
  soundMissing: (id: string) => boolean
): track is Track & { frozen: FrozenTrack } {
  // An armed track plays live, so a MIDI keyboard played into it is heard
  return !!track.frozen && !track.isArmed && !soundMissing(track.frozen.soundId) && track.frozen.fingerprint === freezeFingerprint(track, all);
}

export const frozenClipId = (trackId: string) => `frozen:${trackId}`;

/** How many bars `seconds` of frozen sound from `startBar` lasts, through the song's tempo changes. */
const frozenLengthBars = (startBar: number, seconds: number, tempo: TempoMap) => secondsToBar(barToSeconds(startBar, tempo) + seconds, tempo) - startBar;


export interface LiveView {
  tracks: Track[];
  clips: Clip[];
  /** Per track id: the store's track and what the engine was given for it (for reuse next time). */
  source: Map<string, Track>;
  view: Map<string, Track>;
  baseClips: Clip[];
  frozenKey: string;
}

/**
 * What the live engine plays: each frozen track with a current freeze becomes an Audio track
 * playing its frozen sound (its note clips stay, so its kicks still drive other tracks' Pumps,
 * but an Audio track plays no notes). Everything else is passed through as it is.
 */
export function liveView(
  all: { tracks: Track[]; clips: Clip[]; bpm: number; swing: number; tempoPoints?: TempoPoint[] },
  soundMissing: (id: string) => boolean,
  previous?: LiveView
): LiveView {
  const source = new Map<string, Track>();
  const view = new Map<string, Track>();
  const frozenClips: Clip[] = [];
  let changed = !previous || previous.tracks.length !== all.tracks.length;
  const tracks = all.tracks.map((t, i) => {
    let out: LiveTrackView = t;
    if (freezeIsCurrent(t, all, soundMissing)) {
      const f = t.frozen;
      // Reuse the last view of an unchanged track, so the engine leaves its strip alone
      const before = previous?.source.get(t.id) === t && previous.view.get(t.id) !== t ? previous.view.get(t.id) : undefined;
      out = before ?? {
        ...t,
        instrumentKey: 'audio',
        frozenFrom: t.instrumentKey,
        sample: undefined,
        slicer: undefined,
        // Its plugins are in the sound, and it plays straight into its bus (whose sound isn't)
        plugin: undefined,
        pluginFx: undefined,
        fx: defaultTrackFx(),
        eq: { low: 0, mid: 0, high: 0 },
        automation: (t.automation ?? []).filter((l) => LIVE_PARAMS.has(l.param)),
      };
      frozenClips.push({
        id: frozenClipId(t.id),
        trackId: t.id,
        name: 'Frozen',
        startBar: f.startBar,
        lengthBars: frozenLengthBars(f.startBar, f.seconds, { bpm: all.bpm, points: all.tempoPoints ?? [] }),
        isSelected: false,
        notes: [],
        audio: { soundId: f.soundId, offset: 0, gain: f.gainDb, fadeIn: 0, fadeOut: 0 },
      });
    }
    source.set(t.id, t);
    view.set(t.id, out);
    if (!changed && previous!.tracks[i] !== out) changed = true;
    return out;
  });
  // Same clips and same frozen sounds: the same array, so the engine doesn't reschedule
  const frozenKey = JSON.stringify(frozenClips.map((c) => [c.trackId, c.startBar, c.lengthBars, c.audio]));
  const sameClips = previous && previous.baseClips === all.clips && previous.frozenKey === frozenKey;
  const clips = sameClips ? previous.clips : frozenClips.length ? [...all.clips, ...frozenClips] : all.clips;
  return { tracks: changed ? tracks : previous!.tracks, clips, source, view, baseClips: all.clips, frozenKey };
}
