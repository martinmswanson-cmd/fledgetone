import * as Tone from 'tone';
import type { WamPlugin } from '../../store/timelineTypes';
import { midiOf } from '../../store/noteTools';
import {
  loadWam,
  nativeContextOf,
  nativeInputOf,
  nativeOutputOf,
  PluginBlockedError,
  registerLiveWam,
  keepActive,
  sendMidi,
  startingState,
  unregisterLiveWam,
  type WamInstance,
} from '../wamHost';
import type { NoteOff, PlayableNote, TrackInstrument } from '../instruments';

/**
 * A Plugin track's instrument (a WAM loaded from its URL) and the WAM effects on a track. Both
 * load asynchronously: `ready` waits for them (an export renders only once they're in), and a
 * live one is silent (an instrument) or passes the sound by (an effect) until then, or if it
 * fails to load (the error goes to `onError`).
 */

/** Pitch bend range the host assumes a plugin uses (the MIDI default), in cents. */
const BEND_RANGE_CENTS = 200;

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

/** Take a plugin instance out of the graph and let it go. */
function release(plugin: WamPlugin, inst: WamInstance, ctx: BaseAudioContext): void {
  try {
    inst.audioNode.disconnect();
  } catch {
    // Not connected
  }
  try {
    inst.audioNode.destroy?.();
  } catch {
    // Already destroyed
  }
  if (isLive(ctx)) unregisterLiveWam(plugin.id, inst);
}

export function createPluginInstrument(output: Tone.InputNode, plugin: WamPlugin | undefined): TrackInstrument {
  const out = new Tone.Gain(1).connect(output);
  // The plugin plays into `out` natively, out of Tone's sight: keep `out` in the graph
  const unkeep = keepActive(out);
  const ctx = nativeContextOf(out.context);
  let inst: WamInstance | null = null;
  let disposed = false;
  /** Notes sounding (key held or scheduled), so they can all be let go */
  const sounding = new Map<number, number>();
  const noteNumber = (note: string) => {
    const m = midiOf(note);
    return Number.isFinite(m) ? Math.max(0, Math.min(127, m)) : 60;
  };
  const on = (n: number, velocity: number, time: number) => {
    if (!inst) return;
    sendMidi(inst, [0x90, n, Math.max(1, Math.min(127, Math.round(velocity * 127)))], time);
    sounding.set(n, (sounding.get(n) ?? 0) + 1);
  };
  const off = (n: number, time: number) => {
    if (!inst) return;
    sendMidi(inst, [0x80, n, 0], time);
    const left = (sounding.get(n) ?? 1) - 1;
    if (left > 0) sounding.set(n, left);
    else sounding.delete(n);
  };

  const ready = plugin
    ? loadWam(ctx, plugin.url, startingState(plugin)).then(
        (loaded) => {
          if (disposed) {
            release(plugin, loaded, ctx);
            return;
          }
          inst = loaded;
          loaded.audioNode.connect(nativeInputOf(out));
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
        off(n, time + Tone.Time(note.duration).toSeconds());
      }
    },
    noteOn: (note: PlayableNote, time: number): NoteOff => {
      const n = noteNumber(note.note);
      on(n, note.velocity, time);
      return (at: number) => off(n, at);
    },
    bend: (cents: number, time: number) => {
      if (!inst) return;
      const v = Math.max(0, Math.min(16383, Math.round(8192 + (cents / BEND_RANGE_CENTS) * 8192)));
      sendMidi(inst, [0xe0, v & 0x7f, v >> 7], time);
    },
    releaseAll: () => {
      if (!inst) return;
      const now = out.context.currentTime;
      inst.audioNode.clearEvents?.();
      for (const n of sounding.keys()) sendMidi(inst, [0x80, n, 0], now);
      sendMidi(inst, [0xb0, 123, 0], now);
      sendMidi(inst, [0xe0, 0, 64], now);
      sounding.clear();
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
export function createPluginChain(output: Tone.InputNode, plugins: WamPlugin[]): { input: Tone.Gain; ready: Promise<unknown>; dispose: () => void } {
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
      loadWam(ctx, plugin.url, startingState(plugin)).then(
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
