import * as Tone from 'tone';
import type { GlueStyle, MasterSettings } from '../../store/timelineTypes';
import { createWorkletNode, loadWorklet } from '../worklets';
import { OTT_PROCESSOR, OTT_WORKLET_SOURCE } from './ott';
import { paramSetter as smoothParamSetter } from './smoothParam';

/**
 * The master section's inserts, between the master compressor and the limiter (see engine.ts):
 *   compressor -> [OTT] -> [Stereo width] -> limiter
 * Each exists only while it's switched on, like a track's inserts: off, it is taken out of the
 * chain and disposed, so it costs nothing. The OTT is an AudioWorklet (ott.ts); the width is a
 * handful of plain nodes doing mid/side. Live, a switch crossfades between the old and the new
 * chain on the audio clock the way a track strip does (trackStrip.ts, rewire), so switching while
 * the song plays opens no gap; in the WAV export's offline context the links are made directly,
 * since nothing plays while the graph is set up.
 */
export interface MasterInserts {
  /** Apply settings, ramping continuous ones over `ramp` seconds (0: at once). */
  apply: (settings: MasterSettings, ramp?: number) => void;
  /** Resolves once the inserts the settings ask for are in the chain (the OTT loads its worklet first). */
  ready: () => Promise<void>;
  dispose: () => void;
}

/** Below this the Stereo width's "mono bass" keeps the sound in the middle. */
export const MONO_BASS_HZ = 120;

type Node = Tone.ToneAudioNode | AudioNode;
type Link = [from: Node, to: Node];

interface Insert {
  input: Node;
  output: Node;
}

interface Unit extends Insert {
  dispose: () => void;
}

/** A live link of the chain, through a gain of its own so it can be faded on the audio clock. */
interface Gate {
  link: Link;
  gain: GainNode;
  fade: { from: number; to: number; start: number; end: number };
  wanted: boolean;
}

/** How long after a switch the crossfade starts (the fades are all set by then), and how long it takes. */
const SWITCH_LEAD = 0.02;
const SWITCH_FADE = 0.01;

/** Set native params, gliding over about `ramp` seconds (0 = at once), now (see smoothParam.ts). */
const paramSetter = (raw: BaseAudioContext) => smoothParamSetter(() => raw.currentTime);

/** head -> inserts -> tail, re-patched without gaps live (see above). */
function createInsertChain(head: Tone.ToneAudioNode, tail: Tone.ToneAudioNode) {
  const raw = head.context.rawContext as unknown as BaseAudioContext;
  const live = !(typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext);
  let chain: Insert[] = [];
  let gates: Gate[] = [];
  let leaving: Array<{ dispose: () => void }> = [];
  let tidyTimer = 0;

  const linksOf = (inserts: Insert[]): Link[] => {
    const links: Link[] = [];
    let from: Node = head;
    for (const ins of inserts) {
      links.push([from, ins.input]);
      from = ins.output;
    }
    links.push([from, tail]);
    return links;
  };
  const cut = (from: Node, to: Node) => {
    try {
      Tone.disconnect(from, to);
    } catch {
      // Not connected (any more): nothing to cut
    }
  };
  const sameLink = (a: Link, b: Link) => a[0] === b[0] && a[1] === b[1];
  const gate = (link: Link, level: number) => {
    const gain = raw.createGain();
    gain.gain.value = level;
    Tone.connect(gain, link[1]);
    Tone.connect(link[0], gain);
    gates.push({ link, gain, fade: { from: level, to: level, start: 0, end: 0 }, wanted: true });
  };
  /** Fade a link to `level` from `at`, starting from wherever its earlier fades have it then. */
  const fadeTo = (g: Gate, level: number, at: number) => {
    const { from, to, start, end } = g.fade;
    const held = at >= end ? to : at <= start ? from : from + ((to - from) * (at - start)) / (end - start);
    if (held === level && at >= end) return;
    const param = g.gain.gain;
    param.cancelAndHoldAtTime(at);
    param.setValueAtTime(held, at);
    param.linearRampToValueAtTime(level, at + SWITCH_FADE);
    g.fade = { from: held, to: level, start: at, end: at + SWITCH_FADE };
  };
  if (live) gate([head, tail], 1);
  else Tone.connect(head, tail);

  /** Take apart the links that have faded out, and dispose the inserts switched off. */
  const tidy = () => {
    // The fades are on the audio clock, which stands still while the page's audio is suspended
    const fadesEnd = gates.reduce((end, g) => (g.wanted ? end : Math.max(end, g.fade.end)), 0);
    if (raw.currentTime < fadesEnd) {
      clearTimeout(tidyTimer);
      tidyTimer = window.setTimeout(tidy, Math.max(250, (fadesEnd - raw.currentTime) * 1000 + 50));
      return;
    }
    for (const g of gates) {
      if (g.wanted) continue;
      cut(g.link[0], g.gain);
      g.gain.disconnect();
    }
    gates = gates.filter((g) => g.wanted);
    leaving.forEach((unit) => unit.dispose());
    leaving = [];
  };

  return {
    set: (next: Insert[], retired: Array<{ dispose: () => void }>) => {
      leaving.push(...retired);
      const unchanged = next.length === chain.length && next.every((ins, i) => ins.input === chain[i].input && ins.output === chain[i].output);
      const before = linksOf(chain);
      const links = linksOf(next);
      chain = next;
      if (unchanged) {
        if (!gates.some((g) => !g.wanted)) tidy();
        return;
      }
      if (!live) {
        before.filter((link) => !links.some((l) => sameLink(l, link))).forEach(([from, to]) => cut(from, to));
        links.filter((link) => !before.some((l) => sameLink(l, link))).forEach(([from, to]) => Tone.connect(from, to));
        tidy();
        return;
      }
      // New links start silent unless they feed a fresh insert (nothing hears it until its way out fades in)
      const fed = new Set(gates.map((g) => g.link[1]));
      for (const link of links) if (!gates.some((g) => sameLink(g.link, link))) gate(link, fed.has(link[1]) ? 0 : 1);
      const at = raw.currentTime + SWITCH_LEAD;
      const staying = new Set(links.map((link) => link[1]));
      for (const g of gates) {
        g.wanted = links.some((link) => sameLink(g.link, link));
        if (g.wanted || staying.has(g.link[1])) fadeTo(g, g.wanted ? 1 : 0, at);
      }
      clearTimeout(tidyTimer);
      tidyTimer = window.setTimeout(tidy, (at + SWITCH_FADE - raw.currentTime) * 1000 + 50);
    },
    dispose: () => {
      clearTimeout(tidyTimer);
      gates.forEach((g) => {
        cut(g.link[0], g.gain);
        g.gain.disconnect();
      });
      gates = [];
      if (!live) linksOf(chain).forEach(([from, to]) => cut(from, to));
      leaving.forEach((unit) => unit.dispose());
      leaving = [];
      chain = [];
    },
  };
}

interface OttUnit extends Unit {
  set: (ott: MasterSettings['ott'], ramp: number) => void;
}

/** The OTT worklet node, once its module is in the context. Its params are k-rate AudioParams. */
async function createOtt(context: Tone.BaseContext, ott: MasterSettings['ott']): Promise<OttUnit> {
  await loadWorklet(context, OTT_PROCESSOR, OTT_WORKLET_SOURCE);
  // Made with its settings, so they apply from its first sample
  const node = createWorkletNode(context, OTT_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    parameterData: { depth: ott.depth, time: ott.time, inGain: Tone.dbToGain(ott.inGain), outGain: Tone.dbToGain(ott.outGain) },
  });
  const raw = context.rawContext as unknown as BaseAudioContext;
  const ramped = paramSetter(raw);
  const param = (name: string) => node.parameters.get(name)!;
  const set = (s: MasterSettings['ott'], ramp: number) => {
    ramped(param('depth'), s.depth, ramp);
    ramped(param('time'), s.time, ramp);
    ramped(param('inGain'), Tone.dbToGain(s.inGain), ramp);
    ramped(param('outGain'), Tone.dbToGain(s.outGain), ramp);
  };
  set(ott, 0);
  return {
    input: node,
    output: node,
    set,
    dispose: () => {
      // A disconnected worklet that keeps returning true from process() would run forever
      node.port.postMessage('dispose');
      node.disconnect();
    },
  };
}

interface WidthUnit extends Unit {
  set: (width: MasterSettings['width'], ramp: number) => void;
}

/**
 * Stereo width by mid/side: M = (L + R) / 2 is what both sides share, S = (L - R) / 2 what
 * differs; the output is M +/- amount * S, so 0 is mono, 1 leaves the sound alone and 2 doubles
 * the difference. With mono bass on, S goes through a 24 dB/octave high-pass at MONO_BASS_HZ
 * first, so the bass stays in the middle however wide the rest is (wide bass sounds thin on a
 * club system and vanishes on a phone). Both routes exist, with the width on one or the other,
 * so the switch ramps rather than clicks.
 */
function createWidth(context: Tone.BaseContext, width: MasterSettings['width']): WidthUnit {
  const raw = context.rawContext as unknown as BaseAudioContext;
  const input = raw.createGain();
  // A mono source becomes the same on both sides (no side signal at all)
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  const output = raw.createGain();
  const split = raw.createChannelSplitter(2);
  const merge = raw.createChannelMerger(2);
  const gain = (level: number) => {
    const g = raw.createGain();
    g.gain.value = level;
    return g;
  };
  const mid = gain(1);
  const side = gain(1);
  const lToMid = gain(0.5);
  const rToMid = gain(0.5);
  const lToSide = gain(0.5);
  const rToSide = gain(-0.5);
  const highpass = () => {
    const f = raw.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = MONO_BASS_HZ;
    f.Q.value = Math.SQRT1_2;
    return f;
  };
  const hp1 = highpass();
  const hp2 = highpass();
  const wide = gain(0);
  const wideHp = gain(0);
  const flip = gain(-1);

  input.connect(split);
  split.connect(lToMid, 0);
  split.connect(rToMid, 1);
  lToMid.connect(mid);
  rToMid.connect(mid);
  split.connect(lToSide, 0);
  split.connect(rToSide, 1);
  lToSide.connect(side);
  rToSide.connect(side);
  side.connect(wide);
  side.connect(hp1);
  hp1.connect(hp2);
  hp2.connect(wideHp);
  // Left = M + S', right = M - S'
  mid.connect(merge, 0, 0);
  mid.connect(merge, 0, 1);
  wide.connect(merge, 0, 0);
  wideHp.connect(merge, 0, 0);
  wide.connect(flip);
  wideHp.connect(flip);
  flip.connect(merge, 0, 1);
  merge.connect(output);

  const ramped = paramSetter(raw);
  const set = (w: MasterSettings['width'], ramp: number) => {
    ramped(wide.gain, w.monoBass ? 0 : w.amount, ramp);
    ramped(wideHp.gain, w.monoBass ? w.amount : 0, ramp);
  };
  set(width, 0);
  const nodes = [input, output, split, merge, mid, side, lToMid, rToMid, lToSide, rToSide, hp1, hp2, wide, wideHp, flip];
  return { input, output, set, dispose: () => nodes.forEach((n) => n.disconnect()) };
}

/**
 * The master compressor's styles: how hard it squeezes the whole mix, and how fast. Standard is
 * the one every project had before; Punchy's slow attack lets each drum hit through before
 * holding the rest; Tight is for dense, loud electronic music; Gentle barely touches it.
 */
export const GLUE_STYLES: Record<GlueStyle, { name: string; about: string; threshold: number; ratio: number; attack: number; release: number }> = {
  standard: { name: 'Standard', about: 'Holds the mix together evenly.', threshold: -18, ratio: 4, attack: 0.005, release: 0.1 },
  gentle: { name: 'Gentle', about: 'Barely touches it: acoustic, orchestral and jazz.', threshold: -14, ratio: 2, attack: 0.03, release: 0.25 },
  punchy: { name: 'Punchy', about: 'Lets each drum hit through before holding the rest: rock, hip-hop, pop.', threshold: -20, ratio: 4, attack: 0.03, release: 0.08 },
  tight: { name: 'Tight', about: 'Firm and loud: dubstep, EDM, drum and bass.', threshold: -22, ratio: 6, attack: 0.003, release: 0.06 },
  off: { name: 'Off', about: 'No master compression (the limiter still catches peaks).', threshold: 0, ratio: 1, attack: 0.005, release: 0.1 },
};

export function createMasterInserts(compressor: Tone.ToneAudioNode, limiter: Tone.ToneAudioNode, settings: MasterSettings): MasterInserts {
  const context = compressor.context;
  const glue = (style: GlueStyle) => {
    const comp = compressor as Tone.Compressor;
    const g = GLUE_STYLES[style] ?? GLUE_STYLES.standard;
    if (!('threshold' in comp)) return;
    comp.threshold.value = g.threshold;
    comp.ratio.value = g.ratio;
    comp.attack.value = g.attack;
    comp.release.value = g.release;
  };
  glue(settings.glue);
  const chain = createInsertChain(compressor, limiter);
  let ott: OttUnit | null = null;
  let width: WidthUnit | null = null;
  let wanted = settings;
  let loading: Promise<void> | null = null;
  let disposed = false;
  let unavailable = false;

  const rewire = (retired: Array<{ dispose: () => void }>) => chain.set([...(ott ? [ott] : []), ...(width ? [width] : [])], retired);

  const apply = (next: MasterSettings, ramp = 0.03) => {
    if (disposed) return;
    if (next.glue !== wanted.glue) glue(next.glue);
    wanted = next;
    const retired: Array<{ dispose: () => void }> = [];
    if (next.ott.on) {
      if (ott) ott.set(next.ott, ramp);
      else if (!loading && !unavailable) {
        loading = createOtt(context, next.ott).then(
          (unit) => {
            loading = null;
            if (disposed || !wanted.ott.on) {
              unit.dispose();
              return;
            }
            unit.set(wanted.ott, 0);
            ott = unit;
            rewire([]);
          },
          (err) => {
            loading = null;
            unavailable = true;
            console.warn('The OTT could not start:', err);
          }
        );
      }
    } else if (ott) {
      retired.push(ott);
      ott = null;
    }
    if (next.width.on) {
      if (width) width.set(next.width, ramp);
      else width = createWidth(context, next.width);
    } else if (width) {
      retired.push(width);
      width = null;
    }
    rewire(retired);
  };
  apply(settings, 0);

  return {
    apply,
    ready: () => loading ?? Promise.resolve(),
    dispose: () => {
      disposed = true;
      chain.dispose();
      ott?.dispose();
      width?.dispose();
      ott = null;
      width = null;
    },
  };
}
