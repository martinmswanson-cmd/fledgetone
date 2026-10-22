/**
 * The master section's inserts, between the master compressor and the Level and limiter (see
 * engine.ts):
 *   compressor -> [OTT] -> [Stereo width] -> [Drop] -> Level -> [Clipper] -> limiter
 * The Drop pad's effects (dropFx.ts) are there only while the song has a Drop track (setDrop).
 * Each insert exists only while it's switched on, like a track's inserts: off, it is taken out of
 * the chain and disposed, so it costs nothing. The OTT is an AudioWorklet (ott.ts); the width is a
 * handful of plain nodes doing mid/side; the Level is one gain, always there. A switch crossfades
 * between the old and the new chain on the audio clock the way a track strip does (trackStrip.ts,
 * rewire), so switching while the song plays opens no gap.
 *
 * In an export's offline context the inserts and the Level aren't built at all: the render stops
 * after the compressor, and masterAfter.ts runs the OTT, width, Level and limiter over the finished
 * render in plain JavaScript (an AudioWorklet would keep the whole render in memory for good).
 */
import * as Tone from 'tone';
import type { GlueStyle, MasterSettings } from '../../store/timelineTypes';
import { createWorkletNode, loadWorklet } from '../worklets';
import { OTT_PROCESSOR, OTT_WORKLET_SOURCE } from './ott';
import { MONO_BASS_HZ, MONO_BASS_Q } from './masterAfter';
import { effectiveClipper, effectiveWidth, livePushDb, LOUD_SHELF_HZ, pushDb, subTiltDb } from './loudMaster';
import { monitorStatus, onMonitorReading } from '../monitor';
import { CLIPPER_PROCESSOR, CLIPPER_WORKLET_SOURCE, clipperParams, type ClipperReading, type ClipperSettings } from './clipper';
import { paramSetter as smoothParamSetter } from './smoothParam';
import { DROP_PROCESSOR, DROP_WORKLET_SOURCE } from './dropFx';
import { setLiveDropPort } from '../dropLive';

export interface MasterInserts {
  /** Apply settings, ramping continuous ones over `ramp` seconds (0: at once). */
  apply: (settings: MasterSettings, ramp?: number) => void;
  /** Put the Drop pad's effects in the chain (the song has a Drop track) or take them out. Live only. */
  setDrop: (on: boolean) => void;
  /** Resolves once the inserts the settings ask for are in the chain (the OTT loads its worklet first). */
  ready: () => Promise<void>;
  dispose: () => void;
}

export { MONO_BASS_HZ };

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
function createInsertChain(raw: BaseAudioContext, head: Node, tail: Node, live: boolean) {
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

interface ClipperUnit extends Unit {
  set: (clipper: ClipperSettings, ramp: number) => void;
  /** The band kind (ClipperSettings.band): a change of kind is a new unit, faded over to. */
  band: boolean;
}

/** Listeners to the live clipper's readings (the Master tab's meter). */
const clipperListeners = new Set<(reading: ClipperReading) => void>();

/** Hear what the live clipper does, a few times a second while it's on; returns a function that stops listening. */
export function onClipperReading(listener: (reading: ClipperReading) => void): () => void {
  clipperListeners.add(listener);
  return () => clipperListeners.delete(listener);
}

/** The clipper worklet (clipper.ts), once its module is in the context. */
async function createClipper(context: Tone.BaseContext, settings: ClipperSettings): Promise<ClipperUnit> {
  await loadWorklet(context, CLIPPER_PROCESSOR, CLIPPER_WORKLET_SOURCE);
  const p = clipperParams(settings);
  const node = createWorkletNode(context, CLIPPER_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    parameterData: p,
    processorOptions: { band: settings.band === true },
  });
  node.port.onmessage = (e: MessageEvent<ClipperReading>) => clipperListeners.forEach((l) => l(e.data));
  const raw = context.rawContext as unknown as BaseAudioContext;
  const ramped = paramSetter(raw);
  const param = (name: string) => node.parameters.get(name)!;
  const set = (s: ClipperSettings, ramp: number) => {
    const v = clipperParams(s);
    ramped(param('drive'), v.drive, ramp);
    ramped(param('ceiling'), v.ceiling, ramp);
    ramped(param('softness'), v.softness, ramp);
  };
  return {
    input: node,
    output: node,
    set,
    band: settings.band === true,
    dispose: () => {
      node.port.onmessage = null;
      node.port.postMessage('dispose');
      node.disconnect();
    },
  };
}

/** The Drop pad's worklet (dropFx.ts), once its module is in the context; its port is the live one (dropLive.ts). */
async function createDrop(context: Tone.BaseContext): Promise<Unit> {
  await loadWorklet(context, DROP_PROCESSOR, DROP_WORKLET_SOURCE);
  const node = createWorkletNode(context, DROP_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  return {
    input: node,
    output: node,
    dispose: () => {
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
    f.Q.value = MONO_BASS_Q;
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

interface ShelfUnit extends Unit {
  set: (db: number, ramp: number) => void;
}

/** A Loud master's sub tilt: a low shelf at LOUD_SHELF_HZ (a BiquadFilterNode, as masterAfter.ts computes it). */
function createShelf(context: Tone.BaseContext, db: number): ShelfUnit {
  const raw = context.rawContext as unknown as BaseAudioContext;
  const f = raw.createBiquadFilter();
  f.type = 'lowshelf';
  f.frequency.value = LOUD_SHELF_HZ;
  f.gain.value = db;
  f.channelCount = 2;
  f.channelCountMode = 'explicit';
  const ramped = paramSetter(raw);
  return { input: f, output: f, set: (v, ramp) => ramped(f.gain, v, ramp), dispose: () => f.disconnect() };
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

/**
 * The inserts from `compressor` into `level` (a gain just before the limiter, which applies the
 * Level), with the glue style on the compressor. In an offline context (an export) only the glue:
 * the compressor plays straight into `level`, left at unity, and masterAfter.ts does the rest.
 */
export function createMasterInserts(compressor: Tone.ToneAudioNode, level: GainNode, settings: MasterSettings, limiterIn?: GainNode): MasterInserts {
  const context = compressor.context;
  const raw = context.rawContext as unknown as BaseAudioContext;
  const live = !(typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext);
  const ramped = paramSetter(raw);
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
  const chain = createInsertChain(raw, compressor, level, live);
  // The clipper sits after the Level, before the limiter: a chain of its own, level -> [clipper] -> limiterIn
  const clipChain = limiterIn ? createInsertChain(raw, level, limiterIn, live) : null;
  let clipper: ClipperUnit | null = null;
  let clipLoading: Promise<void> | null = null;
  let clipUnavailable = false;
  let ott: OttUnit | null = null;
  let width: WidthUnit | null = null;
  let wanted = settings;
  let loading: Promise<void> | null = null;
  let disposed = false;
  let unavailable = false;

  let drop: Unit | null = null;
  let dropWanted = false;
  let dropLoading: Promise<void> | null = null;
  let dropUnavailable = false;

  let shelf: ShelfUnit | null = null;
  const rewire = (retired: Array<{ dispose: () => void }>) => chain.set([...(ott ? [ott] : []), ...(width ? [width] : []), ...(shelf ? [shelf] : []), ...(drop ? [drop] : [])], retired);

  const setDrop = (on: boolean) => {
    dropWanted = on;
    if (!live || disposed) return;
    if (on && !drop && !dropLoading && !dropUnavailable) {
      dropLoading = createDrop(context).then(
        (unit) => {
          dropLoading = null;
          if (disposed || !dropWanted) {
            unit.dispose();
            return;
          }
          drop = unit;
          setLiveDropPort((unit.input as AudioWorkletNode).port);
          rewire([]);
        },
        (err) => {
          dropLoading = null;
          dropUnavailable = true;
          console.warn('The Drop pad could not start:', err);
        }
      );
    } else if (!on && drop) {
      const old = drop;
      drop = null;
      setLiveDropPort(null);
      rewire([old]);
    }
  };

  const apply = (next: MasterSettings, ramp = 0.03) => {
    if (disposed) return;
    if (next.glue !== wanted.glue) glue(next.glue);
    wanted = next;
    if (!live) return;
    ramped(level.gain, Tone.dbToGain(next.level + (live ? livePushDb(next, monitorStatus() === 'on') : pushDb(next))), ramp);
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
    const w = effectiveWidth(next);
    if (w) {
      if (width) width.set(w, ramp);
      else width = createWidth(context, w);
    } else if (width) {
      retired.push(width);
      width = null;
    }
    const tilt = subTiltDb(next);
    if (tilt) {
      if (shelf) shelf.set(tilt, ramp);
      else shelf = createShelf(context, tilt);
    } else if (shelf) {
      retired.push(shelf);
      shelf = null;
    }
    rewire(retired);
    if (!clipChain) return;
    syncClipper(next, ramp);
  };
  /** The clipper as `next` wants it: set, started, swapped for the other kind (faded over), or taken out. */
  const syncClipper = (next: MasterSettings, ramp: number) => {
    if (!clipChain) return;
    const clipWanted = effectiveClipper(next);
    if (clipWanted) {
      const band = clipWanted.band === true;
      if (clipper) clipper.set(clipWanted, ramp);
      if ((!clipper || clipper.band !== band) && !clipLoading && !clipUnavailable) {
        clipLoading = createClipper(context, clipWanted).then(
          (unit) => {
            clipLoading = null;
            const now = effectiveClipper(wanted);
            if (disposed || !now || (now.band === true) !== unit.band) {
              unit.dispose();
              // (Changed again while it started: the one wanted now)
              if (!disposed) syncClipper(wanted, 0);
              return;
            }
            unit.set(now, 0);
            const old = clipper;
            clipper = unit;
            clipChain.set([unit], old ? [old] : []);
          },
          (err) => {
            clipLoading = null;
            clipUnavailable = true;
            console.warn('The clipper could not start:', err);
          }
        );
      }
    } else if (clipper) {
      const old = clipper;
      clipper = null;
      clipChain.set([], [old]);
    }
  };
  apply(settings, 0);
  // The Loud master's push comes in once the listening path (its level matching and safety
  // limiter) is in, over a few seconds so the level matching keeps up; never if it can't start
  let heardStatus = monitorStatus();
  const stopHearing = live
    ? onMonitorReading(({ status }) => {
        if (status === heardStatus || disposed) return;
        heardStatus = status;
        ramped(level.gain, Tone.dbToGain(wanted.level + livePushDb(wanted, status === 'on')), 3);
      })
    : () => {};

  return {
    apply,
    setDrop,
    ready: () => Promise.all([loading, clipLoading, dropLoading]).then(() => undefined),
    dispose: () => {
      disposed = true;
      stopHearing();
      if (drop) setLiveDropPort(null);
      drop?.dispose();
      drop = null;
      chain.dispose();
      clipChain?.dispose();
      clipper?.dispose();
      clipper = null;
      ott?.dispose();
      width?.dispose();
      shelf?.dispose();
      ott = null;
      width = null;
      shelf = null;
    },
  };
}
