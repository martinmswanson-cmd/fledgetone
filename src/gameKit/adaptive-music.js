// Adaptive music player for the web, from Bo's Beatbox. No libraries: Web Audio only.
//
//   import { AdaptiveMusic } from './adaptive-music.js';
//   const music = new AdaptiveMusic();
//   await music.load('music/');          // the folder with music.json in it
//   music.play('Explore');               // after a click or key press (browsers need one)
//   music.setState('Combat');            // switches on the next bar, with its transition
//   music.stinger('Victory');            // plays over the music on the next beat
//   music.setVolume(0.8);
//   music.stop();
//
// Every state is a seamless loop exactly a whole number of bars long, so switching on a bar line
// keeps the beat. Times come from the audio clock, so changes land on the beat however busy the
// game is.

export class AdaptiveMusic {
  constructor(context = new AudioContext(), destination) {
    this.ctx = context;
    this.out = this.ctx.createGain();
    this.out.connect(destination ?? this.ctx.destination);
    this.buffers = new Map();
    this.data = null;
    this.current = null; // { name, source, gain, startTime }
  }

  /** Load music.json and every sound it lists from `baseUrl` (ending in a slash). */
  async load(baseUrl = '') {
    this.base = baseUrl;
    this.data = await (await fetch(baseUrl + 'music.json')).json();
    const files = [
      ...this.data.states.map((s) => s.file),
      ...this.data.states.filter((s) => s.transition).map((s) => s.transition.file),
      ...this.data.stingers.map((s) => s.file),
    ];
    await Promise.all(
      [...new Set(files)].map(async (file) => {
        const bytes = await (await fetch(baseUrl + file)).arrayBuffer();
        this.buffers.set(file, await this.ctx.decodeAudioData(bytes));
      })
    );
  }

  get secondsPerBeat() {
    return 60 / this.data.bpm;
  }

  /** The audio time of the next bar or beat line of the state playing now. */
  nextLine(unit = 'bar') {
    const now = this.ctx.currentTime + 0.02;
    if (!this.current) return now;
    const line = this.secondsPerBeat * (unit === 'bar' ? this.data.beatsPerBar : 1);
    const elapsed = now - this.current.startTime;
    return this.current.startTime + Math.ceil(elapsed / line - 1e-6) * line;
  }

  state(name) {
    const s = this.data.states.find((x) => x.name === name);
    if (!s) throw new Error(`No state called "${name}"`);
    return s;
  }

  startLoop(state, at) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(state.file);
    source.loop = true;
    const gain = this.ctx.createGain();
    source.connect(gain).connect(this.out);
    source.start(at);
    return { name: state.name, source, gain, startTime: at };
  }

  playOnce(file, at) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(file);
    source.connect(this.out);
    source.start(Math.max(at, this.ctx.currentTime));
  }

  /** Start a state at once. */
  play(name) {
    // A page's AudioContext starts suspended until the player clicks or presses a key
    if (this.ctx.state === 'suspended' && !('startRendering' in this.ctx)) this.ctx.resume();
    this.stop();
    this.current = this.startLoop(this.state(name), this.ctx.currentTime + 0.05);
  }

  /** Move to another state on the next bar (or 'beat'), with its transition. */
  setState(name, unit = 'bar') {
    if (!this.current) return this.play(name);
    if (this.current.name === name) return;
    const next = this.state(name);
    let at = this.nextLine(unit);
    const line = this.secondsPerBeat * (unit === 'bar' ? this.data.beatsPerBar : 1);
    const lead = next.transition ? next.transition.leadInSeconds : 0;
    // A riser needs its whole lead-in: wait another line if there isn't room
    while (at - this.ctx.currentTime < lead) at += line;
    if (next.transition) this.playOnce(next.transition.file, at - lead);
    this.current.source.stop(at);
    this.current = this.startLoop(next, at);
  }

  /** Play a stinger over the music on the next beat (or 'bar', or 'now'). */
  stinger(name, unit) {
    const s = this.data.stingers.find((x) => x.name === name);
    if (!s) throw new Error(`No stinger called "${name}"`);
    this.playOnce(s.file, unit === 'now' ? this.ctx.currentTime : this.nextLine(unit ?? s.quantize ?? 'beat'));
  }

  setVolume(volume, seconds = 0.1) {
    this.out.gain.setTargetAtTime(volume, this.ctx.currentTime, seconds / 3);
  }

  stop() {
    if (this.current) this.current.source.stop();
    this.current = null;
  }
}
