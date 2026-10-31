/**
 * Web Audio Module plugins in the mix: a Plugin track's instrument (createPluginInstrument) and
 * the plugin effects on a track (createPluginChain). Loading, permission and the plugin's own
 * window are in wamHost.ts and PluginDialogs.tsx.
 */
import * as Tone from 'tone';
import type { WamPlugin } from '../../store/timelineTypes';
import { midiOf } from '../../store/noteTools';
import {
  destroyInstance,
  keepActive,
  loadWam,
  nativeContextOf,
  nativeInputOf,
  nativeOutputOf,
  PluginBlockedError,
  registerLiveWam,
  retireLiveWam,
  sendMidi,
  sendTempo,
  setWamParam,
  startingState,
  whenRetired,
  type WamInstance,
} from '../wamHost';
import type { NoteOff, PlayableNote, TrackInstrument } from '../instruments';
import { isBuiltinUrl } from '../plugins/builtinHost';
import { NAMED_PARAM, paramNamesOf } from '../plugins/paramNames';
import { resetsFresh } from '../ccHold';

/**
 * A Plugin track's instrument (a WAM loaded from its URL) and the WAM effects on a track. Both
 * load asynchronously: `ready` waits for them (an export renders only once they're in), and a
 * live one is silent (an instrument) or passes the sound by (an effect) until then, or if it
 * fails to load (the error goes to `onError`).
 */

/** Pitch bend range the host assumes a plugin uses (the MIDI default), in cents. */
const BEND_RANGE_CENTS = 200;
/** A plugin's own bend range setting, and the range a wide bend sets it to (its top: 24 semitones). */
const BEND_RANGE_PARAM = 'Bend range';
const WIDE_BEND_CENTS = 2400;

const isLive = (ctx: BaseAudioContext) => typeof OfflineAudioContext === 'undefined' || !(ctx instanceof OfflineAudioContext);

let errorHandler: (message: string) => void = () => {};
/** Where load errors go (a toast, live). */
export function onPluginError(handler: (message: string) => void): void {
  errorHandler = handler;
}
const report = (plugin: WamPlugin, err: unknown) => {
  if (err instanceof PluginBlockedError) return; // the project's plugin banner asks
  errorHandler(`Couldn't load the plugin "${plugin.name}": ${err instanceof Error ? err.message : String(err)}`);
};

/** Take a plugin instance out of the graph and let it go (a live one once its settings are read). */
function release(plugin: WamPlugin, inst: WamInstance, ctx: BaseAudioContext): void {
  if (isLive(ctx)) retireLiveWam(plugin.id, inst);
  else destroyInstance(inst);
}

/** Load `plugin` into `ctx`, from its latest settings (after any instance of it being let go has given them). */
const loadPlugin = (ctx: BaseAudioContext, plugin: WamPlugin) => whenRetired(plugin.id).then(() => loadWam(ctx, plugin.url, startingState(plugin)));

export function createPluginInstrument(output: Tone.InputNode, plugin: WamPlugin | undefined): TrackInstrument {
  const out = new Tone.Gain(1).connect(output);
  // The plugin plays into `out` natively, out of Tone's sight: keep `out` in the graph
  const unkeep = keepActive(out);
  const ctx = nativeContextOf(out.context);
  let inst: WamInstance | null = null;
  let disposed = false;
  /**
   * From when the plugin plays bends on the wide range (WIDE_BEND_CENTS; Infinity: its own, the
   * MIDI default), see bend. Kept by time: bends are sent ahead (a note's slide when it starts),
   * and each is sent on the range in force at its own time, so a wide step to come doesn't make the
   * bends before it twelve times too wide, nor one sent before it is known too narrow after it.
   */
  let wideFrom = Infinity;
  /** The bend `cents` as MIDI's 14-bit value, on the range in force at `time` */
  const bendValue = (cents: number, time: number) => Math.max(0, Math.min(16383, Math.round(8192 + (cents / (time >= wideFrom ? WIDE_BEND_CENTS : BEND_RANGE_CENTS)) * 8192)));
  /**
   * Every note started since the last let-go: a scheduled note's note-off may still be pending (and
   * is cleared by releaseAll), so each of these gets a note-off then.
   */
  const touched = new Set<number>();
  const noteNumber = (note: string) => {
    const m = midiOf(note);
    return Number.isFinite(m) ? Math.max(0, Math.min(127, m)) : 60;
  };
  /** The tempo last sent: a note goes with the tempo where it starts, when that has changed. */
  let tempo = 0;
  /**
   * The bend played live (the wheel on the player's keyboard), while it's off centre: a hold
   * point's Reset All Controllers centres the bend, so it's sent again after it, and a song at rest
   * (a clip's bend back to centre) leaves it where the player has it. A song's own bend takes it
   * over. (The song's bend at a hold point is the scheduler's to send: see ClipSchedule.hold.) In cents.
   */
  let liveBend: number | undefined;
  /** The song's centres sent ahead of their time (a bent note's end): a wheel moved before one comes is sent again there */
  let centres: number[] = [];
  /**
   * The controllers played live (a knob on the player's keyboard), each one's last value: a hold
   * point's reset puts them back as the player left them (the scheduler sends the clips' lanes'
   * own). A clip's lane sending the same controller takes it over.
   */
  const liveCcs = new Map<number, number>();
  /** When the last Reset All Controllers was set to happen: what's played live for before then, after it was set, is sent again then */
  let resetAt = -Infinity;
  /** The bends sent for later, in the order sent (a plugin that can't drop them has each overridden at a cut; one widened has them sent again: see bend) */
  let sent: Array<[time: number, cents: number]> = [];
  /**
   * A plugin that can't drop the bends sent for later has each one a cut dropped overridden by
   * another for its time (see cutBends): `at`, that time, and `from`, when the bend sent last that's
   * in force there begins. A bend sent since for before `at` (the song from where it jumped to) is
   * sent again at `at`, so the old one's override doesn't hold the bend from the cut over it.
   */
  let overrides: Array<{ at: number; from: number }> = [];
  const midiBend = (cents: number, time: number) => {
    const v = bendValue(cents, time);
    sendMidi(inst!, [0xe0, v & 0x7f, v >> 7], time);
  };
  const sendBend = (cents: number, time: number) => {
    if (!inst) return;
    midiBend(cents, time);
    const now = out.context.currentTime;
    if (time > now) {
      if (sent.length > 64 && sent[0][0] < now) sent = sent.filter(([t]) => t > now);
      sent.push([time, cents]);
    }
    if (!overrides.length) return;
    overrides = overrides.filter((o) => o.at > now);
    for (const o of overrides)
      if (o.at > time && time >= o.from) {
        midiBend(cents, o.at);
        o.from = time;
      }
  };
  /** Drop the bends sent for `time` and after (a jump or Stop), holding the bend `cents` from then. */
  const cutBends = (cents: number, time: number) => {
    if (!inst) return;
    const later = sent.filter(([t]) => t >= time);
    sent = sent.filter(([t]) => t < time);
    if (inst.audioNode.dropBendsAfter) {
      inst.audioNode.dropBendsAfter(time);
      return;
    }
    // (One that can't: each is followed at once by the bend held, so it never sounds)
    const times = new Set([...later.map(([t]) => t), ...overrides.filter((o) => o.at >= time).map((o) => o.at)]);
    overrides = overrides.filter((o) => o.at < time);
    for (const t of times) {
      midiBend(cents, t);
      overrides.push({ at: t, from: time });
    }
  };
  /**
   * The plugin plays bends on the wide range from `time` on (a bend wider than its own: a note's
   * slide or dive), where it has a Bend range setting (Fledge Synth's). The bends already sent for
   * then and after went on its own range: sent again on the wide one.
   */
  const widen = (time: number) => {
    if (!inst) return;
    wideFrom = time;
    setWamParam(inst, `${NAMED_PARAM}${BEND_RANGE_PARAM}`, 1, time);
    const again = sent.filter(([t]) => t >= time);
    if (!again.length) return;
    sent = sent.filter(([t]) => t < time);
    inst.audioNode.dropBendsAfter?.(time);
    for (const [t, cents] of again) sendBend(cents, t);
  };
  /** Where in the song `time` is (beats), while the song plays; else undefined (playing by hand). */
  const beatAt = (time: number): number | undefined => {
    const transport = out.context.transport;
    try {
      if (transport.state !== 'started') return undefined;
      const ticks = transport.getTicksAtTime(time);
      return Number.isFinite(ticks) && ticks >= 0 ? ticks / transport.PPQ : undefined;
    } catch {
      return undefined;
    }
  };
  const on = (n: number, velocity: number, time: number) => {
    if (!inst) return;
    // (In the render's own context: an export's tempo, not the live one)
    const bpm = out.context.transport.bpm.getValueAtTime(time);
    // Each note goes with where in the song it is: plugins that follow the song (Fledge Synth's
    // free LFOs, its random values) play it the same way live and in an export
    const beat = beatAt(time);
    if (Number.isFinite(bpm) && (Math.abs(bpm - tempo) > 0.01 || beat !== undefined)) {
      tempo = bpm;
      sendTempo(inst, bpm, time, beat);
    }
    sendMidi(inst, [0x90, n, Math.max(1, Math.min(127, Math.round(velocity * 127)))], time);
    touched.add(n);
  };
  const off = (n: number, time: number) => {
    if (!inst) return;
    sendMidi(inst, [0x80, n, 0], time);
  };

  const ready = plugin
    ? loadPlugin(ctx, plugin).then(
        (loaded) => {
          if (disposed) {
            release(plugin, loaded, ctx);
            return;
          }
          inst = loaded;
          loaded.audioNode.connect(nativeInputOf(out));
          // The tempo from the start (not only with the first note): free tempo-synced LFOs run
          // before any note
          const now = out.context.currentTime;
          const bpm = out.context.transport.bpm.getValueAtTime(now);
          if (Number.isFinite(bpm) && bpm > 0) {
            tempo = bpm;
            sendTempo(loaded, bpm, now);
          }
          if (isLive(ctx)) registerLiveWam(plugin.id, loaded);
        },
        (err) => report(plugin, err)
      )
    : Promise.resolve();

  return {
    play: (notes: PlayableNote[], time: number) => {
      for (const note of notes) {
        const n = noteNumber(note.note);
        on(n, note.velocity, time);
        // (In the render's own context: an export's tempo, not the live one)
        off(n, time + out.toSeconds(note.duration));
      }
    },
    noteOn: (note: PlayableNote, time: number): NoteOff => {
      const n = noteNumber(note.note);
      on(n, note.velocity, time);
      return (at: number) => off(n, at);
    },
    bend: (cents: number, time: number, live?: boolean, cut?: boolean) => {
      if (!inst) return;
      if (Math.abs(cents) > BEND_RANGE_CENTS + 0.5 && time < wideFrom && plugin && isBuiltinUrl(plugin.url) && paramNamesOf(plugin.url)?.includes(BEND_RANGE_PARAM)) widen(time);
      // (Centred as MIDI has it: its middle value)
      const centred = bendValue(cents, time) === 8192;
      if (cut) centres = centres.filter((t) => t < time);
      if (live) {
        liveBend = centred ? undefined : cents;
        if (cut) cutBends(cents, time);
        sendBend(cents, time);
        if (resetAt > time) sendBend(cents, resetAt);
        // (The song's centres sent ahead: the wheel there instead)
        const now = out.context.currentTime;
        centres = centres.filter((t) => t > now);
        for (const t of centres) sendBend(cents, t);
        return;
      }
      // The song's bend takes the wheel over; back at rest, the wheel is where the player has it
      if (!centred) {
        liveBend = undefined;
        centres = centres.filter((t) => t < time);
      } else if (time > out.context.currentTime) {
        if (centres.length > 64) centres = centres.filter((t) => t > out.context.currentTime);
        centres.push(time);
      }
      if (cut) cutBends(liveBend ?? cents, time);
      sendBend(liveBend ?? cents, time);
    },
    releaseAll: () => {
      if (!inst) return;
      const now = out.context.currentTime;
      inst.audioNode.clearEvents?.();
      for (const n of touched) sendMidi(inst, [0x80, n, 0], now);
      sendMidi(inst, [0xb0, 64, 0], now);
      sendMidi(inst, [0xb0, 123, 0], now);
      sendMidi(inst, [0xe0, 0, 64], now);
      // Reset All Controllers: a controller lane's value is held to the end of the song, not past
      // Stop (the mod wheel back to 0...; the scheduler sets them again where playback starts, see ccHold.ts)
      sendMidi(inst, [0xb0, 121, 0], now);
      touched.clear();
      sent = [];
      overrides = [];
      centres = [];
      liveBend = undefined;
      liveCcs.clear();
      resetAt = -Infinity;
      // (A tempo waiting with the cleared events never arrived)
      tempo = 0;
      // Nor maybe the wide Bend range: back to the plugin's own, so the next wide bend widens it again
      // (and its knob is free to turn)
      if (wideFrom !== Infinity) {
        wideFrom = Infinity;
        inst.audioNode.resetParam?.(`${NAMED_PARAM}${BEND_RANGE_PARAM}`);
      }
    },
    cc: (cc: number, value: number, time: number, live?: boolean) => {
      if (!inst) return;
      const n = Math.max(0, Math.min(119, cc));
      const v = Math.max(0, Math.min(127, Math.round(value * 127)));
      sendMidi(inst, [0xb0, n, v], time);
      if (!live) {
        liveCcs.delete(n);
        return;
      }
      liveCcs.set(n, v);
      if (resetAt > time) sendMidi(inst, [0xb0, n, v], resetAt);
    },
    resetControllers: (time: number) => {
      if (!inst) return false;
      sendMidi(inst, [0xb0, 121, 0], time);
      // (It centres the bend too: the wheel and the knobs played live stay where the player left
      // them, sent again after it; the song's own bend here the scheduler sends after this)
      if (liveBend !== undefined) sendBend(liveBend, time);
      for (const [n, v] of liveCcs) sendMidi(inst, [0xb0, n, v], time);
      resetAt = Math.max(resetAt, time);
      return !!plugin && resetsFresh(plugin.url);
    },
    setPluginParam: (pluginId, paramId, value, time) => {
      if (!inst || pluginId !== plugin?.id) return false;
      setWamParam(inst, paramId, value, time);
      return true;
    },
    ready,
    dispose: () => {
      disposed = true;
      if (inst && plugin) release(plugin, inst, ctx);
      inst = null;
      unkeep();
      out.dispose();
    },
  };
}

/**
 * The WAM effects on a track, in order, between `input` and `output`: `input` plays straight into
 * `output` until they're in (or if none load), then through each one that isn't bypassed.
 */
export function createPluginChain(
  output: Tone.InputNode,
  plugins: WamPlugin[]
): { input: Tone.Gain; ready: Promise<unknown>; dispose: () => void; setPluginParam: (pluginId: string, paramId: string, value: number, time: number) => boolean } {
  const input = new Tone.Gain(1);
  input.connect(output);
  // The last plugin plays into the strip natively, out of Tone's sight: keep that in the graph
  const sink = new Tone.Gain(1).connect(output);
  const unkeep = keepActive(sink);
  const ctx = nativeContextOf(input.context);
  const loaded: Array<{ plugin: WamPlugin; inst: WamInstance }> = [];
  let disposed = false;
  const active = plugins.filter((p) => !p.bypass);
  const ready = Promise.all(
    active.map((plugin) =>
      loadPlugin(ctx, plugin).then(
        (inst) => ({ plugin, inst }),
        (err) => {
          report(plugin, err);
          return null;
        }
      )
    )
  ).then((results) => {
    const ok = results.filter((r): r is { plugin: WamPlugin; inst: WamInstance } => !!r);
    if (disposed) {
      ok.forEach(({ plugin, inst }) => release(plugin, inst, ctx));
      return;
    }
    if (!ok.length) return;
    loaded.push(...ok);
    // Wired natively: input -> each plugin -> output
    const from = nativeOutputOf(input);
    const to = nativeInputOf(sink);
    input.disconnect();
    let prev: AudioNode = from;
    for (const { plugin, inst } of ok) {
      prev.connect(inst.audioNode);
      prev = inst.audioNode;
      if (isLive(ctx)) registerLiveWam(plugin.id, inst);
    }
    prev.connect(to);
  });
  return {
    input,
    ready,
    setPluginParam: (pluginId, paramId, value, time) => {
      const found = loaded.find((l) => l.plugin.id === pluginId);
      if (!found) return false;
      setWamParam(found.inst, paramId, value, time);
      return true;
    },
    dispose: () => {
      disposed = true;
      loaded.forEach(({ plugin, inst }) => release(plugin, inst, ctx));
      try {
        nativeOutputOf(input).disconnect();
      } catch {
        // Not connected
      }
      input.dispose();
      unkeep();
      sink.dispose();
    },
  };
}
