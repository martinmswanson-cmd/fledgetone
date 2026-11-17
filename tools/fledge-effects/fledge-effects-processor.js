// The Fledge effects' AudioWorklet processor. Part of Fledgetone (https://fledgetone.com),
// © Martin Swanson, GPL-3.0-or-later. Loaded by fledge-effects.js (context.audioWorklet.addModule).
//
// It makes one effect in one of the .wasm files (the module comes from the main thread, already
// compiled) and talks to it through the module's plain C functions (the bb_* interface, see
// source/fledge-wasm/src/lib.rs): parameters are 0 to 1, the sound goes in and comes out through
// buffers of 128 samples in the module's memory.
//
// The node has two inputs: the sound to treat, and a sidechain (another sound for the effect to
// listen to: a compressor's key, a vocoder's voice). The sidechain is only heard while the main
// thread says one is connected.
//
// Messages in (port):
//   { type: 'set', index, value, time }        a parameter (0 to 1) at audio time `time` (seconds)
//   { type: 'preset', index, id }              choose a preset now (sets every parameter)
//   { type: 'tempo', bpm }                     the song's tempo
//   { type: 'position', beats, time }          where the song is at `time`, in beats (quarter
//                                              notes); under 0: the song has stopped
//   { type: 'sidechain', connected }           whether a sound is connected to the second input
//   { type: 'describe', id }                   answered with { type: 'params', id, params, preset }
//   { type: 'clear' }                          drop everything still waiting
//   { type: 'destroy' }                        free the effect; the processor stops
// Messages out: { type: 'ready', info, params, presets, preset } once made (info: the effect's
// name, what it does, and whether it listens to a sidechain or follows the song),
// { type: 'params', ... } answering 'describe' or 'preset', { type: 'error', message }.

const BLOCK = 128;

class FledgeEffectProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.events = [];
    this.alive = false;
    this.keyed = false;
    this.listens = false;
    this.port.onmessage = (m) => this.message(m.data);
    try {
      // The modules need nothing from outside (no imports)
      this.e = new WebAssembly.Instance(o.module, {}).exports;
      this.h = this.e.bb_create(0, sampleRate);
      if (!this.h) throw new Error('the effect could not be made');
      this.n = this.e.bb_params(this.h);
      this.presets = this.e.bb_programs(this.h);
      if (Number.isInteger(o.preset) && o.preset >= 0 && o.preset < this.presets) this.e.bb_set_program(this.h, o.preset);
      if (o.tempo > 0) this.e.bb_tempo(this.h, o.tempo);
      this.views();
      this.alive = true;
      const presets = [];
      for (let i = 0; i < this.presets; i++) presets.push(this.text(this.e.bb_program_name(this.h, i)));
      const info = JSON.parse(this.text(this.e.bb_info(0)));
      this.port.postMessage({ type: 'ready', info, params: this.describe(), presets, preset: this.e.bb_get_program(this.h) });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  }

  /** Views of the effect's buffers (made again when its memory grows, which replaces the buffer). */
  views() {
    this.mem = this.e.memory.buffer;
    // 0, 1 the sound in; 2, 3 the sound out; 4, 5 the sidechain (for an effect that listens to one)
    this.buf = (this.listens ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3]).map((w) => new Float32Array(this.mem, this.e.bb_buffer(this.h, w), BLOCK));
  }

  /** A text the module handed out (UTF-8, ending in a zero byte; worklets have no TextDecoder). */
  text(ptr) {
    if (!ptr) return '';
    const m = new Uint8Array(this.e.memory.buffer);
    let s = '';
    for (let p = ptr; m[p]; p++) {
      const c = m[p];
      if (c < 0x80) s += String.fromCharCode(c);
      else if (c >= 0xc0 && c < 0xe0 && m[p + 1]) { s += String.fromCharCode(((c & 0x1f) << 6) | (m[p + 1] & 0x3f)); p++; }
      else if (c >= 0xe0 && c < 0xf0 && m[p + 1] && m[p + 2]) { s += String.fromCharCode(((c & 0x0f) << 12) | ((m[p + 1] & 0x3f) << 6) | (m[p + 2] & 0x3f)); p += 2; }
    }
    return s;
  }

  describe() {
    const { e, h } = this;
    const params = [];
    for (let i = 0; i < this.n; i++) params.push({ name: this.text(e.bb_param_name(h, i)), value: e.bb_get(h, i), text: this.text(e.bb_param_display(h, i)) });
    return params;
  }

  message(d) {
    if (!this.alive) return;
    if (d.type === 'set' || d.type === 'position') {
      // Kept in time order (they nearly always come in order)
      const ev = { ...d, frame: Math.round((d.time || 0) * sampleRate) };
      let i = this.events.length;
      while (i > 0 && this.events[i - 1].frame > ev.frame) i--;
      this.events.splice(i, 0, ev);
    } else if (d.type === 'preset') {
      if (d.index >= 0 && d.index < this.presets) this.e.bb_set_program(this.h, d.index);
      this.port.postMessage({ type: 'params', id: d.id, params: this.describe(), preset: this.e.bb_get_program(this.h) });
    } else if (d.type === 'tempo') {
      if (d.bpm > 0) this.e.bb_tempo(this.h, d.bpm);
    } else if (d.type === 'sidechain') {
      this.keyed = !!d.connected;
      // (1 back if the effect listens to one: only then does it have the two extra buffers)
      this.listens = !!this.e.bb_sidechain(this.h, this.keyed ? 1 : 0) && this.keyed;
      this.views();
    } else if (d.type === 'describe') {
      this.port.postMessage({ type: 'params', id: d.id, params: this.describe(), preset: this.e.bb_get_program(this.h) });
    } else if (d.type === 'clear') {
      this.events.length = 0;
    } else if (d.type === 'destroy') {
      this.alive = false;
      this.events.length = 0;
      this.e.bb_destroy(this.h);
    }
  }

  apply(ev) {
    if (ev.type === 'set') {
      if (ev.index >= 0 && ev.index < this.n) this.e.bb_set(this.h, ev.index, Math.max(0, Math.min(1, ev.value)));
    } else this.e.bb_position(this.h, Number.isFinite(ev.beats) ? ev.beats : -1);
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const out = outputs[0];
    const [input, key] = [inputs[0] || [], inputs[1] || []];
    const frames = out[0] ? out[0].length : BLOCK;
    let pos = 0;
    // The block is cut at each event, so a setting changes on its own sample
    while (pos < frames) {
      while (this.events.length && this.events[0].frame <= currentFrame + pos) this.apply(this.events.shift());
      const next = this.events.length ? this.events[0].frame - currentFrame : frames;
      const end = Math.min(frames, Math.max(pos + 1, next));
      const n = end - pos;
      if (this.mem !== this.e.memory.buffer) this.views();
      // A sound of one channel goes to both sides; nothing connected is silence
      const fill = (from, left, right) => {
        const [l, r] = [from[0], from[1] || from[0]];
        if (l) {
          this.buf[left].set(l.subarray(pos, end));
          this.buf[right].set(r.subarray(pos, end));
        } else {
          this.buf[left].fill(0, 0, n);
          this.buf[right].fill(0, 0, n);
        }
      };
      fill(input, 0, 1);
      if (this.listens) fill(key, 4, 5);
      this.e.bb_process(this.h, n);
      if (this.mem !== this.e.memory.buffer) this.views();
      if (out[0]) out[0].set(this.buf[2].subarray(0, n), pos);
      if (out[1]) out[1].set(this.buf[3].subarray(0, n), pos);
      pos = end;
    }
    return true;
  }
}

registerProcessor('fledge-effect', FledgeEffectProcessor);
