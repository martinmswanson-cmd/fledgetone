/**
 * The AudioWorklet processor that runs built-in plugins (see builtinHost.ts). Each plugin family
 * is one WebAssembly module (scripts/plugins/bbplug.h is its interface); the first plugin of a
 * family in a context instantiates it, and every plugin of that family in the context then lives
 * in that one instance's memory.
 *
 * Messages in (port): `events` (timed MIDI and parameter changes, as WAM events: applied at their
 * exact frame), `set` (a parameter now, from its panel), `clear` (drop pending events),
 * `describe` (send every parameter's name, value and text), `program` (choose a preset, which
 * sets the parameters), `load` (a preset file's bytes), `sync` (answered with `synced` once everything before it has arrived),
 * `legacy` (an older saved sound with only its first `count` values went in: the plugin sets the
 * rest as it sounded then; answered with `params`), `destroy`.
 * Messages out: `ready` with the parameters (and their defaults) and presets once made, `params` answering `describe`, `display`
 * after a `set` (the parameter's text), `error` if the plugin couldn't be made.
 *
 * Kept as a string (like the OTT's) so the one-file build needs no extra file.
 */
import { insertTimedEvent } from '../legato';

export const BUILTIN_PROCESSOR = 'bb-builtin-plugin';

export const BUILTIN_PROCESSOR_SOURCE = `
const BLOCK = 128;
const families = new Map();
const insertTimedEvent = ${insertTimedEvent.toString()};

function familyOf(name, module) {
  let fam = families.get(name);
  if (fam) return fam;
  // The C runtime's few calls out: writing text (it's shown in the console) is done properly, so
  // the runtime doesn't retry it forever; the rest answer "nothing here"
  let e = null;
  const imports = {};
  for (const i of WebAssembly.Module.imports(module)) {
    if (!imports[i.module]) imports[i.module] = {};
    imports[i.module][i.name] = i.kind === 'function' ? () => 0 : undefined;
  }
  if (imports.wasi_snapshot_preview1 && imports.wasi_snapshot_preview1.fd_write) {
    imports.wasi_snapshot_preview1.fd_write = (fd, iovs, count, written) => {
      const view = new DataView(e.memory.buffer);
      let total = 0, text = '';
      for (let k = 0; k < count; k++) {
        const ptr = view.getUint32(iovs + k * 8, true), len = view.getUint32(iovs + k * 8 + 4, true);
        text += readString(e, ptr).slice(0, len);
        total += len;
      }
      view.setUint32(written, total, true);
      if (text.trim()) console.log('[' + name + '] ' + text.trim());
      return 0;
    };
  }
  const instance = new WebAssembly.Instance(module, imports);
  e = instance.exports;
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
    // Fledge Synth hears a note drawn to start where the last one ends while that one is still
    // held, so its Legato mode joins them (see insertTimedEvent in legato.ts)
    // (Plain time order: touching notes stay separate; overlapping ones join by themselves)
    this.join = 0;
    this.alive = false;
    // Follow the input (effects, see followInput below): its gain, where it's heading, and the
    // windows that tell a fading tail from a sound the plugin keeps making by itself
    this.follow = !!o.followInput;
    this.gain = 1;
    this.target = 1;
    this.quiet = 0;
    this.winE = 0;
    this.winN = 0;
    this.prevE = -1;
    this.steady = 0;
    this.port.onmessage = (m) => this.message(m.data);
    try {
      this.e = familyOf(o.family, o.module).e;
      this.h = this.e.bb_create(o.index, sampleRate);
      if (!this.h) throw new Error('no plugin ' + o.index + ' in ' + o.family);
      this.n = this.e.bb_params(this.h);
      // A preset file (Surge's patches) is the starting point: its values are the defaults
      if (o.preset) this.loadData(o.preset);
      const defaults = [];
      for (let i = 0; i < this.n; i++) defaults.push(this.e.bb_get(this.h, i));
      // A built-in preset, then the saved parameters over it
      this.programs = this.e.bb_programs ? this.e.bb_programs(this.h) : 0;
      if (this.programs && Number.isInteger(o.program) && o.program >= 0 && o.program < this.programs) this.e.bb_set_program(this.h, o.program);
      const values = o.values || [];
      for (let i = 0; i < this.n && i < values.length; i++) if (Number.isFinite(values[i])) this.e.bb_set(this.h, i, values[i]);
      // Saved before the plugin had all its parameters: the ones it didn't have yet are set as
      // the sound was then (Fledge Synth's bb_legacy), so it sounds as it did
      if (values.length > 0 && values.length < this.n && this.e.bb_legacy) this.e.bb_legacy(this.h, values.length);
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

  /** Hand the plugin a preset file (bb_load): through its own memory */
  loadData(buffer) {
    const e = this.e;
    if (!e.bb_alloc) return 0;
    const bytes = new Uint8Array(buffer);
    const ptr = e.bb_alloc(bytes.length);
    new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
    const ok = e.bb_load(this.h, ptr, bytes.length);
    e.bb_free(ptr);
    this.n = e.bb_params(this.h);
    this.views();
    return ok;
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
      // Kept in time order (they nearly always arrive in order)
      for (const ev of d.events) insertTimedEvent(this.events, ev, this.join);
    } else if (d.type === 'set') {
      if (d.index >= 0 && d.index < this.n) {
        // (Its lane is gone: what it still had queued goes too, even while the track sleeps)
        if (d.drop) this.events = this.events.filter((ev) => !(ev.type === 'wam-automation' && Number(ev.data.id) === d.index));
        this.e.bb_set(this.h, d.index, d.value);
        this.port.postMessage({ type: 'display', index: d.index, value: this.e.bb_get(this.h, d.index), text: readString(this.e, this.e.bb_param_display(this.h, d.index)) });
      }
    } else if (d.type === 'program') {
      if (d.index >= 0 && d.index < this.programs) {
        this.e.bb_set_program(this.h, d.index);
        this.port.postMessage({ type: 'params', id: -1, params: this.describe(), program: this.program() });
      }
    } else if (d.type === 'load') {
      this.loadData(d.data);
      this.port.postMessage({ type: 'params', id: -1, params: this.describe(), program: this.program() });
    } else if (d.type === 'sync') {
      // Everything sent before this has arrived (an export waits for it before rendering on)
      this.port.postMessage({ type: 'synced', id: d.id });
    } else if (d.type === 'clear') {
      this.events.length = 0;
    } else if (d.type === 'legacy') {
      // (As at the start: an older saved sound with only its first "count" values just went in)
      if (this.e.bb_legacy && d.count > 0 && d.count < this.n) this.e.bb_legacy(this.h, d.count);
      this.port.postMessage({ type: 'params', id: d.id, params: this.describe(), program: this.program() });
    } else if (d.type === 'describe') {
      // (Automation already due first: a sleeping track's queue still says what it plays now)
      this.dueAutomation();
      this.port.postMessage({ type: 'params', id: d.id, params: this.describe(), program: this.program() });
    } else if (d.type === 'destroy') {
      this.alive = false;
      this.events.length = 0;
      this.e.bb_destroy(this.h);
    }
  }

  /** Apply the automation events whose time has come (notes wait for process()). */
  dueAutomation() {
    const now = currentFrame;
    this.events = this.events.filter((ev) => {
      if (ev.type !== 'wam-automation' || Math.round(ev.time * sampleRate) > now) return true;
      this.apply(ev);
      return false;
    });
  }

  apply(ev) {
    if (ev.type === 'wam-automation') {
      const i = Number(ev.data.id);
      if (i >= 0 && i < this.n) this.e.bb_set(this.h, i, Math.max(0, Math.min(1, ev.data.value)));
    } else if (ev.type === 'wam-midi') {
      const b = ev.data.bytes;
      this.e.bb_midi(this.h, b[0], b[1] || 0, b[2] || 0);
    } else if (ev.type === 'wam-transport') {
      // The song's tempo, for plugins with tempo-synced parts (Fledge Synth's LFOs), and where in
      // the song it is (beats), for plugins that follow it (Fledge Synth's free LFOs and random
      // values: the same notes from the same place sound the same, live or exported)
      if (this.e.bb_tempo && ev.data.tempo > 0) this.e.bb_tempo(this.h, ev.data.tempo);
      if (this.e.bb_position && Number.isFinite(ev.data.beat) && ev.data.beat >= 0) this.e.bb_position(this.h, ev.data.beat);
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
      // Notes started since the last render, and how late they started. Late events arrive
      // together (a plugin that just loaded, a busy main thread). A late note's end is moved later
      // by as much as its start was late, so it still sounds as long as written; and a note's end
      // (or all-notes-off) is never applied in the same render as its start: an instrument that
      // restrikes a voice by dropping its gate for one render (the Faust instruments) could miss
      // the note or, before their fix, drone on until the next stop.
      const started = new Map();
      while (this.events.length) {
        const ev = this.events[0];
        const at = Math.round(ev.time * sampleRate) - start;
        if (at <= pos) {
          const b = ev.type === 'wam-midi' ? ev.data.bytes : null;
          const kind = b ? b[0] & 0xf0 : 0;
          const late = b && (kind === 0x80 || (kind === 0x90 && !b[2])) ? started.get(b[1]) : undefined;
          if (late !== undefined) {
            const moved = Math.max(ev.time + late, (start + pos + 1) / sampleRate);
            this.events.shift();
            let k = 0;
            while (k < this.events.length && this.events[k].time <= moved) k++;
            this.events.splice(k, 0, { ...ev, time: moved });
            continue;
          }
          if (b && kind === 0xb0 && (b[1] === 120 || b[1] === 123) && started.size > 0) {
            end = Math.min(frames, pos + 1);
            break;
          }
          this.apply(this.events.shift());
          if (b && kind === 0x90 && b[2]) started.set(b[1], Math.max(0, (start + pos) / sampleRate - ev.time));
        } else {
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
    if (this.follow) this.followInput(input, out, frames);
    return true;
  }

  /**
   * An effect makes sound from its track's sound: one that goes on making its own once the track
   * has gone quiet (a Shepard tone, a noise source, a click track, a filter stuck oscillating)
   * would drone on through the whole song and while it's stopped. So once the input has been
   * silent for a second, the output is watched a second at a time: a tail (reverb, delay) keeps
   * fading, a sound the plugin makes itself doesn't. Two seconds that don't fade by 1 dB and it's
   * faded out (over half a second); the track's next sound opens it again at once. Decided from
   * the samples alone, so live and export behave the same.
   */
  followInput(input, out, frames) {
    const l = input[0], r = input[1] || input[0];
    let peak = 0;
    if (l) for (let i = 0; i < frames; i++) { const a = Math.abs(l[i]), b = Math.abs(r[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
    if (peak > 1e-5) {
      this.quiet = 0;
      this.steady = 0;
      this.prevE = -1;
      this.winE = 0;
      this.winN = 0;
      this.target = 1;
    } else {
      this.quiet += frames;
    }
    const o0 = out[0], o1 = out[1] || out[0];
    if (this.quiet >= sampleRate && o0) {
      for (let i = 0; i < frames; i++) this.winE += o0[i] * o0[i] + o1[i] * o1[i];
      this.winN += frames;
      if (this.winN >= sampleRate) {
        const e = this.winE / this.winN;
        // Not fading (by less than 1 dB in the second) and above the floor of silence
        if (this.prevE > 0 && e > 1e-12 && e >= this.prevE * 0.794) this.steady++;
        else this.steady = 0;
        if (this.steady >= 2) this.target = 0;
        this.prevE = e;
        this.winE = 0;
        this.winN = 0;
      }
    }
    if (this.target === 1 && this.gain === 1) return;
    // Opening takes 5 ms, closing half a second
    const step = this.target > this.gain ? 1 / (0.005 * sampleRate) : 1 / (0.5 * sampleRate);
    for (let i = 0; i < frames; i++) {
      this.gain = this.target > this.gain ? Math.min(this.target, this.gain + step) : Math.max(this.target, this.gain - step);
      if (out[0]) out[0][i] *= this.gain;
      if (out[1]) out[1][i] *= this.gain;
    }
  }
}

registerProcessor('bb-builtin-plugin', BuiltinPlugin);
`;
