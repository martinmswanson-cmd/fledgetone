// The Drop pad's effects for the Web Audio API. Part of Fledgetone (https://fledgetone.com),
// © Martin Swanson, GPL-3.0-or-later. No libraries.
//
//   import { createDropEffects } from './drop-effects.js';
//   const drop = await createDropEffects(context, { tempo: 128 });
//   music.connect(drop.input); drop.connect(context.destination);
//   drop.on('Stutter');                            // now, or at an audio-clock time in seconds
//   drop.off('Stutter', context.currentTime + 1);  // let go
//   drop.cancel();                                 // let go of everything, forget what was due
//
// The effects: Stutter, Filter, Tape stop, Crush, Gate and Echo. Several can be on at once. Each
// keeps time with the music by its 16th note: set the tempo (or the 16th's length) to match.
// It needs drop-processor.js next to this file (or say where with `processorUrl`), and a page
// served over http(s): AudioWorklets don't run from a file.

/** The effects' names, in the order the processor numbers them. */
export const DROP_EFFECT_NAMES = ['Stutter', 'Filter', 'Tape stop', 'Crush', 'Gate', 'Echo'];

/** An effect's number from its name ('Tape stop', 'tape', 'TAPE STOP') or number. */
export function dropEffectIndex(fx) {
  if (typeof fx === 'number' && Number.isInteger(fx) && fx >= 0 && fx < DROP_EFFECT_NAMES.length) return fx;
  const key = String(fx).trim().toLowerCase();
  const i = DROP_EFFECT_NAMES.findIndex((n) => n.toLowerCase() === key || n.toLowerCase().split(' ')[0] === key);
  if (i < 0) throw new Error(`No Drop effect ${fx} (there are ${DROP_EFFECT_NAMES.join(', ')})`);
  return i;
}

const added = new WeakMap();

/**
 * Make the effects in `context`. Options: `tempo` (beats per minute, 120 if left out), or
 * `sixteenth` (seconds a 16th note lasts), and `processorUrl`.
 */
export async function createDropEffects(context, options = {}) {
  if (!context.audioWorklet) throw new Error('AudioWorklets need a secure page (https or localhost)');
  const processorUrl = options.processorUrl ?? new URL('./drop-processor.js', import.meta.url);
  let adding = added.get(context);
  if (!adding) {
    adding = context.audioWorklet.addModule(processorUrl);
    added.set(context, adding);
    adding.catch(() => added.delete(context));
  }
  await adding;
  const node = new AudioWorkletNode(context, 'bbx-drop', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  let sixteenth = options.sixteenth > 0 ? options.sixteenth : 15 / (options.tempo > 0 ? options.tempo : 120);
  /** When each effect was last turned on (its "off" comes after that) */
  const lastOn = DROP_EFFECT_NAMES.map(() => undefined);
  const now = () => context.currentTime;
  const post = (m) => node.port.postMessage(m);
  return {
    /** The AudioWorkletNode: send the music into it, take the sound from it */
    node,
    input: node,
    output: node,
    effects: [...DROP_EFFECT_NAMES],
    connect: (destination, output, input) => node.connect(destination, output ?? 0, input ?? 0),
    disconnect: (...args) => node.disconnect(...args),
    /** Turn effect `fx` on at audio time `time` (now if left out). */
    on(fx, time = now()) {
      const i = dropEffectIndex(fx);
      lastOn[i] = time;
      post({ on: i, at: time, sixteenth });
    },
    /** Let go of effect `fx` at audio time `time` (now if left out). */
    off(fx, time = now()) {
      const i = dropEffectIndex(fx);
      post({ off: i, at: time, from: lastOn[i] });
    },
    /** Let go of every effect at `time` (now if left out) and forget anything due after it. */
    cancel(time = now()) {
      post({ cancel: true, at: time });
    },
    /** The music's tempo (beats per minute): effects turned on from now keep time with it. */
    setTempo(bpm) {
      if (bpm > 0) sixteenth = 15 / bpm;
    },
    /** How long a 16th note lasts, in seconds (instead of a tempo). */
    setSixteenth(seconds) {
      if (seconds > 0) sixteenth = seconds;
    },
    get sixteenth() {
      return sixteenth;
    },
    /** Stop the effects for good and take them out. */
    dispose() {
      post('dispose');
      node.disconnect();
    },
  };
}
