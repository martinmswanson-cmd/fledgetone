import { useTimelineStore } from '../../store/timelineStore';
import type { GameKitSong } from '../../audio/gameKit';

/** The song as the game kit needs it, from the store now. */
export function gameKitSong(): GameKitSong {
  const s = useTimelineStore.getState();
  return {
    name: s.projectName || 'Untitled',
    bpm: s.bpm,
    tempoPoints: s.tempoPoints,
    meter: s.meter,
    meterPoints: s.meterPoints,
    swing: s.swing,
    tracks: s.tracks,
    clips: s.clips,
    markers: s.markers,
    masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback },
    master: s.master,
    stingers: s.stingers,
    transitions: s.transitions,
    intensity: s.intensity,
    intensityCurves: s.intensityCurves,
  };
}

