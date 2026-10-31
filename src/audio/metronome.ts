import * as Tone from 'tone';
import { measureAt } from './tempoMap';
import { getSongMeter } from './transport';
import { liveMix } from './engine';
import { mixDelaySeconds } from './latency';

/**
 * The metronome: a click on every beat, accented on the first beat of a bar, straight to the
 * live output (not through the master compressor and limiter, which it would otherwise pump).
 * It lives on the live Transport only, so it can't reach a WAV export, which renders its own
 * Transport in an OfflineAudioContext. Each click is a short oscillator made for that beat and
 * gone after it, so a metronome that's off costs nothing, and one that's on costs a Transport
 * event per beat.
 */

/** Click pitch and level: the accent is higher and louder. */
const BEAT_HZ = 1000;
const ACCENT_HZ = 1600;
const BEAT_LEVEL = 0.5;
const ACCENT_LEVEL = 0.85;
/** How long a click rings (an exponential fade). */
const CLICK_SECONDS = 0.03;

/** Volume applied over a short ramp, so moving the slider doesn't zip. */
const VOLUME_RAMP = 0.02;

let output: Tone.Gain | null = null;
let volume = 0.6;
let repeat: number | null = null;
/**
 * The metronome's clicks handed out for later (the Transport's look-ahead), by their beat's time:
 * Stop and Pause silence the ones for beats after the press (see setMetronomeOn).
 */
let coming: Array<{ beat: number; silence: () => void }> = [];
let watching = false;

/** The click bus, made on first use in the live context (never the export's). */
function out(): Tone.Gain {
  if (!output) {
    const context = liveMix.bus.context;
    output = new Tone.Gain({ context, gain: volume }).connect(context.destination);
  }
  return output;
}

/**
 * One click for the beat at `time` (audio clock). Returns a function that silences it early (a
 * cancelled count-in). It sounds the live mix's delay later (its delay compensation and the master
 * section's look-ahead: see mixDelaySeconds), as the music scheduled for that beat does: straight
 * to the output it would otherwise come about 10 to 20 ms early, a flam against the drums.
 */
function click(beat: number, accent: boolean): () => void {
  const time = beat + mixDelaySeconds();
  const bus = out();
  const raw = bus.context.rawContext;
  const osc = raw.createOscillator();
  const env = raw.createGain();
  osc.type = 'sine';
  osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(accent ? ACCENT_LEVEL : BEAT_LEVEL, time + 0.001);
  env.gain.exponentialRampToValueAtTime(0.001, time + CLICK_SECONDS);
  osc.connect(env);
  env.connect(bus.input as unknown as AudioNode);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
  osc.start(time);
  osc.stop(time + CLICK_SECONDS + 0.01);
  return () => osc.stop(Math.max(time, raw.currentTime));
}

/** Stop or Pause at `time`: the clicks for beats from then on never sound (one already ringing rings out). */
function silenceComing(time: number): void {
  for (const c of coming) if (c.beat >= time - 1e-4) c.silence();
  coming = [];
}

/** The click's loudness, 0 to 1. */
export function setMetronomeVolume(level: number): void {
  volume = Math.max(0, Math.min(1, level));
  if (output) output.gain.rampTo(volume, VOLUME_RAMP);
}

/**
 * Click on every beat the live Transport plays while `on`, in the song's time signature there. Beat
 * one of each measure is the accent.
 * (Swing moves notes, not beats: the clicks stay straight.)
 */
export function setMetronomeOn(on: boolean): void {
  const transport = liveMix.bus.context.transport;
  if (on === (repeat !== null)) return;
  if (!on) {
    transport.clear(repeat!);
    repeat = null;
    return;
  }
  if (!watching) {
    watching = true;
    transport.on('stop', silenceComing);
    transport.on('pause', silenceComing);
  }
  // Tone can hand the Transport the same tick twice on a clock boundary: one click per time
  let lastTime = -Infinity;
  repeat = transport.scheduleRepeat((time) => {
    if (Math.abs(time - lastTime) < 1e-4) return;
    lastTime = time;
    const ticks = Math.round(transport.getTicksAtTime(time));
    // Every beat of the time signature there (quarters in 4/4, eighths in 6/8), accented on each measure's first
    const bar = ticks / (transport.PPQ * 4) + 1;
    const m = measureAt(bar, getSongMeter());
    const beats = (bar - m.start) * m.meter.den;
    if (Math.abs(beats - Math.round(beats)) > 1e-3) return;
    const now = transport.context.currentTime;
    coming = coming.filter((c) => c.beat > now);
    coming.push({ beat: time, silence: click(time, Math.round(beats) === 0) });
  }, '16n', 0);
}

/**
 * A count-in: `beats` clicks ending exactly when the Transport starts at `startAt` (audio
 * clock), the first one accented. Returns a function that silences the ones still to come.
 */
export function countInClicks(startAt: number, beats: number, beatSeconds: number): () => void {
  const stops: Array<() => void> = [];
  for (let k = 0; k < beats; k++) stops.push(click(startAt - (beats - k) * beatSeconds, k === 0));
  return () => stops.forEach((stop) => stop());
}
