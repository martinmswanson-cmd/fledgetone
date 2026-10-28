/**
 * Hearing Fledge Synth: a preset's phrase (fledgePhrases.ts) played on a track's own live synth,
 * with its sound as it is now (preset, macros, the track's level and effects), from the ▶ Hear
 * button by the preset picker (FledgeSynthPanel.tsx, PocketSynth.tsx); and, before a track has
 * one, the ▶ by "Fledge Synth" in Add Track, the plugin browser and Pocket's lists: a bass, a
 * lead and chords rendered once offline through a temporary track (renderArrangement, without
 * the master), level-matched to the instrument menu's previews and kept for the visit.
 * One plays at a time: starting one stops the other; pressing again, or choosing another preset,
 * stops it (the notes end with the sound's own release; the rendered one fades out).
 */
import { initAudio, liveMix, rawAudioState } from './engine';
import { getLiveInstrument } from './liveTracks';
import { nativeInputOf } from './nativeNodes';
import { safely, type NoteOff } from './instruments';
import { FLEDGE_PRESETS, FLEDGE_URL } from './plugins/fledgeMacros';
import { matchGain, PHRASE_BPM, PHRASE_TAIL, phraseLength, presetPhrase, TOUR_PRESETS, TOUR_STEP, type PhraseNote } from './plugins/fledgePhrases';
import { barsToDuration, defaultMasterSettings, DEFAULT_MASTER_FX, uid, type Clip, type Track } from '../store/timelineTypes';
import { makeTrack, useTimelineStore } from '../store/timelineStore';

/** What's playing: a track's preset phrase, the rendered tour, or nothing. */
export type FledgePreviewState = { kind: 'track'; trackId: string } | { kind: 'tour'; loading: boolean } | null;

let state: FledgePreviewState = null;
const listeners = new Set<() => void>();
const setState = (s: FledgePreviewState) => {
  state = s;
  listeners.forEach((l) => l());
};
/** For useSyncExternalStore: what's playing now. */
export const fledgePreviewState = (): FledgePreviewState => state;
export const subscribeFledgePreview = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Stops whatever is playing now (set by the one playing). */
let stopNow: (() => void) | null = null;

/** Stop the Fledge Synth preview that's playing, if any. */
export function stopFledgePreview(): void {
  const stop = stopNow;
  stopNow = null;
  stop?.();
  if (state) setState(null);
}

// The song starting stops a preview (it isn't heard over the song)
useTimelineStore.subscribe((s, before) => {
  if (s.isPlaying && !before.isPlaying) stopFledgePreview();
});

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** How far ahead of the audio clock notes are sent (seconds), and how often. */
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

/**
 * Play preset `preset`'s phrase on track `trackId`'s live synth (as it sounds now, through the
 * track). Stops any other preview first. Resolves when it has finished or been stopped; false if
 * the track can't sound now (muted, or its synth isn't loaded).
 */
export async function hearPresetOnTrack(trackId: string, preset: string | undefined): Promise<boolean> {
  stopFledgePreview();
  if (rawAudioState() !== 'running') await initAudio();
  const inst = getLiveInstrument(trackId);
  if (!inst) return false;
  const ctx = liveMix.bus.context;
  const notes = presetPhrase(preset);
  const start = ctx.currentTime + 0.05;
  let next = 0;
  const sounding: Array<{ n: PhraseNote; on: number; off: NoteOff | null }> = [];
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const tick = () => {
    const now = ctx.currentTime;
    while (next < notes.length && start + notes[next].at < now + LOOKAHEAD) {
      const n = notes[next++];
      const on = Math.max(now, start + n.at);
      const v = { note: noteName(n.midi), duration: barsToDuration(n.length / ((60 / PHRASE_BPM) * 4)), velocity: n.velocity };
      let off: NoteOff | null = null;
      safely(() => {
        if (inst.noteOn) off = inst.noteOn(v, on);
        else inst.play([v], on);
      });
      sounding.push({ n, on, off });
    }
    // Each note's end, once it's near
    for (let i = sounding.length - 1; i >= 0; i--) {
      const s = sounding[i];
      const end = s.on + s.n.length;
      if (end < now + LOOKAHEAD) {
        safely(() => s.off?.(Math.max(now, end)));
        sounding.splice(i, 1);
      }
    }
    if (next >= notes.length && !sounding.length && now > start + phraseLength(notes) + PHRASE_TAIL) finish();
  };
  const timer = window.setInterval(tick, TICK_MS);
  const finish = () => {
    window.clearInterval(timer);
    // Notes still sounding end now (with the sound's own release); never before they've started
    const now = ctx.currentTime;
    for (const s of sounding) safely(() => s.off?.(Math.max(now, s.on + 0.01)));
    sounding.length = 0;
    if (stopNow === finish) {
      stopNow = null;
      setState(null);
    }
    done();
  };
  stopNow = finish;
  setState({ kind: 'track', trackId });
  tick();
  await finished;
  return true;
}

/** Press ▶ Hear: play track `trackId`'s preset phrase, or stop it if it's playing. */
export function toggleHearPreset(trackId: string, preset: string | undefined): Promise<boolean> {
  if (state?.kind === 'track' && state.trackId === trackId) {
    stopFledgePreview();
    return Promise.resolve(true);
  }
  return hearPresetOnTrack(trackId, preset);
}

/**
 * A preset was chosen on track `trackId` (`chosen` resolves once the synth has it): the phrase
 * playing on that track stops, and with "Hear on change" on, the new preset's plays.
 */
export function choosePresetHeard(trackId: string, preset: string | undefined, chosen: Promise<unknown>): void {
  if (state?.kind === 'track' && state.trackId === trackId) stopFledgePreview();
  if (!hearOnChange()) return;
  void chosen.then(
    () => hearPresetOnTrack(trackId, preset),
    () => {}
  );
}

/** Whether a preset is heard as soon as it's chosen (the "Hear on change" switch), per browser. */
const HEAR_ON_CHANGE_KEY = 'fledgetone.fledgeHearOnChange';
export function hearOnChange(): boolean {
  try {
    return localStorage.getItem(HEAR_ON_CHANGE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setHearOnChange(on: boolean): void {
  try {
    localStorage.setItem(HEAR_ON_CHANGE_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: for this visit only
  }
}

/**
 * The tour's loudness (see loudnessDb), measured after the master as the instrument menu's
 * previews are: those measure -17 to -22 (the Grand Piano -22, the Wavetable Synth -19), and a
 * Fledge track's own ▶ Hear about -21 to -24.
 */
export const TOUR_LEVEL_DB = -21;

let tour: Promise<AudioBuffer> | null = null;

/** A bass, a lead and chords (TOUR_PRESETS), each on a temporary Fledge Synth track, rendered once and kept. */
export function renderFledgeTour(): Promise<AudioBuffer> {
  tour ??= (async () => {
    const { renderArrangement } = await import('./exportWav');
    const barSeconds = (60 / PHRASE_BPM) * 4;
    const tracks: Track[] = [];
    const clips: Clip[] = [];
    TOUR_PRESETS.forEach((preset, k) => {
      const t = makeTrack('plugin', tracks, 'Fledge Synth');
      const track: Track = { ...t, reverbSend: 0, delaySend: 0, plugin: { id: uid('plugin'), url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program: Math.max(0, FLEDGE_PRESETS.indexOf(preset)) } } };
      tracks.push(track);
      const notes = presetPhrase(preset);
      clips.push({
        id: uid('clip'),
        trackId: track.id,
        name: preset,
        startBar: 1 + (k * TOUR_STEP) / barSeconds,
        lengthBars: Math.ceil(phraseLength(notes) / barSeconds),
        isSelected: false,
        notes: notes.map((n) => ({ id: uid('note'), note: noteName(n.midi), startOffset: n.at / barSeconds, duration: barsToDuration(n.length / barSeconds), velocity: n.velocity })),
      });
    });
    const seconds = (TOUR_PRESETS.length - 1) * TOUR_STEP + phraseLength(presetPhrase(TOUR_PRESETS.at(-1))) + PHRASE_TAIL;
    const audio = await renderArrangement({
      tracks,
      clips,
      bpm: PHRASE_BPM,
      // (played here, not saved: the recordings as live playback has them)
      recordings: 'playback',
      swing: 0,
      masterFx: DEFAULT_MASTER_FX,
      master: defaultMasterSettings(),
      startBar: 1,
      endBar: 1 + seconds / barSeconds,
      ending: 'exact',
      sampleRate: 48000,
      bypassMaster: true,
      threads: 1,
    });
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const gain = matchGain(channels, audio.sampleRate, TOUR_LEVEL_DB);
    for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
    return audio;
  })();
  // A failed render can be tried again
  tour.catch(() => (tour = null));
  return tour;
}

/** Fades (seconds): in, and out when stopped. */
const FADE_IN = 0.01;
const FADE_OUT = 0.06;

/** Play the tour (rendering it the first time), or stop it if it's playing. Resolves when it ends. */
export async function toggleFledgeTour(): Promise<void> {
  if (state?.kind === 'tour') {
    stopFledgePreview();
    return;
  }
  stopFledgePreview();
  let cancelled = false;
  stopNow = () => (cancelled = true);
  const mine = stopNow;
  setState({ kind: 'tour', loading: true });
  try {
    if (rawAudioState() !== 'running') await initAudio();
    const buffer = await renderFledgeTour();
    if (cancelled) return;
    const into = nativeInputOf(liveMix.auditionInput);
    const raw = into.context;
    const source = raw.createBufferSource();
    source.buffer = buffer;
    const amp = raw.createGain();
    const at = raw.currentTime + 0.02;
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(1, at + FADE_IN);
    source.connect(amp);
    amp.connect(into);
    source.start(at);
    let ended!: () => void;
    const over = new Promise<void>((r) => (ended = r));
    const finish = () => {
      source.onended = null;
      const now = raw.currentTime;
      amp.gain.cancelScheduledValues(now);
      amp.gain.setValueAtTime(amp.gain.value, now);
      amp.gain.linearRampToValueAtTime(0, now + FADE_OUT);
      try {
        source.stop(now + FADE_OUT + 0.01);
      } catch {
        // Already stopped
      }
      window.setTimeout(() => {
        source.disconnect();
        amp.disconnect();
      }, (FADE_OUT + 0.1) * 1000);
      if (stopNow === finish) {
        stopNow = null;
        setState(null);
      }
      ended();
    };
    if (stopNow !== mine) return;
    stopNow = finish;
    setState({ kind: 'tour', loading: false });
    source.onended = finish;
    await over;
  } catch (err) {
    console.warn('Fledge Synth preview could not render:', err);
    if (stopNow === mine) {
      stopNow = null;
      setState(null);
    }
  }
}
