import React, { useMemo } from 'react';
import { soundStatusText, useSoundLibrary } from '../../audio/soundLibrary';
import { waveformPath } from '../../audio/waveform';

interface WaveformProps {
  soundId: string;
  /** The stretch of the sound shown, in seconds */
  from: number;
  to: number;
  /** The drawing's size; with `stretch` it fills its container's width instead (keeping `width` columns) */
  width: number;
  height: number;
  stretch?: boolean;
  /** Linear gain the peaks are drawn at */
  gain?: number;
  color: string;
  className?: string;
}

/**
 * A sound's waveform (its precomputed peaks, see soundLibrary.ts), or a word on why there isn't
 * one yet. The path is worked out only when the stretch, size or gain change, never per frame.
 */
export const Waveform: React.FC<WaveformProps> = ({ soundId, from, to, width, height, stretch, gain = 1, color, className }) => {
  const peaks = useSoundLibrary((s) => s.peaks[soundId]);
  const status = useSoundLibrary((s) => s.status[soundId]);
  const d = useMemo(() => (peaks ? waveformPath(peaks, from, to, width, height, gain) : ''), [peaks, from, to, width, height, gain]);
  if (!peaks) {
    return (
      <div
        className={`${className ?? ''} flex items-center px-1.5 text-[9px] font-mono text-forge-muted/80 truncate`}
        style={{ width: stretch ? '100%' : width, height }}
      >
        {soundStatusText(status)}
      </div>
    );
  }
  return (
    <svg
      className={className}
      width={stretch ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} fill={color} fillOpacity={0.85} />
    </svg>
  );
};
