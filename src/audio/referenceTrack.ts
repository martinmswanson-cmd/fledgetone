/**
 * The reference track: a finished song loaded to compare the mix against. It's kept in this
 * browser's sound library (keptSounds.ts), never in the project or an export. Its loudness is
 * measured (loudness.ts) and it's played at the mix's loudness (the mix as last analysed,
 * mixStudio.ts), so the comparison is about the sound, not the level; its spectrum is measured for
 * the overlay.
 *
 * A/B: while the song plays, the reference plays along at the same position (the song's seconds
 * from bar 1). One switch crossfades between the two in 20 ms: the mix is faded at the master
 * output (a gain chained into the destination, before its meters), the reference, already
 * mastered, goes in after it, so the loudness meter and spectrum show whichever is heard. Nothing
 * is connected until A/B is first used, and the reference's player exists only while the song plays.
 */
import { create } from 'zustand';
import * as Tone from 'tone';
import { liveContext, liveDestination, liveTransport } from './liveContext';
import { decodeSound, importSoundFile } from './soundLibrary';
import { measureLoudness } from './loudness';
import { bandSpectrum, type BandSpectrum } from './mixAnalysis';
import { keepSound, keptSound } from './keptSounds';
import { getMasterVolume } from './engine';
import { useMixStudio } from './mixStudio';
import { nativeContextOf, nativeInputOf } from './nativeNodes';

/** A reference song may be longer than other sounds (a whole master as WAV). */
const MAX_REFERENCE_BYTES = 200 * 1024 * 1024;
/** How long a switch between the mix and the reference takes, seconds. */
const SWITCH_SECONDS = 0.02;

interface ReferenceState {
  /** The loaded reference (null: none). */
  sound: { id: string; name: string; seconds: number } | null;
  /** Its integrated loudness and true peak. */
  lufs: number;
  truePeakDb: number;
  spectrum: BandSpectrum | null;
  /** What's heard: the mix or the reference. */
  hearing: 'mix' | 'reference';
  loading: boolean;
  error: string | null;
}

export const useReference = create<ReferenceState>(() => ({ sound: null, lufs: -Infinity, truePeakDb: -Infinity, spectrum: null, hearing: 'mix', loading: false, error: null }));

let buffer: AudioBuffer | null = null;

/**
 * The gain (dB) that brings the reference to the mix's loudness, as heard now (the master volume
 * since the analysis counted), or null until the mix has been analysed.
 */
export function referenceMatchDb(): number | null {
  const analysis = useMixStudio.getState().analysis;
  const { lufs, sound } = useReference.getState();
  if (!analysis || !sound || !Number.isFinite(lufs) || !Number.isFinite(analysis.lufs)) return null;
  return analysis.lufs - lufs + (getMasterVolume() - analysis.masterDb);
}

async function measure(id: string, name: string): Promise<void> {
  const decoded = await decodeSound(id, liveContext.sampleRate);
  const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, c) => decoded.getChannelData(c));
  const reading = await measureLoudness(channels.length > 1 ? channels : [channels[0], channels[0]], decoded.sampleRate);
  buffer = decoded;
  useReference.setState({ sound: { id, name, seconds: decoded.duration }, lufs: reading.integrated, truePeakDb: reading.truePeakMax, spectrum: bandSpectrum(channels, decoded.sampleRate), loading: false, error: null });
}

/** Load a song file as the reference (kept in this browser for next time). */
export async function loadReferenceFile(file: File): Promise<void> {
  useReference.setState({ loading: true, error: null });
  try {
    const meta = await importSoundFile(file, file.name, MAX_REFERENCE_BYTES);
    keepSound('reference', { id: meta.id, name: file.name });
    await measure(meta.id, file.name);
  } catch (err) {
    useReference.setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Bring back the reference kept from last time, if there is one (quietly: it may have been cleared). */
export async function restoreReference(): Promise<void> {
  const kept = keptSound('reference');
  if (!kept || useReference.getState().sound || useReference.getState().loading) return;
  useReference.setState({ loading: true });
  try {
    await measure(kept.id, kept.name);
  } catch {
    keepSound('reference', null);
    useReference.setState({ loading: false });
  }
}

/** Forget the reference (the sound stays in the library until unused sounds are freed). */
export function clearReference(): void {
  hear('mix');
  keepSound('reference', null);
  buffer = null;
  stopPlayer();
  useReference.setState({ sound: null, lufs: -Infinity, truePeakDb: -Infinity, spectrum: null });
}

// ---------- playback ----------

/** The gates, made the first time A/B is used. */
let gates: { mix: Tone.Gain; reference: GainNode } | null = null;
let player: { source: AudioBufferSourceNode; startedAt: number; offset: number } | null = null;
let follow = 0;

const raw = () => nativeContextOf(liveContext) as AudioContext;

function ensureGates() {
  if (gates) return gates;
  const mix = new Tone.Gain({ context: liveContext, gain: 1 });
  // Into the destination between its volume and its output (where the meters listen)
  liveDestination.chain(mix);
  const reference = raw().createGain();
  reference.gain.value = 0;
  reference.connect(nativeInputOf(liveDestination.output as Tone.ToneAudioNode));
  gates = { mix, reference };
  return gates;
}

/** Glide a gain (native or Tone's) to `to` from wherever it is now. */
function fade(param: AudioParam | Tone.Param<'gain'>, to: number) {
  const now = raw().currentTime;
  const from = param.value;
  param.cancelAndHoldAtTime(now);
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(to, now + SWITCH_SECONDS);
}

function stopPlayer() {
  if (!player) return;
  try {
    player.source.stop();
  } catch {
    // Never started
  }
  player.source.disconnect();
  player = null;
}

/** Where the song is now, seconds from bar 1 (what the reference lines up with). */
const songSeconds = () => Math.max(0, liveTransport.seconds);

function startPlayer(at: number) {
  stopPlayer();
  if (!buffer || !gates || at >= buffer.duration) return;
  const source = raw().createBufferSource();
  source.buffer = buffer;
  source.connect(gates.reference);
  const now = raw().currentTime;
  source.start(now, at);
  player = { source, startedAt: now, offset: at };
}

/** Keep the reference's player with the song: started, stopped, and moved when the song jumps (a seek, a loop). */
function keepUp() {
  const playing = liveTransport.state === 'started';
  if (!playing || !buffer) {
    stopPlayer();
    return;
  }
  const want = songSeconds();
  const at = player ? player.offset + (raw().currentTime - player.startedAt) : -1;
  if (!player || Math.abs(at - want) > 0.08) startPlayer(want);
}

/** Hear the mix or the reference (at the mix's loudness). */
export function hear(which: 'mix' | 'reference'): void {
  if (which === 'reference' && !buffer) return;
  useReference.setState({ hearing: which });
  if (which === 'mix' && !gates) return;
  const g = ensureGates();
  if (!follow) {
    follow = window.setInterval(keepUp, 50);
    keepUp();
  }
  const db = referenceMatchDb() ?? 0;
  fade(g.mix.gain, which === 'mix' ? 1 : 0);
  fade(g.reference.gain, which === 'reference' ? 10 ** (db / 20) : 0);
  if (which === 'mix') {
    // Back on the mix: the reference's player isn't needed (it starts again on the next switch)
    window.clearInterval(follow);
    follow = 0;
    window.setTimeout(() => useReference.getState().hearing === 'mix' && stopPlayer(), 100);
  }
}

/** Flip between the mix and the reference. */
export function toggleReference(): void {
  hear(useReference.getState().hearing === 'mix' ? 'reference' : 'mix');
}
