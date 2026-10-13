/**
 * Waveform drawings from a sound's precomputed peaks: a stretch of a sound (Waveform), and an
 * audio clip's waveform laid along its warp markers (ClipWaveform).
 */
import React, { useMemo } from 'react';
import { soundStatusText, useSoundLibrary } from '../../audio/soundLibrary';
import { waveformPath } from '../../audio/waveform';
import type { ClipAudio } from '../../store/timelineTypes';
import { clipSecondsAt, isWarped, sourceAt, warpPieces } from '../../store/warp';

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

/**
 * An audio clip's waveform as it plays: the stretch of its sound from its offset, `seconds` of
 * clip long at `bpm`, laid along its warp markers (each stretch between markers drawn over the
 * time it plays in). `columns` is the drawing's resolution; it fills its container's width.
 */
export const ClipWaveform: React.FC<{ audio: ClipAudio; bpm: number; seconds: number; columns: number; height: number; gain?: number; color: string; className?: string }> = ({
  audio,
  bpm,
  seconds,
  columns,
  height,
  gain = 1,
  color,
  className,
}) => {
  const end = sourceAt(audio, seconds, bpm);
  if (!isWarped(audio) || seconds <= 0) return <Waveform soundId={audio.soundId} from={audio.offset} to={end} width={columns} height={height} stretch gain={gain} color={color} className={className} />;
  return (
    <div className={`${className ?? ''} relative`} style={{ width: '100%', height }}>
      {warpPieces(audio, audio.offset, end).map((p) => {
        const x0 = clipSecondsAt(audio, p.src0, bpm) / seconds;
        const x1 = clipSecondsAt(audio, p.src1, bpm) / seconds;
        return (
          <div key={p.src0} className="absolute top-0" style={{ left: `${x0 * 100}%`, width: `${Math.max(0, x1 - x0) * 100}%`, height }}>
            <Waveform soundId={audio.soundId} from={p.src0} to={p.src1} width={Math.max(2, Math.round((x1 - x0) * columns))} height={height} stretch gain={gain} color={color} className="block" />
          </div>
        );
      })}
    </div>
  );
};
