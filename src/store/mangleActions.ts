/**
 * Mangling an audio clip (its editor's Mangle menu): the stretch of its sound it plays is made
 * into a new sound (mangle.ts: tape speed, pitch, stretch, stutter, shuffle, gate, crush, formant)
 * that the clip then plays, one undo step each. The clip keeps where it came from, so "Back to the
 * original" brings the first sound back whatever was done since. Being a sound like any other,
 * it plays the same live and in an export.
 */
import { songTempo, useTimelineStore } from './timelineStore';
import type { Clip } from './timelineTypes';
import { audioSourceSeconds, stretchRatio } from './audioClips';
import { tempoAt } from '../audio/tempoMap';
import { decodeSound, importSoundFile, useSoundLibrary } from '../audio/soundLibrary';
import { encodeChannels } from '../audio/wavFile';
import { GATE_PATTERNS, lengthFactor, mangle, mangleLabel, type MangleOp } from '../audio/mangle';

/** The rate mangled copies are made at. */
const RATE = 44100;

/** A mangle as the menu asks for it: the grids in notes of the song (1/8, 1/16, 1/32). */
export type MangleRequest =
  | { kind: 'tape'; semitones: number }
  | { kind: 'pitch'; semitones: number }
  | { kind: 'stretch'; factor: number }
  | { kind: 'stutter'; grid: 8 | 16 | 32 }
  | { kind: 'shuffle'; grid: 8 | 16; seed: number }
  | { kind: 'gate'; pattern: keyof typeof GATE_PATTERNS }
  | { kind: 'crush'; bits: number; downsample: number }
  | { kind: 'formant'; semitones: number };

/** The edit in samples of the sound, for a clip playing it `ratio` times as fast at `bpm`. */
export function mangleOp(req: MangleRequest, bpm: number, ratio: number, sampleRate: number): MangleOp {
  // A beat of the song, in samples of the sound as the clip plays it
  const beat = (60 / bpm) * ratio * sampleRate;
  switch (req.kind) {
    case 'stutter':
      return { kind: 'stutter', cell: (beat * 4) / req.grid, beat };
    case 'shuffle':
      return { kind: 'shuffle', cell: (beat * 4) / req.grid, seed: req.seed };
    case 'gate':
      return { kind: 'gate', step: beat / 4, pattern: [...(GATE_PATTERNS[req.pattern] ?? GATE_PATTERNS.Trance)].map((c) => c === 'x') };
    default:
      return req;
  }
}

/**
 * Mangle audio clip `clipId`. Resolves to what to tell the person. The clip's length follows
 * edits that change it (tape speed, stretch); warp markers go (they belonged to the old sound).
 */
export async function mangleClip(clipId: string, req: MangleRequest): Promise<string> {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip?.audio) return 'Choose an audio clip to mangle.';
  const audio = clip.audio;
  const bpm = tempoAt(clip.startBar, songTempo(s));
  const played = audioSourceSeconds(clip, bpm);
  const buffer = await decodeSound(audio.soundId, RATE);
  const from = Math.max(0, Math.floor(audio.offset * RATE));
  const to = Math.min(buffer.length, Math.ceil((audio.offset + played) * RATE));
  if (to - from < 64) return 'That clip is too short to mangle.';
  const input = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(from, to));
  const op = mangleOp(req, bpm, stretchRatio(audio, bpm), RATE);
  const out = mangle(input, op, RATE);
  const label = mangleLabel(op);
  const base = (useSoundLibrary.getState().metas[audio.soundId]?.name ?? clip.name).replace(/\.[a-z0-9]+$/i, '').replace(/ \(mangled\)$/, '');
  const sound = await importSoundFile(new Blob([encodeChannels(out, RATE, 24)], { type: 'audio/wav' }), `${base} (mangled).wav`);
  const now = useTimelineStore.getState();
  const still = now.clips.find((c) => c.id === clipId);
  if (!still?.audio || still.audio.soundId !== audio.soundId) return 'The clip changed while it was being mangled: try again.';
  now.checkpoint();
  const kept = still.audio.mangled ?? { from: audio.soundId, offset: audio.offset, bars: still.lengthBars, steps: [] };
  const lengthBars = still.lengthBars * lengthFactor(op);
  useTimelineStore.setState((st) => ({
    clips: st.clips.map((c): Clip => {
      if (c.id !== clipId || !c.audio) return c;
      const next = { ...c.audio, soundId: sound.id, offset: 0, warp: undefined, envelope: undefined, reversedFrom: undefined, mangled: { ...kept, steps: [...kept.steps, label].slice(-16) } };
      delete next.warp;
      delete next.envelope;
      delete next.reversedFrom;
      return { ...c, lengthBars, audio: next };
    }),
  }));
  return `"${clip.name}" ${label}. Undo goes back a step; Back to the original undoes them all.`;
}

/** Play the sound the clip was mangled from again, where it was and as long (one undo step). */
export function unmangleClip(clipId: string): boolean {
  const s = useTimelineStore.getState();
  const clip = s.clips.find((c) => c.id === clipId);
  const m = clip?.audio?.mangled;
  if (!clip?.audio || !m) return false;
  s.checkpoint();
  useTimelineStore.setState((st) => ({
    clips: st.clips.map((c): Clip => {
      if (c.id !== clipId || !c.audio) return c;
      const next = { ...c.audio, soundId: m.from, offset: m.offset };
      delete next.mangled;
      return { ...c, lengthBars: m.bars, audio: next };
    }),
  }));
  return true;
}
