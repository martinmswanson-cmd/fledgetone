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
