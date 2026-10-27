/**
 * Chop my voice: a recorded or imported vocal (an audio clip) cut into its syllables, each tuned
 * onto a note (voiceChops.ts), and made into an instrument: a new Multi Sampler track with every
 * syllable on its own key, playable from the keyboard like any instrument, and a clip on it that
 * plays the syllables where they were sung (now in tune), to start from. One undo step; the
 * original take is left as it is. Pocket and the studio both use this.
 */
import { songTempo, useTimelineStore } from './timelineStore';
import { barsToDuration, uid, type Clip, type MultiZone } from './timelineTypes';
import { midiName } from './sampleKits';
import { detectKey } from './songKey';
import { padFromClip } from './bounceToPad';
import { tempoAt } from '../audio/tempoMap';
import { decodeSound, importSoundFile, useSoundLibrary } from '../audio/soundLibrary';
import { encodeChannels } from '../audio/wavFile';
import { detectPitch } from '../audio/vocalTune';
import { chopGain, findSyllables, layoutChops, tuneChop } from '../audio/voiceChops';

const RATE = 44100;
/** The chop instrument's envelope: a quick start, and a short release so each chop stops cleanly. */
export const CHOP_ATTACK = 0.002;
export const CHOP_RELEASE = 0.12;

export type VoiceChopResult = { trackId: string; chops: number; message: string } | { error: string };

/**
 * Chop the clip's take into a playable instrument (see the file's notes). Resolves with the new
 * track and a message for the person, or an error to show.
 */
export async function chopVoiceToKeys(clipId: string): Promise<VoiceChopResult> {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip?.audio) return { error: 'Pick a recorded or imported vocal (an audio clip) to chop.' };
  if ((clip.takes?.length ?? 0) > 1) return { error: 'This clip is a take folder: flatten it first (Takes…), then chop it.' };
  const buffer = await decodeSound(clip.audio.soundId, RATE);
  const bpm = tempoAt(clip.startBar, songTempo(s));
  const part = padFromClip(clip, buffer.duration, bpm);
  if (!part) return { error: 'That clip plays none of its sound.' };
  const from = Math.round((part.start ?? 0) * RATE);
  const to = Math.round((part.end ?? buffer.duration) * RATE);
  // The take folded to one channel
  const mono = new Float32Array(Math.max(0, to - from));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[from + i] / buffer.numberOfChannels;
  }
  const frames = detectPitch(mono, RATE);
  const syllables = findSyllables(mono, RATE, frames);
  if (!syllables.length) return { error: 'No syllables were heard in it: is it a vocal, and loud enough?' };
  // Tuned into the song's key, when its notes say one
  const key = detectKey(s.clips, s.tracks);
  const keys = layoutChops(syllables, key);
  const base = (useSoundLibrary.getState().metas[clip.audio.soundId]?.name ?? clip.name).replace(/\.[a-z0-9]+$/i, '');
  const zones: MultiZone[] = [];
  for (const [i, k] of keys.entries()) {
    const y = tuneChop(mono, RATE, frames, syllables[k.index], k.root);
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
  // A clip playing each syllable where it was sung, on its key
  const barsPerSecond = bpm / 240;
  const first = Math.min(...keys.map((k) => syllables[k.index].start));
  const notes = keys
    .map((k) => ({ k, syl: syllables[k.index] }))
    .sort((a, b) => a.syl.start - b.syl.start)
    .map(({ k, syl }) => ({
      id: uid('note'),
      note: midiName(k.root),
      startOffset: (syl.start - first) * barsPerSecond,
      duration: barsToDuration(Math.max(1 / 64, (syl.end - syl.start) * barsPerSecond)),
      velocity: 0.85,
    }));
  const lastEnd = Math.max(...keys.map((k) => syllables[k.index].end));
  const audioStart = Math.max(0, still.audio?.offset ?? 0);
  const startBar = still.startBar + Math.max(0, (part.start ?? 0) - audioStart + first) * barsPerSecond;
  const made: Clip = {
    id: uid('clip'),
    trackId,
    name: `${clip.name} chops`,
    startBar,
    lengthBars: Math.max(1 / 16, Math.ceil((lastEnd - first) * barsPerSecond * 16) / 16),
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
