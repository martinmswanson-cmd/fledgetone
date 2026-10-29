/** The parts of a song a render needs (see listen.ts), from a snapshot of it. */
import type { ProjectSnapshot } from '../store/project';
import type { ListenSnapshot } from '../audio/listen';

export const listenSnapshot = (p: ProjectSnapshot): ListenSnapshot => ({
  tracks: p.tracks,
  clips: p.clips,
  bpm: p.bpm,
  tempoPoints: p.tempoPoints,
  swing: p.swing,
  masterFx: p.masterFx ?? { reverbDecay: 2.4, delayTime: '8n', delayFeedback: 0.35 },
  master: p.master,
  intensity: p.intensity,
});
