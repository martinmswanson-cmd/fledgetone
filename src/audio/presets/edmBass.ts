import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { DEFAULT_WOBBLE, WOBBLE_BEATS } from '../../store/timelineTypes';
import { monotonicTime } from './monotonic';
import {
  atAudioTime,
  attackDecay,
  createBus,
  createDrive,
  createFilter,
  createOsc,
  createVoiceSet,
  leveledWave,
  noteFrequency,
  releaseConstant,
  releaseTail,
} from './native';
import type { NativeVoice } from './native';
import type { GlideRef } from '../instruments';

/**
 * The EDM basses: Wobble, Growl and Reese. Monophonic, built from plain Web Audio nodes per note
 * (see native.ts), with a short glide when a note starts before the previous one has ended.
 *
 * The wobble is filter automation, not a running LFO: each note's filters get a value curve from
 * the note's start to its end, one sweep per wobble period (the clip's wobble rate at the song's
 * tempo). It starts afresh with every note, so wobbles lock to the beat, live and in the export.
 */

/** One note as a voice plays it. */
interface BassNote {
  /** Seconds (context time). */
  start: number;
  end: number;
  freq: number;
  velocity: number;
  /** Seconds per wobble. */
  cycle: number;
}

/** A voice's oscillators. They play on through legato notes, sliding to each new pitch. */
interface BassSource {
  /** Into the filters. */
  main: AudioNode;
  /** Straight to the amp, skipping the filters (a sub). */
  direct?: AudioNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Slide to `freq` from `at`, most of the way in `seconds`. */
  glide: (freq: number, at: number, seconds: number) => void;
}

interface ToneSection {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
}

interface BassPatch {
  /** Seconds a legato note takes to slide to its pitch. */
  glide: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Envelope peak at velocity 1. */
  level: number;
  source: (raw: BaseAudioContext, note: BassNote) => BassSource;
  /** Filters for a note, their sweeps running from the note's start until `until` (the end of its release). */
  tone: (raw: BaseAudioContext, note: BassNote, until: number) => ToneSection;
  /** A legato note gets fresh filters, so its wobble restarts with it. Otherwise one set lasts the voice. */
  retone: boolean;
}

/** Crossfade from a legato note's filters to the next one's: quick, and both hear the same oscillators. */
const RETONE_FADE = 0.004;

/** Wobble shape, 0 (closed) to 1 (open): a sine that starts and ends each period closed ("wub"). */
const wob = (t: number, cycle: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / cycle);

/**
 * A value curve for a sweep over [start, end], sampled finely enough for the fastest wobble.
 * Several filters can share one (the browser copies it).
 */
function sweepCurve(start: number, end: number, cycle: number, value: (t: number) => number): Float32Array {
  // A point every 3 ms, or 24 a cycle if that's finer; Web Audio joins them with straight lines
  const step = Math.min(0.003, cycle / 24);
  const points = Math.max(2, Math.ceil((end - start) / step) + 1);
  const curve = new Float32Array(points);
  const dt = (end - start) / (points - 1);
  for (let i = 0; i < points; i++) curve[i] = value(i * dt);
  return curve;
}

function createMonoBass(output: Tone.InputNode, patch: BassPatch, glide?: GlideRef) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  // Overlapping clips can land two notes on one instant: keep start times strictly increasing
  const safeTime = monotonicTime(bus.context);
  const releaseTc = releaseConstant(patch.release);
  /** The voice the last note started or joined, which a note starting before `end` slides on from. */
  let current: { voice: NativeVoice; source: BassSource; gate: GainNode; tone: ToneSection; end: number; note: string } | null = null;

  /**
   * Filters for one note, then a gain that switches between legato notes' filters. After them, not
   * before: the filters let go are cut off when the main thread gets round to it, which varies,
   * and their last ringing cut there made two exports of a song differ. Behind a closed gate,
   * nothing of them is heard however long they ring.
   */
  const section = (note: BassNote, until: number) => {
    const tone = patch.tone(raw, note, until);
    const gate = raw.createGain();
    tone.output.connect(gate);
    return { gate, tone };
  };

  return {
    trigger: (n: PlayableNote, time: number) => {
      const length = bus.toSeconds(n.duration);
      const freq = noteFrequency(n.note);
      // A note a hand-edited file garbled (NaN) is skipped before anything starts playing
      if (!Number.isFinite(length) || !(freq > 0)) return;
      const start = safeTime(time);
      const end = start + Math.max(0.005, length);
      const note: BassNote = {
        start,
        end,
        freq,
        velocity: n.velocity,
        cycle: WOBBLE_BEATS[n.wobble ?? DEFAULT_WOBBLE] * bus.toSeconds('4n'),
      };
      const peak = patch.level * n.velocity;
      const stopAt = end + releaseTail(patch.release);

      const v = current;
      if (v && v.end > start) {
        // Legato: slide the playing voice to the new pitch. The envelope carries on (towards this
        // note's level) instead of starting again, and the release moves to this note's end.
        v.source.glide(note.freq, start, glide?.seconds ?? patch.glide);
        const amp = v.voice.amp.gain;
        amp.cancelScheduledValues(start);
        amp.setTargetAtTime(peak * patch.sustain, start, 0.01);
        amp.setTargetAtTime(0, end, releaseTc);
        if (patch.retone) {
          const next = section(note, stopAt);
          next.gate.gain.value = 0;
          v.source.main.connect(next.tone.input);
          next.gate.connect(v.voice.amp);
          const previous = [v.gate, ...v.tone.nodes];
          const previousInput = v.tone.input;
          v.gate.gain.setValueAtTime(1, start);
          v.gate.gain.linearRampToValueAtTime(0, start + RETONE_FADE);
          next.gate.gain.setValueAtTime(0, start);
          next.gate.gain.linearRampToValueAtTime(1, start + RETONE_FADE);
          v.voice.nodes.push(next.gate, ...next.tone.nodes);
          v.gate = next.gate;
          v.tone = next.tone;
          // Let the previous note's filters go once they're silent. Kept to the end of the voice, a
          // long legato run would pile up dozens of idle filters the audio thread still visits.
          atAudioTime(raw, start + RETONE_FADE + 0.05, () => {
            try {
              v.source.main.disconnect(previousInput);
            } catch {
              // (already let go: the voice ended or the instrument was disposed)
            }
            previous.forEach((node) => node.disconnect());
            v.voice.nodes = v.voice.nodes.filter((node) => !previous.includes(node));
          });
        }
        voices.extend(v.voice, stopAt);
        v.end = end;
        v.note = n.note;
        return;
      }

      const source = patch.source(raw, note);
      const first = section(note, stopAt);
      const amp = raw.createGain();
      attackDecay(amp.gain, start, peak, patch.attack, patch.decay, patch.sustain);
      amp.gain.setTargetAtTime(0, end, releaseTc);
      source.main.connect(first.tone.input);
      first.gate.connect(amp);
      source.direct?.connect(amp);
      amp.connect(input);
      const voice: NativeVoice = { start, stopAt, sources: source.sources, nodes: [...source.nodes, first.gate, ...first.tone.nodes, amp], amp };
      voices.add(voice);
      current = { voice, source, gate: first.gate, tone: first.tone, end, note: n.note };
    },
    /**
     * End the note `note` at `time` (a key let go on a MIDI keyboard) if it's the one sounding:
     * the envelope falls from where it is, the way it would have at the note's end.
     */
    release: (note: string, time: number) => {
      const v = current;
      if (!v || v.note !== note || v.end <= time) return;
      const amp = v.voice.amp.gain;
      if (typeof amp.cancelAndHoldAtTime === 'function') amp.cancelAndHoldAtTime(time);
      else amp.cancelScheduledValues(time);
      amp.setTargetAtTime(0, time, releaseTc);
      voices.extend(v.voice, time + releaseTail(patch.release));
      v.end = time;
    },
    releaseAll: () => {
      voices.releaseAll(raw.currentTime);
      current = null;
    },
    dispose: () => {
      voices.stopAll();
      current = null;
      bus.dispose();
    },
  };
}

/** Oscillators gliding together; `ratios` are each one's frequency relative to the note's. */
function glider(params: Array<[AudioParam, number]>): BassSource['glide'] {
  return (freq, at, seconds) => params.forEach(([param, ratio]) => param.setTargetAtTime(freq * ratio, at, Math.max(0.003, seconds) / 3));
}

/**
 * Wobble Bass: two detuned saws, lightly driven, into a 24 dB low-pass swept by the tempo-synced
 * wobble, with a little grit after the filter; a clean sub underneath that skips the filter, so
 * the low end stays solid while the wobble moves above it.
 */
export function createWobbleBass(output: Tone.InputNode, glide?: GlideRef) {
  return createMonoBass(output, {
    glide: 0.06,
    attack: 0.004,
    decay: 0.3,
    sustain: 0.9,
    release: 0.09,
    level: 0.85,
    retone: true,
    source: (raw, { freq, start }) => {
      // Levels baked into the waves: peaks of about 1 into the drive, so it bends rather than clips
      const saw = leveledWave(raw, 'sawtooth', 0.42);
      const saw1 = createOsc(raw, saw, freq, start, -11);
      const saw2 = createOsc(raw, saw, freq, start, 9);
      // The sub: a sine on the note itself down low (an octave below E1 is 20 Hz, felt as mud,
      // not heard), a square an octave down from about A1 up
      const low = freq < 60;
      const sub = createOsc(raw, leveledWave(raw, low ? 'sine' : 'square', low ? 0.3 : 0.22), low ? freq : freq / 2, start);
      const drive = createDrive(raw, 1.4);
      [saw1, saw2].forEach((o) => o.connect(drive));
      return {
        main: drive,
        direct: sub,
        sources: [saw1, saw2, sub],
        nodes: [saw1, saw2, sub, drive],
        glide: glider([[saw1.frequency, 1], [saw2.frequency, 1], [sub.frequency, low ? 1 : 0.5]]),
      };
    },
    tone: (raw, note, until) => {
      // A mildly resonant stage and a plain one make the 24 dB slope (a sharp peak sweeping up
      // and down squelched instead of wubbing)
      const lp1 = createFilter(raw, 'lowpass', 200, 2.5);
      const lp2 = createFilter(raw, 'lowpass', 200, 0.7);
      const grit = createDrive(raw, 1.25);
      lp1.connect(lp2);
      lp2.connect(grit);
      // Closed an octave above the fundamental, opening 4.5 to 5.5 octaves with velocity; the
      // wobble sits closed a little longer than open ("wub", not "wow")
      const closed = Math.max(90, note.freq * 2);
      const octaves = 4.5 + note.velocity;
      const curve = sweepCurve(note.start, until, note.cycle, (t) => Math.min(16000, closed * 2 ** (octaves * wob(t, note.cycle) ** 1.4)));
      lp1.frequency.setValueCurveAtTime(curve, note.start, until - note.start);
      lp2.frequency.setValueCurveAtTime(curve, note.start, until - note.start);
      return { input: lp1, output: grit, nodes: [lp1, lp2, grit] };
    },
  }, glide);
}

/** Vowel formants (F1, F2 in Hz) along the growl's wobble, closed to open: "oo", "ah", "eh". */
const VOWELS: ReadonlyArray<[at: number, f1: number, f2: number]> = [
  [0, 300, 800],
  [0.55, 720, 1200],
  [1, 560, 1850],
];

/** Formants at wobble position `m` (0-1), interpolated in pitch between the vowels. */
function formants(m: number): [number, number] {
  let i = 0;
  while (i < VOWELS.length - 2 && m > VOWELS[i + 1][0]) i++;
  const [a, f1a, f2a] = VOWELS[i];
  const [b, f1b, f2b] = VOWELS[i + 1];
  const k = Math.max(0, Math.min(1, (m - a) / (b - a)));
  return [f1a * (f1b / f1a) ** k, f2a * (f2b / f2a) ** k];
}

/** Harmonics in the growl's waveform (band-limited by the browser per note). */
const GROWL_PARTIALS = 256;
/** How far the FM swings the saw's frequency, as a multiple of the note's (1:1 ratio). */
const GROWL_FM_INDEX = 2.2;
let growlSpectrum: { real: Float32Array; imag: Float32Array } | undefined;
const growlWaves = new WeakMap<BaseAudioContext, PeriodicWave>();

/**
 * A saw frequency-modulated by a sine at the same frequency: a bright, nasal, metallic tone. With
 * a 1:1 ratio the result is still a plain harmonic waveform, so it's worked out once (by a DFT of
 * one cycle) and played as a PeriodicWave: one oscillator instead of two and an audio-rate
 * modulation, band-limited (no aliasing), and it glides like any oscillator.
 */
function growlWave(raw: BaseAudioContext): PeriodicWave {
  let wave = growlWaves.get(raw);
  if (!wave) {
    if (!growlSpectrum) {
      const N = 4096;
      const cycle = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        // Phase in cycles: the integral of f * (1 + index * sin(2 pi f t)), over one period
        const x = i / N;
        const phase = x + (GROWL_FM_INDEX / (2 * Math.PI)) * (1 - Math.cos(2 * Math.PI * x));
        cycle[i] = 2 * (phase - Math.floor(phase)) - 1;
      }
      const real = new Float32Array(GROWL_PARTIALS + 1);
      const imag = new Float32Array(GROWL_PARTIALS + 1);
      for (let k = 1; k <= GROWL_PARTIALS; k++) {
        // cos and sin of 2 pi k i / N, by turning a unit vector one step per sample
        const stepCos = Math.cos((2 * Math.PI * k) / N);
        const stepSin = Math.sin((2 * Math.PI * k) / N);
        let c = 1;
        let sn = 0;
        let re = 0;
        let im = 0;
        for (let i = 0; i < N; i++) {
          re += cycle[i] * c;
          im += cycle[i] * sn;
          const turned = c * stepCos - sn * stepSin;
          sn = sn * stepCos + c * stepSin;
          c = turned;
        }
        real[k] = (2 * re) / N;
        imag[k] = (2 * im) / N;
      }
      growlSpectrum = { real, imag };
    }
    wave = raw.createPeriodicWave(growlSpectrum.real, growlSpectrum.imag);
    growlWaves.set(raw, wave);
  }
  return wave;
}

/**
 * Growl Bass: the FM saw driven hard into a vowel filter (two formant peaks and a low-pass, in
 * series) that the wobble moves between vowels ("wow", "yoi"), with a clean sine sub underneath.
 * Few nodes per note: the audio thread visits every node of every sounding voice in every block.
 */
export function createGrowlBass(output: Tone.InputNode, glide?: GlideRef) {
  return createMonoBass(output, {
    glide: 0.05,
    attack: 0.004,
    decay: 0.25,
    sustain: 0.9,
    release: 0.08,
    level: 0.85,
    retone: true,
    source: (raw, { freq, start }) => {
      const fm = createOsc(raw, growlWave(raw), freq, start);
      const drive = createDrive(raw, 3.5);
      const sub = createOsc(raw, leveledWave(raw, 'sine', 0.45), freq, start);
      fm.connect(drive);
      return {
        main: drive,
        direct: sub,
        sources: [fm, sub],
        nodes: [fm, drive, sub],
        glide: glider([[fm.frequency, 1], [sub.frequency, 1]]),
      };
    },
    tone: (raw, note, until) => {
      const f1 = createFilter(raw, 'peaking', 500, 4);
      const f2 = createFilter(raw, 'peaking', 1200, 6);
      f1.gain.value = 12;
      f2.gain.value = 10;
      // Opens with the vowel ("oo" dark, "eh" bright): the "wow". It also tames the drive's fizz.
      const body = createFilter(raw, 'lowpass', 700, 2);
      f1.connect(f2);
      f2.connect(body);
      const m = (t: number) => wob(t, note.cycle);
      const duration = until - note.start;
      const sweep = (param: AudioParam, value: (t: number) => number) =>
        param.setValueCurveAtTime(sweepCurve(note.start, until, note.cycle, value), note.start, duration);
      sweep(f1.frequency, (t) => formants(m(t))[0]);
      sweep(f2.frequency, (t) => formants(m(t))[1]);
      sweep(body.frequency, (t) => 700 * 2 ** (2.3 * m(t)));
      return { input: f1, output: body, nodes: [f1, f2, body] };
    },
  }, glide);
}

/** Reese Bass: three saws detuned so they beat slowly (and a sine for weight), through a gentle drive and a low-pass. */
export function createReeseBass(output: Tone.InputNode, glide?: GlideRef) {
  return createMonoBass(output, {
    glide: 0.08,
    attack: 0.01,
    decay: 0.5,
    sustain: 0.85,
    release: 0.15,
    level: 0.85,
    retone: false,
    source: (raw, { freq, start }) => {
      // Uneven detune, so the beating never settles into one steady pulse
      const saw = leveledWave(raw, 'sawtooth', 0.3);
      const saws = [-17, 3, 15].map((cents) => createOsc(raw, saw, freq, start, cents));
      const sine = createOsc(raw, leveledWave(raw, 'sine', 0.3), freq, start);
      const drive = createDrive(raw, 1.3);
      const oscs = [...saws, sine];
      oscs.forEach((o) => o.connect(drive));
      return {
        main: drive,
        sources: oscs,
        nodes: [...oscs, drive],
        glide: glider(oscs.map((o) => [o.frequency, 1])),
      };
    },
    tone: (raw, note) => {
      // Brighter for higher notes, so the beating stays audible
      const lp = createFilter(raw, 'lowpass', Math.min(4000, 520 + note.freq * 6), 3);
      return { input: lp, output: lp, nodes: [lp] };
    },
  }, glide);
}
