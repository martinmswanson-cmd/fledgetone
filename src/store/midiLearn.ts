import { create } from 'zustand';
import { useTimelineStore } from './timelineStore';
import type { AutomationParam } from './timelineTypes';
import { laneOf, normalizePoints, parseParam, specOf } from '../audio/automation';
import { liveWam } from '../audio/wamHost';

/**
 * MIDI learn and automation writing. A knob or fader of a MIDI controller (its CC number) can be
 * mapped to any setting a lane can drive (see automation.ts): moving it sets that setting over its
 * whole range. With Write on, moves made while the song plays are written into the setting's
 * lane at the playhead instead, replacing what the lane had there.
 */
interface MidiLearnState {
  /** Waiting for a knob to be moved, to map it to this setting */
  learning: { trackId: string; param: AutomationParam } | null;
  /** Moves while playing write automation */
  write: boolean;
  /** The last CC a mapped knob sent, for the readout ("CC 74 → Filter Cutoff") */
  last: { cc: number; label: string } | null;
  setLearning: (learning: { trackId: string; param: AutomationParam } | null) => void;
  setWrite: (write: boolean) => void;
}

export const useMidiLearn = create<MidiLearnState>((set) => ({
  learning: null,
  write: false,
  last: null,
  setLearning: (learning) => set({ learning }),
  setWrite: (write) => set({ write }),
}));

/**
 * Set a track's own `param` to lane value `n` (0 to 1 of its range), as moving its control would
 * (no undo step of its own: the caller checkpoints).
 */
export function setParamValue(trackId: string, param: AutomationParam, n: number): void {
  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.id === trackId);
  if (!track) return;
  const value = Math.max(0, Math.min(1, n));
  const real = specOf(param, track, s.tracks).toReal(value);
  const p = parseParam(param);
  switch (p.kind) {
    case 'builtin':
      switch (p.key) {
        case 'volume':
          return s.setTrackVolume(trackId, Number.isFinite(real) ? real : -60);
        case 'pan':
          return s.setTrackPan(trackId, real);
        case 'filterCutoff':
          return s.setTrackFx(trackId, 'filter', { cutoff: real });
        case 'filterResonance':
          return s.setTrackFx(trackId, 'filter', { resonance: real });
        case 'reverbSend':
          return s.setTrackReverbSend(trackId, real);
        case 'delaySend':
          return s.setTrackDelaySend(trackId, real);
        case 'eqLow':
          return s.setTrackEq(trackId, { low: real });
        case 'eqMid':
          return s.setTrackEq(trackId, { mid: real });
        case 'eqHigh':
          return s.setTrackEq(trackId, { high: real });
      }
      return;
    case 'send':
      return s.setTrackSend(trackId, p.returnId, real, false);
    case 'fx':
      return s.setTrackFx(trackId, p.insert, { [p.field]: real } as never);
    case 'plugin': {
      // A plugin keeps its own settings (saved with the project as its state)
      const inst = liveWam(p.pluginId);
      inst?.audioNode.scheduleEvents?.({ type: 'wam-automation', time: 0, data: { id: p.paramId, value, normalized: true } });
      return;
    }
  }
}

/** A knob gesture: moves this close together are one undo step. */
const GESTURE_MS = 800;
let gestureTimer = 0;
let inGesture = false;
/** Per lane being written: the bar the last point went at. */
const writing = new Map<string, number>();

function startGesture(): void {
  if (!inGesture) useTimelineStore.getState().checkpoint();
  inGesture = true;
  clearTimeout(gestureTimer);
  gestureTimer = window.setTimeout(() => {
    inGesture = false;
    writing.clear();
  }, GESTURE_MS);
}

/** Write lane value `n` at the playhead, replacing the lane's points since the last one this gesture wrote. */
function writeAutomation(trackId: string, param: AutomationParam, n: number): void {
  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.id === trackId);
  if (!track) return;
  const bar = s.playheadPosition;
  const key = `${trackId}|${param}`;
  const from = writing.get(key);
  const points = laneOf(track, param)?.points ?? [];
  // A new pass (or a loop back): start from here
  const since = from !== undefined && from <= bar ? from : bar;
  // (The point this gesture wrote last stays: what's after it, up to here, is replaced)
  const kept = from !== undefined && from <= bar ? points.filter((p) => p.bar <= since + 1e-9 || p.bar > bar + 1e-9) : points.filter((p) => Math.abs(p.bar - bar) > 1e-9);
  const next = normalizePoints([...kept, { bar, value: Math.max(0, Math.min(1, n)) }]);
  writing.set(key, bar);
  s.setAutomationPoints(trackId, param, next, false);
}

/**
 * A controller's CC `cc` moved to `value` (0 to 1). Learning: it's mapped to the setting waiting
 * for it. Else every setting it's mapped to follows it. Returns whether anything used it.
 */
export function handleMidiCc(cc: number, value: number): boolean {
  const learn = useMidiLearn.getState();
  const s = useTimelineStore.getState();
  if (learn.learning) {
    const { trackId, param } = learn.learning;
    s.mapMidi(trackId, cc, param);
    learn.setLearning(null);
    useMidiLearn.setState({ last: { cc, label: specOf(param, s.tracks.find((t) => t.id === trackId), s.tracks).label } });
    return true;
  }
  const targets = s.tracks.flatMap((t) => (t.midiMap ?? []).filter((m) => m.cc === cc).map((m) => ({ track: t, param: m.param })));
  if (!targets.length) return false;
  startGesture();
  for (const { track, param } of targets) {
    if (learn.write && s.isPlaying) writeAutomation(track.id, param, value);
    else setParamValue(track.id, param, value);
  }
  const first = targets[0];
  useMidiLearn.setState({ last: { cc, label: `${first.track.name}: ${specOf(first.param, first.track, s.tracks).label}` } });
  return true;
}
