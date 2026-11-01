import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { DEFAULT_WOBBLE, WOBBLE_BEATS } from '../../store/timelineTypes';
import { monotonicTime, notLate } from './monotonic';
import { joinsNote } from '../legato';
import { createBendTimeline } from '../bendTimeline';
import { FEED_AHEAD, FEED_EVERY, feedFollower, followsNow } from '../bendFeed';
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
  /** Drop the slides set for after `at` (the one under way carries on). */
  cancel: (at: number) => void;
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
  /**
   * Filters for a note, their sweeps running from the note's start until `until` (the end of its
   * release), each given to `sweep` (which writes it to the params as it comes due).
   */
  tone: (raw: BaseAudioContext, note: BassNote, until: number, sweep: Sweeper) => ToneSection;
  /** A legato note gets fresh filters, so its wobble restarts with it. Otherwise one set lasts the voice. */
  retone: boolean;
}

/** Crossfade from a legato note's filters to the next one's: quick, and both hear the same oscillators. */
const RETONE_FADE = 0.004;

/** Wobble shape, 0 (closed) to 1 (open): a sine that starts and ends each period closed ("wub"). */
const wob = (t: number, cycle: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / cycle);

/** Give `params` a sweep over the note: `value` at each moment, in seconds from the note's start. */
type Sweeper = (params: AudioParam[], value: (t: number) => number) => void;

/**
 * A note's sweep, sampled finely enough for the fastest wobble: `points` values `dt` apart from
 * the note's start, joined with straight lines (a value curve).
 */
function sweepGrid(start: number, end: number, cycle: number): { points: number; dt: number } {
  // A point every 3 ms, or 24 a cycle if that's finer
  const step = Math.min(0.003, cycle / 24);
  const points = Math.max(2, Math.ceil((end - start) / step) + 1);
  return { points, dt: (end - start) / (points - 1) };
}

/**
 * Live, a sweep is given to the filters at most FEED_AHEAD seconds ahead of the clock, and the
 * rest in pieces as the clock gets to them (every FEED_EVERY): a long note's whole sweep at once
 * (a value every 3 ms, hundreds of thousands for a note of minutes) froze the page while it was
 * worked out and copied. Each piece is a value curve that starts exactly where the one before
 * ends, on the same points the whole curve has, so nothing changes at a join. An export gives a
 * sweep whole up to OFFLINE_WHOLE seconds (as it always did), and a longer one in pieces too, as
 * its scheduling clock gets to them: a long run of legato notes gave every note's sweep to the
 * end of its release, although the next note took over a moment later.
 */
const OFFLINE_WHOLE = 60;
/**
 * Seconds of a sweep given with its note; the rest follows at once (see sweeper). Longer than a
 * legato note's filters are heard once the next takes over.
 */
const FIRST_PIECE = 0.1;
/** Seconds a sweep glides back after a stall held it (see feedSweep). */
const STALL_GLIDE = 0.03;
/**
 * Live, no piece starts closer than this to the audio clock (it renders a little ahead of the
 * time the page reads).
 */
const LIVE_MARGIN = 0.02;

/** A sweep being given to its params in pieces. */
interface SweepFeed {
  params: AudioParam[];
  value: (t: number) => number;
  /** The note's points (see sweepGrid). */
  points: number;
  dt: number;
  /** Points given so far: up to index `i`, which the next piece starts from, at `at`. */
  i: number;
  at: number;
  /** The value at `at` (the last piece's last). */
  last: number;
  /** Seconds added to a point's own time: 0, unless a stall held the param past where the pieces had got to. */
  shift: number;
  /** Given no further than this: the end of its note's release, or sooner when it's let go. */
  until: number;
}

function createMonoBass(output: Tone.InputNode, patch: BassPatch, glide?: GlideRef) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  // Overlapping clips can land two notes on one instant: keep start times strictly increasing
  const safeTime = monotonicTime(bus.context);
  const releaseTc = releaseConstant(patch.release);
  /** The voice the last note started or joined, which a note starting before `end` slides on from. */
  let current: { voice: NativeVoice; source: BassSource; gate: GainNode; tone: ToneSection; sweeps: SweepFeed[]; end: number; note: string; freq: number; fedTo: number } | null = null;
  /** The pitch bend (cents) the voice plays at, by time: a note's own slide or dive, a bend lane (see bendTimeline.ts) */
  const bends = createBendTimeline(() => raw.currentTime);
  const bentBy = (freq: number, cents: number) => (cents ? freq * 2 ** (cents / 1200) : freq);
  const bent = (freq: number, time: number) => bentBy(freq, bends.at(time));
  /** Give the sounding voice the bends sent for later while it sounds: live, as they come due (see bendFeed.ts) */
  const feed = (v: NonNullable<typeof current>, until = v.voice.stopAt) => feedFollower(v, until, bends, bus.context, (cents, t) => v.source.glide(bentBy(v.freq, cents), t, 0.004));
  /**
   * The bends sent for after `from` on the sounding voice (as it plays now) while it sounds; with
   * none ever off centre, none (it's given the ones sent from now on).
   */
  const follow = (v: NonNullable<typeof current>, from: number, until: number) => {
    v.fedTo = from;
    if (bends.moved()) feed(v, until);
    else v.fedTo = Math.min(until, bus.context.isOffline ? Infinity : raw.currentTime + FEED_AHEAD);
  };

  const offline = bus.context.isOffline;
  /** The sweeps given in pieces, with more to give */
  const feeds = new Set<SweepFeed>();
  /** Give `s` its next piece, up to `to` (or its end). False once it has had all it gets. */
  const feedSweep = (s: SweepFeed, to: number): boolean => {
    if (s.i >= s.points - 1 || s.at >= s.until) return false;
    // How many points glide from the value held to the sweep's
    let blend = 0;
    const catchUp = () => {
      // The clock is past where the pieces got to (the page stalled, or a live key or a late note
      // starts as good as now, where the browser would move a piece's start on and the next would
      // overlap it): the sweep carries on from a moment from now, where it is by then (still on
      // the beat), gliding there from the value held
      const from = raw.currentTime + LIVE_MARGIN;
      if (s.i === 0) for (const param of s.params) param.setValueAtTime(s.last, raw.currentTime);
      s.shift += from - s.at;
      s.at = from;
      blend = Math.ceil(STALL_GLIDE / s.dt);
    };
    if (!offline && s.at < raw.currentTime + LIVE_MARGIN) catchUp();
    const n = Math.min(s.points - 1 - s.i, Math.ceil((Math.min(to, s.until) - s.at) / s.dt));
    if (!(n > 0)) return true;
    const make = () => {
      const curve = new Float32Array(n + 1);
      curve[0] = s.last;
      for (let k = 1; k <= n; k++) {
        const v = s.value(s.shift + (s.i + k) * s.dt);
        curve[k] = k < blend ? s.last + ((v - s.last) * k) / blend : v;
      }
      return curve;
    };
    let curve = make();
    const duration = n * s.dt;
    const give = () => {
      let refused = false;
      for (const param of s.params) {
        try {
          param.setValueCurveAtTime(curve, s.at, duration);
        } catch {
          refused = true;
        }
      }
      return refused;
    };
    // (Refused live, the browser having moved the last piece's start on: once more from a moment
    // from now; refused again, or in an export, skipped and the filter holds where it is)
    if (give() && !offline) {
      for (const param of s.params) param.cancelAndHoldAtTime?.(raw.currentTime);
      catchUp();
      curve = make();
      give();
    }
    // Where this piece ends, as the browser works it out, so the next starts exactly there
    s.at += duration;
    s.i += n;
    s.last = curve[n];
    return true;
  };
  const feedSweeps = () => {
    const to = (offline ? bus.context.currentTime : raw.currentTime) + FEED_AHEAD;
    for (const s of feeds) if (!feedSweep(s, to)) feeds.delete(s);
  };
  /** The interval feeding an export's long sweeps, set going with the first */
  let offlineFeeder = -1;
  /** Whether the sweeps are to be fed once the notes being handed out now are */
  let feedSoon = false;
  /** A sweeper for a note's filters, given until `until` (see OFFLINE_WHOLE). */
  const sweeper =
    (note: BassNote, until: number, given: SweepFeed[]): Sweeper =>
    (params, value) => {
      const { points, dt } = sweepGrid(note.start, until, note.cycle);
      const ahead = offline && until - note.start <= OFFLINE_WHOLE ? Infinity : Math.max(note.start, offline ? bus.context.currentTime : raw.currentTime) + FEED_AHEAD;
      if (ahead >= until) {
        // All of it at once: a short note (live), or any but a very long one (an export)
        const curve = new Float32Array(points);
        for (let i = 0; i < points; i++) curve[i] = value(i * dt);
        for (const param of params) param.setValueCurveAtTime(curve, note.start, until - note.start);
        return;
      }
      const s: SweepFeed = { params, value, points, dt, i: 0, at: note.start, last: value(0), shift: 0, until };
      // A moment of it now, the rest once the notes being handed out with this one are: a run of
      // legato notes landing together takes over from each other at once (each note's filters
      // are heard only RETONE_FADE), and each would otherwise work out FEED_AHEAD of sweep
      feedSweep(s, note.start + FIRST_PIECE);
      feeds.add(s);
      given.push(s);
      if (!feedSoon) {
        feedSoon = true;
        queueMicrotask(() => {
          feedSoon = false;
          feedSweeps();
        });
      }
      if (offline && offlineFeeder === -1) offlineFeeder = bus.context.setInterval(feedSweeps, FEED_EVERY);
    };
  /** Give the sweeps of a note's filters no further than `t` (the filters are let go, or the voice stops). */
  const endSweeps = (given: SweepFeed[], t: number) => {
    for (const s of given) s.until = Math.min(s.until, t);
  };
  const feeder = offline
    ? -1
    : bus.context.setInterval(() => {
        if (current && current.voice.stopAt > raw.currentTime) feed(current);
        feedSweeps();
      }, FEED_EVERY);

  /**
   * Filters for one note, then a gain that switches between legato notes' filters. After them, not
   * before: the filters let go are cut off when the main thread gets round to it, which varies,
   * and their last ringing cut there made two exports of a song differ. Behind a closed gate,
   * nothing of them is heard however long they ring.
   */
  const section = (note: BassNote, until: number) => {
    const sweeps: SweepFeed[] = [];
    const tone = patch.tone(raw, note, until, sweeper(note, until, sweeps));
    const gate = raw.createGain();
    tone.output.connect(gate);
    return { gate, tone, sweeps };
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
      if (v && joinsNote(start, v.end)) {
        // Legato (the note starts before the last one ends, or right where it ends): slide the
        // playing voice to the new pitch, or stay on it (a tie). The envelope carries on (towards
        // this note's level) instead of starting again, and the release moves to this note's end.
        // (The old note's bends to come go: the new one's from here)
        if (bends.moved()) v.source.cancel(start);
        v.source.glide(bent(note.freq, start), start, glide?.seconds ?? patch.glide);
        // (on to this note's end, at its pitch)
        v.freq = note.freq;
        follow(v, start, stopAt);
        const amp = v.voice.amp.gain;
        // (From the last note's end when that came first: its release is called off too)
        amp.cancelScheduledValues(Math.min(start, v.end));
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
          // (The previous note's sweeps only while its filters are heard)
          endSweeps(v.sweeps, start + RETONE_FADE + 0.05);
          v.gate = next.gate;
          v.tone = next.tone;
          v.sweeps = next.sweeps;
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

      const cents = bends.at(start);
      const source = patch.source(raw, cents ? { ...note, freq: bentBy(note.freq, cents) } : note);
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
      current = { voice, source, gate: first.gate, tone: first.tone, sweeps: first.sweeps, end, note: n.note, freq: note.freq, fedTo: start };
      follow(current, start, stopAt);
    },
    /** Bend the sounding voice (and the notes after it) `cents` from their pitch, from `time`, gliding a few ms. */
    bend: (cents: number, time: number, _live?: boolean, cut?: boolean) => {
      if (!Number.isFinite(cents)) return;
      const t = notLate(bus.context, time);
      const v = current;
      if (cut) v?.source.cancel(t);
      else if (Math.abs(cents - bends.at(t)) < 0.01) return;
      bends.set(cents, t, cut);
      // (Given the bends only to sooner, it gets this one when it's fed)
      if (v && followsNow(v, v.voice.stopAt, t)) v.source.glide(bentBy(v.freq, cents), t, 0.004);
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
      endSweeps(v.sweeps, v.voice.stopAt);
      v.end = time;
    },
    releaseAll: () => {
      voices.releaseAll(raw.currentTime);
      // (Every voice is fading out: their sweeps go no further than the fade)
      for (const s of feeds) s.until = Math.min(s.until, raw.currentTime + 0.1);
      current = null;
    },
    dispose: () => {
      if (feeder !== -1) bus.context.clearInterval(feeder);
      if (offlineFeeder !== -1) bus.context.clearInterval(offlineFeeder);
      feeds.clear();
      voices.stopAll();
      current = null;
      bus.dispose();
    },
  };
}

/** Oscillators gliding together; `ratios` are each one's frequency relative to the note's. */
function glider(params: Array<[AudioParam, number]>): Pick<BassSource, 'glide' | 'cancel'> {
  return {
    glide: (freq, at, seconds) => params.forEach(([param, ratio]) => param.setTargetAtTime(freq * ratio, at, Math.max(0.003, seconds) / 3)),
    cancel: (at) => params.forEach(([param]) => param.cancelScheduledValues(at)),
  };
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
        ...glider([[saw1.frequency, 1], [saw2.frequency, 1], [sub.frequency, low ? 1 : 0.5]]),
      };
    },
    tone: (raw, note, _until, sweep) => {
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
      // (Both stages share one curve: the browser copies it)
      sweep([lp1.frequency, lp2.frequency], (t) => Math.min(16000, closed * 2 ** (octaves * wob(t, note.cycle) ** 1.4)));
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
        ...glider([[fm.frequency, 1], [sub.frequency, 1]]),
      };
    },
    tone: (raw, note, _until, sweep) => {
      const f1 = createFilter(raw, 'peaking', 500, 4);
      const f2 = createFilter(raw, 'peaking', 1200, 6);
      f1.gain.value = 12;
      f2.gain.value = 10;
      // Opens with the vowel ("oo" dark, "eh" bright): the "wow". It also tames the drive's fizz.
      const body = createFilter(raw, 'lowpass', 700, 2);
      f1.connect(f2);
      f2.connect(body);
      const m = (t: number) => wob(t, note.cycle);
      sweep([f1.frequency], (t) => formants(m(t))[0]);
      sweep([f2.frequency], (t) => formants(m(t))[1]);
      sweep([body.frequency], (t) => 700 * 2 ** (2.3 * m(t)));
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
        ...glider(oscs.map((o) => [o.frequency, 1])),
      };
    },
    tone: (raw, note) => {
      // Brighter for higher notes, so the beating stays audible
      const lp = createFilter(raw, 'lowpass', Math.min(4000, 520 + note.freq * 6), 3);
      return { input: lp, output: lp, nodes: [lp] };
    },
  }, glide);
}
