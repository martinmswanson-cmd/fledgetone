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

// The scroll synth. Scrolling plays it: how fast you scroll is the level (it jumps up and falls
// back like a meter), how far down the page you are is a filter sweep (the spectrum's peak moves
// from the lows to the highs). Bars draw a spectrum, waves an oscilloscope in the section's colour.
const scopes = [...document.querySelectorAll('.scope')].map((el) => ({
  el, kind: el.dataset.scope, canvas: el.querySelector('canvas'), on: false,
  reads: { cutoff: el.querySelector('[data-read="cutoff"]'), level: el.querySelector('[data-read="level"]') },
}));
if (scopes.length) {
  const css = getComputedStyle(document.documentElement);
  const col = (name) => css.getPropertyValue(name).trim();
  const PALETTE = ['--cyan', '--green', '--amber', '--purple'].map(col);
  const BARS = 64;
  const peaks = new Float32Array(BARS);
  let energy = 0, lastY = scrollY, lastT = performance.now(), raf = 0, t0 = performance.now();

  const fit = (s) => {
    const r = s.canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    s.canvas.width = Math.round(r.width * dpr); s.canvas.height = Math.round(r.height * dpr);
  };
  const progress = () => Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
  // The filter: a resonant peak that sweeps from the lows to the highs as you go down the page
  const response = (x, p) => {
    const centre = 0.08 + p * 0.84;
    const peak = Math.exp(-((x - centre) ** 2) / 0.012);
    const body = Math.exp(-((x - centre) ** 2) / 0.09) * 0.55;
    const tilt = 0.35 * (1 - x);
    return Math.min(1, peak + body + tilt);
  };
  const noise = (i, t) => 0.5 + 0.25 * Math.sin(t * 7.1 + i * 1.7) + 0.25 * Math.sin(t * 3.3 + i * 0.6);

  const drawBars = (s, t, p) => {
    const g = s.canvas.getContext('2d'), W = s.canvas.width, H = s.canvas.height;
    g.clearRect(0, 0, W, H);
    const gap = W / BARS, bw = Math.max(2, gap * 0.62);
    for (let i = 0; i < BARS; i++) {
      const x = i / (BARS - 1);
      const idle = 0.05 + 0.04 * noise(i, t * 0.6);
      const h = Math.min(1, idle + energy * response(x, p) * (0.65 + 0.35 * noise(i, t)));
      peaks[i] = Math.max(h, peaks[i] - 0.008);
      const px = i * gap + (gap - bw) / 2, ph = h * H;
      const c = PALETTE[Math.floor(x * PALETTE.length) % PALETTE.length];
      const grad = g.createLinearGradient(0, H - ph, 0, H);
      grad.addColorStop(0, c); grad.addColorStop(1, c + '22');
      g.fillStyle = grad;
      g.fillRect(px, H - ph, bw, ph);
      g.fillStyle = c;
      g.fillRect(px, H - peaks[i] * H - 3, bw, 2);
    }
  };
  const drawWave = (s, t, p) => {
    const g = s.canvas.getContext('2d'), W = s.canvas.width, H = s.canvas.height;
    const c = getComputedStyle(s.el).getPropertyValue('--c').trim() || PALETTE[0];
    g.clearRect(0, 0, W, H);
    const amp = (0.06 + energy * 0.8) * H * 0.45, f = 3 + p * 14;
    for (const [alpha, lw, shift] of [[0.18, 6, 0.4], [0.9, 2, 0]]) {
      g.beginPath();
      for (let x = 0; x <= W; x += 3) {
        const u = x / W;
        const env = Math.sin(Math.PI * u);
        const y = H / 2 + env * amp * (Math.sin(u * f * Math.PI * 2 - t * 4 + shift) * 0.7 + Math.sin(u * f * 2.01 * Math.PI * 2 - t * 6.3) * 0.3);
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = c; g.globalAlpha = alpha; g.lineWidth = lw * Math.min(2, devicePixelRatio || 1);
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const frame = (now) => {
    const dt = Math.max(1, now - lastT) / 1000; lastT = now;
    const v = Math.abs(scrollY - lastY) / dt; lastY = scrollY;
    const target = Math.min(1, v / 2200);
    energy += (target - energy) * (target > energy ? 0.35 : 0.04); // quick attack, slow release
    const t = (now - t0) / 1000, p = progress();
    for (const s of scopes) if (s.on) (s.kind === 'wave' ? drawWave : drawBars)(s, t, p);
    const cutoff = 80 * Math.pow(16000 / 80, 0.08 + p * 0.84);
    const db = energy > 0.001 ? Math.max(-60, 20 * Math.log10(energy)) : -60;
    for (const s of scopes) {
      if (s.reads.cutoff) s.reads.cutoff.textContent = cutoff >= 1000 ? `${(cutoff / 1000).toFixed(1)} kHz` : `${Math.round(cutoff)} Hz`;
      if (s.reads.level) s.reads.level.textContent = `${db.toFixed(0)} dB`;
    }
    raf = scopes.some((s) => s.on) && !reduce ? requestAnimationFrame(frame) : 0;
  };
  const start = () => { if (!raf) { lastT = performance.now(); lastY = scrollY; raf = requestAnimationFrame(frame); } };

  scopes.forEach(fit);
  addEventListener('resize', () => { scopes.forEach(fit); if (reduce) frame(performance.now()); });
  if (reduce) {
    energy = 0.35; scopes.forEach((s) => (s.on = true)); frame(performance.now());
  } else {
    const io = seen((e) => { const s = scopes.find((x) => x.el === e.target); s.on = e.isIntersecting; if (s.on) start(); }, 0);
    if (io) scopes.forEach((s) => io.observe(s.el)); else { scopes.forEach((s) => (s.on = true)); start(); }
  }
}
