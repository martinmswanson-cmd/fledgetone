/**
 * A connection that can hold the sound back by a few milliseconds and change how much while it
 * plays, without a click: the track strip's paths after its sends are taken (delay compensation,
 * see delayCompensation.ts).
 *
 * Live, the sound goes through a gain of its own (and a delay line, when it's delayed). A new delay
 * glides there: a second path, silent at first, with a delay line as long as the old one's, takes
 * over in a 10 ms crossfade (the two paths play the same sound in step, so nothing changes), then
 * its delay glides to the new length slowly enough to bend the pitch by under 9 cents (delayGlide.ts),
 * and once there a plain delay line of that length takes over the same way. Crossfading straight
 * to the new length mixed two copies a few milliseconds apart, which partly cancel on a low note:
 * a held 78 Hz tone dipped by 20 dB or more for an instant when another track's compressor was
 * switched. Making or breaking a connection outright is heard whenever the audio thread renders
 * between the two (see rewire in trackStrip.ts). The old paths are taken apart once their fades
 * have played. In an export nothing plays while the graph is set up, so there the link is joined
 * (or rebuilt) directly, with no gain.
 *
 * A new target (a track sent to another bus, or back to the master when its bus is deleted) is
 * crossfaded the same way: a path of the same delay, joined to the new target silent, fades in over
 * RETARGET_FADE as the paths into the old one fade out, and those are taken apart once that has
 * played. Switched outright, the level stepped in one sample: a track out of a bus at -20 dB jumped
 * 20 dB, a click as large as any the music makes.
 */
import * as Tone from 'tone';
import { glideAt, planGlide, type Glide } from '../delayGlide';

type Node = Tone.ToneAudioNode | AudioNode;

export interface DelayLink {
  /**
   * Hold the sound back by `seconds` (0: none), crossfading to it live. `glide` false: nothing on
   * this link can be heard now (the audio isn't running, or nothing plays or rings), so it's set
   * at once, as in an export: a glide planned on a clock that isn't running was heard on the
   * first Play, the track early by a few ms and bending back over a second.
   */
  set: (seconds: number, glide?: boolean) => void;
  /**
   * Play into `to` instead (null: into nothing, as a sleeping strip). Live, from one target to
   * another, crossfaded over RETARGET_FADE (see the top); to or from nothing (a strip going to sleep
   * or waking, when nothing on it can be heard), at once.
   */
  retarget: (to: Tone.InputNode | null) => void;
  dispose: () => void;
}

/** How long after a change the crossfade starts (all its fades are set by then), and how long it takes. */
const LEAD = 0.02;
const FADE = 0.01;
/** A new target's crossfade: long enough that even a jump of 60 dB in level is a smooth swell. */
export const RETARGET_FADE = 0.02;

/** 0 to 1 along a raised cosine: no corner where it starts or ends. */
export const smoothStep = (k: number): number => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, k)))) / 2;

/**
 * A fade from `from` to `to` along smoothStep, as a value curve. A retarget's fade can be a swell
 * of 60 dB: a straight one bends the waveform sharply where it starts and stops (four times the
 * second difference a low sine has of its own), the S-curve not at all. The old path's and the new
 * one's add up to the same level all the way.
 */
export function smoothCurve(from: number, to: number, points = 64): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = from + (to - from) * smoothStep(i / (points - 1));
  return curve;
}

/** Two channels always, as fixedDelay says. */
function twoChannels(node: DelayNode): void {
  node.channelCount = 2;
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'speakers';
}

/**
 * A DelayNode whose time follows `glide`, read every sample while it moves (a time read once per
 * block would step, a faint buzz on high sounds). Only for the glide: a plain fixedDelay takes over
 * once it's there.
 */
export function glidingDelay(raw: BaseAudioContext, glide: Glide): DelayNode {
  const node = raw.createDelay(Math.max(0.01, 2 * Math.max(glide.from, glide.to)));
  twoChannels(node);
  node.delayTime.value = glide.from;
  node.delayTime.setValueAtTime(glide.from, glide.start);
  node.delayTime.linearRampToValueAtTime(glide.to, glide.end);
  return node;
}

/**
 * A DelayNode read once per render block (its time never moves). Live, the node is
 * standardized-audio-context's wrapper, whose params don't pass automationRate on, so it's set on
 * the native node the wrapper keeps.
 *
 * Always two channels (a mono sound is on both, as the strip's solo makes it next anyway). A
 * DelayNode whose input goes from one channel to two or back starts its delay lines over in
 * Chromium, dropping the few milliseconds it held: a click, on a delayed track, whenever a
 * recorded note kept in one channel (recordingMaths.ts) started or stopped beside a stereo one.
 */
export function fixedDelay(raw: BaseAudioContext, seconds: number): DelayNode {
  const node = raw.createDelay(Math.max(0.01, seconds * 2));
  twoChannels(node);
  node.delayTime.value = seconds;
  const native = (node as DelayNode & { _nativeAudioNode?: DelayNode })._nativeAudioNode ?? node;
  try {
    native.delayTime.automationRate = 'k-rate';
  } catch {
    // A browser without automationRate: per-sample it is
  }
  return node;
}

interface Path {
  /** The delay it holds the sound back by (where a gliding one is going). */
  seconds: number;
  /** A gliding path's glide (see glidingDelay). */
  glide?: Glide;
  gain: GainNode | null;
  delay: DelayNode | null;
  /** Where it plays into. */
  target: Tone.InputNode | null;
  /** Its last fade: from `from` at `start` to `to` at `end` (audio clock), straight or `smooth` (see smoothCurve). */
  fade: { from: number; to: number; start: number; end: number; smooth?: boolean };
}

/** `from` into `to`, held back by `seconds` (see above). */
export function createDelayLink(from: Node, to: Tone.InputNode | null, seconds = 0): DelayLink {
  const context = (from as { context: Tone.BaseContext | BaseAudioContext }).context;
  const raw = ('rawContext' in context ? context.rawContext : context) as unknown as BaseAudioContext;
  const live = !(typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext);
  let target = to;
  let paths: Path[] = [];
  let timer = 0;
  let settleTimer = 0;

  /** The path's last node, which plays into the target. */
  const end = (p: Path): Node => p.delay ?? p.gain ?? from;
  const join = (p: Path) => {
    if (p.target) Tone.connect(end(p), p.target);
  };
  const part = (p: Path) => {
    try {
      if (p.target) Tone.disconnect(end(p), p.target);
    } catch {
      // Not joined
    }
  };
  const make = (s: number, level: number, glide?: Glide): Path => {
    const gain = live ? raw.createGain() : null;
    if (gain) gain.gain.value = level;
    const delay = glide ? glidingDelay(raw, glide) : s > 0 ? fixedDelay(raw, s) : null;
    if (gain && delay) gain.connect(delay);
    const p: Path = { seconds: s, glide, gain, delay, target, fade: { from: level, to: level, start: 0, end: 0 } };
    join(p);
    // Fed last, so nothing reaches the target before the path is whole
    if (gain) Tone.connect(from, gain);
    else if (delay) Tone.connect(from, delay);
    return p;
  };
  const drop = (p: Path) => {
    part(p);
    try {
      Tone.disconnect(from, p.gain ?? p.delay ?? (p.target as Node));
    } catch {
      // Already apart
    }
    p.gain?.disconnect();
    p.delay?.disconnect();
  };
  /**
   * Fade a path to `level` over `fade` from `at`, from wherever its earlier fades have it then.
   * `smooth`: along an S-curve rather than straight (a retarget's, see smoothCurve).
   */
  const fadeTo = (p: Path, level: number, at: number, fade = FADE, smooth = false) => {
    const { from: a, to: b, start, end: stop, smooth: wasSmooth } = p.fade;
    const k = at >= stop ? 1 : at <= start ? 0 : (at - start) / (stop - start);
    const held = a + (b - a) * (wasSmooth ? smoothStep(k) : k);
    const param = p.gain!.gain;
    param.cancelAndHoldAtTime(at);
    if (smooth && held !== level) param.setValueCurveAtTime(smoothCurve(held, level), at, fade);
    else {
      param.setValueAtTime(held, at);
      param.linearRampToValueAtTime(level, at + fade);
    }
    p.fade = { from: held, to: level, start: at, end: at + fade, smooth };
  };
  /** Take apart the paths that have faded out, once the audio clock has played their fades. */
  const tidy = () => {
    const fadesEnd = paths.slice(0, -1).reduce((e, p) => Math.max(e, p.fade.end), 0);
    if (raw.currentTime < fadesEnd) {
      window.clearTimeout(timer);
      timer = window.setTimeout(tidy, Math.max(100, (fadesEnd - raw.currentTime) * 1000 + 50));
      return;
    }
    paths.slice(0, -1).forEach(drop);
    paths = paths.slice(-1);
  };

  /** Crossfade from every path to `fresh` (added last), and take the old ones apart after. */
  const takeOver = (fresh: Path, at: number, fade = FADE, smooth = false) => {
    paths.push(fresh);
    for (const p of paths) fadeTo(p, p === fresh ? 1 : 0, at, fade, smooth);
    window.clearTimeout(timer);
    timer = window.setTimeout(tidy, (at + fade - raw.currentTime) * 1000 + 50);
  };
  /** Once a glide is there, a plain path of its length takes over (the same sound, so seamless). */
  const settle = () => {
    const last = paths[paths.length - 1];
    if (!last?.glide) return;
    if (raw.currentTime < last.glide.end) {
      settleTimer = window.setTimeout(settle, (last.glide.end - raw.currentTime) * 1000 + 50);
      return;
    }
    takeOver(make(last.seconds, 0), raw.currentTime + LEAD);
  };

  paths.push(make(Math.max(0, seconds), 1));

  return {
    set: (next, glide = true) => {
      const s = Math.max(0, next);
      const current = paths[paths.length - 1];
      if (Math.abs(current.seconds - s) < 1e-9 && !current.glide) return;
      if (Math.abs(current.seconds - s) < 1e-9 && glide) return;
      if (!live || !glide) {
        window.clearTimeout(timer);
        window.clearTimeout(settleTimer);
        paths.forEach(drop);
        paths = [make(s, 1)];
        return;
      }
      // A gliding path, starting where the current one is when it takes over, fades in as every
      // other fades out; then it glides, and settles (see the top)
      const at = raw.currentTime + LEAD;
      const from = current.glide ? glideAt(current.glide, at) : current.seconds;
      const plan = planGlide(from, s, at + FADE);
      takeOver(make(s, 0, plan), at);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, (plan.end - raw.currentTime) * 1000 + 50);
    },
    retarget: (next) => {
      if (next === target) return;
      if (!live || !target || !next) {
        paths.forEach(part);
        target = next;
        paths.forEach((p) => {
          p.target = next;
          join(p);
        });
        return;
      }
      // A path into the new target as the current one is (a gliding one glides on the same plan),
      // fed for a while before it's heard so its delay line holds the sound by then
      const current = paths[paths.length - 1];
      const held = current.glide ? Math.max(current.glide.from, current.glide.to) : current.seconds;
      const at = raw.currentTime + Math.max(LEAD, held + 0.005);
      target = next;
      takeOver(make(current.seconds, 0, current.glide), at, RETARGET_FADE, true);
    },
    dispose: () => {
      window.clearTimeout(timer);
      window.clearTimeout(settleTimer);
      paths.forEach(drop);
      paths = [];
    },
  };
}
