/** The listening path's state for the UI: level matching on or off, whether it's in, and its latest reading (monitor.ts). */
import { useEffect, useState } from 'react';
import { onMonitorReading, type ListeningState } from '../audio/monitor';

export function useListening(): ListeningState {
  const [state, setState] = useState<ListeningState>({ reading: null, wanted: true, status: 'pending', matched: false });
  useEffect(() => onMonitorReading(setState), []);
  return state;
}
