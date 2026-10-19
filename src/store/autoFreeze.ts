/**
 * Auto-freeze: in a big song, the tracks nobody is working on are frozen by themselves in the
 * background, so playback has room for more. It's the same freeze as the snowflake's (see
 * freeze.ts), with three differences: the renders live in memory only (never in the project, the
 * sound library or undo), they're made and swapped in only while the song is stopped (a render
 * under way pauses while it plays, and nothing changes under a playing song), and a track is left
 * alone until it has gone a few seconds without a change.
 *
 * A change to an auto-frozen track makes its render out of date at once (its fingerprint no
 * longer matches), so it plays live straight away, and is frozen again once it's left alone.
 * Undo back to the frozen state and the render is current again. Exports never use these: they
 * render every track from its notes.
 *
 * Renders take memory (decoded audio), so the busiest tracks go first and they stop at a budget
 * set by the computer's memory. It's a setting for this browser, on by default.
 *
 * A track whose plugin window is open plays live and isn't frozen: the window works the plugin
 * itself, which a render has in place of it (opening the window lets go of the track's render).
 */
import { create } from 'zustand';
import { useTimelineStore } from './timelineStore';
import { freezeFingerprint, freezeIsCurrent } from './freeze';
import { isMixTrack } from './buses';
import { renderTrackChannels, PLAYBACK_DB, useFreezing } from './freezeActions';
import type { FrozenTrack, Track } from './timelineTypes';
import { barToSeconds } from '../audio/tempoMap';
import { INSTRUMENTS, isAudioKind, isDrumKind } from '../audio/instrumentCatalog';
import { dropMemorySound, provideMemorySound, useSoundLibrary } from '../audio/soundLibrary';
import { useUiStore } from './uiStore';

const SETTING_KEY = 'bosBeatbox.autoFreeze';
/** Songs with fewer instrument tracks than this play fine live: nothing is frozen */
export const AUTO_FREEZE_MIN_TRACKS = 6;
/** How long a track must go without a change before it's frozen (ms) */
const SETTLE_MS = 3000;
/** How long the whole song must go without an edit before a render starts (ms) */
const QUIET_MS = 1500;

/**
 * Memory for renders: about 32 MB per GB the browser reports, 128 to 512 MB. (It was twice that.
 * Since silent tracks sleep while the song plays (liveTracks.ts), freezing saves much less: on a
 * 37-track orchestral song 510 MB of renders took the audio thread only from 42% to 37%, and the
 * browser warned about the page's memory.)
 */
const budgetBytes = () => {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return Math.max(128, Math.min(512, gb * 32)) * 1024 * 1024;
};

const readSetting = (): boolean => {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
};

interface AutoFrozen extends FrozenTrack {
  bytes: number;
}

interface AutoFreezeState {
  on: boolean;
  /** The renders the live engine plays, by track */
  frozen: Record<string, AutoFrozen>;
  /** Renders finished while the song played, swapped in when it stops */
  pending: Record<string, AutoFrozen>;
  /** The track being rendered now */
  rendering: string | null;
}

export const useAutoFreeze = create<AutoFreezeState>(() => ({ on: readSetting(), frozen: {}, pending: {}, rendering: null }));

/** The auto-freeze render the live engine may play for a track (liveView checks it's current). */
export const autoFrozenFor = (trackId: string): FrozenTrack | undefined => useAutoFreeze.getState().frozen[trackId];

/** Turn auto-freeze on or off (for this browser). Off lets go of every render at once. */
export function setAutoFreeze(on: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered this time
  }
  if (!on) dropAll();
  useAutoFreeze.setState({ on });
}

/** Let go of a track's render (and one waiting to go in), so it plays live. */
function thaw(trackId: string) {
  const { frozen, pending } = useAutoFreeze.getState();
  if (!frozen[trackId] && !pending[trackId]) return;
  for (const e of [frozen[trackId], pending[trackId]]) if (e) dropMemorySound(e.soundId);
  const nextFrozen = { ...frozen };
  const nextPending = { ...pending };
  delete nextFrozen[trackId];
  delete nextPending[trackId];
  useAutoFreeze.setState({ frozen: nextFrozen, pending: nextPending });
}

function dropAll() {
  const { frozen, pending } = useAutoFreeze.getState();
  for (const e of [...Object.values(frozen), ...Object.values(pending)]) dropMemorySound(e.soundId);
  useAutoFreeze.setState({ frozen: {}, pending: {} });
}

/** Tracks auto-freeze can freeze: instrument tracks with clips (not audio, buses or returns). */
const freezable = (t: Track, clipTracks: Set<string>) => !isAudioKind(t.instrumentKey) && !isMixTrack(t) && clipTracks.has(t.id);

/** Roughly how much a track costs to play live, to freeze the busiest first. */
function weight(t: Track, notes: number): number {
  const kind = INSTRUMENTS[t.instrumentKey]?.kind;
  const inserts = Object.values(t.fx).filter((fx) => (fx as { on?: boolean } | undefined)?.on).length;
  const kindWeight = isDrumKind(t.instrumentKey) ? 0.7 : kind === 'synth' || kind === 'custom' ? 1.5 : 1;
  return (notes + 20) * kindWeight * (1 + inserts * 0.5) + (t.plugin || t.pluginFx?.length ? 2000 : 0);
}

/**
 * Resolves once the song isn't playing. A render started while it was stopped pauses here when
 * Play is pressed: an offline render beside the live one took the computer from it (stutters on a
 * big song), and doubled the work on the page's own thread.
 */
function untilStopped(): Promise<void> {
  if (!useTimelineStore.getState().isPlaying) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useTimelineStore.subscribe((s) => {
      if (s.isPlaying) return;
      stop();
      resolve();
    });
  });
}

/** When each track's fingerprint last changed, to wait until it settles. */
const settled = new Map<string, { fingerprint: string; since: number }>();
/**
 * Tracks whose render didn't fit in the memory left, as they were then (fingerprint) and with how
 * much memory taken (bytes): not tried again until they change or memory is let go. Without this
 * the same track was rendered, found too big and thrown away, over and over (a long song keeps the
 * page busy for good).
 */
const tooBig = new Map<string, { fingerprint: string; used: number }>();
let lastEdit = 0;
let counter = 0;

async function tick() {
  const auto = useAutoFreeze.getState();
  if (!auto.on || auto.rendering) return;
  const s = useTimelineStore.getState();
  const now = performance.now();
  const all = { tracks: s.tracks, clips: s.clips, bpm: s.bpm, swing: s.swing, tempoPoints: s.tempoPoints };

  // Let go of renders of tracks that are gone
  const ids = new Set(s.tracks.map((t) => t.id));
  const gone = [...Object.keys(auto.frozen), ...Object.keys(auto.pending)].filter((id) => !ids.has(id));
  if (gone.length) {
    const frozen = { ...auto.frozen };
    const pending = { ...auto.pending };
    for (const id of gone) {
      for (const e of [frozen[id], pending[id]]) if (e) dropMemorySound(e.soundId);
      delete frozen[id];
      delete pending[id];
    }
    useAutoFreeze.setState({ frozen, pending });
  }

  // Stopped: renders made while it played go in now
  if (!s.isPlaying && Object.keys(useAutoFreeze.getState().pending).length) {
    const { frozen, pending } = useAutoFreeze.getState();
    const next = { ...frozen };
    for (const [id, e] of Object.entries(pending)) {
      if (next[id]) dropMemorySound(next[id].soundId);
      next[id] = e;
    }
    useAutoFreeze.setState({ frozen: next, pending: {} });
  }

  const clipTracks = new Set(s.clips.map((c) => c.trackId));
  const candidates = s.tracks.filter((t) => freezable(t, clipTracks));
  for (const t of candidates) {
    const fingerprint = freezeFingerprint(t, all);
    const known = settled.get(t.id);
    if (!known || known.fingerprint !== fingerprint) settled.set(t.id, { fingerprint, since: now });
  }
  if (candidates.length < AUTO_FREEZE_MIN_TRACKS || s.isPlaying || now - lastEdit < QUIET_MS) return;
  if (Object.keys(useFreezing.getState()).length) return; // a freeze the person asked for comes first

  const editingTrack = s.clips.find((c) => c.id === s.editingClipId)?.trackId;
  const pluginOpen = useUiStore.getState().pluginWindow?.trackId;
  const soundMissing = (id: string) => ['missing', 'error'].includes(useSoundLibrary.getState().status[id] ?? '');
  const { frozen } = useAutoFreeze.getState();
  const used = Object.values(frozen).reduce((n, e) => n + e.bytes, 0);
  const notes = new Map<string, number>();
  for (const c of s.clips) notes.set(c.trackId, (notes.get(c.trackId) ?? 0) + c.notes.length);
  // The least a render could take (one channel, no tail): one that couldn't fit isn't made at all
  const span = new Map<string, [number, number]>();
  for (const c of s.clips) {
    const [a, b] = span.get(c.trackId) ?? [Infinity, -Infinity];
    span.set(c.trackId, [Math.min(a, c.startBar), Math.max(b, c.startBar + c.lengthBars)]);
  }
  const tempo = { bpm: s.bpm, points: s.tempoPoints };
  const leastBytes = (id: string) => {
    const [a, b] = span.get(id) ?? [1, 1];
    return (barToSeconds(b, tempo) - barToSeconds(a, tempo)) * 44100 * 4;
  };
  const budget = budgetBytes();
  const next = candidates
    .filter((t) => {
      const fingerprint = settled.get(t.id)!.fingerprint;
      return (
        frozen[t.id]?.fingerprint !== fingerprint &&
        now - settled.get(t.id)!.since >= SETTLE_MS &&
        !(tooBig.get(t.id)?.fingerprint === fingerprint && used >= tooBig.get(t.id)!.used) &&
        used - (frozen[t.id]?.bytes ?? 0) + leastBytes(t.id) <= budget &&
        !t.isArmed &&
        t.id !== editingTrack &&
        t.id !== pluginOpen &&
        !freezeIsCurrent(t, all, soundMissing) // frozen by hand already
      );
    })
    .sort((a, b) => weight(b, notes.get(b.id) ?? 0) - weight(a, notes.get(a.id) ?? 0))[0];
  if (!next) return;

  useAutoFreeze.setState({ rendering: next.id });
  try {
    const r = await renderTrackChannels(next.id, undefined, untilStopped);
    // Turned off while it rendered: Off lets go of every render, this one too
    if (!useAutoFreeze.getState().on) return;
    const after = useTimelineStore.getState();
    const track = after.tracks.find((t) => t.id === next.id);
    // Changed while it rendered (or gone): out of date already, so it's tried again once it settles
    if (!r || !track || useUiStore.getState().pluginWindow?.trackId === next.id || freezeFingerprint(track, { tracks: after.tracks, clips: after.clips, bpm: after.bpm, swing: after.swing, tempoPoints: after.tempoPoints }) !== r.fingerprint) return;
    // A track whose two sides are the same (most instruments, centred) is kept as one channel
    const [left, right] = r.channels;
    let mono = !right;
    if (right) {
      mono = true;
      for (let i = 0; i < left.length; i += 7) if (Math.abs(left[i] - right[i]) > 1e-5) { mono = false; break; }
    }
    const channels = mono ? [left] : r.channels;
    const bytes = channels.length * left.length * 4;
    const current = useAutoFreeze.getState();
    const replaced = current.frozen[next.id]?.bytes ?? 0;
    if (used - replaced + bytes > budgetBytes()) {
      // Over budget: this one stays live, and isn't tried again until it or the memory changes
      tooBig.set(next.id, { fingerprint: r.fingerprint, used });
      return;
    }
    tooBig.delete(next.id);
    const buffer = new AudioBuffer({ length: left.length, numberOfChannels: channels.length, sampleRate: r.sampleRate });
    channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
    const soundId = `autofreeze:${next.id}:${++counter}`;
    provideMemorySound(soundId, buffer);
    const entry: AutoFrozen = { soundId, startBar: r.startBar, seconds: left.length / r.sampleRate, gainDb: PLAYBACK_DB, fingerprint: r.fingerprint, bytes };
    if (useTimelineStore.getState().isPlaying) {
      const old = current.pending[next.id];
      if (old) dropMemorySound(old.soundId);
      useAutoFreeze.setState({ pending: { ...current.pending, [next.id]: entry } });
    } else {
      const old = current.frozen[next.id];
      useAutoFreeze.setState({ frozen: { ...current.frozen, [next.id]: entry } });
      if (old) dropMemorySound(old.soundId);
    }
  } catch {
    // It plays live; tried again after its next change
    settled.set(next.id, { fingerprint: settled.get(next.id)?.fingerprint ?? '', since: Number.POSITIVE_INFINITY });
  } finally {
    useAutoFreeze.setState({ rendering: null });
  }
}

/** Start watching the song (once, from App). Returns a function that stops it. */
export function startAutoFreeze(): () => void {
  const unsubscribe = useTimelineStore.subscribe((state, prev) => {
    if (state.tracks !== prev.tracks || state.clips !== prev.clips || state.bpm !== prev.bpm || state.swing !== prev.swing || state.tempoPoints !== prev.tempoPoints) lastEdit = performance.now();
  });
  // A plugin's window opened: its track plays live while it's open
  const unwatchWindow = useUiStore.subscribe((state, prev) => {
    const id = state.pluginWindow?.trackId;
    if (id && id !== prev.pluginWindow?.trackId) thaw(id);
  });
  const timer = window.setInterval(() => void tick(), 1000);
  return () => {
    unsubscribe();
    unwatchWindow();
    window.clearInterval(timer);
  };
}
