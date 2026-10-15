/**
 * A connection that can hold the sound back by a few milliseconds and change how much while it
 * plays, without a click: the track strip's paths after its sends are taken (delay compensation,
 * see delayCompensation.ts).
 *
 * Live, the sound goes through a gain of its own (and a delay line, when it's delayed). A new delay
 * is a second path, silent at first, and the two crossfade on the audio clock in 10 ms; the old one
 * is taken apart once that has played. Changing a delay line's time instead would bend the pitch
 * while it moved, and making or breaking a connection outright is heard whenever the audio thread
 * renders between the two (see rewire in trackStrip.ts). In an export nothing plays while the graph
 * is set up, so there the link is joined (or rebuilt) directly, with no gain.
 */
import * as Tone from 'tone';

type Node = Tone.ToneAudioNode | AudioNode;

export interface DelayLink {
  /** Hold the sound back by `seconds` (0: none), crossfading to it live. */
  set: (seconds: number) => void;
  /** Play into `to` instead (null: into nothing, as a sleeping strip). Switched at once, as a re-routing always was. */
  retarget: (to: Tone.InputNode | null) => void;
  dispose: () => void;
}

/** How long after a change the crossfade starts (all its fades are set by then), and how long it takes. */
const LEAD = 0.02;
const FADE = 0.01;

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
  node.channelCount = 2;
  node.channelCountMode = 'explicit';
  node.channelInterpretation = 'speakers';
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
  seconds: number;
  gain: GainNode | null;
  delay: DelayNode | null;
  /** Its last fade: from `from` at `start` to `to` at `end` (audio clock). */
  fade: { from: number; to: number; start: number; end: number };
}

/** `from` into `to`, held back by `seconds` (see above). */
export function createDelayLink(from: Node, to: Tone.InputNode | null, seconds = 0): DelayLink {
  const context = (from as { context: Tone.BaseContext | BaseAudioContext }).context;
  const raw = ('rawContext' in context ? context.rawContext : context) as unknown as BaseAudioContext;
  const live = !(typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext);
  let target = to;
  let paths: Path[] = [];
  let timer = 0;

  /** The path's last node, which plays into the target. */
  const end = (p: Path): Node => p.delay ?? p.gain ?? from;
  const join = (p: Path) => {
    if (target) Tone.connect(end(p), target);
  };
  const part = (p: Path) => {
    try {
      if (target) Tone.disconnect(end(p), target);
    } catch {
      // Not joined
    }
  };
  const make = (s: number, level: number): Path => {
    const gain = live ? raw.createGain() : null;
    if (gain) gain.gain.value = level;
    const delay = s > 0 ? fixedDelay(raw, s) : null;
    if (gain && delay) gain.connect(delay);
    const p: Path = { seconds: s, gain, delay, fade: { from: level, to: level, start: 0, end: 0 } };
    join(p);
    // Fed last, so nothing reaches the target before the path is whole
    if (gain) Tone.connect(from, gain);
    else if (delay) Tone.connect(from, delay);
    return p;
  };
  const drop = (p: Path) => {
    part(p);
    try {
      Tone.disconnect(from, p.gain ?? p.delay ?? (target as Node));
    } catch {
      // Already apart
    }
    p.gain?.disconnect();
    p.delay?.disconnect();
  };
  /** Fade a path to `level` over FADE from `at`, from wherever its earlier fades have it then. */
  const fadeTo = (p: Path, level: number, at: number) => {
    const { from: a, to: b, start, end: stop } = p.fade;
    const held = at >= stop ? b : at <= start ? a : a + ((b - a) * (at - start)) / (stop - start);
    const param = p.gain!.gain;
    param.cancelAndHoldAtTime(at);
    param.setValueAtTime(held, at);
    param.linearRampToValueAtTime(level, at + FADE);
    p.fade = { from: held, to: level, start: at, end: at + FADE };
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

  paths.push(make(Math.max(0, seconds), 1));

  return {
    set: (next) => {
      const s = Math.max(0, next);
      const current = paths[paths.length - 1];
      if (Math.abs(current.seconds - s) < 1e-9) return;
      if (!live) {
        paths.forEach(drop);
        paths = [make(s, 1)];
        return;
      }
      // The new path (the last one) fades in as every other fades out
      const fresh = make(s, 0);
      paths.push(fresh);
      const at = raw.currentTime + LEAD;
      for (const p of paths) fadeTo(p, p === fresh ? 1 : 0, at);
      window.clearTimeout(timer);
      timer = window.setTimeout(tidy, (LEAD + FADE) * 1000 + 50);
    },
    retarget: (next) => {
      if (next === target) return;
      paths.forEach(part);
      target = next;
      paths.forEach(join);
    },
    dispose: () => {
      window.clearTimeout(timer);
      paths.forEach(drop);
      paths = [];
    },
  };
}
