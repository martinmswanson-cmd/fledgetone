/**
 * A hearing: the sound report of some audio and, when asked, its set of pictures (an overview
 * spectrogram, detail spectrograms of each stretch, the stereo side signal, the level, the spectrum,
 * the pitch classes and close-ups of each fault and of moments asked for), named for where they are
 * in the song. Also the shape of a hearing saved to a file, and its check. Pure code on samples.
 */
import { cleaned, hearSound, type HearOptions } from './hearSound';
import {
  axisFor,
  chromaPicture,
  closeUpPicture,
  levelPicture,
  middleOf,
  rangeText,
  sideOf,
  spectrogramPictures,
  spectrumPicture,
  type BarSpan,
  type Picture,
} from './pictures';
import type { Fault, Place, SoundReport } from './types';

export interface HearingOptions extends HearOptions {
  bars?: readonly BarSpan[];
  closeUps?: readonly number[];
  pictures?: boolean;
  prefix?: string;
  small?: boolean;
  against?: { sound: SoundReport; label: string };
}
export interface Hearing {
  sound: SoundReport;
  pictures: Picture[];
}

/** The version of the saved hearing file's shape. */
export const HEARING_FILE = 1;
export interface SavedHearing {
  fledgetoneHearing: typeof HEARING_FILE;
  of: string;
  range: { fromSeconds: number; toSeconds: number; fromBar?: number; toBar?: number };
  sound: SoundReport;
}

/** The longest stretch a hearing takes, in seconds. */
export const MAX_HEAR_SECONDS = 900;
/** A detail spectrogram covers this many bars, or, without bars, this many seconds. */
export const DETAIL_BARS = 8;
export const DETAIL_SECONDS = 30;
/** At most this many detail spectrograms (spread evenly over the range when there would be more). */
export const MAX_DETAILS = 12;
/** At most this many close-ups of faults, and as many again of moments asked for. */
export const MAX_CLOSE_UPS = 6;

/** Faults are placed to the ms, so a time this close before a bar or beat counts as on it. */
const ROUNDING = 0.0005;

/** Where `seconds` falls in the bars: the bar it is in and its beat (1 plus the whole part of the bar's fraction times its beats). */
function placeIn(bars: readonly BarSpan[]): (seconds: number) => Place {
  return (seconds) => {
    const s = seconds + ROUNDING;
    const bar = bars.find((b, i) => s >= b.start && (s < b.end || (i === bars.length - 1 && seconds <= b.end)));
    if (!bar || !(bar.end > bar.start)) return { seconds };
    const beat = Math.min(bar.beats, 1 + Math.floor(((s - bar.start) / (bar.end - bar.start)) * bar.beats));
    return { seconds, bar: bar.bar, beat };
  };
}

const placeWords = (p: Place) => (p.bar !== undefined && p.beat !== undefined ? `bar ${p.bar}, beat ${p.beat}` : `${p.seconds.toFixed(2)} s`);
const placeName = (p: Place) => (p.bar !== undefined && p.beat !== undefined ? `closeup-bar-${p.bar}-beat-${p.beat}` : `closeup-${p.seconds.toFixed(2)}s`);
const FAULT_WORDS: Record<Fault['kind'], string> = { click: 'a click', clipping: 'clipping', dc: 'a DC offset', hum: 'hum', silence: 'digital silence', channel: 'a channel fault' };
/** `5m30` for 330 s. */
const minutesName = (seconds: number) => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
};

/** At most `most` of `items`, spread evenly from the first to the last. */
function spread<T>(items: readonly T[], most: number): T[] {
  if (items.length <= most) return [...items];
  return Array.from({ length: most }, (_, i) => items[Math.round((i * (items.length - 1)) / (most - 1))]);
}

/** The detail stretches of a range: every DETAIL_BARS bars, or every DETAIL_SECONDS without bars. */
function detailsOf(seconds: number, bars: readonly BarSpan[] | undefined): Array<{ from: number; to: number; name: string }> {
  const out: Array<{ from: number; to: number; name: string }> = [];
  if (bars && bars.length > 0) {
    const inside = bars.filter((b) => b.start < seconds && b.end > 0);
    if (inside.length > DETAIL_BARS) {
      for (let i = 0; i < inside.length; i += DETAIL_BARS) {
        const group = inside.slice(i, i + DETAIL_BARS);
        const last = group[group.length - 1];
        out.push({ from: group[0].start, to: Math.min(seconds, last.end), name: `spectrogram-bars-${group[0].bar}-${last.bar}` });
      }
    }
  } else if (seconds > DETAIL_SECONDS) {
    for (let from = 0; from < seconds; from += DETAIL_SECONDS) {
      const to = Math.min(seconds, from + DETAIL_SECONDS);
      out.push({ from, to, name: `spectrogram-${minutesName(from)}-${minutesName(to)}` });
    }
  }
  return spread(out, MAX_DETAILS);
}

/** The sound report of `channels` (one or two) and, with `pictures`, its pictures, named and in a fixed order. */
export function hearingOf(channels: readonly Float32Array[], sampleRate: number, opts: HearingOptions): Hearing {
  const { bars, closeUps, pictures, prefix = '', small, against, ...hear } = opts;
  const place = bars && bars.length > 0 ? placeIn(bars) : opts.place;
  const sound = hearSound(channels, sampleRate, place ? { ...hear, place } : hear);
  if (!pictures) return { sound, pictures: [] };

  // draw from what hearSound measured: at most two channels, NaN and Infinity as 0
  const heard = cleaned(channels.slice(0, 2));
  if (heard.length === 0) heard.push(new Float32Array(0));
  const stereo = heard.length >= 2;
  const length = heard[0].length;
  const seconds = length / sampleRate;
  const mid = stereo ? middleOf(heard[0], heard[1]) : heard[0];
  const out: Picture[] = [];
  const named = (name: string) => `${prefix}${name}`;
  const whole = axisFor(0, seconds, bars);
  const quiet = sound.silent || length === 0;

  const overview = { name: named('spectrogram'), title: `Spectrogram: ${rangeText(whole)}` };
  const side = stereo && !quiet && !small ? { name: named('stereo'), title: `Stereo side signal: ${rangeText(whole)}`, kind: 'stereo' as const } : null;
  const [spectrogram, stereoPicture] = spectrogramPictures(mid, side ? sideOf(heard[0], heard[1]) : null, sampleRate, whole, overview, side);
  out.push(spectrogram);
  const spectrum = () => {
    if (!sound.tone) return;
    const other = against?.sound.tone ? { spectrum: against.sound.tone.spectrum, label: against.label } : null;
    out.push(spectrumPicture(sound.tone.spectrum, 'this sound', other, named('spectrum'), { fromSeconds: 0, toSeconds: seconds }));
  };
  if (small) {
    spectrum();
    return { sound, pictures: out };
  }
  if (quiet) {
    out.push(levelPicture(heard, sampleRate, whole, sound.along.lufs, named('level')));
    return { sound, pictures: out };
  }

  for (const d of detailsOf(seconds, bars)) {
    const axis = axisFor(d.from, d.to, bars);
    out.push(...spectrogramPictures(mid, null, sampleRate, axis, { name: named(d.name), title: `Spectrogram: ${rangeText(axis)}` }, null));
  }
  if (stereoPicture) out.push(stereoPicture);
  out.push(levelPicture(heard, sampleRate, whole, sound.along.lufs, named('level')));
  spectrum();
  if (sound.along.chroma.length > 0) out.push(chromaPicture(sound.along.chroma, sound.along.stepSeconds, whole, named('chroma')));

  const taken = new Set(out.map((p) => p.name));
  const closeUp = (at: Place, where: string) => {
    let name = named(placeName(at));
    for (let k = 2; taken.has(name); k++) name = `${named(placeName(at))}-${k}`;
    taken.add(name);
    out.push(closeUpPicture(heard, sampleRate, at.seconds, where, name));
  };
  const placeOf = (s: number): Place => (place ? place(s) : { seconds: s });
  for (const f of sound.faults.filter((f) => f.seconds !== null).slice(0, MAX_CLOSE_UPS)) {
    const at = f.at ?? placeOf(f.seconds as number);
    closeUp(at, `${FAULT_WORDS[f.kind]} at ${placeWords(at)}`);
  }
  for (const s of (closeUps ?? []).filter(Number.isFinite).slice(0, MAX_CLOSE_UPS)) {
    const at = placeOf(s);
    closeUp(at, placeWords(at));
  }
  return { sound, pictures: out };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A saved hearing read back from JSON; throws Error('not a saved hearing') on any other shape or version. */
export function parseSavedHearing(json: unknown): SavedHearing {
  const refuse = () => new Error('not a saved hearing');
  if (!isObject(json) || json.fledgetoneHearing !== HEARING_FILE || typeof json.of !== 'string') throw refuse();
  const { range, sound } = json;
  if (!isObject(range) || !isNumber(range.fromSeconds) || !isNumber(range.toSeconds)) throw refuse();
  if ((range.fromBar !== undefined && !isNumber(range.fromBar)) || (range.toBar !== undefined && !isNumber(range.toBar))) throw refuse();
  if (!isObject(sound) || !isObject(sound.versions) || !isObject(sound.along) || !isNumber(sound.seconds) || !Array.isArray(sound.faults) || !Array.isArray(sound.words)) throw refuse();
  return json as unknown as SavedHearing;
}
