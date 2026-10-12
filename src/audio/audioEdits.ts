import { useTimelineStore, songTempo } from '../store/timelineStore';
import { tempoAt } from './tempoMap';
import { decodeSound, importSoundFile, useSoundLibrary } from './soundLibrary';
import { encodeChannels } from './exportWav';
import { audioSourceSeconds } from '../store/audioClips';
import { onsets } from './timeStretch';
import { beatAt as beatOf, quantizeWarp } from '../store/warp';
import { AUDIO_GAIN_MAX, AUDIO_GAIN_MIN } from '../store/timelineTypes';

/**
 * Edits of an audio clip that need its sound: reversing it, normalizing it and quantizing it.
 * Each is one undo step. They work on the sound decoded at ANALYSIS_RATE.
 */
const ANALYSIS_RATE = 44100;

const clipOf = (clipId: string) => {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip?.audio) throw new Error('That clip has no audio');
  return { clip, audio: clip.audio, bpm: tempoAt(clip.startBar, songTempo(s)) };
};

/**
 * Play the clip backwards: it plays a reversed copy of its sound (made once and kept in the sound
 * library), the same stretch of it mirrored, so the end of what it played comes first. Reversing
 * a reversed clip goes back to the original sound. Warp markers are cleared (they belong to the
 * sound as it was); the gain envelope is mirrored with it.
 */
export async function reverseClip(clipId: string): Promise<void> {
  const { clip, audio, bpm } = clipOf(clipId);
  const played = audioSourceSeconds(clip, bpm);
  const source = await decodeSound(audio.reversedFrom ?? audio.soundId, ANALYSIS_RATE);
  const seconds = source.duration;
  const mirror = (src: number) => Math.max(0, seconds - src);
  const offset = Math.max(0, seconds - (audio.offset + played));
  const envelope = audio.envelope?.map((p) => ({ src: mirror(p.src), db: p.db })).reverse();
  if (audio.reversedFrom) {
    useTimelineStore.getState().setClipAudio(clip.id, { soundId: audio.reversedFrom, reversedFrom: undefined, offset, envelope, warp: undefined }, true);
    return;
  }
  const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c).slice().reverse());
  const name = `${(useSoundLibrary.getState().metas[audio.soundId]?.name ?? clip.name).replace(/\.[a-z0-9]+$/i, '')} (reversed).wav`;
  const sound = await importSoundFile(new Blob([encodeChannels(channels, ANALYSIS_RATE, 24)], { type: 'audio/wav' }), name);
  useTimelineStore.getState().setClipAudio(clip.id, { soundId: sound.id, reversedFrom: audio.soundId, offset, envelope, warp: undefined }, true);
}

/** The loudest sample of what the clip plays (its stretch of the sound). */
async function clipPeak(clipId: string): Promise<number> {
  const { clip, audio, bpm } = clipOf(clipId);
  const source = await decodeSound(audio.soundId, ANALYSIS_RATE);
  const from = Math.max(0, Math.floor(audio.offset * ANALYSIS_RATE));
  const to = Math.min(source.length, Math.ceil((audio.offset + audioSourceSeconds(clip, bpm)) * ANALYSIS_RATE));
  let peak = 0;
  for (let c = 0; c < source.numberOfChannels; c++) {
    const ch = source.getChannelData(c);
    for (let i = from; i < to; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Headroom normalize leaves under full scale. */
export const NORMALIZE_TARGET_DB = -0.3;

/**
 * Set the clip's gain so its loudest moment peaks at `target` dB (just under full scale), within
 * the clip gain's range. Returns the gain set, or null for a silent clip.
 */
export async function normalizeClip(clipId: string, target = NORMALIZE_TARGET_DB): Promise<number | null> {
  const peak = await clipPeak(clipId);
  if (peak < 1e-6) return null;
  const gain = Math.max(AUDIO_GAIN_MIN, Math.min(AUDIO_GAIN_MAX, Math.round((target - 20 * Math.log10(peak)) * 10) / 10));
  useTimelineStore.getState().setClipAudio(clipId, { gain }, true);
  return gain;
}

/**
 * Quantize the audio: find the hits (drum strikes, plucks, the starts of words) in what the clip
 * plays and add warp markers that pull each onto the nearest `grid` (in beats: 0.25 is a 16th) of
 * the song, `strength` of the way. A clip that doesn't follow the tempo yet starts to, at the
 * song's tempo (so nothing else about it changes). Returns how many hits moved.
 */
export async function quantizeClipAudio(clipId: string, grid: number, strength = 1): Promise<number> {
  const { clip, audio, bpm } = clipOf(clipId);
  const source = await decodeSound(audio.soundId, ANALYSIS_RATE);
  const mono = new Float32Array(source.length);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const ch = source.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += ch[i];
  }
  const hits = onsets(mono, ANALYSIS_RATE).map((i) => i / ANALYSIS_RATE);
  const following = audio.stretchBpm ? audio : { ...audio, stretchBpm: bpm };
  const from = audio.offset;
  const to = audio.offset + audioSourceSeconds(clip, bpm);
  // A beat of the sound plays on this beat of the song (bar 1 is beat 0)
  const startBeat = (clip.startBar - 1) * 4;
  const offsetBeat = beatOf(following, from);
  const warp = quantizeWarp(following, hits, { grid, strength, from, to, songBeatOf: (b) => startBeat + (b - offsetBeat) });
  const moved = warp.length - (audio.warp?.filter((m) => m.src < from || m.src > to).length ?? 0) - 2;
  const s = useTimelineStore.getState();
  if (!audio.stretchBpm) s.setClipStretch(clip.id, bpm);
  s.setClipAudio(clip.id, { warp }, !!audio.stretchBpm);
  return Math.max(0, moved);
}
