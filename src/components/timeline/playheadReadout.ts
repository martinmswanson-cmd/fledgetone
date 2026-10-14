/**
 * The playhead for readouts (the position and timecode boxes, the overview's playhead): while
 * playing, updated a few times a second on the shared frame loop; stopped, at once on every move.
 * The store moves the playhead every frame, and a readout re-rendering with it changed text in the
 * page's main layer every frame, which made the browser repaint the whole page (every clip and
 * note on screen) sixty times a second during playback. Digits changing faster than this can't be
 * read anyway; the playhead line itself still moves every frame (Playhead.tsx).
 */
import { useEffect, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { onFrame } from '../frameTicker';
import { livePlayhead } from '../../store/playheadClock';

export function usePlayheadReadout(fps = 15): number {
  const [position, setPosition] = useState(() => useTimelineStore.getState().playheadPosition);
  useEffect(() => {
    let playing = useTimelineStore.getState().isPlaying;
    const unFrame = onFrame(() => {
      if (playing) setPosition(livePlayhead());
    }, fps);
    const unSubscribe = useTimelineStore.subscribe((s, prev) => {
      playing = s.isPlaying;
      if (s.playheadPosition !== prev.playheadPosition && (!s.isPlaying || s.isPlaying !== prev.isPlaying)) setPosition(s.playheadPosition);
    });
    return () => {
      unFrame();
      unSubscribe();
    };
  }, [fps]);
  return position;
}
