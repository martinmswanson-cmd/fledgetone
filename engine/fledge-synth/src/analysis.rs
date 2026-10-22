//! Bass movement, measured as it was measured on the reference tracks (the brief's
//! scripts/detail.py, `movement`): the spectral centroid of 100 Hz to 4 kHz, frame by frame, then
//! how far it jumps from one 16th to the next (in octaves), how much of its movement is at one
//! rate (a constant wobble puts most of it there) and how alike it is 1/8 and 1 bar apart.
//! Used by the preset tests and the `movement` example (which prints the table for every preset).

use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, Default)]
pub struct Movement {
    /// Median centroid jump from one 16th to the next, in octaves
    pub jump: f64,
    /// Share of 16ths whose jump is over 0.25 and over 0.5 octave
    pub over_quarter: f64,
    pub over_half: f64,
    /// Share of the centroid's modulation power (0.3 to 30 Hz) within 3 % of its strongest rate
    pub top_rate: f64,
    /// Autocorrelation of the centroid 1/8 and 1 bar apart
    pub ac_eighth: f64,
    pub ac_bar: f64,
    /// Median centroid (Hz)
    pub centroid: f64,
}

/// A 2nd-order section (direct form, for the band pass run both ways).
#[derive(Clone, Copy)]
struct Biquad {
    b: [f64; 3],
    a: [f64; 2],
}

impl Biquad {
    /// Butterworth-style low or high pass section at `f` with quality `q` (bilinear transform).
    fn new(f: f64, q: f64, sr: f64, high: bool) -> Self {
        let w = 2.0 * PI * f / sr;
        let (s, c) = (w.sin(), w.cos());
        let alpha = s / (2.0 * q);
        let a0 = 1.0 + alpha;
        let b = if high { [(1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0] } else { [(1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0] };
        Biquad { b: [b[0] / a0, b[1] / a0, b[2] / a0], a: [-2.0 * c / a0, (1.0 - alpha) / a0] }
    }
    fn run(&self, x: &mut [f64]) {
        let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
        for v in x.iter_mut() {
            let y = self.b[0] * *v + self.b[1] * x1 + self.b[2] * x2 - self.a[0] * y1 - self.a[1] * y2;
            x2 = x1;
            x1 = *v;
            y2 = y1;
            y1 = y;
            *v = y;
        }
    }
}

/// The 4th-order Butterworth band pass 100 Hz to 4 kHz, forwards and backwards (no phase shift),
/// as scipy's sosfiltfilt does it.
fn band(x: &[f32], sr: f64) -> Vec<f64> {
    let qs = [0.541_196_1, 1.306_563];
    let mut v: Vec<f64> = x.iter().map(|&s| s as f64).collect();
    let stages: Vec<Biquad> = qs.iter().map(|&q| Biquad::new(100.0, q, sr, true)).chain(qs.iter().map(|&q| Biquad::new(4000.0, q, sr, false))).collect();
    for st in &stages {
        st.run(&mut v);
    }
    v.reverse();
    for st in &stages {
        st.run(&mut v);
    }
    v.reverse();
    v
}

/// The centroid of 100 Hz..4 kHz per STFT frame (2048 points, hop 256, Hann), and the frames'
/// centre times.
fn centroids(x: &[f64], sr: f64) -> (Vec<f64>, Vec<f64>) {
    const N: usize = 2048;
    const HOP: usize = 256;
    let win: Vec<f64> = (0..N).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / N as f64).cos()).collect();
    let bins: Vec<usize> = (0..N / 2).filter(|&k| {
        let f = k as f64 * sr / N as f64;
        (100.0..=4000.0).contains(&f)
    }).collect();
    let cos: Vec<Vec<f64>> = bins.iter().map(|&k| (0..N).map(|i| (2.0 * PI * (k * i % N) as f64 / N as f64).cos()).collect()).collect();
    let sin: Vec<Vec<f64>> = bins.iter().map(|&k| (0..N).map(|i| (2.0 * PI * (k * i % N) as f64 / N as f64).sin()).collect()).collect();
    let mut cen = vec![];
    let mut times = vec![];
    let mut start = 0;
    let mut frame = vec![0.0; N];
    while start + N <= x.len() {
        for i in 0..N {
            frame[i] = x[start + i] * win[i];
        }
        let (mut num, mut den) = (0.0, 0.0);
        for (j, &k) in bins.iter().enumerate() {
            let (mut re, mut im) = (0.0, 0.0);
            for i in 0..N {
                re += frame[i] * cos[j][i];
                im += frame[i] * sin[j][i];
            }
            let p = re * re + im * im;
            num += k as f64 * sr / N as f64 * p;
            den += p;
        }
        cen.push(num / (den + 1e-12));
        times.push((start + N / 2) as f64 / sr);
        start += HOP;
    }
    (cen, times)
}

fn median(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        0.5 * (v[n / 2 - 1] + v[n / 2])
    }
}

/// Measure `mono` (a riff of 16ths starting at 0) at `bpm`.
pub fn movement(mono: &[f32], sr: f32, bpm: f32) -> Movement {
    let sr = sr as f64;
    let beat = 60.0 / bpm as f64;
    let six = beat / 4.0;
    let x = band(mono, sr);
    let (cen, t) = centroids(&x, sr);
    if cen.len() < 8 {
        return Movement::default();
    }
    // Per 16th: the geometric mean of its frames' centroids (away from its edges)
    let last = *t.last().unwrap();
    let mut cs = vec![];
    let mut a = 0.0;
    while a < last - six {
        let sel: Vec<f64> = cen.iter().zip(t.iter()).filter(|(_, &tt)| tt >= a + 0.01 && tt < a + six - 0.005).map(|(c, _)| c.max(1e-9).ln()).collect();
        if !sel.is_empty() {
            cs.push((sel.iter().sum::<f64>() / sel.len() as f64).exp());
        }
        a += six;
    }
    let dc: Vec<f64> = cs.windows(2).map(|w| (w[1] / w[0]).log2().abs()).collect();
    let share = |lim: f64| dc.iter().filter(|&&d| d > lim).count() as f64 / dc.len().max(1) as f64;
    // The centroid's modulation spectrum (log2, detrended, Hann), 0.3 to 30 Hz
    let n = cen.len();
    let lc: Vec<f64> = cen.iter().map(|c| c.max(1e-9).log2()).collect();
    let (mx, my) = ((n as f64 - 1.0) / 2.0, lc.iter().sum::<f64>() / n as f64);
    let sxy: f64 = lc.iter().enumerate().map(|(i, y)| (i as f64 - mx) * (y - my)).sum();
    let sxx: f64 = (0..n).map(|i| (i as f64 - mx).powi(2)).sum();
    let slope = sxy / sxx;
    let det: Vec<f64> = lc.iter().enumerate().map(|(i, y)| y - my - slope * (i as f64 - mx)).collect();
    let fps = sr / 256.0;
    let hann: Vec<f64> = (0..n).map(|i| if n > 1 { 0.5 - 0.5 * (2.0 * PI * i as f64 / (n - 1) as f64).cos() } else { 1.0 }).collect();
    let nf = n / 2 + 1;
    let fr: Vec<f64> = (0..nf).map(|k| k as f64 * fps / n as f64).collect();
    let spec: Vec<f64> = (0..nf)
        .map(|k| {
            let (mut re, mut im) = (0.0, 0.0);
            for i in 0..n {
                let ph = 2.0 * PI * (k * i % n) as f64 / n as f64;
                re += det[i] * hann[i] * ph.cos();
                im -= det[i] * hann[i] * ph.sin();
            }
            re * re + im * im
        })
        .collect();
    let inside = |f: f64| f > 0.3 && f < 30.0;
    let masked: Vec<f64> = spec.iter().zip(fr.iter()).map(|(s, &f)| if inside(f) { *s } else { 0.0 }).collect();
    let tot: f64 = masked.iter().sum();
    let order = 2usize.max((0.15 / fr[1]) as usize);
    // Local maxima (strictly greater than `order` neighbours each side), the strongest
    let mut top = None;
    for i in 0..nf {
        let lo = i.saturating_sub(order);
        let hi = (i + order).min(nf - 1);
        if i < order || i + order >= nf {
            continue;
        }
        if (lo..=hi).all(|j| j == i || masked[i] > masked[j]) && top.is_none_or(|t: usize| masked[i] > masked[t]) {
            top = Some(i);
        }
    }
    let i0 = top.unwrap_or(0);
    let conc: f64 = spec.iter().zip(fr.iter()).filter(|(_, &f)| f > fr[i0] * 0.97 && f < fr[i0] * 1.03).map(|(s, _)| s).sum::<f64>() / tot.max(1e-30);
    // Autocorrelation at musical lags (of the detrended centroid)
    let lmean = det.iter().sum::<f64>() / n as f64;
    let sd = (det.iter().map(|v| (v - lmean).powi(2)).sum::<f64>() / n as f64).sqrt() + 1e-9;
    let z: Vec<f64> = det.iter().map(|v| (v - lmean) / sd).collect();
    let ac = |secs: f64| {
        let lag = (secs * fps).round() as usize;
        if lag >= n {
            return f64::NAN;
        }
        (0..n - lag).map(|i| z[i + lag] * z[i]).sum::<f64>() / (n - lag) as f64
    };
    let mut d2 = dc.clone();
    let mut c2 = cen.clone();
    Movement { jump: median(&mut d2), over_quarter: share(0.25), over_half: share(0.5), top_rate: conc, ac_eighth: ac(2.0 * six), ac_bar: ac(4.0 * beat), centroid: median(&mut c2) }
}

/// A sound's band balance, as the hit check measures a mix's (dB of the total), and the parts a
/// bright preset is judged by: see `balance`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Balance {
    /// Sub (under 60 Hz), low (60-250), low mids (250-1k), mids (1-4k), presence (4-8k), air (8k+)
    pub bands: [f64; 6],
    /// Presence and air against everything over 100 Hz (the part a growl's top is heard against,
    /// its sub left out)
    pub presence: f64,
    pub air: f64,
    /// The side against the middle under 150 Hz (dB)
    pub side_low: f64,
    /// The tallest 1/24-octave peak over 1-12 kHz above the octave around it (dB): a harsh
    /// resonance shows as a tall one
    pub peak: f64,
}

/// In-place radix-2 FFT (`re.len()` a power of two).
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * PI / len as f64;
        for s in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (wr, wi) = ((ang * k as f64).cos(), (ang * k as f64).sin());
                let (a, b) = (s + k, s + k + len / 2);
                let (xr, xi) = (re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr);
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
            }
        }
        len <<= 1;
    }
}

/// The long-term power spectrum of `x` (Welch: 4096-point Hann frames, half overlapping).
fn spectrum(x: &[f32]) -> Vec<f64> {
    const N: usize = 4096;
    let win: Vec<f64> = (0..N).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / N as f64).cos()).collect();
    let mut acc = vec![0.0; N / 2];
    let mut start = 0;
    while start + N <= x.len() {
        let mut re: Vec<f64> = (0..N).map(|i| x[start + i] as f64 * win[i]).collect();
        let mut im = vec![0.0; N];
        fft(&mut re, &mut im);
        for k in 0..N / 2 {
            acc[k] += re[k] * re[k] + im[k] * im[k];
        }
        start += N / 2;
    }
    acc
}

/// Measure the band balance of a stereo sound (`l`, `r` at `sr`).
pub fn balance(l: &[f32], r: &[f32], sr: f32) -> Balance {
    let mid: Vec<f32> = l.iter().zip(r).map(|(a, b)| 0.5 * (a + b)).collect();
    let side: Vec<f32> = l.iter().zip(r).map(|(a, b)| 0.5 * (a - b)).collect();
    let (sm, ss) = (spectrum(&mid), spectrum(&side));
    let bin = sr as f64 / 4096.0;
    let sum = |s: &[f64], lo: f64, hi: f64| s.iter().enumerate().filter(|(k, _)| (lo..hi).contains(&(*k as f64 * bin))).map(|(_, v)| v).sum::<f64>();
    // (Middle and side together: left plus right power)
    let both: Vec<f64> = sm.iter().zip(&ss).map(|(a, b)| a + b).collect();
    let db = |x: f64| 10.0 * x.max(1e-30).log10();
    let total = sum(&both, 20.0, 20000.0);
    let over100 = sum(&both, 100.0, 20000.0);
    let edges = [20.0, 60.0, 250.0, 1000.0, 4000.0, 8000.0, 20000.0];
    let bands = std::array::from_fn(|i| db(sum(&both, edges[i], edges[i + 1]) / total));
    // Power per Hz in 1/24 octave, against the octave around it
    let (a, w) = (2f64.powf(1.0 / 48.0), 2f64.sqrt());
    let mut peak = f64::NEG_INFINITY;
    let mut f = 1000.0;
    while f < 12000.0 {
        let narrow = sum(&both, f / a, f * a) / (f * (a - 1.0 / a));
        let wide = sum(&both, f / w, f * w) / (f * (w - 1.0 / w));
        peak = peak.max(db(narrow / wide));
        f *= a;
    }
    Balance {
        bands,
        presence: db(sum(&both, 4000.0, 8000.0) / over100),
        air: db(sum(&both, 8000.0, 20000.0) / over100),
        side_low: db(sum(&ss, 20.0, 150.0) / sum(&sm, 20.0, 150.0)),
        peak,
    }
}
