// Adaptive music player for the web, from Fledgetone. No libraries: Web Audio only.
//
//   import { AdaptiveMusic } from './adaptive-music.js';
//   const music = new AdaptiveMusic();
//   await music.load('music/');          // the folder with audio_manifest.json in it
//   music.play('Explore');               // after a click or key press (browsers need one)
//   music.setState('Combat');            // switches by the transition rules in the manifest
//   music.setIntensity(0.8);             // crossfades the stem groups along their curves
//   music.stinger('Victory');            // plays over the music on the next beat
//   music.setCostume('8-bit');           // the same music played another way, mid-loop (null: back)
//   music.setEffect('underwater');       // muffled and roomy ('muffled', 'lowHealth', 'none')
//   music.setParameter('danger', 0.7);   // a parameter of the song's: moves what it was set up to move
//   music.playSfx('sword_hit');          // a sound effect (a different variation each time)
//   const rain = music.playSfx('rain');  // a looping one plays until stopped: rain.stop()
//   music.setVolume(0.8); music.setSfxVolume(0.6);
//   music.stop();
//
// Every state is a seamless loop exactly a whole number of bars long (and, when the song has stem
// groups, a set of stems of that same length), so switching on a bar line keeps the beat. A state
// can also play its pieces in a shuffled order, or leave silences between plays (see the
// manifest's shuffleBars and gap). Times come from the audio clock, so changes land on the beat
// however busy the game is.

/** The effect presets: a low-pass, a reverb send, and the music's level. */
const EFFECTS = {
  none: { filter: 20000, reverb: 0, level: 1 },
  underwater: { filter: 650, reverb: 0.5, level: 1 },
  muffled: { filter: 1100, reverb: 0.12, level: 0.9 },
  lowHealth: { filter: 2200, reverb: 0.2, level: 0.85 },
  dream: { filter: 5000, reverb: 0.7, level: 0.9 },
};

export class AdaptiveMusic {
  constructor(context = new AudioContext(), destination) {
    this.ctx = context;
    const dest = destination ?? this.ctx.destination;
    // Music: out -> level -> low-pass -> (dry, and a reverb send) -> the destination
    this.out = this.ctx.createGain();
    this.levelGain = this.ctx.createGain();
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.7;
    this.out.connect(this.levelGain).connect(this.filter).connect(dest);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = AdaptiveMusic.impulse(this.ctx, 2.8);
    this.filter.connect(this.reverbSend).connect(this.reverb).connect(dest);
    // Sound effects have their own level, apart from the music's (and no music effects)
    this.sfxOut = this.ctx.createGain();
    this.sfxOut.connect(dest);
    this.lastSfx = new Map(); // name -> the variation played last, so the next differs
    this.sfxPlaying = new Map(); // name -> Set of handles still sounding
    this.buffers = new Map();
    this.data = null;
    this.current = null; // see startState
    this.intensity = 1;
    this.costume = null;
    this.effect = 'none';
    this.effectLevel = 1;
    this.baseFilter = 20000; // the filter and reverb as setFilter, setReverb and setEffect last left them
    this.baseReverb = 0;
    this.params = new Map(); // the song's parameters (name -> value): see setParameter
    this.timer = null;
  }

  /** A soft room: stereo noise fading over `seconds`. */
  static impulse(ctx, seconds) {
    const n = Math.round(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3) * 0.5;
    }
    return b;
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
    this.params = new Map((data.parameters ?? []).map((p) => [p.name, p.default ?? 0]));
    this.applyMix(0);
  }

  /** Every sound file a manifest uses. */
  static filesOf(data) {
    const files = [];
    const partsOf = (s) => (s.stems?.length ? s.stems.map((x) => x.file) : s.file ? [s.file] : []);
    for (const s of data.states) {
      // A state with stems plays them; its whole mix is only needed without
      files.push(...partsOf(s));
      for (const c of s.costumes ?? []) files.push(...partsOf(c));
    }
    for (const t of data.transitions ?? []) if (t.file) files.push(t.file);
    for (const s of data.states) if (s.transition?.file) files.push(s.transition.file); // version 1 manifests
    for (const s of data.stingers) files.push(s.file);
    for (const s of data.sfx ?? []) files.push(...s.files);
    return [...new Set(files)];
  }

  /** The names of the costumes (the same music played other ways). */
  get costumeNames() {
    const names = new Set();
    for (const s of this.data?.states ?? []) for (const c of s.costumes ?? []) names.add(c.name);
    return [...names];
  }

  /** The state playing now's beat and bar (each state has its own tempo and time signature; a costume may be faster). */
  get secondsPerBeat() {
    const st = this.current && this.data.states.find((s) => s.name === this.current.name);
    return (st?.beatSeconds ?? this.data.beatSeconds ?? 60 / this.data.bpm) / (this.current?.tempo ?? 1);
  }

  lineLength(unit) {
    const st = this.current && this.data.states.find((s) => s.name === this.current.name);
    return this.secondsPerBeat * (unit === 'bar' ? st?.beatsPerBar ?? this.data.beatsPerBar : 1);
  }

  /**
   * The audio time of the next line of the state playing now: a 'bar' or 'beat', a 'phrase'
   * (every `phraseBars` bars from the state's start), or the 'end' of its loop (or piece).
   */
  nextLine(unit = 'bar', phraseBars = 4, ahead = 0) {
    const now = this.ctx.currentTime + 0.02;
    if (!this.current || unit === 'now') return now;
    // Where the bar lines run from: the piece playing now (or, in a silence, the next one)
    const from = this.current.gridStart(now);
    if (from >= now) return from;
    // A state whose tempo or time signature changes inside it: its own bar lines and beats
    const lines = this.gridLines(unit, phraseBars);
    if (lines) {
      const piece = this.current.pieces?.find((p) => now >= p.at - 1e-3 && now < p.end);
      const pos = piece ? this.current.bounds[piece.index][0] + (now - piece.at) : (now - from) % this.current.seconds;
      const at = now + AdaptiveMusic.untilLine(lines, this.current.seconds, pos, ahead);
      // (The next piece, which may be any of them, starts on a bar line)
      return piece && ahead <= piece.end - now ? Math.min(at, piece.end) : at;
    }
    if (unit === 'end') {
      const piece = this.current.pieces?.find((p) => now >= p.at - 1e-3 && now < p.end);
      if (piece) return piece.end;
      if (this.current.loopSeconds) return from + Math.ceil((now - from) / this.current.loopSeconds - 1e-6) * this.current.loopSeconds;
    }
    const line = this.lineFor(unit, phraseBars);
    return from + Math.ceil((now - from) / line - 1e-6) * line;
  }

  /**
   * The lines of `unit` in the state playing now, in seconds into its loop as the costume on now
   * plays it, when the manifest gives them (barTimes, beatTimes: a state whose tempo or time
   * signature changes inside it); null when one line length finds them.
   */
  gridLines(unit, phraseBars = 4) {
    const st = this.current && this.data.states.find((s) => s.name === this.current.name);
    const times = unit === 'beat' ? st?.beatTimes : unit === 'bar' || unit === 'phrase' ? st?.barTimes : null;
    if (!times?.length) return null;
    const tempo = this.current.tempo ?? 1;
    return times.filter((_, i) => unit !== 'phrase' || i % phraseBars === 0).map((t) => t / tempo);
  }

  /** Seconds from `pos` (seconds into a loop `loop` long) to the first of `lines` at least `ahead` on, going round the loop. */
  static untilLine(lines, loop, pos, ahead = 0) {
    const target = pos + ahead - 1e-6;
    const base = Math.floor(target / loop) * loop;
    const t = lines.find((x) => x >= target - base);
    return (t !== undefined ? base + t : base + loop + lines[0]) - pos;
  }

  /** How long a line of `unit` is in the state playing now. */
  lineFor(unit, phraseBars = 4) {
    if (unit === 'phrase') return this.lineLength('bar') * phraseBars;
    return this.lineLength(unit === 'beat' ? 'beat' : 'bar');
  }

  state(name) {
    const s = this.data.states.find((x) => x.name === name);
    if (!s) throw new Error(`No state called "${name}"`);
    return s;
  }

  /** The names of the song's parameters (see setParameter). */
  get parameterNames() {
    return (this.data?.parameters ?? []).map((p) => p.name);
  }

  /**
   * What the parameters ask for together: the highest intensity and reverb, the lowest filter, the
   * volumes and each group's levels multiplied (the same sums as Fledgetone's gameParams.ts).
   */
  mix() {
    const m = { intensity: null, filter: 20000, reverb: 0, volume: 1, layers: {} };
    const clamp = (x) => Math.max(0, Math.min(1, x));
    for (const p of this.data?.parameters ?? []) {
      const v = clamp(this.params.get(p.name) ?? p.default ?? 0);
      for (const t of p.targets) {
        const lo = Math.min(t.from, t.to);
        const hi = Math.max(t.from, t.to);
        const f = hi - lo < 1e-6 ? (v >= hi ? 1 : 0) : clamp((v - lo) / (hi - lo));
        if (t.target === 'filter') {
          const a = Math.max(60, t.start);
          const b = Math.max(60, t.end);
          m.filter = Math.min(m.filter, Math.max(60, Math.min(20000, a * Math.pow(b / a, f))));
          continue;
        }
        const x = t.start + (t.end - t.start) * f;
        if (t.target === 'intensity') m.intensity = Math.max(m.intensity ?? 0, clamp(x));
        else if (t.target === 'reverb') m.reverb = Math.max(m.reverb, clamp(x));
        else if (t.target === 'volume') m.volume *= clamp(x);
        else if (t.target === 'layer' && t.group) m.layers[t.group] = (m.layers[t.group] ?? 1) * clamp(x);
      }
    }
    return m;
  }

  /**
   * Set one of the song's parameters (0 to 1), over `seconds`: whatever it was set up to move
   * (the intensity, a filter, the reverb, the volume, a stem group's level) follows.
   */
  setParameter(name, value, seconds = 0.5) {
    if (!this.params.has(name)) throw new Error(`No parameter called "${name}" (try ${this.parameterNames.join(', ') || 'none: this song has none'})`);
    this.params.set(name, Math.max(0, Math.min(1, Number(value) || 0)));
    this.applyMix(seconds);
  }

  /** Where a parameter is now. */
  getParameter(name) {
    return this.params.get(name);
  }

  /** The filter, reverb, level and group levels as the effect, setFilter / setReverb and the parameters have them. */
  applyMix(seconds = 0.5) {
    const m = this.mix();
    const t = this.ctx.currentTime;
    const hz = Math.max(40, Math.min(20000, Math.min(this.baseFilter, m.filter)));
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
    if (seconds > 0) this.filter.frequency.exponentialRampToValueAtTime(hz, t + seconds);
    else this.filter.frequency.setValueAtTime(hz, t);
    const ramp = Math.max(0.01, seconds / 3);
    this.reverbSend.gain.setTargetAtTime(Math.max(this.baseReverb, m.reverb) * 0.6, t, ramp);
    this.levelGain.gain.setTargetAtTime(this.effectLevel * m.volume, t, ramp);
    if (this.current) for (const [group, g] of this.current.groups) if (group) g.gain.setTargetAtTime(this.level(group), t, ramp);
  }

  /** A stem group's level now: its curve at the intensity, times what the parameters ask of it. */
  level(group) {
    const m = this.data?.parameters?.length ? this.mix() : null;
    const layer = m?.layers[group] ?? 1;
    return this.curveLevel(group, m?.intensity ?? this.intensity) * layer;
  }

  /** A stem group's level on its intensity curve at `intensity` (straight lines between its points). */
  curveLevel(group, intensity) {
    const g = this.data.intensity?.groups?.find((x) => x.name === group);
    if (!g || !g.curve.length) return 1;
    const x = Math.max(0, Math.min(1, intensity));
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

  /** A state as the costume on now dresses it: its parts (stems or mix), length and tempo. */
  dressed(state) {
    const c = this.costume && state.costumes?.find((x) => x.name === this.costume);
    const src = c ?? state;
    const parts = src.stems?.length ? src.stems.map((s) => ({ file: s.file, group: s.group })) : [{ file: src.file, group: null }];
    return { parts, seconds: c ? c.seconds : state.seconds, tempo: c ? c.tempo : 1 };
  }

  /**
   * Start a state at `at`, fading in over `fade` seconds, `from` (0 to 1) of the way into its loop.
   * A plain state is a loop; one with shuffled pieces or silences is scheduled piece by piece.
   */
  startState(state, at, fade = 0, from = 0) {
    const bus = this.ctx.createGain();
    bus.connect(this.out);
    if (fade > 0) {
      bus.gain.setValueAtTime(0, at);
      bus.gain.linearRampToValueAtTime(1, at + fade);
    }
    const { parts, seconds, tempo } = this.dressed(state);
    // One gain per stem group, so intensity reaches every piece
    const groups = new Map();
    for (const { group } of parts) {
      if (groups.has(group)) continue;
      const g = this.ctx.createGain();
      g.gain.value = group ? this.level(group) : 1;
      g.connect(bus);
      groups.set(group, g);
    }
    const playing = { name: state.name, startTime: at, fade, tempo, seconds, bus, groups, sources: new Set(), pieces: [], gridStart: () => at };
    if (!state.shuffleBars && !state.gap) {
      const offset = (from % 1) * seconds;
      for (const { file, group } of parts) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers.get(file);
        source.loop = true;
        source.connect(groups.get(group));
        source.start(at, offset);
        playing.sources.add(source);
      }
      playing.gridStart = () => at - offset;
      playing.loopSeconds = seconds;
      return playing;
    }
    // Pieces: bar-line boundaries a few bars (measures of the state's own time signature) apart,
    // the whole loop when it isn't shuffled
    // (On the state's own bar lines where the manifest gives them: its tempo changes inside it)
    const lines = state.barTimes?.length ? state.barTimes.map((t) => (t * seconds) / state.seconds) : null;
    const bars = lines ? lines.length : AdaptiveMusic.measures(state, this.data);
    const each = state.shuffleBars && state.shuffleBars < bars ? state.shuffleBars : bars;
    const lineAt = (b) => (b >= bars ? seconds : !lines ? (b / bars) * seconds : b === 0 ? 0 : lines[b]);
    const bounds = [];
    for (let b = 0; b < bars - 1e-6; b += each) bounds.push([lineAt(b), lineAt(Math.min(bars, b + each))]);
    playing.bounds = bounds;
    // The piece `from` falls in, then the rest of the pass in order (or shuffled)
    let first = 0;
    while (first + 1 < bounds.length && bounds[first + 1][0] <= (from % 1) * seconds + 1e-9) first++;
    const startIn = (from % 1) * seconds - bounds[first][0];
    playing.queue = [first, ...this.order(bounds.length, first, state.shuffleBars).filter((i) => i !== first)];
    playing.next = at - startIn;
    playing.firstOffset = startIn;
    playing.parts = parts;
    playing.state = state;
    playing.gridStart = (now) => {
      for (const p of playing.pieces) if (now >= p.at - 1e-3 && now < p.end) return p.at;
      const ahead = playing.pieces.find((p) => p.at >= now);
      return ahead ? ahead.at : playing.next;
    };
    this.schedule(playing);
    return playing;
  }

  /** How many bars (measures of its time signature) a state is. */
  static measures(state, data) {
    const bar = (state.beatsPerBar ?? data.beatsPerBar) * (state.beatSeconds ?? data.beatSeconds ?? 60 / data.bpm);
    return bar > 0 ? Math.max(1, Math.round(state.seconds / bar)) : Math.max(1, Math.round(state.bars));
  }

  /** A pass through `n` pieces: in order, or shuffled with no piece twice in a row (`last` played just before). */
  order(n, last, shuffle) {
    const idx = [...Array(n).keys()];
    if (!shuffle) return idx;
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (n > 1 && idx[0] === last) [idx[0], idx[1]] = [idx[1], idx[0]];
    return idx;
  }

  /** Queue pieces a little ahead of the clock (all at once in an offline render). */
  schedule(playing) {
    const offline = 'startRendering' in this.ctx;
    const horizon = offline ? this.ctx.length / this.ctx.sampleRate : this.ctx.currentTime + 1.5;
    // A state fading out keeps its pieces coming until the fade ends (a shuffled or gapped state
    // would otherwise go quiet a second or two into a longer fade)
    const until = playing.stopAt ?? Infinity;
    while (playing.next < Math.min(horizon, until) && !playing.stopped) {
      if (!playing.queue.length) {
        // End of a pass: a silence (if the state has one), then another pass
        const g = playing.state.gap;
        if (g) playing.next += g.min + Math.random() * Math.max(0, g.max - g.min);
        const last = playing.lastPiece ?? -1;
        playing.queue = this.order(playing.bounds.length, last, playing.state.shuffleBars);
        continue;
      }
      const i = playing.queue.shift();
      const [a, b] = playing.bounds[i];
      const skip = playing.firstOffset ?? 0;
      playing.firstOffset = 0;
      const at = Math.max(playing.next + skip, this.ctx.currentTime);
      const dur = b - a - skip;
      if (dur > 0.01) {
        for (const { file, group } of playing.parts) {
          const source = this.ctx.createBufferSource();
          source.buffer = this.buffers.get(file);
          const env = this.ctx.createGain();
          // Short fades so a piece joins any other cleanly
          env.gain.setValueAtTime(0, at);
          env.gain.linearRampToValueAtTime(1, at + 0.006);
          env.gain.setValueAtTime(1, at + dur - 0.006);
          env.gain.linearRampToValueAtTime(0, at + dur);
          source.connect(env).connect(playing.groups.get(group));
          source.start(at, a + skip, dur);
          if (until < at + dur) source.stop(until);
          playing.sources.add(source);
          source.onended = () => playing.sources.delete(source);
        }
        playing.pieces.push({ at: playing.next, end: playing.next + (b - a), index: i });
        if (playing.pieces.length > 64) playing.pieces.shift();
      }
      playing.lastPiece = i;
      playing.next += b - a;
    }
    if (!offline && !playing.stopped && playing.next < until) {
      clearTimeout(playing.timer);
      playing.timer = setTimeout(() => this.schedule(playing), 400);
    }
  }

  stopState(playing, at, fade = 0) {
    if (fade > 0) {
      // From wherever its level is then, mid fade-in included (cancelling would drop the fade-in
      // and jump its level)
      const gain = playing.bus.gain;
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(at);
      else {
        gain.cancelScheduledValues(at);
        gain.setValueAtTime(gain.value, at);
      }
      gain.linearRampToValueAtTime(0, at + fade);
      // Its pieces carry on to the end of the fade, then stop
      playing.stopAt = at + fade;
      this.schedule(playing);
    } else {
      playing.stopped = true;
      clearTimeout(playing.timer);
    }
    for (const s of playing.sources) {
      try {
        s.stop(at + fade);
      } catch {
        // already stopped
      }
    }
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
    const line = q === 'end' && this.current.loopSeconds ? this.current.loopSeconds : this.lineFor(q, r.phraseBars);
    const lead = r.leadInSeconds ?? 0;
    // A riser needs its whole lead-in: wait another line if there isn't room
    let at = this.nextLine(q, r.phraseBars, this.gridLines(q, r.phraseBars) ? lead : 0);
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
        this.current = this.startState(next, at + (s.bridgeSeconds ?? (s.bridgeBars ?? 1) * this.lineLength('bar')));
        return;
      }
    }
    if (r.kind === 'bridge' && r.file) {
      // A bridge written into the new state: it plays on the line, the state comes in after it
      this.playOnce(r.file, at);
      this.stopState(old, at);
      this.current = this.startState(next, at + (r.bridgeSeconds ?? this.lineLength('bar')));
      return;
    }
    if (r.file) this.playOnce(r.file, at - lead);
    this.stopState(old, at);
    this.current = this.startState(next, at);
  }

  /**
   * Play the music in a costume (null: as written), crossfading over `seconds` from the same point
   * in the loop, so the tune carries on in its new clothes. Every later state wears it too.
   */
  setCostume(name, seconds = 1) {
    if (name && !this.costumeNames.includes(name)) throw new Error(`No costume called "${name}"`);
    if ((name ?? null) === this.costume) return;
    this.costume = name ?? null;
    if (!this.current) return;
    const old = this.current;
    const state = this.state(old.name);
    const now = this.ctx.currentTime + 0.03;
    // A state still waiting for its line: it comes in there, in the new costume
    if (old.startTime > now) {
      this.stopState(old, old.startTime);
      this.current = this.startState(state, old.startTime, old.fade ?? 0);
      return;
    }
    // How far into the loop (or the piece) the music is, as a fraction of the whole state
    const len = state.seconds / (old.tempo ?? 1);
    let from;
    // In a silence between plays: the new costume comes in when the music would have
    if (old.bounds && !old.pieces.some((x) => now >= x.at && now < x.end)) {
      const ahead = old.pieces.find((x) => x.at > now)?.at ?? old.next;
      if (ahead > now) {
        this.stopState(old, now);
        this.current = this.startState(state, ahead);
        return;
      }
    }
    if (old.bounds) {
      const p = old.pieces.find((x) => now >= x.at && now < x.end) ?? old.pieces[old.pieces.length - 1];
      from = p ? (old.bounds[p.index][0] + (now - p.at)) / len : 0;
    } else {
      from = (((now - old.gridStart(now)) % len) + len) % len / len;
    }
    this.stopState(old, now, seconds);
    this.current = this.startState(state, now, seconds, Math.max(0, from));
  }

  /**
   * Shape the music for what's going on: 'underwater', 'muffled' (behind a wall, a pause menu),
   * 'lowHealth', 'dream' or 'none', over `seconds`. Sound effects aren't touched.
   */
  setEffect(name, seconds = 1) {
    const e = EFFECTS[name];
    if (!e) throw new Error(`No effect called "${name}" (try ${Object.keys(EFFECTS).join(', ')})`);
    this.effect = name;
    this.baseFilter = e.filter;
    this.baseReverb = e.reverb;
    this.effectLevel = e.level;
    this.applyMix(Math.max(0.01, seconds));
  }

  /**
   * The music through a low-pass at `hz` (20000: open), gliding over `seconds`. A parameter asking
   * for a lower one wins while it does.
   */
  setFilter(hz, seconds = 0.5) {
    this.baseFilter = Math.max(40, Math.min(20000, hz));
    this.applyMix(Math.max(0.01, seconds));
  }

  /** How much of the music goes to the room reverb, 0 to 1, over `seconds` (or more, while a parameter asks for more). */
  setReverb(amount, seconds = 0.5) {
    this.baseReverb = Math.max(0, Math.min(1, amount));
    this.applyMix(Math.max(0.01, seconds));
  }

  /**
   * Crossfade the stem groups to `value` (0 to 1) along their curves, over `seconds`. (A song whose
   * parameters move the intensity follows them instead.)
   */
  setIntensity(value, seconds = 0.5) {
    this.intensity = Math.max(0, Math.min(1, value));
    if (this.data) this.applyMix(seconds);
  }

  /** Play a stinger over the music on the next beat (or 'bar', or 'now'). */
  stinger(name, unit) {
    const s = this.data.stingers.find((x) => x.name === name);
    if (!s) throw new Error(`No stinger called "${name}"`);
    this.playOnce(s.file, this.nextLine(unit ?? s.quantize ?? 'beat'));
  }

  /** The names of the kit's sound effects. */
  get sfxNames() {
    return (this.data?.sfx ?? []).map((s) => s.name);
  }

  /**
   * Play a sound effect now: one of its variations, never the same one twice in a row.
   * `volume` 0 to 1, `pitch` in semitones (a little random pitch is up to you: pitch: Math.random() - 0.5).
   * A looping sound plays until its handle's stop(); stopSfx(name) stops every one of a name.
   */
  playSfx(name, { volume = 1, pitch = 0, when = 0 } = {}) {
    const s = (this.data?.sfx ?? []).find((x) => x.name === name);
    if (!s) throw new Error(`No sound effect called "${name}"`);
    if (this.ctx.state === 'suspended' && !('startRendering' in this.ctx)) this.ctx.resume();
    let i = Math.floor(Math.random() * s.files.length);
    if (s.files.length > 1 && i === this.lastSfx.get(name)) i = (i + 1) % s.files.length;
    this.lastSfx.set(name, i);
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(s.files[i]);
    source.loop = !!s.loop;
    source.playbackRate.value = Math.pow(2, pitch / 12);
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.sfxOut);
    source.start(Math.max(this.ctx.currentTime, when));
    const live = this.sfxPlaying.get(name) ?? new Set();
    this.sfxPlaying.set(name, live);
    const handle = {
      source,
      gain,
      stop: (fade = 0.05) => {
        const t = this.ctx.currentTime;
        gain.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 3));
        try {
          source.stop(t + fade + 0.05);
        } catch {
          // already stopped
        }
        live.delete(handle);
      },
    };
    live.add(handle);
    source.onended = () => live.delete(handle);
    return handle;
  }

  /** Stop every playing sound effect called `name` (or all of them). */
  stopSfx(name, fade = 0.05) {
    for (const [n, live] of this.sfxPlaying) if (name === undefined || n === name) for (const h of [...live]) h.stop(fade);
  }

  setSfxVolume(volume, seconds = 0.1) {
    this.sfxOut.gain.setTargetAtTime(volume, this.ctx.currentTime, seconds / 3);
  }

  setVolume(volume, seconds = 0.1) {
    this.out.gain.setTargetAtTime(volume, this.ctx.currentTime, seconds / 3);
  }

  stop() {
    if (this.current?.sources) this.stopState(this.current, this.ctx.currentTime);
    this.current = null;
  }

  /** Stop everything and take the player's sound out of the mix for good (it can't be used after). */
  dispose() {
    this.stop();
    this.stopSfx();
    clearTimeout(this.timer);
    this.out.disconnect();
    this.sfxOut.disconnect();
  }
}
