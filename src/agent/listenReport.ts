/**
 * What a listen reports, in plain JSON for an agent: the mix's loudness, true peak, crest and
 * balance, what the master section did, the loudness bar by bar, each track's own (when asked),
 * and findings in plain words. And the difference between two listens of the same bars (the song,
 * and the song with a suggestion), bar by bar, so an agent can tell where a change is heard: the
 * level of what changed in each bar (barDifferences, from the two renders' samples) and the bars
 * that sound different (changedRegions), which the studio also uses to find where a suggestion is
 * heard (whereHeard.ts). Pure: the rendering and measuring are the runtime's (src/runtime/render.ts)
 * and the studio's.
 */
import type { MasterStats } from '../audio/effects/masterAfter';
import type { Finding } from '../audio/mixCheck';

/** A number rounded to a tenth of a dB, or null for none (silence: -Infinity). */
export const tenth = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export interface ListenMix {
  lufs: number | null;
  shortTermMaxLufs: number | null;
  truePeakDbtp: number | null;
  crestDb: number | null;
  /** Each part of the spectrum against the whole, dB. */
  regions: Array<{ name: string; db: number }>;
  master: { limiterMaxGrDb: number | null; clipperMaxDb: number | null };
}

export interface ListenTrack {
  id: string;
  name: string;
  lufs: number | null;
  truePeakDbtp: number | null;
  crestDb: number | null;
  regions: Array<{ name: string; db: number }>;
}

/** One bar's loudness (a bar cut short by the range's end measures what there is of it). */
export interface ListenBar {
  bar: number;
  lufs: number | null;
}

export interface ListenReport {
  range: { fromBar: number; toBar: number };
  seconds: number;
  heard: string;
  renderMode: 'playback';
  mix: ListenMix;
  bars: ListenBar[];
  /** Each track's stem, without the master section (per-track listening only). */
  tracks?: ListenTrack[];
  /** What the Mix check finds, with the tracks to look at (only the checks that need no tracks without per-track listening). */
  checks?: Array<Pick<Finding, 'id' | 'level' | 'title' | 'detail' | 'trackIds'>>;
  /** In plain words, worst first. */
  findings: string[];
}

/** What a listen measured of the mix, before rounding (as listen.ts measureRender gives it). */
export interface MixReading {
  lufs: number;
  /** null: shorter than 3 seconds, so no whole 3 seconds to measure. */
  shortTermMaxLufs: number | null;
  truePeakDbtp: number;
  crestDb: number;
  regions: Array<{ name: string; db: number }>;
}

/** The findings every listen gives (the live studio's listen says the same). */
export function mixFindings(m: MixReading, stats?: MasterStats): string[] {
  const findings: string[] = [];
  if (m.truePeakDbtp > -1) findings.push(`The true peak reaches ${m.truePeakDbtp.toFixed(1)} dBTP: over -1, it may distort when it's turned into an MP3.`);
  if (stats && stats.limiterPeakDb > 3) findings.push(`The master limiter takes up to ${stats.limiterPeakDb.toFixed(1)} dB off the peaks.`);
  if (stats?.clipper && stats.clipper.peakDb > 3) findings.push(`The master clipper takes up to ${stats.clipper.peakDb.toFixed(1)} dB off the peaks.`);
  if (!Number.isFinite(m.lufs)) findings.push('It is silent.');
  return findings;
}

/** The Mix check's findings that name no track (all a listen without per-track listening can judge). */
export const MIX_ONLY_CHECKS: ReadonlyArray<Finding['id']> = ['quiet', 'loud', 'limiter', 'clipper'];

/** The mix part of a report. */
export function listenMix(m: MixReading, stats?: MasterStats): ListenMix {
  return {
    lufs: tenth(m.lufs),
    shortTermMaxLufs: tenth(m.shortTermMaxLufs),
    truePeakDbtp: tenth(m.truePeakDbtp),
    crestDb: tenth(m.crestDb),
    regions: m.regions,
    master: { limiterMaxGrDb: stats ? tenth(stats.limiterPeakDb) : null, clipperMaxDb: stats?.clipper ? tenth(stats.clipper.peakDb) : null },
  };
}

/**
 * The findings of a report: the listen's own, then the Mix check's (`checks`), leaving out a check
 * of the limiter or clipper the listen's own already speak of.
 */
export function allFindings(own: string[], checks: ReadonlyArray<Pick<Finding, 'id' | 'title' | 'detail'>>): string[] {
  const said = (word: string) => own.some((f) => f.includes(word));
  const more = checks.filter((c) => !(c.id === 'limiter' && said('limiter')) && !(c.id === 'clipper' && said('clipper'))).map((c) => `${c.title}: ${c.detail}`);
  return [...own, ...more];
}

/** One bar of a before-and-after: each one's loudness, how much louder after, and how loud the difference between them is. */
export interface CompareBar {
  bar: number;
  beforeLufs: number | null;
  afterLufs: number | null;
  /** after - before, LU (null where either is silent) */
  lufsChange: number | null;
  /**
   * The level of what changed (the after's samples minus the before's), dBFS: null where the two
   * are the same (to under SAME_DB: only rounding), or can't be lined up (the tempo changed).
   */
  differenceDb: number | null;
  /** Whether the bar sounds different (its difference is above HEARD_DIFFERENCE_DB, or the tempo changed). */
  changed: boolean;
}

/** A difference quieter than this (dBFS) is taken as no change: far under anything heard in a mix. */
export const HEARD_DIFFERENCE_DB = -70;
/** A difference quieter than this (dBFS) is only the rounding of two renders: reported as none. */
export const SAME_DB = -120;

export interface ListenComparison {
  before: ListenReport;
  after: ListenReport;
  difference: {
    mix: { lufs: number | null; shortTermMaxLufs: number | null; truePeakDbtp: number | null; crestDb: number | null; regions: Array<{ name: string; db: number }> };
    tracks?: Array<{ id: string; name: string; lufs: number | null; truePeakDbtp: number | null }>;
    bars: CompareBar[];
    /** The first and last bar that changed (toBar not included), or null: it sounds the same. */
    changedBars: { fromBar: number; toBar: number } | null;
    /** In plain words. */
    summary: string[];
  };
}

const minus = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : tenth(a - b));

/**
 * The difference between two listens of the same bars: `before` (the song) and `after` (with a
 * suggestion). `differenceDb` is each bar's level of after minus before (see CompareBar), measured
 * by the caller from the two renders.
 */
export function compareListens(before: ListenReport, after: ListenReport, differenceDb: ReadonlyArray<number | null | 'tempo'>): ListenComparison {
  const bars: CompareBar[] = before.bars.map((b, i) => {
    const a = after.bars[i];
    const d = differenceDb[i];
    return {
      bar: b.bar,
      beforeLufs: b.lufs,
      afterLufs: a?.lufs ?? null,
      lufsChange: minus(a?.lufs ?? null, b.lufs),
      differenceDb: d === 'tempo' || d === null || d === undefined || d < SAME_DB ? null : tenth(d),
      changed: barChanged(d),
    };
  });
  const changed = bars.filter((b) => b.changed);
  const changedBars = changed.length ? { fromBar: changed[0].bar, toBar: Math.min(before.range.toBar, changed[changed.length - 1].bar + 1) } : null;
  const mix = {
    lufs: minus(after.mix.lufs, before.mix.lufs),
    shortTermMaxLufs: minus(after.mix.shortTermMaxLufs, before.mix.shortTermMaxLufs),
    truePeakDbtp: minus(after.mix.truePeakDbtp, before.mix.truePeakDbtp),
    crestDb: minus(after.mix.crestDb, before.mix.crestDb),
    regions: before.mix.regions.map((r) => ({ name: r.name, db: tenth((after.mix.regions.find((x) => x.name === r.name)?.db ?? r.db) - r.db) ?? 0 })),
  };
  let tracks: ListenComparison['difference']['tracks'];
  if (before.tracks || after.tracks) {
    const ids = [...new Set([...(before.tracks ?? []), ...(after.tracks ?? [])].map((t) => t.id))];
    tracks = ids.map((id) => {
      const b = before.tracks?.find((t) => t.id === id);
      const a = after.tracks?.find((t) => t.id === id);
      return { id, name: (a ?? b)!.name, lufs: minus(a?.lufs ?? null, b?.lufs ?? null), truePeakDbtp: minus(a?.truePeakDbtp ?? null, b?.truePeakDbtp ?? null) };
    });
  }
  const summary: string[] = [];
  const range = (r: { fromBar: number; toBar: number }) => (r.toBar - r.fromBar <= 1 ? `Bar ${r.fromBar}` : `Bars ${r.fromBar} to ${r.toBar - 1}`);
  if (!changedBars) summary.push('It sounds the same: the two renders are the same in every bar.');
  else {
    const loudest = Math.max(...changed.map((b) => b.differenceDb ?? -Infinity));
    const others = bars.length - changed.length;
    summary.push(
      `${range(changedBars)} ${changedBars.toBar - changedBars.fromBar <= 1 ? 'sounds' : 'sound'} different${Number.isFinite(loudest) ? ` (what changed is up to ${loudest.toFixed(1)} dBFS)` : ''}${changed.length < changedBars.toBar - changedBars.fromBar ? ', not every bar between' : ''}${others ? '; the other bars sound the same' : ''}.`
    );
  }
  if (mix.lufs !== null && Math.abs(mix.lufs) >= 0.1) summary.push(`Overall it is ${Math.abs(mix.lufs).toFixed(1)} LU ${mix.lufs > 0 ? 'louder' : 'quieter'} (${after.mix.lufs} against ${before.mix.lufs} LUFS).`);
  if (mix.truePeakDbtp !== null && Math.abs(mix.truePeakDbtp) >= 0.1) summary.push(`The true peak moves ${mix.truePeakDbtp > 0 ? 'up' : 'down'} ${Math.abs(mix.truePeakDbtp).toFixed(1)} dB, to ${after.mix.truePeakDbtp} dBTP.`);
  for (const r of mix.regions) if (Math.abs(r.db) >= 1) summary.push(`${r.name}: ${r.db > 0 ? '+' : ''}${r.db.toFixed(1)} dB against the whole.`);
  for (const t of tracks ?? []) if (t.lufs !== null && Math.abs(t.lufs) >= 0.5) summary.push(`"${t.name}" is ${Math.abs(t.lufs).toFixed(1)} LU ${t.lufs > 0 ? 'louder' : 'quieter'}.`);
  return { before, after, difference: { mix, ...(tracks ? { tracks } : {}), bars, changedBars, summary } };
}

/** Where a bar lies in a render: seconds from the render's start, end not included. */
export interface BarSpan {
  start: number;
  end: number;
}

/** Level of `b` - `a` over frames [from, to) (dBFS, null: the same sample for sample); a frame past either one's end counts as silence there. */
export function differenceDb(a: readonly Float32Array[], b: readonly Float32Array[], from: number, to: number): number | null {
  let sum = 0;
  let n = 0;
  const count = Math.max(a.length, b.length);
  for (let c = 0; c < count; c++) {
    const x = a[Math.min(c, a.length - 1)];
    const y = b[Math.min(c, b.length - 1)];
    if (!x || !y) continue;
    for (let i = Math.max(0, from); i < to; i++) {
      const d = (i < y.length ? y[i] : 0) - (i < x.length ? x[i] : 0);
      sum += d * d;
      n++;
    }
  }
  return sum > 0 && n > 0 ? 10 * Math.log10(sum / n) : null;
}

/**
 * Bar by bar, how loud what changed is between two renders of the same bars, `a` (before) and `b`
 * (after), each bar where it lies in each (`spansA`, `spansB`, seconds): dBFS (differenceDb, null:
 * the same), or 'tempo' for a bar that starts or ends at another time in one than in the other (by
 * more than a frame: the tempo changed before it or in it), which can't be lined up and counts as
 * changed.
 */
export function barDifferences(a: readonly Float32Array[], b: readonly Float32Array[], sampleRate: number, spansA: readonly BarSpan[], spansB: readonly BarSpan[]): Array<number | null | 'tempo'> {
  return spansA.map((sa, i) => {
    const sb = spansB[i];
    if (!sb) return 'tempo';
    const [a0, a1, b0, b1] = [sa.start, sa.end, sb.start, sb.end].map((t) => Math.round(t * sampleRate));
    if (Math.abs(a0 - b0) > 1 || Math.abs(a1 - b1) > 1) return 'tempo';
    return differenceDb(a, b, a0, a1);
  });
}

/** Whether a bar's difference (barDifferences) sounds: above HEARD_DIFFERENCE_DB, or a bar that can't be lined up. */
export const barChanged = (d: number | null | 'tempo' | undefined): boolean => d === 'tempo' || (typeof d === 'number' && d > HEARD_DIFFERENCE_DB);

/** The bars that sound different (barChanged), `diffs[i]` being bar `firstBar + i`: whole bars, in order, touching ones joined. */
export function changedRegions(diffs: ReadonlyArray<number | null | 'tempo'>, firstBar: number): Array<{ fromBar: number; toBar: number }> {
  const out: Array<{ fromBar: number; toBar: number }> = [];
  diffs.forEach((d, i) => {
    if (!barChanged(d)) return;
    const bar = firstBar + i;
    const last = out.at(-1);
    if (last && last.toBar === bar) last.toBar = bar + 1;
    else out.push({ fromBar: bar, toBar: bar + 1 });
  });
  return out;
}
