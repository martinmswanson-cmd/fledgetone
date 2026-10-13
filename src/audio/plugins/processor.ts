/**
 * The AudioWorklet processor that runs built-in plugins (see builtinHost.ts). Each plugin family
 * is one WebAssembly module (scripts/plugins/bbplug.h is its interface); the first plugin of a
 * family in a context instantiates it, and every plugin of that family in the context then lives
 * in that one instance's memory.
 *
 * Messages in (port): `events` (timed MIDI and parameter changes, as WAM events: applied at their
 * exact frame), `set` (a parameter now, from its panel), `clear` (drop pending events),
 * `describe` (send every parameter's name, value and text), `program` (choose a preset, which
 * sets the parameters), `sync` (answered with `synced` once everything before it has arrived),
 * `destroy`.
 * Messages out: `ready` with the parameters (and their defaults) and presets once made, `params` answering `describe`, `display`
 * after a `set` (the parameter's text), `error` if the plugin couldn't be made.
 *
 * Kept as a string (like the OTT's) so the one-file build needs no extra file.
 */
export const BUILTIN_PROCESSOR = 'bb-builtin-plugin';

export const BUILTIN_PROCESSOR_SOURCE = `
const BLOCK = 128;
const families = new Map();

function familyOf(name, module) {
  let fam = families.get(name);
  if (fam) return fam;
  const imports = {};
  for (const i of WebAssembly.Module.imports(module)) {
    if (!imports[i.module]) imports[i.module] = {};
    imports[i.module][i.name] = i.kind === 'function' ? () => 0 : undefined;
  }
  const instance = new WebAssembly.Instance(module, imports);
  const e = instance.exports;
  if (e._initialize) e._initialize();
  fam = { e };
  families.set(name, fam);
  return fam;
}

function readString(e, ptr) {
  const m = new Uint8Array(e.memory.buffer);
  let s = '';
  for (let p = ptr; m[p]; p++) {
    const c = m[p];
    // UTF-8: plugin texts are ASCII apart from the odd symbol
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c >= 0xc0 && c < 0xe0 && m[p + 1]) { s += String.fromCharCode(((c & 0x1f) << 6) | (m[p + 1] & 0x3f)); p++; }
    else if (c >= 0xe0 && m[p + 1] && m[p + 2]) { s += String.fromCharCode(((c & 0x0f) << 12) | ((m[p + 1] & 0x3f) << 6) | (m[p + 2] & 0x3f)); p += 2; }
  }
  return s;
}

class BuiltinPlugin extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.events = [];
    this.alive = false;
    this.port.onmessage = (m) => this.message(m.data);
    try {
      this.e = familyOf(o.family, o.module).e;
      this.h = this.e.bb_create(o.index, sampleRate);
      if (!this.h) throw new Error('no plugin ' + o.index + ' in ' + o.family);
      this.n = this.e.bb_params(this.h);
      const defaults = [];
      for (let i = 0; i < this.n; i++) defaults.push(this.e.bb_get(this.h, i));
      // A preset first (it sets the parameters), then the saved parameters over it
      this.programs = this.e.bb_programs ? this.e.bb_programs(this.h) : 0;
      if (this.programs && Number.isInteger(o.program) && o.program >= 0 && o.program < this.programs) this.e.bb_set_program(this.h, o.program);
      const values = o.values || [];
      for (let i = 0; i < this.n && i < values.length; i++) if (Number.isFinite(values[i])) this.e.bb_set(this.h, i, values[i]);
      this.alive = true;
      this.views();
      const programs = [];
      for (let i = 0; i < this.programs; i++) programs.push(readString(this.e, this.e.bb_program_name(this.h, i)));
      this.port.postMessage({ type: 'ready', params: this.describe(), defaults, programs, program: this.program() });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  }

  /** Views of the plugin's buffers (made again when its memory grows, which replaces the buffer). */
  views() {
    const e = this.e;
    this.mem = e.memory.buffer;
    this.buf = [0, 1, 2, 3].map((w) => new Float32Array(this.mem, e.bb_buffer(this.h, w), BLOCK));
  }

  program() {
    return this.programs ? this.e.bb_get_program(this.h) : -1;
  }

  describe() {
    const e = this.e, h = this.h, params = [];
    for (let i = 0; i < this.n; i++) params.push({ name: readString(e, e.bb_param_name(h, i)), value: e.bb_get(h, i), text: readString(e, e.bb_param_display(h, i)) });
    return params;
  }

  message(d) {
    if (!this.alive) {
      if (d.type === 'sync') this.port.postMessage({ type: 'synced', id: d.id });
      return;
    }
    if (d.type === 'events') {
      for (const ev of d.events) {
        // Kept in time order (they nearly always arrive in order)
        let i = this.events.length;
        while (i > 0 && this.events[i - 1].time > ev.time) i--;
        this.events.splice(i, 0, ev);
      }
    } else if (d.type === 'set') {
      if (d.index >= 0 && d.index < this.n) {
        this.e.bb_set(this.h, d.index, d.value);
        this.port.postMessage({ type: 'display', index: d.index, value: this.e.bb_get(this.h, d.index), text: readString(this.e, this.e.bb_param_display(this.h, d.index)) });
      }
    } else if (d.type === 'program') {
      if (d.index >= 0 && d.index < this.programs) {
        this.e.bb_set_program(this.h, d.index);
        this.port.postMessage({ type: 'params', id: -1, params: this.describe(), program: this.program() });
      }
    } else if (d.type === 'sync') {
      // Everything sent before this has arrived (an export waits for it before rendering on)
      this.port.postMessage({ type: 'synced', id: d.id });
    } else if (d.type === 'clear') {
      this.events.length = 0;
    } else if (d.type === 'describe') {
      this.port.postMessage({ type: 'params', id: d.id, params: this.describe(), program: this.program() });
    } else if (d.type === 'destroy') {
      this.alive = false;
      this.events.length = 0;
      this.e.bb_destroy(this.h);
    }
  }

  apply(ev) {
    if (ev.type === 'wam-automation') {
      const i = Number(ev.data.id);
      if (i >= 0 && i < this.n) this.e.bb_set(this.h, i, Math.max(0, Math.min(1, ev.data.value)));
    } else if (ev.type === 'wam-midi') {
      const b = ev.data.bytes;
      this.e.bb_midi(this.h, b[0], b[1] || 0, b[2] || 0);
    }
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const out = outputs[0];
    const input = inputs[0] || [];
    const frames = out[0] ? out[0].length : BLOCK;
    const start = currentFrame;
    let pos = 0;
    while (pos < frames) {
      let end = frames;
      while (this.events.length) {
        const at = Math.round(this.events[0].time * sampleRate) - start;
        if (at <= pos) this.apply(this.events.shift());
        else {
          end = Math.min(frames, at);
          break;
        }
      }
      if (this.mem !== this.e.memory.buffer) this.views();
      const n = end - pos;
      const [inL, inR, outL, outR] = this.buf;
      const l = input[0], r = input[1] || input[0];
      if (l) {
        inL.set(l.subarray(pos, end));
        inR.set(r.subarray(pos, end));
      } else {
        inL.fill(0, 0, n);
        inR.fill(0, 0, n);
      }
      this.e.bb_process(this.h, n);
      // Its memory may have grown while processing
      if (this.mem !== this.e.memory.buffer) this.views();
      if (out[0]) out[0].set(this.buf[2].subarray(0, n), pos);
      if (out[1]) out[1].set(this.buf[3].subarray(0, n), pos);
      pos = end;
    }
    return true;
  }
}

registerProcessor('bb-builtin-plugin', BuiltinPlugin);
`;
