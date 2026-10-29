/**
 * Chop my voice: a recorded or imported vocal (an audio clip) cut into its syllables, each tuned
 * onto a note (voiceChops.ts), and made into an instrument: a new Multi Sampler track with every
 * syllable on its own key, playable from the keyboard like any instrument, and a clip on it that
 * plays the syllables where they were sung (now in tune), to start from. One undo step; the
 * original take is left as it is. Pocket and the studio both use this.
 */
import { withClipHeld } from './clipJobs';
import { songTempo, useTimelineStore } from './timelineStore';
import { barsToDuration, uid, type Clip, type MultiZone } from './timelineTypes';
import { midiName } from './sampleKits';
import { detectKey } from './songKey';
import { padFromClip } from './bounceToPad';
import { barToSeconds, secondsToBar, tempoAt } from '../audio/tempoMap';
import { barOfSource } from './audioClips';
import { expandAudioComp } from './takes';
import { decodeSound, importSoundFile, useSoundLibrary } from '../audio/soundLibrary';
import { encodeChannels } from '../audio/wavFile';
import { detectPitch, type PitchFrame } from '../audio/vocalTune';
import { chopGain, findSyllables, layoutChops, MAX_CHOPS, tuneChop, type ChopScale, type Syllable } from '../audio/voiceChops';

const RATE = 44100;
/** The chop instrument's envelope: a quick start, and a short release so each chop stops cleanly. */
export const CHOP_ATTACK = 0.002;
export const CHOP_RELEASE = 0.12;

export type VoiceChopResult = { trackId: string; chops: number; message: string } | { error: string };

/** A syllable of one of the pieces chopped: a clip, or a comp's piece of a take folder. */
interface Heard extends Syllable {
  mono: Float32Array;
  frames: PitchFrame[];
  /** Where it plays on the timeline, in bars */
  at: number;
  atEnd: number;
}

/**
 * Chop the clip's take into a playable instrument (see the file's notes). Resolves with the new
 * track and a message for the person, or an error to show. `scale`: the key to tune into (null
 * for none; unset, the song's, when its notes say one). `comp`: a take folder is chopped as its
 * comp plays (Pocket, which has no Takes to flatten it with), else it's refused.
 */
async function chopVoiceToKeysNow(clipId: string, opts: { scale?: ChopScale | null; comp?: boolean } = {}): Promise<VoiceChopResult> {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip?.audio) return { error: 'Pick a recorded or imported vocal (an audio clip) to chop.' };
  const folder = (clip.takes?.length ?? 0) > 1;
  if (folder && !opts.comp) return { error: 'This clip is a take folder: flatten it first (Takes…), then chop it.' };
  const tempo = songTempo(s);
  const pieces = folder ? expandAudioComp(clip, tempo) : [clip];
  const heard: Heard[] = [];
  let played = 0;
  for (const piece of pieces) {
    const buffer = await decodeSound(piece.audio!.soundId, RATE);
    const part = padFromClip(piece, buffer.duration, tempoAt(piece.startBar, tempo));
    if (!part) continue;
    played++;
    const start = part.start ?? 0;
    const from = Math.round(start * RATE);
    const to = Math.min(buffer.length, Math.round((part.end ?? buffer.duration) * RATE));
    // The take folded to one channel
    const mono = new Float32Array(Math.max(0, to - from));
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[from + i] / buffer.numberOfChannels;
    }
    const frames = detectPitch(mono, RATE);
    // Placed through the clip's own timing (its stretch and warp, the tempo map)
    for (const syl of findSyllables(mono, RATE, frames)) {
      const at = barOfSource(piece, start + syl.start, tempo);
      heard.push({ ...syl, mono, frames, at, atEnd: secondsToBar(barToSeconds(at, tempo) + syl.end - syl.start, tempo) });
    }
  }
  if (!played) return { error: 'That clip plays none of its sound.' };
  // (A comp's pieces: the loudest of all of them, in the order they play)
  const loudest = new Set([...heard].sort((p, q) => q.level - p.level).slice(0, MAX_CHOPS));
  const syllables = heard.filter((h) => loudest.has(h)).sort((p, q) => p.at - q.at);
  if (!syllables.length) return { error: 'No syllables were heard in it: is it a vocal, and loud enough?' };
  // Tuned into the song's key, when its notes say one
  const keys = layoutChops(syllables, opts.scale !== undefined ? opts.scale : detectKey(s.clips, s.tracks));
  const base = (useSoundLibrary.getState().metas[clip.audio.soundId]?.name ?? clip.name).replace(/\.[a-z0-9]+$/i, '');
  const zones: MultiZone[] = [];
  for (const [i, k] of keys.entries()) {
    const syl = syllables[k.index];
    const y = tuneChop(syl.mono, RATE, syl.frames, syl, k.root);
    const g = chopGain(y, RATE);
    for (let j = 0; j < y.length; j++) y[j] *= g;
    const name = `${base} chop ${i + 1} ${midiName(k.root)}`;
    const sound = await importSoundFile(new Blob([encodeChannels([y], RATE, 24)], { type: 'audio/wav' }), `${name}.wav`);
    zones.push({ soundId: sound.id, name, root: k.root, lo: k.lo, hi: k.hi, velLo: 1, velHi: 127 });
  }

  const now = useTimelineStore.getState();
  const still = now.clips.find((c) => c.id === clipId);
  const sourceTrack = still ? now.tracks.find((t) => t.id === still.trackId) : undefined;
  if (!still || !sourceTrack) return { error: 'The take was removed while it was being chopped.' };
  // One undo step: adding the track is it, the rest goes in with it
  const trackId = now.addTrack('multiSampler', `${clip.name} chops`.slice(0, 40));
  const after = useTimelineStore.getState();
  after.setTrackMulti(trackId, { zones, attack: CHOP_ATTACK, release: CHOP_RELEASE }, false);
  // A clip playing each syllable where it was sung, on its key (moved with the take, if it was moved meanwhile)
  const moved = still.startBar - clip.startBar;
  const placed = keys.map((k) => syllables[k.index]);
  const first = Math.min(...placed.map((h) => h.at));
  const notes = keys
    .map((k) => ({ k, syl: syllables[k.index] }))
    .sort((a, b) => a.syl.at - b.syl.at)
    .map(({ k, syl }) => ({
      id: uid('note'),
      note: midiName(k.root),
      startOffset: syl.at - first,
      duration: barsToDuration(Math.max(1 / 64, syl.atEnd - syl.at)),
      velocity: 0.85,
    }));
  const lastEnd = Math.max(...placed.map((h) => h.atEnd));
  const startBar = Math.max(1, first + moved);
  const made: Clip = {
    id: uid('clip'),
    trackId,
    name: `${clip.name} chops`,
    startBar,
    lengthBars: Math.max(1 / 16, Math.ceil((lastEnd - first) * 16) / 16),
    notes,
    isSelected: true,
  };
  useTimelineStore.setState((st) => {
    const track = st.tracks.find((t) => t.id === trackId)!;
    const rest = st.tracks.filter((t) => t.id !== trackId);
    const at = rest.findIndex((t) => t.id === sourceTrack.id) + 1;
    const placed = sourceTrack.folder ? { ...track, folder: sourceTrack.folder } : track;
    return {
      tracks: [...rest.slice(0, at), placed, ...rest.slice(at)],
      clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), made],
      selectedTrackId: trackId,
    };
  });
  const lo = midiName(zones[0].root);
  const hi = midiName(zones[zones.length - 1].root);
  return {
    trackId,
    chops: zones.length,
    message: `Chopped "${clip.name}" into ${zones.length} syllable${zones.length === 1 ? '' : 's'}, each tuned onto a key (${lo} to ${hi}) of a new track, "${useTimelineStore.getState().tracks.find((t) => t.id === trackId)?.name ?? ''}": play them from the keys. Undo takes it away.`,
  };
}

/** (Holding the clip while it works: see clipJobs.ts) */
export function chopVoiceToKeys(clipId: string, opts: { scale?: ChopScale | null; comp?: boolean } = {}): Promise<VoiceChopResult> {
  return withClipHeld(clipId, () => chopVoiceToKeysNow(clipId, opts));
}
