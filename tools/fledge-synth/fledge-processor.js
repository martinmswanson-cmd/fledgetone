// Fledge Synth's AudioWorklet processor. Part of Fledgetone (https://fledgetone.com),
// © Martin Swanson, GPL-3.0-or-later. Loaded by fledge-synth.js (context.audioWorklet.addModule).
//
// It makes one synth in fledge.wasm (the module comes from the main thread, already compiled) and
// talks to it through the module's plain C functions (the bb_* interface, see source/src/abi.rs):
// parameters are 0 to 1, notes are MIDI messages, and sound comes out of two buffers of 128
// samples in the module's memory.
//
// Messages in (port):
//   { type: 'midi', bytes: [status, d1, d2], time }   a MIDI message at audio time `time` (seconds)
//   { type: 'set', index, value, time }                a parameter (0 to 1) at `time`
//   { type: 'preset', index }                          choose a preset now (sets every parameter)
//   { type: 'tempo', bpm }                             the song's tempo (for LFOs and delays in time)
//   { type: 'describe', id }                           answered with { type: 'params', id, params }
//   { type: 'clear' }                                  drop everything still waiting
//   { type: 'destroy' }                                free the synth; the processor stops
// Messages out: { type: 'ready', params, presets } once made, { type: 'params', id, params, preset }
// answering 'describe' or 'preset', { type: 'error', message } if it couldn't be made.

const BLOCK = 128;

class FledgeSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.events = [];
    this.alive = false;
    this.port.onmessage = (m) => this.message(m.data);
    try {
      // fledge.wasm needs nothing from outside (no imports)
      this.e = new WebAssembly.Instance(o.module, {}).exports;
      this.h = this.e.bb_create(0, sampleRate);
      if (!this.h) throw new Error('the synth could not be made');
      this.n = this.e.bb_params(this.h);
      this.presets = this.e.bb_programs(this.h);
      if (Number.isInteger(o.preset) && o.preset >= 0 && o.preset < this.presets) this.e.bb_set_program(this.h, o.preset);
      if (o.tempo > 0) this.e.bb_tempo(this.h, o.tempo);
      this.views();
      this.alive = true;
      const presets = [];
      for (let i = 0; i < this.presets; i++) presets.push(this.text(this.e.bb_program_name(this.h, i)));
      this.port.postMessage({ type: 'ready', params: this.describe(), presets, preset: this.e.bb_get_program(this.h) });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  }

  /** Views of the synth's output buffers (made again when its memory grows, which replaces the buffer). */
  views() {
    this.mem = this.e.memory.buffer;
    this.outL = new Float32Array(this.mem, this.e.bb_buffer(this.h, 2), BLOCK);
    this.outR = new Float32Array(this.mem, this.e.bb_buffer(this.h, 3), BLOCK);
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
    if (d.type === 'midi' || d.type === 'set') {
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
    } else {
      const b = ev.bytes;
      this.e.bb_midi(this.h, b[0] | 0, b[1] | 0, b[2] | 0);
    }
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const out = outputs[0];
    const frames = out[0] ? out[0].length : BLOCK;
    let pos = 0;
    // The block is cut at each event, so a note starts on its own sample
    while (pos < frames) {
      while (this.events.length && this.events[0].frame <= currentFrame + pos) this.apply(this.events.shift());
      const next = this.events.length ? this.events[0].frame - currentFrame : frames;
      const end = Math.min(frames, Math.max(pos + 1, next));
      const n = end - pos;
      this.e.bb_process(this.h, n);
      if (this.mem !== this.e.memory.buffer) this.views();
      if (out[0]) out[0].set(this.outL.subarray(0, n), pos);
      if (out[1]) out[1].set(this.outR.subarray(0, n), pos);
      pos = end;
    }
    return true;
  }
}

registerProcessor('fledge-synth', FledgeSynthProcessor);
