// Fledge Synth for the Web Audio API. Part of Fledgetone (https://fledgetone.com),
// © Martin Swanson, GPL-3.0-or-later. No libraries: Web Audio and WebAssembly only.
//
//   import { FledgeSynth } from './fledge-synth.js';
//   const context = new AudioContext();
//   const synth = await FledgeSynth.create(context, { preset: 'Lead/Supersaw' });
//   synth.connect(context.destination);
//   synth.noteOn(60, 100);                        // middle C (or 'C4'), velocity 1 to 127
//   synth.noteOff(60, context.currentTime + 0.5); // times are on the audio clock (seconds)
//   synth.setParam('Cutoff', 0.4);                // every parameter is 0 to 1...
//   synth.setParam('Filter type', 'Ladder');      // ...and a choice can be set by its option's name
//   await synth.setPreset('Bass/Wobble');
//   synth.listPresets(); synth.listParams();
//
// It needs fledge.wasm, fledge-processor.js and fledge-choices.js next to this file (or say where
// with the `wasmUrl` and `processorUrl` options), and a page served over http(s), not a file:
// AudioWorklets need it.

import { CHOICES } from './fledge-choices.js';

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A MIDI note number from a number or a name ('C4' is 60, 'F#3', 'Bb2'). */
export function noteNumber(note) {
  if (typeof note === 'number') return Math.max(0, Math.min(127, Math.round(note)));
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(note).trim());
  if (!m) throw new Error(`Not a note: ${note}`);
  const n = NAMES[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return Math.max(0, Math.min(127, n));
}

// The processor is added once per context, and fledge.wasm compiled once per page
const added = new WeakMap();
const modules = new Map();

function compile(url) {
  const key = String(url);
  if (!modules.has(key)) {
    const p = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${url}: ${res.status}`);
      return res.arrayBuffer();
    }).then((bytes) => WebAssembly.compile(bytes));
    p.catch(() => modules.delete(key));
    modules.set(key, p);
  }
  return modules.get(key);
}

export class FledgeSynth {
  /**
   * Make a synth in `context` (an AudioContext or OfflineAudioContext). Options: `preset` (a name
   * from listPresets() or its number), `tempo` (beats per minute, for the parts that keep time),
   * `wasmUrl`, `processorUrl`.
   */
  static async create(context, options = {}) {
    if (!context.audioWorklet) throw new Error('AudioWorklets need a secure page (https or localhost)');
    const wasmUrl = options.wasmUrl ?? new URL('./fledge.wasm', import.meta.url);
    const processorUrl = options.processorUrl ?? new URL('./fledge-processor.js', import.meta.url);
    let adding = added.get(context);
    if (!adding) {
      adding = context.audioWorklet.addModule(processorUrl);
      added.set(context, adding);
      adding.catch(() => added.delete(context));
    }
    const [module] = await Promise.all([compile(wasmUrl), adding]);
    const node = new AudioWorkletNode(context, 'fledge-synth', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { module, preset: typeof options.preset === 'number' ? options.preset : undefined, tempo: options.tempo },
    });
    const synth = new FledgeSynth(context, node);
    await synth.ready;
    if (typeof options.preset === 'string') await synth.setPreset(options.preset);
    return synth;
  }

  constructor(context, node) {
    this.context = context;
    /** The AudioWorkletNode: its one output is the synth's stereo sound */
    this.node = node;
    this.params = [];
    this.presets = [];
    this.preset = -1;
    this.waiting = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => {
      node.port.onmessage = (m) => {
        const d = m.data;
        if (d.type === 'ready') {
          this.params = d.params;
          this.presets = d.presets;
          this.preset = d.preset;
          this.index = new Map(d.params.map((p, i) => [p.name, i]));
          resolve(this);
        } else if (d.type === 'error') {
          reject(new Error(d.message));
        } else if (d.type === 'params') {
          this.params = d.params;
          this.preset = d.preset;
          const done = this.waiting.get(d.id);
          this.waiting.delete(d.id);
          done?.(d.params);
        }
      };
    });
  }

  /** Send the synth's sound to an AudioNode (returns it, so calls can chain, as AudioNode.connect does). */
  connect(destination, output, input) {
    return this.node.connect(destination, output ?? 0, input ?? 0);
  }

  disconnect(...args) {
    this.node.disconnect(...args);
  }

  /** A MIDI message (status, data 1, data 2) at audio time `time` (now if left out). */
  midi(status, d1 = 0, d2 = 0, time = this.context.currentTime) {
    this.node.port.postMessage({ type: 'midi', bytes: [status & 0xff, d1 & 0x7f, d2 & 0x7f], time });
  }

  /** Start note `note` (a number or a name like 'C4') at `velocity` (1 to 127). */
  noteOn(note, velocity = 100, time) {
    this.midi(0x90, noteNumber(note), Math.max(1, Math.min(127, Math.round(velocity))), time);
  }

  noteOff(note, time) {
    this.midi(0x80, noteNumber(note), 0, time);
  }

  /** Let every note go (`hard`: cut them off at once instead of letting them ring out). */
  allNotesOff(time, hard = false) {
    this.midi(0xb0, hard ? 120 : 123, 0, time);
  }

  /** Bend the pitch: -1 to 1 (how far is the "Bend range" parameter). */
  pitchBend(amount, time) {
    const v = Math.max(0, Math.min(16383, Math.round((Math.max(-1, Math.min(1, amount)) + 1) * 8192)));
    this.midi(0xe0, v & 0x7f, v >> 7, time);
  }

  /** The mod wheel, 0 to 1 (a preset's matrix may use it). */
  modWheel(amount, time) {
    this.midi(0xb0, 1, Math.round(Math.max(0, Math.min(1, amount)) * 127), time);
  }

  /** The song's tempo in beats per minute (LFOs and the delay set to keep time follow it). */
  setTempo(bpm) {
    this.node.port.postMessage({ type: 'tempo', bpm });
  }

  /** The parameters' names, in the synth's order. */
  listParams() {
    return this.params.map((p) => p.name);
  }

  /** The presets' names, in the synth's order. */
  listPresets() {
    return [...this.presets];
  }

  /** A parameter's place in the list, from its name (or its place). */
  paramIndex(param) {
    const i = typeof param === 'number' ? param : this.index.get(param);
    if (i === undefined || i < 0 || i >= this.params.length) throw new Error(`No parameter ${param}`);
    return i;
  }

  /** The options of a choice parameter ('Filter type', 'LFO 1 shape'...), or undefined for a knob or a switch. */
  choices(param) {
    return CHOICES[this.params[this.paramIndex(param)].name]?.options;
  }

  /**
   * Set a parameter (by its name or place) to `value`, 0 to 1, at audio time `time` (now if left
   * out). A choice parameter also takes the name of one of its options.
   */
  setParam(param, value, time = this.context.currentTime) {
    const index = this.paramIndex(param);
    let v = value;
    if (typeof value === 'string') {
      const c = CHOICES[this.params[index].name];
      const k = c ? c.options.indexOf(value) : -1;
      if (k < 0) throw new Error(`${this.params[index].name} has no option ${value}`);
      v = c.cap > 1 ? k / (c.cap - 1) : 0;
    } else if (typeof value === 'boolean') {
      v = value ? 1 : 0;
    }
    if (!Number.isFinite(v)) throw new Error(`Not a value: ${value}`);
    v = Math.max(0, Math.min(1, v));
    this.params[index] = { ...this.params[index], value: v };
    this.node.port.postMessage({ type: 'set', index, value: v, time });
  }

  /** A parameter's value (0 to 1) as last set or read. */
  getParam(param) {
    return this.params[this.paramIndex(param)].value;
  }

  /** Every parameter as the synth has it now: { name, value (0 to 1), text ("8.00 kHz") }. */
  describe() {
    return this.ask({ type: 'describe' });
  }

  /** Choose a preset by its name or number (it sets every parameter). */
  async setPreset(preset) {
    const index = typeof preset === 'number' ? preset : this.presets.indexOf(preset);
    if (index < 0 || index >= this.presets.length) throw new Error(`No preset ${preset}`);
    await this.ask({ type: 'preset', index });
  }

  ask(message) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.node.port.postMessage({ ...message, id });
    });
  }

  /** Free the synth; it can't be used after. */
  destroy() {
    this.node.port.postMessage({ type: 'destroy' });
    this.node.disconnect();
  }
}
