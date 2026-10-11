import { useEffect, useState } from 'react';
import type { LoudnessReading } from '../../audio/loudness';
import { subscribeLoudness } from '../../audio/loudnessMeter';

/** The live loudness readings while the calling component is on screen (null before the first, or after a reset). */
export function useLoudness(): LoudnessReading | null {
  const [reading, setReading] = useState<LoudnessReading | null>(null);
  useEffect(() => subscribeLoudness(setReading), []);
  return reading;
}
