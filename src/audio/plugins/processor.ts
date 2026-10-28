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
 * rest as it sounded then; answered with `params`), `table` (Fledge Synth's user table: `frames`
 * cycles of 2048 samples, or none; see userTable.ts), `destroy`.
 * Messages out: `ready` with the parameters (and their defaults) and presets once made, `params` answering `describe`, `display`
 * after a `set` (the parameter's text), `error` if the plugin couldn't be made, `fault` (once) if it
 * blew up (see guard below).
 *
 * Options beyond the plugin itself: `ownMemory` gives the plugin a WebAssembly instance of its own
 * instead of its family's shared one (a family whose code reads memory it never set, left over
 * from a plugin that was there before it: the Mutable Instruments family), and `limits` holds
 * parameters (by name) inside the range they're safe in, whatever is set or saved (see
 * paramLimits.ts), and `outputGain` scales what it plays (a plugin too loud as it was made).
 *
 * Kept as a string (like the OTT's) so the one-file build needs no extra file.
 */
import { insertTimedEvent } from '../legato';

/** A plugin playing a sample at or past this (+60 dBFS), or NaN, has blown up (see the guard in the processor). */
export const BLOWN_UP = 1000;

export const BUILTIN_PROCESSOR = 'bb-builtin-plugin';

export const BUILTIN_PROCESSOR_SOURCE = `
const BLOCK = 128;
/** Louder than any plugin plays on purpose (+60 dBFS): a sample past it, or NaN, means it blew up */
const BLOWN = ${BLOWN_UP};
const families = new Map();
const insertTimedEvent = ${insertTimedEvent.toString()};

function familyOf(name, module) {
  let fam = families.get(name);
  if (fam) return fam;
  fam = instantiate(name, module);
  families.set(name, fam);
  return fam;
}

/** A new instance of a family's WebAssembly, with its memory fresh (zeroed). */
function instantiate(name, module) {
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
  return { e };
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
    this.familyName = o.family;
    this.module = o.module;
    this.index = o.index;
    this.ownMemory = !!o.ownMemory;
    this.limitNames = o.limits || null;
    this.outputGain = Number.isFinite(o.outputGain) && o.outputGain > 0 ? o.outputGain : 1;
    this.limits = [];
    // The last preset file and user table it was given, to start it again with after a blow-up
    this.presetData = null;
    this.tableData = null;
    this.tableFrames = 0;
    // The guard: when it last started the plugin again, and whether it has said so
    this.resetAt = -Infinity;
    this.reported = false;
    try {
      this.e = (this.ownMemory ? instantiate(o.family, o.module) : familyOf(o.family, o.module)).e;
      this.h = this.e.bb_create(o.index, sampleRate);
      if (!this.h) throw new Error('no plugin ' + o.index + ' in ' + o.family);
      this.n = this.e.bb_params(this.h);
      this.findLimits();
      // A preset file (Surge's patches) is the starting point: its values are the defaults
      if (o.preset) this.loadData(o.preset);
      const defaults = [];
      for (let i = 0; i < this.n; i++) defaults.push(this.e.bb_get(this.h, i));
      // A built-in preset, then the saved parameters over it
      this.programs = this.e.bb_programs ? this.e.bb_programs(this.h) : 0;
      if (this.programs && Number.isInteger(o.program) && o.program >= 0 && o.program < this.programs) this.e.bb_set_program(this.h, o.program);
      const values = o.values || [];
      for (let i = 0; i < this.n && i < values.length; i++) if (Number.isFinite(values[i])) this.setParam(i, values[i]);
      // Saved before the plugin had all its parameters: the ones it didn't have yet are set as
      // the sound was then (Fledge Synth's bb_legacy), so it sounds as it did
      if (values.length > 0 && values.length < this.n && this.e.bb_legacy) this.e.bb_legacy(this.h, values.length);
      this.enforceLimits();
      // Fledge Synth's user table, made from a sound
      if (o.table) this.loadTable(o.table, o.tableFrames);
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
    this.presetData = buffer;
    const bytes = new Uint8Array(buffer);
    const ptr = e.bb_alloc(bytes.length);
    new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
    const ok = e.bb_load(this.h, ptr, bytes.length);
    e.bb_free(ptr);
    this.n = e.bb_params(this.h);
    this.findLimits();
    this.enforceLimits();
    this.views();
    return ok;
  }

  /** The limited parameters' numbers, from their names (see paramLimits.ts). */
  findLimits() {
    this.limits = [];
    if (!this.limitNames) return;
    for (let i = 0; i < this.n; i++) {
      const range = this.limitNames[readString(this.e, this.e.bb_param_name(this.h, i))];
      if (range) this.limits[i] = range;
    }
  }

  /** Set parameter i (0 to 1), inside its limits if it has any. */
  setParam(i, value) {
    const range = this.limits[i];
    this.e.bb_set(this.h, i, range ? Math.max(range[0], Math.min(range[1], value)) : value);
  }

  /** Put any limited parameter a preset (or an older sound) moved outside its range back inside it. */
  enforceLimits() {
    this.limits.forEach((range, i) => {
      const v = this.e.bb_get(this.h, i);
      if (v < range[0] || v > range[1]) this.e.bb_set(this.h, i, Math.max(range[0], Math.min(range[1], v)));
    });
  }

  /**
   * The guard: the plugin played NaN or blew up (a model gone unstable, memory it never set).
   * Its sound never reaches the track (summed with the rest, one NaN silences the whole mix, and a
   * blow-up is a full-scale blast); it's started again as it was set, at most once a second (in
   * between it plays nothing), and it says so once.
   */
  blewUp() {
    if (!this.reported) {
      this.reported = true;
      this.port.postMessage({ type: 'fault', message: 'played NaN or blew up: started again' });
    }
    if (currentFrame - this.resetAt < sampleRate) return;
    this.resetAt = currentFrame;
    const e = this.e;
    const values = [];
    for (let i = 0; i < this.n; i++) values.push(e.bb_get(this.h, i));
    const program = this.program();
    try {
      e.bb_destroy(this.h);
    } catch (err) {
      // (Its memory may be what went wrong: a new instance below)
    }
    // A plugin with an instance of its own gets a fresh one: whatever it read wrongly is gone
    if (this.ownMemory) this.e = instantiate(this.familyName, this.module).e;
    this.h = this.e.bb_create(this.index, sampleRate);
    if (!this.h) {
      this.alive = false;
      return;
    }
    this.n = this.e.bb_params(this.h);
    if (this.presetData) this.loadData(this.presetData);
    if (this.programs && program >= 0) this.e.bb_set_program(this.h, program);
    for (let i = 0; i < this.n && i < values.length; i++) this.setParam(i, values[i]);
    if (this.tableData) this.loadTable(this.tableData, this.tableFrames);
    if (this.bpm > 0 && this.e.bb_tempo) this.e.bb_tempo(this.h, this.bpm);
    this.views();
  }

  /** Fledge Synth's user table (fledge_table_buffer / fledge_table_set): "frames" cycles, or none (null) */
  loadTable(data, frames) {
    const e = this.e;
    if (!e.fledge_table_set) return;
    const n = data && frames > 0 ? frames : 0;
    this.tableData = n ? data : null;
    this.tableFrames = n;
    if (n) {
      const ptr = e.fledge_table_buffer(this.h, n);
      if (!ptr) return;
      new Float32Array(e.memory.buffer, ptr, data.length).set(data);
    }
    e.fledge_table_set(this.h, n);
    if (this.mem !== e.memory.buffer) this.views();
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
        this.setParam(d.index, d.value);
        this.port.postMessage({ type: 'display', index: d.index, value: this.e.bb_get(this.h, d.index), text: readString(this.e, this.e.bb_param_display(this.h, d.index)) });
      }
    } else if (d.type === 'program') {
      if (d.index >= 0 && d.index < this.programs) {
        this.e.bb_set_program(this.h, d.index);
        this.enforceLimits();
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
      this.enforceLimits();
      this.port.postMessage({ type: 'params', id: d.id, params: this.describe(), program: this.program() });
    } else if (d.type === 'table') {
      this.loadTable(d.data, d.frames);
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
      if (i >= 0 && i < this.n) this.setParam(i, Math.max(0, Math.min(1, ev.data.value)));
    } else if (ev.type === 'wam-midi') {
      const b = ev.data.bytes;
      this.e.bb_midi(this.h, b[0], b[1] || 0, b[2] || 0);
    } else if (ev.type === 'wam-transport') {
      // The song's tempo, for plugins with tempo-synced parts (Fledge Synth's LFOs), and where in
      // the song it is (beats), for plugins that follow it (Fledge Synth's free LFOs and random
      // values: the same notes from the same place sound the same, live or exported)
      if (ev.data.tempo > 0) this.bpm = ev.data.tempo;
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
      let blown = false;
      try {
        this.e.bb_process(this.h, n);
      } catch (err) {
        // (Out of bounds in its memory: as good as blown up)
        blown = true;
      }
      // Its memory may have grown while processing
      if (this.mem !== this.e.memory.buffer) this.views();
      const pl = this.buf[2], pr = this.buf[3];
      // (NaN fails both comparisons)
      for (let i = 0; i < n && !blown; i++) if (!(pl[i] < BLOWN && pl[i] > -BLOWN && pr[i] < BLOWN && pr[i] > -BLOWN)) blown = true;
      if (blown) {
        if (out[0]) out[0].fill(0, pos, end);
        if (out[1]) out[1].fill(0, pos, end);
        this.blewUp();
        if (!this.alive) return false;
      } else {
        if (out[0]) out[0].set(pl.subarray(0, n), pos);
        if (out[1]) out[1].set(pr.subarray(0, n), pos);
        const g = this.outputGain;
        if (g !== 1)
          for (let i = pos; i < end; i++) {
            if (out[0]) out[0][i] *= g;
            if (out[1]) out[1][i] *= g;
          }
      }
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
