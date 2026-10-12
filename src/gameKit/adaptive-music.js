// Adaptive music player for the web, from Bo's Beatbox. No libraries: Web Audio only.
//
//   import { AdaptiveMusic } from './adaptive-music.js';
//   const music = new AdaptiveMusic();
//   await music.load('music/');          // the folder with audio_manifest.json in it
//   music.play('Explore');               // after a click or key press (browsers need one)
//   music.setState('Combat');            // switches by the transition rules in the manifest
//   music.setIntensity(0.8);             // crossfades the stem groups along their curves
//   music.stinger('Victory');            // plays over the music on the next beat
//   music.setVolume(0.8);
//   music.stop();
//
// Every state is a seamless loop exactly a whole number of bars long (and, when the song has stem
// groups, a set of stems of that same length), so switching on a bar line keeps the beat. Times
// come from the audio clock, so changes land on the beat however busy the game is.

export class AdaptiveMusic {
  constructor(context = new AudioContext(), destination) {
    this.ctx = context;
    this.out = this.ctx.createGain();
    this.out.connect(destination ?? this.ctx.destination);
    this.buffers = new Map();
    this.data = null;
    this.current = null; // { name, startTime, bus, voices: [{ source, gain, group }] }
    this.intensity = 1;
  }

  /** Load audio_manifest.json and every sound it lists from `baseUrl` (ending in a slash). */
  async load(baseUrl = '') {
    let res = await fetch(baseUrl + 'audio_manifest.json');
    if (!res.ok) res = await fetch(baseUrl + 'music.json');
    const data = await res.json();
    const buffers = new Map();
    await Promise.all(
      AdaptiveMusic.filesOf(data).map(async (file) => {
        const bytes = await (await fetch(baseUrl + file)).arrayBuffer();
        buffers.set(file, await this.ctx.decodeAudioData(bytes));
      })
    );
    this.loadFrom(data, buffers);
  }

  /** Use a manifest and its sounds already decoded (file path to AudioBuffer). */
  loadFrom(data, buffers) {
    this.data = data;
    this.buffers = buffers;
    this.intensity = data.intensity?.default ?? 1;
  }

  /** Every sound file a manifest uses. */
  static filesOf(data) {
    const files = [];
    for (const s of data.states) {
      // A state with stems plays them; its whole mix is only needed without
      if (s.stems?.length) for (const stem of s.stems) files.push(stem.file);
      else files.push(s.file);
    }
    for (const t of data.transitions ?? []) if (t.file) files.push(t.file);
    for (const s of data.states) if (s.transition?.file) files.push(s.transition.file); // version 1 manifests
    for (const s of data.stingers) files.push(s.file);
    return [...new Set(files)];
  }

  get secondsPerBeat() {
    return 60 / this.data.bpm;
  }

  lineLength(unit) {
    return this.secondsPerBeat * (unit === 'bar' ? this.data.beatsPerBar : 1);
  }

  /** The audio time of the next bar or beat line of the state playing now. */
  nextLine(unit = 'bar') {
    const now = this.ctx.currentTime + 0.02;
    if (!this.current || unit === 'now') return now;
    const line = this.lineLength(unit);
    const elapsed = now - this.current.startTime;
    if (elapsed < 0) return this.current.startTime;
    return this.current.startTime + Math.ceil(elapsed / line - 1e-6) * line;
  }

  state(name) {
    const s = this.data.states.find((x) => x.name === name);
    if (!s) throw new Error(`No state called "${name}"`);
    return s;
  }

  /** A stem group's level at the intensity now (straight lines between its curve's points). */
  level(group) {
    const g = this.data.intensity?.groups?.find((x) => x.name === group);
    if (!g || !g.curve.length) return 1;
    const x = Math.max(0, Math.min(1, this.intensity));
    const c = g.curve;
    if (x <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (x <= c[i][0]) {
        const [x0, y0] = c[i - 1];
        const [x1, y1] = c[i];
        return x1 - x0 < 1e-9 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return c[c.length - 1][1];
  }

  /** Start a state's loop (its stems, or its mix) at `at`, fading in over `fade` seconds. */
  startState(state, at, fade = 0) {
    const bus = this.ctx.createGain();
    bus.connect(this.out);
    if (fade > 0) {
      bus.gain.setValueAtTime(0, at);
      bus.gain.linearRampToValueAtTime(1, at + fade);
    }
    const parts = state.stems?.length ? state.stems.map((s) => ({ file: s.file, group: s.group })) : [{ file: state.file, group: null }];
    const voices = parts.map(({ file, group }) => {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers.get(file);
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = group ? this.level(group) : 1;
      source.connect(gain).connect(bus);
      source.start(at);
      return { source, gain, group };
    });
    return { name: state.name, startTime: at, bus, voices };
  }

  stopState(playing, at, fade = 0) {
    if (fade > 0) {
      playing.bus.gain.setValueAtTime(1, at);
      playing.bus.gain.linearRampToValueAtTime(0, at + fade);
    }
    for (const v of playing.voices) v.source.stop(at + fade);
  }

  playOnce(file, at) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(file);
    source.connect(this.out);
    source.start(Math.max(at, this.ctx.currentTime));
  }

  /** The rule for going from the state playing now to `to`: its own, else from any state, else a cut. */
  rule(to) {
    const rules = this.data.transitions ?? [];
    const from = this.current?.name;
    const own = rules.find((r) => r.from === from && r.to === to) ?? rules.find((r) => r.from === '*' && r.to === to);
    if (own) return own;
    const legacy = this.state(to).transition; // version 1 manifests
    return legacy ? { kind: legacy.kind, file: legacy.file, leadInSeconds: legacy.leadInSeconds } : { kind: 'cut' };
  }

  /** Start a state at once. */
  play(name) {
    // A page's AudioContext starts suspended until the player clicks or presses a key
    if (this.ctx.state === 'suspended' && !('startRendering' in this.ctx)) this.ctx.resume();
    this.stop();
    this.current = this.startState(this.state(name), this.ctx.currentTime + 0.05);
  }

  /**
   * Move to another state the way the transition rules say: on the next bar (or beat, or at once),
   * straight in, crossfading, bridged by a stinger, or with a fill, riser or impact.
   */
  setState(name, unit) {
    if (!this.current) return this.play(name);
    if (this.current.name === name) return;
    const next = this.state(name);
    const r = this.rule(name);
    const q = unit ?? r.quantize ?? 'bar';
    const line = this.lineLength(q === 'beat' ? 'beat' : 'bar');
    let at = this.nextLine(q);
    const lead = r.leadInSeconds ?? 0;
    // A riser needs its whole lead-in: wait another line if there isn't room
    while (at - this.ctx.currentTime < lead) at += line;
    const old = this.current;
    if (r.kind === 'crossfade') {
      const fade = (r.beats ?? 4) * this.secondsPerBeat;
      this.stopState(old, at, fade);
      this.current = this.startState(next, at, fade);
      return;
    }
    if (r.kind === 'stinger' && r.stinger) {
      const s = this.data.stingers.find((x) => x.name === r.stinger);
      if (s) {
        this.playOnce(s.file, at);
        this.stopState(old, at);
        this.current = this.startState(next, at + (s.bridgeBars ?? 1) * this.lineLength('bar'));
        return;
      }
    }
    if (r.file) this.playOnce(r.file, at - lead);
    this.stopState(old, at);
    this.current = this.startState(next, at);
  }

  /** Crossfade the stem groups to `value` (0 to 1) along their curves, over `seconds`. */
  setIntensity(value, seconds = 0.5) {
    this.intensity = Math.max(0, Math.min(1, value));
    if (!this.current) return;
    for (const v of this.current.voices) {
      if (v.group) v.gain.gain.setTargetAtTime(this.level(v.group), this.ctx.currentTime, Math.max(0.01, seconds / 3));
    }
  }

  /** Play a stinger over the music on the next beat (or 'bar', or 'now'). */
  stinger(name, unit) {
    const s = this.data.stingers.find((x) => x.name === name);
    if (!s) throw new Error(`No stinger called "${name}"`);
    this.playOnce(s.file, this.nextLine(unit ?? s.quantize ?? 'beat'));
  }

  setVolume(volume, seconds = 0.1) {
    this.out.gain.setTargetAtTime(volume, this.ctx.currentTime, seconds / 3);
  }

  stop() {
    if (this.current) for (const v of this.current.voices) v.source.stop();
    this.current = null;
  }
}
