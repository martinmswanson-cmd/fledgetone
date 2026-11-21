/**
 * The plain-word lines of the hearing sound report: one line for each finding that applies, in the
 * order tone, texture, movement, dynamics, attack, stereo, pitch, then one line per fault. The
 * lines describe what the numbers say; none of them scores a sound as good or bad. Pure text, no
 * Web Audio, so Node can test it.
 */
import { LOW_SIDE_LIMIT_DB } from '../mixCheck';
import { MOVEMENT_BANDS } from './movement';
import type { Modulation, Place, SoundReport } from './types';

const one = (x: number) => (Object.is(Math.round(x * 10) / 10, -0) ? 0 : x).toFixed(1);
const two = (x: number) => (Object.is(Math.round(x * 100) / 100, -0) ? 0 : x).toFixed(2);
const signed = (x: number) => (x >= 0 ? `+${one(x)}` : one(x));
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** "650 Hz", "3.1 kHz" */
function freqText(hz: number): string {
  const whole = Math.round(hz);
  return whole >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${whole} Hz`;
}

/** A band's range: "40-250 Hz", "250 Hz-4 kHz", "4-16 kHz" */
function rangeText(lo: number, hi: number): string {
  const k = (x: number) => String(x / 1000);
  if (hi < 1000) return `${lo}-${hi} Hz`;
  if (lo >= 1000) return `${k(lo)}-${k(hi)} kHz`;
  return `${lo} Hz-${k(hi)} kHz`;
}

/** "bar 9, beat 3" when the place has a bar, else minutes and seconds: "0:12.5". */
export function placeText(p: Place): string {
  if (p.bar !== undefined) return p.beat !== undefined ? `bar ${p.bar}, beat ${p.beat}` : `bar ${p.bar}`;
  const tenths = Math.round(Math.max(0, p.seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds.toFixed(1)}`;
}

function modulationWords(m: Modulation): string {
  const [lo, hi] = MOVEMENT_BANDS[m.band];
  const note = m.note ? ` (${m.note} notes)` : '';
  return `The ${m.band} band (${rangeText(lo, hi)}) moves at ${one(m.hz)} Hz${note}, ${one(m.depthDb)} dB deep.`;
}

/** A key's short name ("C maj", "A min") written out. */
const keyText = (name: string) => name.replace(/ maj$/, ' major').replace(/ min$/, ' minor');

/** One line for each finding of the report that applies, then one for each fault. */
export function soundWords(r: Omit<SoundReport, 'words'>): string[] {
  const out: string[] = [];
  const { tone, texture, movement, dynamics, attack, stereo, pitch } = r;

  if (tone) {
    if (tone.centreHz > 3000) out.push(`The spectral centre sits at ${freqText(tone.centreHz)}: bright.`);
    else if (tone.centreHz < 700) out.push(`The spectral centre sits at ${freqText(tone.centreHz)}: dark.`);
    if (tone.tiltDbPerOctave > 1) out.push(`Its weight is toward the top (${signed(tone.tiltDbPerOctave)} dB an octave).`);
    else if (tone.tiltDbPerOctave < -3) out.push(`Its weight is toward the bottom (${signed(tone.tiltDbPerOctave)} dB an octave).`);
    if (tone.subVsBassDb > 3) out.push(`Sub bass stands ${one(tone.subVsBassDb)} dB over the bass.`);
    else if (tone.subVsBassDb < -12) out.push(`There is little sub bass (${one(-tone.subVsBassDb)} dB under the bass).`);
    for (const p of tone.peaks) {
      out.push(`A narrow peak at ${freqText(p.hz)} stands ${one(p.overDb)} dB over its surroundings (a resonance, or a held note).`);
    }
  }

  if (texture) {
    if (texture.flatness > 0.3) out.push(`Noisy (flatness ${two(texture.flatness)}).`);
    else if (texture.flatness < 0.02) out.push(`Tonal (flatness ${two(texture.flatness)}).`);
    if (texture.roughness > 0.35) out.push(`Gritty: fast beating inside its bands (roughness ${two(texture.roughness)}).`);
    else if (texture.roughness < 0.08) out.push(`Smooth (roughness ${two(texture.roughness)}).`);
    if (texture.percussiveShare > 0.6) out.push(`Mostly hits (${percent(texture.percussiveShare)} percussive).`);
    else if (texture.percussiveShare < 0.15) out.push(`Mostly held sound (${percent(texture.percussiveShare)} percussive).`);
    if (texture.flatTops) {
      out.push(`Flat-topped peaks at ${one(texture.flatTops.levelDb)} dBFS on ${percent(texture.flatTops.share)} of it: clipped or hard-limited before this point.`);
    }
  }

  if (movement) {
    for (const m of movement.modulations) out.push(modulationWords(m));
    for (const m of movement.modulations) {
      if (m.band === 'mid' && m.note === '1/4' && m.depthDb >= 3) out.push(`It pumps on the beat (${one(m.depthDb)} dB in the mid band).`);
    }
    if (movement.modulations.length === 0 && movement.changeDb < 0.3) out.push('Static: its spectrum barely changes.');
  }

  if (dynamics) {
    if (dynamics.crestDb !== null) {
      if (dynamics.crestDb < 6) out.push(`Squashed (crest ${one(dynamics.crestDb)} dB).`);
      else if (dynamics.crestDb > 14) out.push(`Open (crest ${one(dynamics.crestDb)} dB).`);
    }
    if (dynamics.rangeLu !== null) {
      if (dynamics.rangeLu < 3) out.push(`One level throughout (range ${one(dynamics.rangeLu)} LU).`);
      else if (dynamics.rangeLu > 10) out.push(`Wide swings in level (range ${one(dynamics.rangeLu)} LU).`);
    }
  }

  if (attack) {
    if (attack.riseMs !== null) {
      if (attack.riseMs < 5) out.push(`Sharp attacks (${one(attack.riseMs)} ms).`);
      else if (attack.riseMs > 40) out.push(`Soft attacks (${one(attack.riseMs)} ms).`);
    }
    if (attack.onsetsPerSecond > 8) out.push(`Busy (${one(attack.onsetsPerSecond)} onsets a second).`);
    else if (attack.onsetsPerSecond < 1) out.push(`Sparse (${one(attack.onsetsPerSecond)} onsets a second).`);
  }

  if (stereo) {
    if (stereo.correlation < 0) out.push(`More out of phase than in (correlation ${two(stereo.correlation)}).`);
    else if (stereo.correlation > 0.95) out.push(`Nearly mono (correlation ${two(stereo.correlation)}).`);
    else if (stereo.correlation < 0.3) out.push(`Very wide (correlation ${two(stereo.correlation)}).`);
    if (stereo.monoLossDb < -3) out.push(`Folding to mono loses ${one(-stereo.monoLossDb)} dB.`);
    if (stereo.lowSideDb > LOW_SIDE_LIMIT_DB) {
      const how = stereo.lowSideDb <= 0 ? `${one(-stereo.lowSideDb)} dB under` : `${one(stereo.lowSideDb)} dB over`;
      out.push(`The low end is wide (sides ${how} the middle below 120 Hz).`);
    }
    if (Math.abs(stereo.balanceDb) > 1.5) {
      const [louder, softer] = stereo.balanceDb > 0 ? ['Left', 'right'] : ['Right', 'left'];
      out.push(`${louder} is ${one(Math.abs(stereo.balanceDb))} dB louder than ${softer}.`);
    }
  }

  if (pitch) {
    if (pitch.tempo && !pitch.tempoKnown) {
      const alt = Math.round(pitch.tempo.alternative) !== Math.round(pitch.tempo.bpm) ? ` (or ${Math.round(pitch.tempo.alternative)})` : '';
      out.push(`About ${Math.round(pitch.tempo.bpm)} bpm${alt}.`);
    }
    if (pitch.key && pitch.key.confidence >= 0.5) out.push(`Sounds in ${keyText(pitch.key.name)} (or ${keyText(pitch.key.runnerUp)}).`);
    if (pitch.tuningCents !== null && Math.abs(pitch.tuningCents) > 10) {
      out.push(`Tuned ${Math.abs(pitch.tuningCents)} cents ${pitch.tuningCents > 0 ? 'sharp' : 'flat'} of A440.`);
    }
  }

  for (const f of r.faults) out.push(f.at ? `${f.detail} at ${placeText(f.at)}` : f.detail);
  return out;
}
