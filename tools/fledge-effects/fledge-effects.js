// The Fledge effects for the Web Audio API. Part of Fledgetone (https://fledgetone.com),
// © Martin Swanson, MIT licence. No libraries: Web Audio and WebAssembly only.
//
//   import { FledgeEffect } from './fledge-effects.js';
//   const context = new AudioContext();
//   const comp = await FledgeEffect.create(context, 'compressor', { preset: 'Duck under the kick' });
//   bass.connect(comp.node);                      // the sound to treat goes into the node...
//   comp.connect(context.destination);            // ...and comes out of it
//   comp.setSidechain(kick);                      // what it listens to (a compressor, gate, vocoder)
//   comp.setParam('Threshold', 0.4);              // every parameter is 0 to 1
//   comp.describe();                              // each parameter with the text it shows ("-36.0 dB")
//
// The effects: 'compressor', 'gate', 'vocoder', 'repeat', 'harmony', 'shifter', 'spectral'.
// It needs the .wasm files and fledge-effects-processor.js next to this file (or say where with
// the `wasmUrl` and `processorUrl` options), and a page served over http(s), not a file:
// AudioWorklets need it.

/** The effects, by the short name `create` takes: each one's file. */
export const EFFECTS = {
  compressor: 'fledge-compressor.wasm',
  gate: 'fledge-gate.wasm',
  vocoder: 'fledge-vocoder.wasm',
  repeat: 'fledge-repeat.wasm',
  harmony: 'fledge-harmony.wasm',
  shifter: 'fledge-shifter.wasm',
  spectral: 'fledge-spectral.wasm',
};

// The processor is added once per context, and each .wasm compiled once per page
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

export class FledgeEffect {
  /**
   * Make the effect `kind` (a name from EFFECTS) in `context` (an AudioContext or
   * OfflineAudioContext). Options: `preset` (a name from listPresets() or its number), `tempo`
   * (beats per minute, for the beat repeat), `wasmUrl`, `processorUrl`.
   */
  static async create(context, kind, options = {}) {
    if (!context.audioWorklet) throw new Error('AudioWorklets need a secure page (https or localhost)');
    if (!options.wasmUrl && !Object.hasOwn(EFFECTS, kind)) throw new Error(`No effect called ${kind}: ${Object.keys(EFFECTS).join(', ')}`);
    const wasmUrl = options.wasmUrl ?? new URL(`./${EFFECTS[kind]}`, import.meta.url);
    const processorUrl = options.processorUrl ?? new URL('./fledge-effects-processor.js', import.meta.url);
    let adding = added.get(context);
    if (!adding) {
      adding = context.audioWorklet.addModule(processorUrl);
      added.set(context, adding);
      adding.catch(() => added.delete(context));
    }
    const [module] = await Promise.all([compile(wasmUrl), adding]);
    const node = new AudioWorkletNode(context, 'fledge-effect', {
      // The sound to treat, and a sidechain
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { module, preset: typeof options.preset === 'number' ? options.preset : undefined, tempo: options.tempo },
    });
    const effect = new FledgeEffect(context, node);
    await effect.ready;
    if (typeof options.preset === 'string') await effect.setPreset(options.preset);
    return effect;
  }

  constructor(context, node) {
    this.context = context;
    /** The AudioWorkletNode: connect the sound to treat to it; its output is the treated sound */
    this.node = node;
    this.params = [];
    this.presets = [];
    this.preset = -1;
    /** The effect's name and what it does, and whether it listens to a sidechain or follows the song */
    this.info = {};
    this.key = null;
    this.waiting = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => {
      node.port.onmessage = (m) => {
        const d = m.data;
        if (d.type === 'ready') {
          this.info = d.info;
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
          this.waiting.get(d.id)?.(d.params);
          this.waiting.delete(d.id);
        }
      };
    });
  }

  /** Whether it listens to a sidechain (the compressor, the gate and the vocoder do). */
  get listens() {
    return !!this.info.sidechain;
  }

  /** Whether it follows the song's tempo and position (the beat repeat does): see setPosition. */
  get followsSong() {
    return !!this.info.transport;
  }

  connect(...args) {
    return this.node.connect(...args);
  }

  disconnect(...args) {
    return this.node.disconnect(...args);
  }

  /**
   * The sound it listens to: another AudioNode (the kick for a compressor on the bass, the voice
   * for a vocoder on a synth), or null for none (it then follows its own input; the vocoder
   * passes its input through). For an effect that doesn't listen to one, this does nothing.
   */
  setSidechain(source) {
    if (this.key) {
      try {
        this.key.disconnect(this.node, 0, 1);
      } catch {
        // Already disconnected
      }
    }
    this.key = this.listens && source ? source : null;
    if (this.key) this.key.connect(this.node, 0, 1);
    this.node.port.postMessage({ type: 'sidechain', connected: !!this.key });
  }

  indexOf(name) {
    const i = typeof name === 'number' ? name : this.index.get(name);
    if (i === undefined || i < 0 || i >= this.params.length) throw new Error(`No parameter called ${name}: ${this.listParams().join(', ')}`);
    return i;
  }

  /** Set a parameter (by name or number) to `value`, 0 to 1 (true and false are 1 and 0), now or at `time` on the audio clock. */
  setParam(name, value, time = 0) {
    const index = this.indexOf(name);
    const v = value === true ? 1 : value === false ? 0 : Math.max(0, Math.min(1, Number(value)));
    if (!Number.isFinite(v)) throw new Error(`${name} takes a number from 0 to 1`);
    this.params[index] = { ...this.params[index], value: v };
    this.node.port.postMessage({ type: 'set', index, value: v, time });
  }

  /** A parameter's value, 0 to 1, as last set here or by a preset. */
  getParam(name) {
    return this.params[this.indexOf(name)].value;
  }

  listParams() {
    return this.params.map((p) => p.name);
  }

  listPresets() {
    return [...this.presets];
  }

  ask(message) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.node.port.postMessage({ ...message, id });
    });
  }

  /** Every parameter now: its name, its value (0 to 1) and the text the effect shows for it ("-18.0 dB"). */
  describe() {
    return this.ask({ type: 'describe' });
  }

  /** Choose a preset by name or number (it sets every parameter). */
  setPreset(preset) {
    const index = typeof preset === 'number' ? preset : this.presets.indexOf(preset);
    if (index < 0 || index >= this.presets.length) throw new Error(`No preset called ${preset}: ${this.presets.join(', ')}`);
    return this.ask({ type: 'preset', index });
  }

  /** The song's tempo, in beats per minute (the beat repeat's slices keep time with it). */
  setTempo(bpm) {
    this.node.port.postMessage({ type: 'tempo', bpm });
  }

  /**
   * Where the song is at `time` on the audio clock, in beats (quarter notes from its start): the
   * beat repeat counts on from there and fills the ends of bars by itself. Say it again now and
   * then (each beat, or each bar) to keep it in step, and call stop() when the song stops.
   */
  setPosition(beats, time = 0) {
    this.node.port.postMessage({ type: 'position', beats, time });
  }

  /** The song has stopped: an effect that follows it has no position to follow until the next setPosition. */
  stop(time = 0) {
    this.node.port.postMessage({ type: 'position', beats: -1, time });
  }

  /** Free the effect. Disconnect it first; it plays nothing afterwards. */
  destroy() {
    this.setSidechain(null);
    this.node.port.postMessage({ type: 'destroy' });
    this.node.disconnect();
  }
}
