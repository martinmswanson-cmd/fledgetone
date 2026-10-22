/**
 * Rendering the song to study its mix: the Mix check (a render of the mix through the master
 * section, and one of each track's stem, measured by mixAnalysis.ts and judged by mixCheck.ts),
 * and the mix's loudness and spectrum that the reference track is matched and compared against
 * (referenceTrack.ts), and the "Does it hit?" check of a stretch of it (a loop, a section)
 * against a style's targets (hitCheck.ts, hitTargets.ts). Kept in a small store of its own;
 * nothing here is saved with the song.
 */
import { create } from 'zustand';
import { useTimelineStore, masterFxOf, songTempo } from '../store/timelineStore';
import { audibleTracks, channelsOf, renderArrangement, renderStems, stemTracks, type RenderOptions } from './exportWav';
import { measureLoudness } from './loudness';
import { bandEnvelope, bandSpectrum, type BandSpectrum } from './mixAnalysis';
import { checkMix, trackRole, type Finding, type TrackMeasure } from './mixCheck';
import { targetById } from './loudnessTarget';
import { busChain, isMixTrack } from '../store/buses';
import { INSTRUMENTS } from './instrumentCatalog';
import type { MasterStats } from './effects/masterAfter';
import { LOUD_TARGETS, type LoudMatch } from './effects/loudMaster';
import type { Track } from '../store/timelineTypes';
import { tempoAt } from './tempoMap';
import { drumOnsets } from './hitOnsets';
import { measureHits } from './hitCheckRun';
import type { HitReport } from './hitCheck';
import type { HitStyleId } from './hitTargets';

/** The longest stretch of a song analysed, seconds (from bar 1): enough to know a mix by. */
export const ANALYSE_SECONDS = 120;

/** The mix as last analysed. */
export interface MixAnalysis {
  lufs: number;
  truePeakDb: number;
  spectrum: BandSpectrum;
  stats?: MasterStats;
  /** Bars analysed, [from, to). */
  bars: [number, number];
}

interface MixStudioState {
  analysis: MixAnalysis | null;
  findings: Finding[] | null;
  /** The loudness target the findings were judged against. */
  targetId: string;
  /** A render under way: what it's doing and how far (0 to 1). */
  busy: { what: string; progress: number } | null;
  error: string | null;
  /** The last Mix check's measurements of each track (kept for a second look, and for tuning the rules). */
  measures: TrackMeasure[] | null;
  /** The style the "Does it hit?" check judges against. */
  hitStyle: HitStyleId;
  /** The last "Does it hit?" check: what was measured, of which bars. */
  hit: { report: HitReport; bars: [number, number] } | null;
}

export const useMixStudio = create<MixStudioState>(() => ({ analysis: null, findings: null, targetId: 'streaming', busy: null, error: null, measures: null, hitStyle: 'dubstep', hit: null }));

let running: AbortController | null = null;

/** Stop a render under way. */
export function cancelMixRender(): void {
  running?.abort();
}

/** The song as the export would render it, bar 1 to the end (at most ANALYSE_SECONDS). */
function songOptions(signal: AbortSignal): RenderOptions {
  const s = useTimelineStore.getState();
  const ids = new Set(audibleTracks(s.tracks).map((t) => t.id));
  const end = Math.max(2, ...s.clips.filter((c) => ids.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
  const most = 1 + Math.max(1, Math.floor((ANALYSE_SECONDS * s.bpm) / 240));
  return {
    tracks: s.tracks,
    clips: s.clips,
    bpm: s.bpm,
    tempoPoints: s.tempoPoints,
    swing: s.swing,
    startBar: 1,
    endBar: Math.min(end, most),
    masterFx: masterFxOf(s),
    master: s.master,
    ending: 'exact',
    sampleRate: 44100,
    markers: [],
    intensity: { value: s.intensity, curves: s.intensityCurves },
    signal,
  };
}

/** Whether a track is ducked to the kick already: a Pump on it or on a bus it plays through. */
function ducked(track: Track, tracks: Track[]): boolean {
  return [track, ...busChain(track, tracks)].some((t) => t.fx.pump.on || !!t.duckProxy);
}

async function run<T>(what: string, job: (signal: AbortSignal, progress: (f: number, what?: string) => void) => Promise<T>): Promise<T | null> {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  useTimelineStore.getState().pause();
  useMixStudio.setState({ busy: { what, progress: 0 }, error: null });
  try {
    return await job(controller.signal, (progress, detail) => {
      if (running === controller) useMixStudio.setState({ busy: { what: detail ?? what, progress } });
    });
  } catch (err) {
    if (!controller.signal.aborted) useMixStudio.setState({ error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    if (running === controller) {
      running = null;
      useMixStudio.setState({ busy: null });
    }
  }
}

/** Render the mix through the master section and measure it (its loudness, spectrum and what the master did). */
async function analyseMixRender(opts: RenderOptions, progress: (f: number) => void): Promise<MixAnalysis> {
  let stats: MasterStats | undefined;
  const audio = await renderArrangement({ ...opts, onMasterStats: (s) => (stats = s) }, progress);
  const channels = channelsOf(audio);
  const reading = await measureLoudness(channels, audio.sampleRate, opts.signal);
  return { lufs: reading.integrated, truePeakDb: reading.truePeakMax, spectrum: bandSpectrum(channels, audio.sampleRate), ...(stats ? { stats } : {}), bars: [opts.startBar, opts.endBar] };
}

/** Render and measure the mix alone (for the reference's level match and spectrum). */
export function analyseMix(): Promise<MixAnalysis | null> {
  return run('Rendering the mix', async (signal, progress) => {
    const analysis = await analyseMixRender(songOptions(signal), progress);
    useMixStudio.setState({ analysis });
    return analysis;
  });
}

/**
 * Match a Loud master to its target: render the song through the master section, find the push
 * into the clipper and limiter that gets it there (loudMaster.ts), and keep it, so live playback
 * plays what the export will. The push follows from the song (it's measured, not chosen), so it
 * isn't an undo step of its own: undoing the switch or the target that asked for it takes it
 * back with them. Returns what the match found.
 */
export function matchLoudMaster(): Promise<LoudMatch | null> {
  return run('Matching the loudness', async (signal, progress) => {
    const s = useTimelineStore.getState();
    const loud = s.master.loud;
    if (!loud?.on) return null;
    let stats: MasterStats | undefined;
    await renderArrangement({ ...songOptions(signal), loudTargetLufs: LOUD_TARGETS[loud.target].lufs, onMasterStats: (m) => (stats = m) }, progress);
    const found = stats?.loud;
    if (found && Number.isFinite(found.lufs)) useTimelineStore.getState().setMasterLoud({ push: found.push });
    return found ?? null;
  });
}

/** The Mix check: render the mix and every track's stem, measure them, and judge the mix against `targetId`. */
export function runMixCheck(targetId = useMixStudio.getState().targetId): Promise<Finding[] | null> {
  return run('Rendering the mix', async (signal, progress) => {
    const opts = songOptions(signal);
    const analysis = await analyseMixRender(opts, (f) => progress(f * 0.3));
    useMixStudio.setState({ analysis });
    const s = useTimelineStore.getState();
    const measures: TrackMeasure[] = [];
    // The stems' tracks, in the order renderStems encodes them
    const pending = stemTracks(opts);
    await renderStems(
      { ...opts, bypassMaster: true },
      16,
      (f, stem) => progress(0.3 + f * 0.7, `Rendering ${stem.track.name} (${stem.index + 1} of ${stem.count})`),
      async (channels, sampleRate) => {
        // (Called once per stem, in order, after every stem has rendered)
        const track = pending.shift()!;
        measures.push({
          id: track.id,
          name: track.name,
          role: trackRole(track, s.clips),
          spectrum: bandSpectrum(channels, sampleRate),
          lowEnv: bandEnvelope(channels, sampleRate, 40, 140),
          env: bandEnvelope(channels, sampleRate, 0, sampleRate / 2),
          ducked: ducked(track, s.tracks),
          category: INSTRUMENTS[track.instrumentKey]?.category,
        });
        return new Blob();
      }
    );
    const target = targetById(targetId);
    const findings = checkMix(
      { lufs: analysis.lufs, truePeakDb: analysis.truePeakDb, spectrum: analysis.spectrum, stats: analysis.stats },
      measures,
      { lufs: target.lufs, name: `the ${target.name.replace(/\s*\(.*\)$/, '').toLowerCase()} target (${target.lufs} LUFS)` }
    );
    useMixStudio.setState({ findings, targetId, measures });
    return findings;
  });
}

/** The most of a song the "Does it hit?" check renders, bars. */
export const HIT_MOST_BARS = 64;

/**
 * "Does it hit?": render bars [from, to) of the song as the export would (through the master
 * section), find its kicks and snares from the drum notes, and measure it in a Worker. The
 * result is kept in the store (hit) with the bars; `hitStyle` is only what it's judged against.
 */
export function runHitCheck(from: number, to: number): Promise<HitReport | null> {
  const end = Math.min(to, from + HIT_MOST_BARS);
  return run('Rendering the stretch to check', async (signal, progress) => {
    const s = useTimelineStore.getState();
    const opts = { ...songOptions(signal), startBar: from, endBar: end };
    const audio = await renderArrangement(opts, (f) => progress(f * 0.5));
    // The bass parts alone, for how the bass moves (the drums and chords would blur it in the mix)
    const bassIds = new Set(audibleTracks(s.tracks).filter((t) => !isMixTrack(t) && trackRole(t, s.clips) === 'bass').map((t) => t.id));
    let bassChannels: Float32Array[] | undefined;
    if (bassIds.size) {
      progress(0.5, 'Rendering the bass alone');
      const tracks = s.tracks.map((t) => (isMixTrack(t) || bassIds.has(t.id) ? t : { ...t, isMuted: true, isSoloed: false }));
      const bass = await renderArrangement({ ...opts, tracks }, (f) => progress(0.5 + f * 0.25, 'Rendering the bass alone'));
      bassChannels = channelsOf(bass);
    }
    progress(0.75, 'Measuring');
    const tempo = songTempo(s);
    const { kicks, snares } = drumOnsets(audibleTracks(s.tracks), s.clips, tempo, from, end);
    const report = await measureHits({ channels: channelsOf(audio), sampleRate: audio.sampleRate, bpm: tempoAt(from, tempo), gridStart: 0, kicks, snares, bassChannels }, signal, (f) => progress(0.75 + f * 0.25, 'Measuring'));
    useMixStudio.setState({ hit: { report, bars: [from, end] } });
    return report;
  });
}
