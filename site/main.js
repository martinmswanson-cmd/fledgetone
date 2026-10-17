// fledgetone.com: the home page's motion. Clips play while they're on screen (never with reduced
// motion: then they get controls instead), the step bar under a clip follows it like a timeline,
// and sections fade in as they scroll into view. Everything works without this file.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const seen = (cb, threshold) => {
  if (!('IntersectionObserver' in window)) return null;
  return new IntersectionObserver((entries) => entries.forEach(cb), { threshold });
};

// Clips: play in view, pause out of view
const clips = [...document.querySelectorAll('video[data-autoplay]')];
if (reduce) {
  clips.forEach((v) => { v.controls = true; v.removeAttribute('autoplay'); });
} else {
  const io = seen((e) => {
    const v = e.target;
    if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => { v.controls = true; }); }
    else v.pause();
  }, 0.35);
  clips.forEach((v) => (io ? io.observe(v) : v.play().catch(() => {})));
}

// Step bars: each step fits its label and shares the rest of the bar by its length in the clip;
// the playhead runs through the current step
document.querySelectorAll('.player').forEach((player) => {
  const v = player.querySelector('video[data-steps]');
  const bar = player.querySelector('.steps');
  if (!v || !bar) return;
  const steps = [...bar.querySelectorAll('.step')];
  const head = bar.querySelector('.steps-head');
  const starts = steps.map((s) => parseFloat(s.dataset.start));
  let raf = 0;

  const layout = () => {
    const d = v.duration;
    if (!d) return;
    steps.forEach((s, i) => { s.style.flex = `${(starts[i + 1] ?? d) - starts[i]} 1 auto`; });
  };
  const draw = () => {
    const d = v.duration || 1, t = v.currentTime;
    let k = 0;
    starts.forEach((st, i) => { if (t >= st) k = i; });
    const fill = (i) => {
      const f = i < k ? 1 : i > k ? 0 : (t - starts[i]) / ((starts[i + 1] ?? d) - starts[i]);
      return Math.max(0, Math.min(1, f));
    };
    steps.forEach((s, i) => {
      s.style.setProperty('--fill', fill(i).toFixed(4));
      s.classList.toggle('on', i === k);
      s.setAttribute('aria-current', i === k ? 'step' : 'false');
    });
    const on = steps[k];
    head.style.left = `${on.offsetLeft + fill(k) * on.offsetWidth}px`;
  };
  const tick = () => { draw(); raf = v.paused ? 0 : requestAnimationFrame(tick); };

  v.addEventListener('loadedmetadata', () => { layout(); draw(); });
  if (v.readyState >= 1) layout();
  v.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); });
  v.addEventListener('seeked', draw);
  // Hold the last frame a moment, then go round again
  v.addEventListener('ended', () => {
    if (reduce) return;
    setTimeout(() => { v.currentTime = 0; v.play().catch(() => {}); }, 1600);
  });
  steps.forEach((s, i) => s.addEventListener('click', () => {
    v.preload = 'auto';
    v.currentTime = starts[i];
    v.play().catch(() => {});
  }));
});

// Sections fade up as they arrive
if (!reduce) {
  const els = document.querySelectorAll('.reveal, .track, .card, .section-title, .intro p');
  const io = seen((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, 0.12);
  if (io) {
    document.documentElement.classList.add('motion');
    els.forEach((el) => {
      // Cards in a row arrive one after another
      const sib = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
      if (el.matches('.card')) el.style.transitionDelay = `${(sib % 3) * 80}ms`;
      io.observe(el);
    });
  }
}

// The page as a session in the studio, played by scrolling. One loop measures the scroll: its
// speed is the level (quick to rise, slow to fall, like a meter) and how far down the page you
// are is the position in the song, which also sweeps a filter from the lows to the highs. The
// scopes (spectrum bars, oscilloscope lines) and the ruler read it.
const state = { energy: 0, p: 0, vel: 0, t: 0, dt: 0 };
const parts = [];
const css = getComputedStyle(document.documentElement);
const col = (name) => css.getPropertyValue(name).trim();
const dpr = () => Math.min(2, devicePixelRatio || 1);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);

// Scopes: canvases on the page that draw while they're on screen
{
  const scopes = [...document.querySelectorAll('.scope')].map((el) => ({
    el, kind: el.dataset.scope, canvas: el.querySelector('canvas'), on: reduce,
  }));
  const PALETTE = ['--cyan', '--green', '--amber', '--purple'].map(col);
  const BARS = 64, peaks = new Float32Array(BARS);
  const fit = (s) => {
    const r = s.canvas.getBoundingClientRect();
    s.canvas.width = Math.round(r.width * dpr()); s.canvas.height = Math.round(r.height * dpr());
  };
  const response = (x, p) => {
    const centre = 0.08 + p * 0.84;
    return Math.min(1, Math.exp(-((x - centre) ** 2) / 0.012) + Math.exp(-((x - centre) ** 2) / 0.09) * 0.55 + 0.35 * (1 - x));
  };
  const noise = (i, t) => 0.5 + 0.25 * Math.sin(t * 7.1 + i * 1.7) + 0.25 * Math.sin(t * 3.3 + i * 0.6);
  const bars = (s, { t, p, energy }) => {
    const g = s.canvas.getContext('2d'), W = s.canvas.width, H = s.canvas.height;
    g.clearRect(0, 0, W, H);
    const gap = W / BARS, bw = Math.max(2, gap * 0.62);
    for (let i = 0; i < BARS; i++) {
      const x = i / (BARS - 1);
      const h = Math.min(1, 0.05 + 0.04 * noise(i, t * 0.6) + energy * response(x, p) * (0.65 + 0.35 * noise(i, t)));
      peaks[i] = Math.max(h, peaks[i] - 0.008);
      const px = i * gap + (gap - bw) / 2, ph = h * H;
      const c = PALETTE[Math.floor(x * PALETTE.length) % PALETTE.length];
      const grad = g.createLinearGradient(0, H - ph, 0, H);
      grad.addColorStop(0, c); grad.addColorStop(1, c + '22');
      g.fillStyle = grad; g.fillRect(px, H - ph, bw, ph);
      g.fillStyle = c; g.fillRect(px, H - peaks[i] * H - 3, bw, 2);
    }
  };
  const wave = (s, { t, p, energy }) => {
    const g = s.canvas.getContext('2d'), W = s.canvas.width, H = s.canvas.height;
    const c = getComputedStyle(s.el).getPropertyValue('--c').trim() || PALETTE[0];
    g.clearRect(0, 0, W, H);
    const amp = (0.06 + energy * 0.8) * H * 0.45, f = 3 + p * 14;
    for (const [alpha, lw, shift] of [[0.18, 6, 0.4], [0.9, 2, 0]]) {
      g.beginPath();
      for (let x = 0; x <= W; x += 3) {
        const u = x / W, env = Math.sin(Math.PI * u);
        const y = H / 2 + env * amp * (Math.sin(u * f * Math.PI * 2 - t * 4 + shift) * 0.7 + Math.sin(u * f * 2.01 * Math.PI * 2 - t * 6.3) * 0.3);
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokeStyle = c; g.globalAlpha = alpha; g.lineWidth = lw * dpr(); g.stroke();
    }
    g.globalAlpha = 1;
  };
  scopes.forEach(fit);
  addEventListener('resize', () => scopes.forEach(fit));
  const io = !reduce && seen((e) => { const s = scopes.find((x) => x.el === e.target); s.on = e.isIntersecting; }, 0);
  if (io) scopes.forEach((s) => io.observe(s.el)); else scopes.forEach((s) => (s.on = true));
  parts.push((st) => {
    for (const s of scopes) {
      if (s.on) (s.kind === 'wave' ? wave : bars)(s, st);
    }
  });
}

// The side panels only fit beside the content on wide screens
const wide = window.matchMedia('(min-width: 1400px)');
const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

// The song-position ruler. The page is a 64-bar song at 120 BPM; the sections are its markers
// (click one to go there) and the playhead is where you are. On wide screens it runs down the left
// margin; narrower, it lies across the top under the menu bar, like the studio's own ruler.
{
  const BARS = 64, BPM = 120;
  const ruler = el('nav', 'side-ruler', `
    <div class="sr-read"><span class="sr-label">BAR</span><span class="sr-bar">001.1</span><span class="sr-tc">00:00:00:00</span><span class="sr-sec">Intro</span></div>
    <div class="sr-track"><div class="sr-ticks"></div><div class="sr-marks"></div><div class="sr-head"></div></div>`);
  ruler.setAttribute('aria-label', 'Sections');
  const header = document.querySelector('header.nav');
  const mount = () => (wide.matches ? document.body : header).append(ruler);
  mount(); wide.addEventListener('change', () => { mount(); requestAnimationFrame(place); });
  const ticks = ruler.querySelector('.sr-ticks'), marks = ruler.querySelector('.sr-marks');
  const head = ruler.querySelector('.sr-head');
  const barRead = ruler.querySelector('.sr-bar'), tcRead = ruler.querySelector('.sr-tc'), secRead = ruler.querySelector('.sr-sec');
  for (let b = 0; b <= BARS; b++) {
    const t = el('i', b % 8 === 0 ? 'major' : b % 4 === 0 ? 'mid' : '');
    t.style.setProperty('--pos', `${(b / BARS) * 100}%`);
    if (b % 8 === 0 && b < BARS) t.dataset.n = String(b + 1);
    ticks.append(t);
  }
  const SECTIONS = [['.hero', 'Intro', '--cyan'], ['#video', 'Video', '--purple'], ['#games', 'Games', '--green'],
    ['#features', 'Features', '--amber'], ['#credits', 'Credits', '--muted'], ['.final', 'Outro', '--cyan']];
  const flags = SECTIONS.map(([sel, name, c]) => {
    const target = document.querySelector(sel);
    const f = el('a', 'sr-flag', name);
    f.href = target.id ? `#${target.id}` : '#main';
    f.style.setProperty('--c', `var(${c})`);
    f.addEventListener('click', (e) => { e.preventDefault(); target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); });
    f.title = name;
    marks.append(f);
    return { f, target, name, c, at: 0 };
  });
  const place = () => {
    const m = maxScroll();
    flags.forEach((fl) => {
      // Where scrolling to the section stops: its top, less the room it leaves under the menu bar
      const gap = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      fl.at = clamp((fl.target.getBoundingClientRect().top + scrollY - gap - 8) / m);
      fl.f.style.setProperty('--pos', `${fl.at * 100}%`);
    });
  };
  place();
  addEventListener('load', place); addEventListener('resize', place);
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(document.body);
  let shown = -1;
  parts.push(({ p }) => {
    head.style.setProperty('--pos', `${p * 100}%`);
    // On the side, start below the menu bar (lower while the notice above it is in view)
    if (wide.matches) ruler.style.top = `${Math.max(84, Math.round(header.getBoundingClientRect().bottom) + 20)}px`;
    else ruler.style.top = '';
    const pos = p * BARS, bar = Math.floor(pos) + 1, beat = Math.floor((pos % 1) * 4) + 1;
    barRead.textContent = `${String(Math.min(bar, BARS)).padStart(3, '0')}.${p >= 1 ? 4 : beat}`;
    const secs = pos * (240 / BPM), f = Math.floor((secs % 1) * 30);
    const two = (n) => String(Math.floor(n)).padStart(2, '0');
    tcRead.textContent = `00:${two(secs / 60)}:${two(secs % 60)}:${two(f)}`;
    let on = 0;
    flags.forEach((fl, i) => { if (p + 0.005 >= fl.at) on = i; });
    if (on !== shown) {
      shown = on;
      flags.forEach((fl, i) => fl.f.classList.toggle('on', i === on));
      secRead.textContent = flags[on].name;
      secRead.style.setProperty('--c', `var(${flags[on].c})`);
    }
  });
}

// The loop: runs every frame (the browser pauses it in a background tab); with reduced motion the
// panels just follow the scroll, without the bouncing
{
  let lastY = scrollY, lastT = performance.now();
  const t0 = lastT;
  const step = (now) => {
    const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000)); lastT = now;
    const dy = scrollY - lastY; lastY = scrollY;
    state.vel += (dy / dt / 10 - state.vel) * Math.min(1, dt * 10);
    const target = Math.min(1, Math.abs(dy) / dt / 2200);
    state.energy += (target - state.energy) * (target > state.energy ? 0.35 : 0.04);
    state.p = clamp(scrollY / maxScroll()); state.t = (now - t0) / 1000; state.dt = dt;
    parts.forEach((f) => f(state));
  };
  if (reduce) {
    state.energy = 0.35;
    const still = () => { state.p = clamp(scrollY / maxScroll()); parts.forEach((f) => f(state)); };
    still(); addEventListener('scroll', still, { passive: true }); addEventListener('resize', still);
  } else {
    const loop = (now) => { step(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

// The scored films: muted until asked (browsers only play sound after a click). A button plays its
// film with sound from the start (and mutes the other), or turns the sound off again.
const scored = [...document.querySelectorAll('.scored')];
scored.forEach((fig) => {
  const v = fig.querySelector('video'), btn = fig.querySelector('.sound-btn'), label = btn?.querySelector('span');
  if (!v || !btn) return;
  btn.addEventListener('click', () => {
    const on = v.muted;
    if (on) scored.forEach((other) => { if (other !== fig) { const ov = other.querySelector('video'); if (!ov.muted) other.querySelector('.sound-btn').click(); } });
    v.muted = !on;
    if (on) { v.currentTime = 0; v.loop = false; v.preload = 'auto'; v.play().catch(() => {}); }
    btn.setAttribute('aria-pressed', String(on));
    label.textContent = on ? 'Sound off' : 'Play with sound';
  });
  v.addEventListener('ended', () => {
    v.muted = true; v.loop = true; btn.setAttribute('aria-pressed', 'false'); label.textContent = 'Play again with sound';
    v.play().catch(() => {});
  });
});

// Install: Chrome and Edge hand the page their install prompt (the studio's manifest covers the
// whole site), so the button opens it; other browsers get a sentence saying how, the same advice as
// the studio's Help › Install Fledgetone (src/pwa/installAdvice.ts: change both together).
const installBtn = document.getElementById('install-btn'), installNote = document.getElementById('install-advice');
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
addEventListener('appinstalled', () => {
  installPrompt = null;
  if (installNote) installNote.innerHTML = '<strong>Installed.</strong> Open Fledgetone from your apps, dock or home screen.';
});
function installAdvice() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const edge = /Edg\//.test(ua);
  const chrome = /Chrome\/|CriOS\//.test(ua) && !edge;
  const firefox = /Firefox\/|FxiOS\//.test(ua);
  const safari = /Safari\//.test(ua) && !chrome && !edge && !firefox && !/Android/.test(ua);
  if (ios) return 'In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.';
  if (safari) return 'In Safari, choose <strong>File › Add to Dock</strong> (or Share › Add to Dock).';
  if (edge) return 'In Edge, open the menu (…) › <strong>Apps › Install Fledgetone</strong>, or click the install icon at the right of the address bar.';
  if (/Android/.test(ua)) return firefox ? 'In Firefox, open the menu (⋮) › <strong>Install</strong>.' : 'Open the browser menu (⋮) › <strong>Install app</strong> (or Add to Home screen).';
  if (chrome) return 'In Chrome, click the install icon at the right of the address bar, or open the menu (⋮) › <strong>Cast, save and share › Install page as app</strong>. Already installed? The same icon opens it.';
  if (firefox) return "Firefox on a computer doesn't install web apps: open fledgetone.com in Chrome, Edge or Safari to install it. The studio works in Firefox as it is.";
  return "This browser doesn't install web apps: open fledgetone.com in Chrome, Edge or Safari to install it.";
}
if (installBtn && installNote) {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    installBtn.hidden = true;
    installNote.innerHTML = "<strong>You're using the installed app.</strong>";
  }
  installBtn.addEventListener('click', async () => {
    if (!installPrompt) { installNote.innerHTML = installAdvice(); return; }
    const e = installPrompt;
    installPrompt = null;
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== 'accepted') installNote.innerHTML = 'Not installed. You can install it any time from here, or in the studio from <strong>Help › Install Fledgetone</strong>.';
  });
}

// Hero: a piano roll behind the headline. The red playhead plays it at 120 BPM (a beat is one of
// the 80px bar lines); notes light up and ripple as it hits them, and each pass rewrites a bar of
// the melody, like someone writing. On a computer, click the roll to add a note of your own.
{
  const hero = document.querySelector('.hero'), canvas = hero?.querySelector('.hero-roll');
  const ctx = canvas?.getContext('2d');
  if (hero && ctx) {
    hero.classList.add('has-roll');
    const C = { cyan: col('--cyan'), green: col('--green'), amber: col('--amber'), purple: col('--purple'), red: col('--red') };
    const STEP = 20, BEAT = 80, LOOP = 64; // a 16th note is 20px; the pattern is 4 bars (64 steps)
    const LOW = 33, HIGH = 86; // the pitches the roll shows
    // A minor: Am, F, C, G, a bar each
    const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const SCALE = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const notes = [];
    const add = (step, len, pitch, color, kind) => notes.push({ step, len, pitch, color, kind, glow: 0, fade: 1 });
    CHORDS.forEach((ch, bar) => {
      const b = bar * 16;
      ch.forEach((p) => add(b, 15, p - 12, C.purple, 'pad'));
      for (let i = 0; i < 8; i++) add(b + i * 2, 1.6, ch[i % 3] + (i >= 4 ? 12 : 0), C.amber, 'arp');
    });
    // The melody, one bar at a time: chord tones on the beats, steps of the scale between
    const melodyBar = (bar) => {
      const out = [], ch = CHORDS[bar];
      let s = bar * 16;
      while (s < bar * 16 + 16) {
        const len = [2, 2, 4, 3, 1, 6][Math.floor(rnd() * 6)];
        const onBeat = s % 4 === 0;
        const pool = onBeat ? ch.map((p) => p + 12) : SCALE.slice(4);
        if (rnd() > 0.18) out.push({ step: s, len: Math.min(len, bar * 16 + 16 - s) - 0.3, pitch: pool[Math.floor(rnd() * pool.length)], color: C.cyan, kind: 'lead', glow: 0, fade: 0 });
        s += len;
      }
      return out;
    };
    let melody = [0, 1, 2, 3].flatMap(melodyBar);
    melody.forEach((n) => (n.fade = 1));
    const mine = [];
    const rings = [];
    let w = 0, h = 0, band = 0, lane = 10, copy = null, headX = 0, pass = 0, visible = true, hover = null;

    const fit = () => {
      const r = hero.getBoundingClientRect(), shot = hero.querySelector('.shot-hero');
      w = r.width; band = Math.max(320, (shot ? shot.getBoundingClientRect().top - r.top : r.height * 0.6) + 60);
      h = band;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr()); canvas.height = Math.round(h * dpr());
      lane = (band - 70) / (HIGH - LOW);
      const c = hero.querySelector('.hero-copy').getBoundingClientRect();
      copy = { x: c.left - r.left + c.width / 2, y: c.top - r.top + c.height / 2, rx: c.width / 2 + 40, ry: c.height / 2 + 30 };
    };
    const yOf = (pitch) => 30 + (HIGH - pitch) * lane;
    // Quieter behind the words, and fading out toward the video
    const dim = (x, y) => {
      const dx = (x - copy.x) / copy.rx, dy = (y - copy.y) / copy.ry;
      const inside = clamp(1.25 - Math.sqrt(dx * dx + dy * dy));
      return (1 - 0.72 * inside) * clamp((band - y) / 140);
    };
    const roundRect = (x, y, rw, rh, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, rw, rh, r) : ctx.rect(x, y, rw, rh); };
    const drawNote = (n, x0, now) => {
      const x = x0 + n.step * STEP, nw = n.len * STEP - 2, y = yOf(n.pitch), nh = Math.max(3, lane - 1.5);
      if (x > w || x + nw < 0) return;
      const playing = headX >= x && headX <= x + nw;
      const pad = n.kind === 'pad', glow = pad ? n.glow * 0.35 : n.glow;
      const a = dim(x + nw / 2, y) * n.fade * (pad ? 0.55 : 1);
      if (a <= 0.01) return;
      ctx.globalAlpha = a * (0.16 + 0.5 * glow + (playing ? (pad ? 0.08 : 0.2) : 0));
      ctx.fillStyle = n.color; roundRect(x, y, nw, nh, 2); ctx.fill();
      ctx.globalAlpha = a * (0.35 + 0.5 * glow);
      ctx.strokeStyle = n.color; ctx.lineWidth = 1; ctx.stroke();
      if (glow > 0.05) { ctx.globalAlpha = a * glow * 0.5; ctx.shadowColor = n.color; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0; }
    };
    const all = () => notes.concat(melody, mine);
    const draw = (now) => {
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      ctx.clearRect(0, 0, w, h);
      const span = LOOP * STEP;
      for (let x0 = 0; x0 < w; x0 += span) for (const n of notes.concat(melody)) drawNote(n, x0, now);
      // A note you placed is where you put it, once (the written pattern repeats across wide screens)
      for (const n of mine) drawNote(n, 0, now);
      for (const r of rings) {
        ctx.globalAlpha = r.life * 0.6 * dim(r.x, r.y); ctx.strokeStyle = r.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(r.x, r.y, (1 - r.life) * 26 + 3, 0, Math.PI * 2); ctx.stroke();
      }
      if (hover) {
        ctx.globalAlpha = 0.5; ctx.strokeStyle = C.cyan; ctx.setLineDash([3, 3]);
        roundRect(hover.x, yOf(hover.pitch), 4 * STEP - 2, Math.max(3, lane - 1.5), 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (!reduce) {
        // The playhead: a line with a marker at the top, like the studio's
        const g = ctx.createLinearGradient(0, 0, 0, band);
        g.addColorStop(0, 'rgba(239, 68, 68, .75)'); g.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.shadowColor = C.red; ctx.shadowBlur = 12;
        ctx.fillRect(headX - 1, 0, 2, band); ctx.shadowBlur = 0;
        ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(headX - 6, 0); ctx.lineTo(headX + 6, 0); ctx.lineTo(headX, 8); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const hit = (from, to) => {
      const span = LOOP * STEP;
      for (const n of all()) {
        for (let x0 = 0; x0 < (n.placed ? 1 : w); x0 += span) {
          const x = x0 + n.step * STEP;
          if (x > from && x <= to) {
            n.glow = 1;
            if (n.kind !== 'pad' && rings.length < 40) rings.push({ x, y: yOf(n.pitch) + lane / 2, color: n.color, life: 1 });
          }
        }
      }
    };
    let last = 0;
    const frame = (now) => {
      const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      const prev = headX;
      headX += dt * BEAT * 2; // two beats a second: 120 BPM
      if (headX > w) {
        headX = 0; pass++;
        // Rewrite one bar of the melody: the old notes fade out, the new ones in
        const bar = pass % 4;
        melody.forEach((n) => { if (Math.floor(n.step / 16) === bar) n.out = true; });
        melody.push(...melodyBar(bar));
      } else hit(prev, headX);
      for (const n of all()) n.glow *= Math.exp(-dt * 3.2);
      for (const n of melody) n.fade = clamp(n.fade + (n.out ? -dt * 1.5 : dt * 1.2));
      melody = melody.filter((n) => !(n.out && n.fade <= 0));
      for (const r of rings) r.life -= dt * 1.6;
      while (rings.length && rings[0].life <= 0) rings.shift();
      draw(now);
      if (visible) requestAnimationFrame(frame); else last = 0;
    };

    fit();
    addEventListener('resize', () => { fit(); if (reduce) draw(0); });
    if (reduce) draw(0);
    else {
      const io = seen((e) => { const was = visible; visible = e.isIntersecting; if (visible && !was) requestAnimationFrame(frame); }, 0);
      io?.observe(canvas);
      requestAnimationFrame(frame);
    }

    // Writing notes: a dashed note follows the mouse on the grid; a click puts it there
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const busy = (t) => t.closest('a, button, video, input, .shot-hero, .readouts, .eyebrow');
      const at = (e) => {
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (y < 20 || y > band - 60 || busy(e.target)) return null;
        const step = Math.floor(x / STEP / 2) * 2, pitch = Math.round(HIGH - (y - 30) / lane);
        return { step, x: Math.floor(x / STEP / 2) * 2 * STEP, pitch: clamp(pitch, LOW, HIGH) };
      };
      hero.addEventListener('pointermove', (e) => { hover = at(e); hero.classList.toggle('pencil', !!hover); if (reduce) draw(0); });
      hero.addEventListener('pointerleave', () => { hover = null; hero.classList.remove('pencil'); if (reduce) draw(0); });
      hero.addEventListener('click', (e) => {
        const n = at(e);
        if (!n || getSelection()?.toString()) return;
        if (mine.length >= 32) mine.shift();
        mine.push({ step: n.step, pitch: n.pitch, len: 3.7, color: C.cyan, kind: 'lead', glow: 1, fade: 1, placed: true });
        rings.push({ x: n.x, y: yOf(n.pitch) + lane / 2, color: C.cyan, life: 1 });
        if (reduce) draw(0);
      });
    }
  }
}

// The readouts count up the first time they're on screen
{
  const vals = [...document.querySelectorAll('.ro-value')].map((el) => {
    const m = el.textContent.match(/^(\d+)(.*)$/);
    return m && { el, to: +m[1], rest: m[2] };
  }).filter(Boolean);
  const box = document.querySelector('.readouts');
  if (!reduce && box && vals.length) {
    const run = () => {
      const t0 = performance.now();
      const tick = (now) => {
        const k = clamp((now - t0) / 1400), e = 1 - Math.pow(1 - k, 3);
        vals.forEach((v) => (v.el.textContent = Math.round(v.to * e) + v.rest));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const io = seen((e) => { if (e.isIntersecting) { io.disconnect(); run(); } }, 0.6);
    if (io) io.observe(box);
  }
}
