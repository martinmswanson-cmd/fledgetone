/**
 * The plain-word lines of the hearing sound report: one line for each finding that applies, in the
 * order tone, texture, movement, dynamics, attack, stereo, pitch, register, then one line per
 * fault. The lines describe what the numbers say; none of them scores a sound as good or bad. Pure
 * text, no Web Audio, so Node can test it.
 */
import { LOW_SIDE_LIMIT_DB } from '../mixCheck';
import { MOVEMENT_BANDS } from './movement';
import type { Fault, Modulation, Place, SoundReport } from './types';

export const one = (x: number) => (Object.is(Math.round(x * 10) / 10, -0) ? 0 : x).toFixed(1);
export const two = (x: number) => (Object.is(Math.round(x * 100) / 100, -0) ? 0 : x).toFixed(2);
export const signed = (x: number) => (x >= 0 ? `+${one(x)}` : one(x));
export const percent = (share: number) => `${Math.round(share * 100)}%`;

/** "650 Hz", "3.1 kHz" */
export function freqText(hz: number): string {
  const whole = Math.round(hz);
  return whole >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${whole} Hz`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The nearest equal-tempered note to `hz`, with its octave (A4 = 440 Hz): "C4", "F#5". */
export function noteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** A band's range: "40-250 Hz", "250 Hz-4 kHz", "4-16 kHz" */
function rangeText(lo: number, hi: number): string {
  const k = (x: number) => String(x / 1000);
  if (hi < 1000) return `${lo}-${hi} Hz`;
  if (lo >= 1000) return `${k(lo)}-${k(hi)} kHz`;
  return `${lo} Hz-${k(hi)} kHz`;
}

/**
 * A moment in a file, as a person reads it wherever one is written (the words, a picture's title and
 * its `shows`): minutes, seconds and hundredths, "0:26.53", so two moments 50 ms apart read differently.
 */
export function momentText(seconds: number): string {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const rest = hundredths - minutes * 6000;
  return `${minutes}:${String(Math.floor(rest / 100)).padStart(2, '0')}.${String(rest % 100).padStart(2, '0')}`;
}

/**
 * "bar 9, beat 3" when the place has a bar (with "(measure 12, beat 1 on the ruler)" where the ruler
 * counts otherwise), else the moment: "0:12.50".
 */
export function placeText(p: Place): string {
  if (p.bar !== undefined) {
    const at = p.beat !== undefined ? `bar ${p.bar}, beat ${p.beat}` : `bar ${p.bar}`;
    return p.ruler ? `${at} (measure ${p.ruler.measure}, beat ${p.ruler.beat} on the ruler)` : at;
  }
  return momentText(p.seconds);
}

/**
 * A fault in one line, ending with a full stop: its detail, and where it is when it has a place. Clipping
 * says where it first is (it runs on from there); digital silence says where it ends, or for how long it
 * lasts where places are bars and beats.
 */
export function faultWords(f: Fault): string {
  if (!f.at) return `${f.detail}.`;
  const where = placeText(f.at);
  if (f.kind === 'clipping') return `${f.detail}, ${f.count !== undefined && f.count > 1 ? 'first ' : ''}at ${where}.`;
  if (f.kind === 'silence' && f.seconds !== null && f.endSeconds !== undefined) {
    if (f.at.bar === undefined) return `${f.detail} from ${where} to ${momentText(f.endSeconds)}.`;
    return `${f.detail} for ${Math.round((f.endSeconds - f.seconds) * 1000)} ms from ${where}.`;
  }
  // (a detail with a clause of its own, "A click, a jump of -5.8 dBFS", closes it before the place)
  return `${f.detail}${f.detail.includes(',') ? ',' : ''} at ${where}.`;
}

function modulationWords(m: Modulation): string {
  const [lo, hi] = MOVEMENT_BANDS[m.band];
  const note = m.note ? ` (${m.note} notes)` : '';
  return `The ${m.band} band (${rangeText(lo, hi)}) moves at ${one(m.hz)} Hz${note}, ${one(m.depthDb)} dB deep.`;
}

/** Shorter than this, seconds, a sound is not called busy or sparse. */
const BUSY_MIN_SECONDS = 2;
/** Under this correlation the channels are more out of phase than in. */
const OUT_OF_PHASE = -0.1;
/** Up to this flatness a sound is pitched enough to have a key and a tuning. */
const PITCHED_FLATNESS = 0.15;

/** A key's short name ("C maj", "A min") written out. */
const keyText = (name: string) => name.replace(/ maj$/, ' major').replace(/ min$/, ' minor');

/** One line for each finding of the report that applies, then one for each fault. */
export function soundWords(r: Omit<SoundReport, 'words'>): string[] {
  const out: string[] = [];
  const { tone, texture, movement, dynamics, attack, stereo, pitch, register } = r;

  if (tone) {
    if (tone.centreHz > 3000) out.push(`The spectral centre sits at ${freqText(tone.centreHz)}: bright.`);
    // (a centre of 0 is no centre: nothing sounds between 20 Hz and 20 kHz)
    else if (tone.centreHz > 0 && tone.centreHz < 700) out.push(`The spectral centre sits at ${freqText(tone.centreHz)}: dark.`);
    if (tone.tiltDbPerOctave > 1) out.push(`Its weight is toward the top (${signed(tone.tiltDbPerOctave)} dB an octave).`);
    else if (tone.tiltDbPerOctave < -3) out.push(`Its weight is toward the bottom (${signed(tone.tiltDbPerOctave)} dB an octave).`);
    if (tone.subVsBassDb > 3) out.push(`Sub bass stands ${one(tone.subVsBassDb)} dB over the bass.`);
    else if (tone.subVsBassDb < -12) out.push(`There is little sub bass (${one(-tone.subVsBassDb)} dB under the bass).`);
    // The three that stand out most, then the rest in one line
    const peaks = tone.peaks.map((p, i) => ({ p, i })).sort((a, b) => b.p.overDb - a.p.overDb || a.i - b.i).map(({ p }) => p);
    for (const p of peaks.slice(0, 3)) {
      out.push(`A narrow peak at ${freqText(p.hz)} stands ${one(p.overDb)} dB over its surroundings (a resonance, or a held note).`);
    }
    const more = peaks.slice(3);
    if (more.length > 0) out.push(`${more.length} more narrow peak${more.length === 1 ? '' : 's'}: ${more.map((p) => freqText(p.hz)).join(', ')}.`);
  }

  if (texture) {
    if (texture.flatness > 0.3) out.push(`Noisy (flatness ${two(texture.flatness)}).`);
    else if (texture.flatness < 0.02) out.push(`Tonal (flatness ${two(texture.flatness)}).`);
    if (texture.roughness > 0.35) out.push(`Rough: fast beating inside its bands (roughness ${two(texture.roughness)}); distortion, notes close together and noise all read this way.`);
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
      // (said as what is measured: ducking to a kick and parts that play on the beat move the band alike)
      if (m.band === 'mid' && m.note === '1/4' && m.depthDb >= 3) out.push(`The mid band dips and returns on the beat (${one(m.depthDb)} dB): sidechain pumping and parts played on the beat both read this way.`);
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
    const hit = attack.single;
    if (hit) {
      // One hit: what was measured of it (its loudest 10 ms is K-weighted, how loud it hits; not its sample peak)
      const parts = [
        ...(Number.isFinite(hit.riseMs) ? [`rises in ${one(hit.riseMs)} ms`] : []),
        ...(Number.isFinite(hit.fall20Ms) ? [`falls 20 dB in ${one(hit.fall20Ms)} ms`] : []),
        ...(Number.isFinite(hit.peakDb) ? [`its loudest 10 ms reads ${one(hit.peakDb)} dB`] : []),
      ];
      out.push(parts.length ? `A single hit: ${parts.join(', ')}.` : 'A single hit.');
    } else if (attack.riseMs !== null) {
      if (attack.riseMs < 5) out.push(`Sharp attacks (${one(attack.riseMs)} ms).`);
      else if (attack.riseMs > 40) out.push(`Soft attacks (${one(attack.riseMs)} ms).`);
    }
    // (a rate of onsets says little of a sound under 2 seconds: one hit in 80 ms is not 12.5 a second)
    if (!hit && r.seconds >= BUSY_MIN_SECONDS) {
      if (attack.onsetsPerSecond > 8) out.push(`Busy (${one(attack.onsetsPerSecond)} onsets a second).`);
      else if (attack.onsetsPerSecond < 1) out.push(`Sparse (${one(attack.onsetsPerSecond)} onsets a second).`);
    }
  }

  if (stereo) {
    // (uncorrelated channels read a little either side of 0: out of phase is said only well under it)
    if (stereo.correlation < OUT_OF_PHASE) out.push(`More out of phase than in (correlation ${two(stereo.correlation)}).`);
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
    // A key and a tuning are said of a pitched sound whose key is sure enough (noise has a strongest pitch
    // class too, and a "tuning"), and not of a song, whose own key is known
    const pitched = texture === undefined || texture.flatness <= PITCHED_FLATNESS;
    const sure = pitch.key === null || pitch.key.confidence >= 0.5;
    const guessed = pitched && sure && r.settings.knownKey === undefined;
    if (pitch.key && guessed) out.push(`Sounds in ${keyText(pitch.key.name)} (or ${keyText(pitch.key.runnerUp)}).`);
    if (pitch.tuningCents !== null && Math.abs(pitch.tuningCents) > 10 && guessed) {
      out.push(`Tuned ${Math.abs(pitch.tuningCents)} cents ${pitch.tuningCents > 0 ? 'sharp' : 'flat'} of A440.`);
    }
  }

  if (register) {
    const [low, high] = [noteName(register.lowHz), noteName(register.highHz)];
    // (one note from low to high is said as one place)
    if (low === high) out.push(`Its pitched parts sit at ${low} (${freqText(register.centreHz)}).`);
    else out.push(`Its pitched parts sit between ${low} and ${high} (${freqText(register.lowHz)} to ${freqText(register.highHz)}), centred near ${noteName(register.centreHz)}.`);
    if (register.topHz !== null) out.push(`The top line sits around ${noteName(register.topHz)}.`);
  }

  for (const f of r.faults) out.push(faultWords(f));
  return out;
}
