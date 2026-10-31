/**
 * The Mix check: what a render of the song and of each track says about the mix, in plain words,
 * with the track to look at where one is to blame. It looks for low end that isn't in the middle,
 * kick and bass fighting, muddy low mids, harsh upper mids, a level that's wrong for where the song
 * is going, a master section working too hard, and parts covering each other.
 *
 * Two steps, so the rules can be tuned on real songs: mixMetrics turns the measurements into
 * numbers, checkMix turns the numbers into findings. The thresholds were set on the starter songs
 * (balanced mixes that shouldn't be flagged) and on the same songs deliberately spoiled (a wide
 * bass, a boosted 300 Hz, a harsh 3 kHz, a part turned up over another). Pure: no Web Audio, so
 * Node tests it; mixCheckRun.ts does the rendering.
 */
import { INSTRUMENTS } from './instrumentCatalog';
import { midiOf } from '../store/noteTools';
import { detrended, levelBetween, sumDb, type BandSpectrum } from './mixAnalysis';
import type { Clip, Track } from '../store/timelineTypes';
import type { MasterStats } from './effects/masterAfter';
import { busChain } from '../store/buses';
import { padRoleOf } from '../store/grooveFeels';

/** What a track does in the mix, for knowing who to point at. */
export type TrackRole = 'drums' | 'bass' | 'vocal' | 'music';

/** A track's role from its instrument, name and notes. */
export function trackRole(track: Pick<Track, 'instrumentKey' | 'name' | 'id'>, clips: readonly Pick<Clip, 'trackId' | 'notes' | 'audio'>[] = []): TrackRole {
  const info = INSTRUMENTS[track.instrumentKey];
  const name = track.name.toLowerCase();
  if (info?.category === 'Drums & Percussion' || info?.kind === 'drums' || info?.kind === 'rack' || /\b(drums?|kick|snare|hats?|perc|beat)\b/.test(name)) return 'drums';
  if (/\b(vox|vocals?|voice|rap|sing(ing|er)?|choir|hook|adlibs?)\b/.test(name) || info?.category === 'Choir & Voices') return 'vocal';
  if (info?.category === 'Bass' || /\b(bass|808|sub)\b/.test(name)) return 'bass';
  const notes = clips.filter((c) => c.trackId === track.id && !c.audio).flatMap((c) => c.notes);
  if (notes.length >= 4) {
    const midis = notes.map((n) => midiOf(n.note)).filter(Number.isFinite).sort((a, b) => a - b);
    if (midis.length && midis[Math.floor(midis.length / 2)] < 45) return 'bass';
  }
  return 'music';
}

/**
 * What a track's clips with a measured feel and no part of their own play as (scheduler.ts
 * feelRole): a Drum Rack by its pads' names ("rack:kick,snare,perc..."), else its trackRole (from
 * its instrument, its name and the notes of all its clips). So a track's name, and its notes far
 * from a feel clip, can move how that clip plays (songDiff.ts counts it where those clips sound).
 */
export function feelPartOf(track: Pick<Track, 'instrumentKey' | 'name' | 'id' | 'rack'>, clips: readonly Pick<Clip, 'trackId' | 'notes' | 'audio'>[] = []): string {
  return INSTRUMENTS[track.instrumentKey]?.kind === 'rack' ? `rack:${(track.rack?.pads ?? []).map((p) => (p.soundId ? padRoleOf(p.name) : 'perc')).join(',')}` : trackRole(track, clips);
}

/** Whether a track is ducked to the kick already: a Pump on it or on a bus it plays through. */
export function duckedToKick(track: Track, tracks: readonly Track[]): boolean {
  return [track, ...busChain(track, tracks)].some((t) => t.fx.pump.on || !!t.duckProxy);
}

/** What was measured of one track's stem. */
export interface TrackMeasure {
  id: string;
  name: string;
  role: TrackRole;
  spectrum: BandSpectrum;
  /** Level of 40-140 Hz in 20 ms frames (linear). */
  lowEnv: Float32Array;
  /** Level of the whole sound in 20 ms frames (linear). */
  env: Float32Array;
  /** Ducked to the kick already (a Pump on it, or a sidechain): kick and bass then take turns. */
  ducked: boolean;
  /** Its instrument's category (see isBassLine). */
  category?: string;
}

/** What was measured of the whole mix. */
export interface MixMeasure {
  /** Integrated loudness, LUFS. */
  lufs: number;
  /** True peak, dBTP. */
  truePeakDb: number;
  spectrum: BandSpectrum;
  /** What the master section did (absent: bypassed). */
  stats?: MasterStats;
}

/** One thing the Mix check found. */
export interface Finding {
  id: 'lowSides' | 'kickBass' | 'mud' | 'harsh' | 'quiet' | 'loud' | 'limiter' | 'clipper' | 'masking';
  /** 'problem': worth fixing; 'note': worth a look. */
  level: 'problem' | 'note';
  title: string;
  detail: string;
  /** The tracks to look at, most to blame first. */
  trackIds: string[];
}

/** Low end centred: side power under 120 Hz against the middle's, dB, over which it's flagged (a note; a problem 3 dB over). */
export const LOW_SIDE_LIMIT_DB = -10.5;
/** Muddy: how far the 200-500 Hz bulge stands over the mix's own slope, dB (a note; a problem 1 dB over). */
export const MUD_LIMIT_DB = 5;
/** Harsh: how far 2-5 kHz stands over the mix's own slope, dB (a note; a problem 1.5 dB over). */
export const HARSH_LIMIT_DB = 5.5;
/**
 * Harsh, the other way: 2-5 kHz louder per band than 0.7-1.4 kHz by more than this, dB (a note
 * only: some styles are bright on purpose, a cowbell lead or distorted guitars).
 */
export const HARSH_TILT_DB = 2.5;
/**
 * Kick and bass fight when, at the kick's hits, the bass's 40-140 Hz level is between these against
 * the kick's (dB): about as loud, so neither wins. (Far louder, the bass simply leads, as in jazz
 * or a sustained synth bass; far quieter, they take turns, as a ducked or short 808 does.)
 */
export const CLASH_RANGE_DB: readonly [number, number] = [-2.5, 5];
/** Masking: the least share of a band each of two parts must have for them to be covering each other there. */
const MASK_SHARE = 0.3;

export interface MixMetrics {
  /** Side against middle power below 120 Hz, dB. */
  lowSideDb: number;
  /** The 200-500 Hz bulge over the slope, dB. */
  mudDb: number;
  /** The 2-5 kHz bulge over the slope, dB. */
  harshDb: number;
  /** 2-5 kHz against 0.7-1.4 kHz, per band, dB. */
  upperTiltDb: number;
  /**
   * For each kick (drums) and bass pair: the bass at the kick's hits against the kick, dB, how
   * often both sound, and where each one's low end peaks (Hz, 30-200).
   */
  clashes: Array<{ kickId: string; bassId: string; db: number; together: number; kickHz: number; bassHz: number }>;
  /** Pairs of parts covering each other: the bands where, and how much of the time both play. */
  masking: Array<{ a: string; b: string; lo: number; hi: number; bands: number; together: number }>;
  /** Who has the most low side energy, and their share of the mix's. */
  lowSideBlame: Array<{ id: string; share: number }>;
  mudBlame: Array<{ id: string; share: number }>;
  harshBlame: Array<{ id: string; share: number }>;
}

const power = (db: number) => 10 ** (db / 10);

/**
 * A bass line that can fight a kick: a bass instrument, or a track named as one. (A low part
 * that's only low by its notes, such as cellos under an orchestra, isn't.)
 */
const isBassLine = (t: TrackMeasure) => t.role === 'bass' && (t.category === 'Bass' || /\b(bass|808|sub)\b/i.test(t.name));

/** Each track's share of the stems' total power between lo and hi Hz (middle, or sides), largest first. */
function blame(tracks: readonly TrackMeasure[], lo: number, hi: number, side = false): Array<{ id: string; share: number }> {
  const each = tracks.map((t) => ({ id: t.id, p: power(levelBetween(t.spectrum, side ? t.spectrum.side : t.spectrum.mid, lo, hi)) }));
  const total = each.reduce((s, e) => s + e.p, 0) || 1;
  return each.map((e) => ({ id: e.id, share: e.p / total })).sort((a, b) => b.share - a.share);
}

/** The mean of the detrended bands from lo to hi Hz. */
function bulge(shape: readonly number[], freqs: readonly number[], lo: number, hi: number): number {
  const xs = shape.filter((v, i) => freqs[i] >= lo && freqs[i] <= hi && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Frames where a track sounds: within 30 dB of its own loudest stretch. */
function active(env: Float32Array): Uint8Array {
  let max = 0;
  for (const v of env) if (v > max) max = v;
  const floor = max * 0.03;
  return Uint8Array.from(env, (v) => (v > floor ? 1 : 0));
}

/** How much of the time either plays that both do (0 to 1). */
function overlap(a: Uint8Array, b: Uint8Array): number {
  let either = 0;
  let both = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] || b[i]) either++;
    if (a[i] && b[i]) both++;
  }
  return either ? both / either : 0;
}

/** The numbers the findings are judged on (see above). */
export function mixMetrics(mix: MixMeasure, tracks: readonly TrackMeasure[]): MixMetrics {
  const s = mix.spectrum;
  const lowSideDb = levelBetween(s, s.side, 20, 120) - levelBetween(s, s.mid, 20, 120);
  const shape = detrended(s);
  const mudDb = bulge(shape, s.freqs, 200, 500);
  const harshDb = bulge(shape, s.freqs, 2000, 5000);
  const perBand = (lo: number, hi: number) => {
    const xs = s.mid.filter((_, i) => s.freqs[i] >= lo && s.freqs[i] < hi);
    return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  };
  const upperTiltDb = perBand(2000, 5000) - perBand(700, 1400);
  /** Where a spectrum's low end is loudest, Hz (30-200). */
  const lowPeak = (sp: BandSpectrum) => {
    let best = -Infinity;
    let at = 60;
    sp.freqs.forEach((f, i) => {
      if (f >= 30 && f <= 200 && sp.mid[i] > best) {
        best = sp.mid[i];
        at = f;
      }
    });
    return at;
  };

  // Kick and bass: at the kick's hits (its 40-140 Hz level in its top fifth), how loud the bass is there
  const clashes: MixMetrics['clashes'] = [];
  for (const kick of tracks.filter((t) => t.role === 'drums')) {
    const k = kick.lowEnv;
    const sorted = Float32Array.from(k).sort();
    const top = sorted[Math.floor(sorted.length * 0.8)] ?? 0;
    const kickPeak = sorted[sorted.length - 1] ?? 0;
    // A drum track with hardly any low end has no kick in it
    if (!(top > 0) || kickPeak < 1e-3) continue;
    for (const bass of tracks.filter((t) => isBassLine(t) && !t.ducked)) {
      const ratios: number[] = [];
      let both = 0;
      let hits = 0;
      for (let i = 1; i < Math.min(k.length, bass.lowEnv.length); i++) {
        // A hit: in the kick's top fifth, and rising into it
        if (k[i] < top || k[i - 1] >= top) continue;
        hits++;
        const b = Math.max(bass.lowEnv[i], bass.lowEnv[i + 1] ?? 0);
        if (b > k[i] * 0.1) both++;
        ratios.push(b / k[i]);
      }
      if (hits < 4) continue;
      ratios.sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      clashes.push({ kickId: kick.id, bassId: bass.id, db: median > 0 ? 20 * Math.log10(median) : -120, together: both / hits, kickHz: lowPeak(kick.spectrum), bassHz: lowPeak(bass.spectrum) });
    }
  }

  // Masking: two parts each holding a large share of the same run of bands (150 Hz to 6 kHz), while both play
  const tonal = tracks.filter((t) => t.role !== 'drums');
  const total = s.freqs.map((_, i) => sumDb(tracks.map((t) => t.spectrum.mid[i])));
  const actives = new Map(tonal.map((t) => [t.id, active(t.env)]));
  const masking: MixMetrics['masking'] = [];
  for (let a = 0; a < tonal.length; a++) {
    for (let b = a + 1; b < tonal.length; b++) {
      const ta = tonal[a];
      const tb = tonal[b];
      let run = 0;
      let best = { bands: 0, lo: 0, hi: 0 };
      s.freqs.forEach((f, i) => {
        const inRange = f >= 150 && f <= 6000;
        const shareA = power(ta.spectrum.mid[i] - total[i]);
        const shareB = power(tb.spectrum.mid[i] - total[i]);
        if (inRange && shareA >= MASK_SHARE && shareB >= MASK_SHARE) {
          run++;
          if (run > best.bands) best = { bands: run, lo: s.freqs[i - run + 1], hi: f };
        } else run = 0;
      });
      if (best.bands === 0) continue;
      masking.push({ a: ta.id, b: tb.id, ...best, together: overlap(actives.get(ta.id)!, actives.get(tb.id)!) });
    }
  }
  masking.sort((x, y) => y.bands - x.bands);

  return {
    lowSideDb,
    mudDb,
    harshDb,
    upperTiltDb,
    clashes,
    masking,
    lowSideBlame: blame(tracks, 20, 120, true),
    mudBlame: blame(tracks, 200, 500),
    harshBlame: blame(tracks, 2000, 5000),
  };
}

const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f / 10) * 10} Hz`);

/** The tracks with at least `least` of the blame (the top one always), at most two. */
const culprits = (list: Array<{ id: string; share: number }>, least = 0.25) => list.filter((e, i) => i === 0 || e.share >= least).slice(0, 2).map((e) => e.id);

/**
 * The findings for a mix, worst first (an empty list: nothing to flag). `target` is where the
 * song is going (its loudness, and a name to say), `names` gives the tracks' names.
 */
export function checkMix(mix: MixMeasure, tracks: readonly TrackMeasure[], target: { lufs: number; name: string }, ceilingDbtp = -1): Finding[] {
  const m = mixMetrics(mix, tracks);
  const name = (id: string) => tracks.find((t) => t.id === id)?.name ?? 'a track';
  const list = (ids: string[]) => ids.map((id) => `"${name(id)}"`).join(' and ');
  const out: Finding[] = [];

  if (m.lowSideDb > LOW_SIDE_LIMIT_DB) {
    const ids = culprits(m.lowSideBlame);
    out.push({
      id: 'lowSides',
      level: m.lowSideDb > LOW_SIDE_LIMIT_DB + 3 ? 'problem' : 'note',
      title: "The low end isn't in the middle",
      detail: `Below about 120 Hz, the left and right sides differ a lot (${m.lowSideDb.toFixed(0)} dB of side against the middle). Wide bass sounds thin on club systems and disappears on phones. Look at ${list(ids)}: pan it to the centre, take off stereo chorus or wideners, or turn on the master Stereo width with "Keep the bass in the middle".`,
      trackIds: ids,
    });
  }

  for (const c of m.clashes) {
    if (c.db < CLASH_RANGE_DB[0] || c.db > CLASH_RANGE_DB[1] || c.together < 0.6) continue;
    out.push({
      id: 'kickBass',
      // Worst where both are as loud on nearly every hit and the bass is a sub (under 80 Hz), right on the kick
      level: Math.abs(c.db) <= 1.5 && c.together >= 0.9 && c.bassHz < 80 ? 'problem' : 'note',
      title: 'The kick and the bass fight',
      detail: `When the kick in "${name(c.kickId)}" hits, "${name(c.bassId)}" is just as loud in the same low notes (${Math.round(c.together * 100)}% of the hits), so the two blur into one boom and the kick loses its punch. Put a Pump on "${name(c.bassId)}" following the kick, so it ducks out of the way, or move the bass notes off the kick.`,
      trackIds: [c.bassId, c.kickId],
    });
  }

  if (m.mudDb > MUD_LIMIT_DB) {
    const ids = culprits(m.mudBlame);
    out.push({
      id: 'mud',
      level: m.mudDb > MUD_LIMIT_DB + 1 ? 'problem' : 'note',
      title: 'Muddy low mids',
      detail: `There's ${m.mudDb.toFixed(1)} dB more between 200 and 500 Hz than the rest of the mix leads up to, which makes it boxy and unclear. Most of it comes from ${list(ids)}: try cutting 2-4 dB around 300 Hz on its EQ, or a low cut on parts that don't need the bottom (Make space does this for you).`,
      trackIds: ids,
    });
  }

  if (m.harshDb > HARSH_LIMIT_DB || m.upperTiltDb > HARSH_TILT_DB) {
    const ids = culprits(m.harshBlame);
    out.push({
      id: 'harsh',
      level: m.harshDb > HARSH_LIMIT_DB + 1.5 ? 'problem' : 'note',
      title: 'Harsh upper mids',
      detail: `${m.upperTiltDb > HARSH_TILT_DB ? `The 2-5 kHz range is ${m.upperTiltDb.toFixed(1)} dB louder than the mids below it` : `There's ${m.harshDb.toFixed(1)} dB more between 2 and 5 kHz than the rest of the mix leads up to`}: tiring to listen to, especially loud. Most of it comes from ${list(ids)}: try a cut of 2-3 dB around 3 kHz on its EQ, or turn it down a little.`,
      trackIds: ids,
    });
  }

  if (Number.isFinite(mix.lufs)) {
    const short = target.lufs - mix.lufs;
    // How much limiting the export's loudness match would need to get there
    const limiting = Math.max(0, short - (ceilingDbtp - mix.truePeakDb));
    if (short > 3) {
      out.push({
        id: 'quiet',
        level: limiting > 8 ? 'problem' : 'note',
        title: `Quieter than ${target.name}`,
        detail:
          limiting > 8
            ? `The mix is ${mix.lufs.toFixed(1)} LUFS, ${short.toFixed(1)} dB under the target, and its peaks are already high: getting there would take about ${limiting.toFixed(0)} dB of limiting, which squashes it. Turn the loudest peaks down (often the drums), or use the master Clipper or OTT, then raise the master Level.`
            : `The mix is ${mix.lufs.toFixed(1)} LUFS, ${short.toFixed(1)} dB under the target. Turn on "Match a loudness target" when you export, or raise the master Level.`,
        trackIds: [],
      });
    } else if (mix.lufs > target.lufs + 2) {
      out.push({
        id: 'loud',
        level: mix.lufs > target.lufs + 4 ? 'problem' : 'note',
        title: `Louder than ${target.name}`,
        detail: `The mix is ${mix.lufs.toFixed(1)} LUFS, ${(mix.lufs - target.lufs).toFixed(1)} dB over the target. ${target.lufs <= -13 ? 'Streaming services will turn it down to the target anyway, so the extra loudness only costs punch.' : 'That is very loud: expect it to sound squashed.'} Lower the master Level, or let the export match the target.`,
        trackIds: [],
      });
    }
  }

  const stats = mix.stats;
  if (stats && (stats.limiterPeakDb > 7 || stats.limiterBusyShare > 0.2)) {
    out.push({
      id: 'limiter',
      level: stats.limiterPeakDb > 9 || stats.limiterBusyShare > 0.4 ? 'problem' : 'note',
      title: 'Peaks hit the limiter hard',
      detail: `Before the limiter the peaks reach ${stats.limiterInPeakDb > 0 ? '+' : ''}${stats.limiterInPeakDb.toFixed(1)} dBFS, so it takes up to ${stats.limiterPeakDb.toFixed(1)} dB off them${stats.limiterBusyShare > 0.05 ? `, and works hard ${Math.round(stats.limiterBusyShare * 100)}% of the time` : ''}. That flattens the drums. Lower the master Level, turn down the loudest part, or shave the peaks first with the Clipper.`,
      trackIds: [],
    });
  }
  if (stats?.clipper && stats.clipper.peakDb > 4) {
    out.push({
      id: 'clipper',
      level: stats.clipper.peakDb > 6 ? 'problem' : 'note',
      title: 'The clipper is working hard',
      detail: `It takes up to ${stats.clipper.peakDb.toFixed(1)} dB off the peaks (${(stats.clipper.share * 100).toFixed(1)}% of the time). Past about 3-4 dB clipping starts to sound crunchy: lower its Drive.`,
      trackIds: [],
    });
  }

  for (const k of m.masking.filter((x) => x.bands >= 4 && x.together >= 0.5).slice(0, 2)) {
    out.push({
      id: 'masking',
      level: k.bands >= 7 ? 'problem' : 'note',
      title: 'Two parts cover each other',
      detail: `"${name(k.a)}" and "${name(k.b)}" play at the same time in the same range (${hz(k.lo)} to ${hz(k.hi)}), at about the same level, so neither is clear. Cut one of them a little there with its EQ, move one up or down an octave, or pan them apart (Make space carves room for you).`,
      trackIds: [k.a, k.b],
    });
  }

  const rank = (f: Finding) => (f.level === 'problem' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}
