/**
 * Pocket's one export: the whole song as an MP3 at a loudness target (the studio's Export dialog
 * with its defaults: the song from bar 1, ringing out, matched to the target, peaks held under
 * the lossy ceiling). The target is the Loud master's when it's on (Pocket's Loud button aims it
 * at the drop check's style), else Streaming; the Share screen can pick another. With the Loud
 * master on the push into its clipper and limiter is found afresh (and kept for live playback when
 * the file aims at the Loud master's own target);
 * otherwise the file is turned up or down and limited as the studio does. Uses the same render as
 * the studio, so the file sounds the same whichever made it.
 */
import { countedRender } from '../audio/renderBusy';
import { audibleTracks, channelsOf, cutRingOut, renderArrangement, type RenderOptions } from '../audio/exportWav';
import { measureLoudness } from '../audio/loudness';
import { DEFAULT_TARGET, reachTarget, targetById } from '../audio/loudnessTarget';
import { exportCeilingDbtp } from '../audio/effects/limiter';
import { LOUD_TARGETS, loudCrunch, pushToKeep, type LoudMatch } from '../audio/effects/loudMaster';
import type { MasterStats } from '../audio/effects/masterAfter';
import { encodeAudio } from '../audio/encoders';
import { useTimelineStore } from '../store/timelineStore';
import { safeFileName } from '../store/project';

/** Render the song to an MP3 (`onProgress` 0 to 1 while rendering). Null when the song has nothing in it. */
/** The target Pocket's MP3 aims at unless another is picked: the Loud master's, else Streaming. */
export function pocketTarget(): string {
  const loud = useTimelineStore.getState().master.loud;
  return loud?.on ? loud.target : DEFAULT_TARGET;
}

export function renderSongMp3(onProgress: (fraction: number, detail: string) => void, targetId: string = pocketTarget()): Promise<{ blob: Blob; name: string; lufs: number } | null> {
  return countedRender(async () => {
    const s = useTimelineStore.getState();
    // The render swaps the global audio context while it sets up, so live playback halts first
    s.pause();
    const audible = new Set(audibleTracks(s.tracks).map((t) => t.id));
    const songEnd = Math.max(1, ...s.clips.filter((c) => audible.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
    if (songEnd <= 1) return null;
    const ceilingDbtp = exportCeilingDbtp('mp3', loudCrunch(useTimelineStore.getState().master));
    const masterFx = {
      reverbDecay: s.masterReverbDecay,
      delayTime: s.masterDelayTime,
      delayFeedback: s.masterDelayFeedback,
      ...(s.masterReverbRoom ? { room: s.masterReverbRoom } : {}),
      ...(s.masterRoomStyle !== 'hall' ? { roomStyle: s.masterRoomStyle } : {}),
    };
    const opts: RenderOptions = {
      tracks: s.tracks,
      clips: s.clips,
      bpm: s.bpm,
      tempoPoints: s.tempoPoints,
      swing: s.swing,
      startBar: 1,
      endBar: songEnd,
      masterFx,
      master: s.master,
      ending: 'ringOut',
      sampleRate: 44100,
      markers: s.markers,
      intensity: { value: s.intensity, curves: s.intensityCurves },
      peakCeilingDbtp: ceilingDbtp,
      keepRingOut: true,
    };
    const target = targetById(targetId);
    const loud = !!s.master.loud?.on;
    let found: LoudMatch | undefined;
    if (loud) Object.assign(opts, { loudTargetLufs: target.lufs, onMasterStats: (m: MasterStats) => (found = m.loud) });
    let audio = await renderArrangement(opts, (f, stage) => onProgress(f, stage === 'matching' ? 'Matching the loudness' : 'Playing the song through'));
    onProgress(1, 'Matching the loudness');
    let reading = await measureLoudness(channelsOf(audio), audio.sampleRate);
    if (!loud) reading = (await reachTarget(channelsOf(audio), audio.sampleRate, reading, target, undefined, ceilingDbtp)).reading;
    else {
      // Kept for live playback only when aimed at the Loud master's own target (the whole song, full mix with no solo on)
      // at the live ceiling: so never from this MP3 (the Loud master's own match keeps Pocket's push)
      const live = useTimelineStore.getState().master.loud;
      const push = live ? pushToKeep({ wholeSong: true, fullMix: !s.tracks.some((t) => t.isSoloed), exportTargetLufs: target.lufs, loudTargetLufs: LOUD_TARGETS[live.target].lufs, found, currentPush: live.push ?? 0, ceilingDbtp }) : null;
      if (push !== null) useTimelineStore.getState().setMasterLoud({ push });
    }
    audio = cutRingOut(audio, opts);
    onProgress(1, 'Making the MP3');
    const blob = await encodeAudio(channelsOf(audio), audio.sampleRate, 'mp3', { bitDepth: 16 });
    return { blob, name: `${safeFileName(s.projectName)}.mp3`, lufs: loud && found ? found.lufs : reading.integrated };
  });
}
