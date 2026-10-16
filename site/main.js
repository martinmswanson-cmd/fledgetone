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
// scopes (spectrum bars, oscilloscope lines), the ruler and the channel strip all read it.
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

// Right: the master channel strip. The meters bounce with the scroll, and the fader rides the
// song down to silence at the end of the page.
{
  const strip = el('aside', 'side-strip', `
    <div class="ss-name">MASTER</div>
    <div class="ss-body">
      <div class="ss-meter"><i class="ss-fill"></i><i class="ss-peak"></i></div>
      <div class="ss-meter"><i class="ss-fill"></i><i class="ss-peak"></i></div>
      <div class="ss-fader"><span class="ss-cap"></span></div>
    </div>
    <span class="ss-val ss-db">0.0 dB</span>
    <div class="ss-btns"><span>M</span><span>S</span></div>`);
  strip.setAttribute('aria-hidden', 'true');
  document.body.append(strip);
  const dbRead = strip.querySelector('.ss-db');
  const fills = [...strip.querySelectorAll('.ss-fill')], peaksEl = [...strip.querySelectorAll('.ss-peak')];
  const cap = strip.querySelector('.ss-cap');
  const peak = [0, 0];
  parts.push(({ p, energy, t }) => {
    if (!wide.matches) return;
    // The fader: 0 dB, easing down to -12 dB through the song, then a fade to silence at the end
    const gainDb = p < 0.9 ? -12 * (p / 0.9) ** 2 : -12 - ((p - 0.9) / 0.1) * 48;
    const faderPos = gainDb <= -60 ? 1 : clamp(-gainDb / 66);
    cap.style.top = `${faderPos * 100}%`;
    dbRead.textContent = gainDb <= -59.9 ? '-inf dB' : `${gainDb.toFixed(1)} dB`;
    const g = gainDb <= -59.9 ? 0 : 10 ** (gainDb / 40);
    fills.forEach((f, i) => {
      const lvl = clamp((0.06 + energy * 0.95) * g * (0.88 + 0.12 * Math.sin(t * (11 + i * 3) + i)));
      peak[i] = Math.max(lvl, peak[i] - 0.006);
      f.style.transform = `scaleY(${lvl.toFixed(3)})`;
      peaksEl[i].style.bottom = `${(peak[i] * 100).toFixed(1)}%`;
    });
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
