/** The listening path's state for the UI: level matching on or off, and its latest reading (monitor.ts). */
import { useEffect, useState } from 'react';
import { onMonitorReading, type MonitorReading } from '../audio/monitor';

export function useListening(): { reading: MonitorReading | null; matched: boolean } {
  const [state, setState] = useState<{ reading: MonitorReading | null; matched: boolean }>({ reading: null, matched: true });
  useEffect(() => onMonitorReading((reading, matched) => setState({ reading, matched })), []);
  return state;
}
