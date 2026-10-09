import React, { useEffect, useState } from 'react';
import { AudioWaveform, Slice, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, Track } from '../../store/timelineTypes';
import { AUDIO_GAIN_MAX, AUDIO_GAIN_MIN } from '../../store/timelineTypes';
import { audioClipSeconds } from '../../store/audioClips';
import { useSoundLibrary } from '../../audio/soundLibrary';
import { dbToGain } from '../../audio/clipEnvelope';
import { shouldIgnoreShortcut } from '../keyboard';
import { UndoableRange } from '../UndoableRange';
import { ChopToSlicerDialog } from './ChopToSlicerDialog';
import { Waveform } from './Waveform';

const WAVE_H = 120;
const WAVE_COLUMNS = 1200;

const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const formatDb = (db: number) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

/**
 * Editor for one audio clip, docked under the timeline where the piano roll goes for note clips:
 * the stretch of the sound the clip plays, its gain and its fades (sliders, one undo step per
 * adjustment), and "Chop to Slicer…".
 */
export const AudioClipEditor: React.FC<{ clip: Clip; track: Track }> = ({ clip, track }) => {
  const bpm = useTimelineStore((s) => s.bpm);
  const audio = clip.audio!;
  const meta = useSoundLibrary((s) => s.metas[audio.soundId]);
  const [chopping, setChopping] = useState(false);
  const seconds = audioClipSeconds(clip, bpm);
  const maxFade = Math.max(0, Math.floor((seconds / 2) * 100) / 100);
  const setAudio = (patch: Parameters<ReturnType<typeof useTimelineStore.getState>['setClipAudio']>[1]) =>
    useTimelineStore.getState().setClipAudio(clip.id, patch);
  const px = (s: number) => (s / Math.max(seconds, 1e-9)) * WAVE_COLUMNS;
  // Esc closes the editor (capture phase, before the timeline's Esc clears the selection)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || shouldIgnoreShortcut(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      useTimelineStore.getState().closeEditor();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const select = 'h-7 bg-forge-bg border border-forge-border rounded-md px-1.5 text-forge-text focus:outline-none focus:border-cyan-500';

  const fadeSlider = (label: string, value: number, key: 'fadeIn' | 'fadeOut') => (
    <label className="flex items-center gap-1.5" title={`${label}, in seconds (up to half the clip)`}>
      {label.toUpperCase()}
      <UndoableRange min={0} max={maxFade} step={0.01} value={Math.min(value, maxFade)} onValue={(v) => setAudio({ [key]: v })} className="w-24 cursor-pointer" style={{ accentColor: track.color }} />
      <span className="w-12 tabular-nums text-forge-text">{value.toFixed(2)} s</span>
    </label>
  );

  return (
    <div className="border-t-2 bg-forge-panel flex flex-col" style={{ borderTopColor: track.color }} aria-label="Audio clip editor">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-forge-border text-xs font-mono text-forge-muted">
        <div className="flex items-center gap-2">
          <AudioWaveform className="w-4 h-4" style={{ color: track.color }} />
          <input
            value={clip.name}
            onChange={(e) => useTimelineStore.getState().renameClip(clip.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-7 w-40 bg-transparent border border-transparent hover:border-forge-border focus:border-cyan-500 rounded-md px-2 text-sm font-semibold text-forge-text focus:outline-none"
            aria-label="Clip name"
          />
          <span className="text-[11px]">{track.name}</span>
        </div>
        <label className="flex items-center gap-1.5" title="Clip gain, -24 to +24 dB (double-click for 0 dB)">
          GAIN
          <UndoableRange
            min={AUDIO_GAIN_MIN}
            max={AUDIO_GAIN_MAX}
            step={0.5}
            value={audio.gain}
            onValue={(v) => setAudio({ gain: v })}
            resetValue={0}
            className="w-28 cursor-pointer"
            style={{ accentColor: track.color }}
          />
          <span className="w-16 tabular-nums text-forge-text">{formatDb(audio.gain)}</span>
        </label>
        {fadeSlider('Fade in', audio.fadeIn, 'fadeIn')}
        {fadeSlider('Fade out', audio.fadeOut, 'fadeOut')}
        <button type="button" onClick={() => setChopping(true)} className={`${select} flex items-center gap-1.5 hover:border-cyan-500`} title="Cut this clip's sound into slices on a new Slicer track">
          <Slice className="w-3.5 h-3.5" /> Chop to Slicer…
        </button>
        <span className="hidden xl:inline text-[11px]">
          {meta ? `${meta.name} · ${formatSeconds(meta.seconds)}` : 'Sound'} · plays {formatSeconds(audio.offset)} to {formatSeconds(audio.offset + seconds)} · drag the clip's edges to trim, its top corners for the fades
        </span>
        <button type="button" onClick={() => useTimelineStore.getState().closeEditor()} className="ml-auto flex items-center gap-1 text-forge-muted hover:text-forge-text" title="Close editor (Esc)">
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      <div className="relative px-4 py-3 select-none">
        <div className="relative rounded-md overflow-hidden border border-forge-border bg-black/40" style={{ height: WAVE_H }}>
          <Waveform soundId={audio.soundId} from={audio.offset} to={audio.offset + seconds} width={WAVE_COLUMNS} height={WAVE_H} stretch gain={dbToGain(audio.gain)} color={track.color} className="block" />
          {/* The fades: the quiet corners shaded, as on the clip */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${WAVE_COLUMNS} ${WAVE_H}`} preserveAspectRatio="none" aria-hidden="true">
            {audio.fadeIn > 0 && <polygon points={`0,0 ${px(audio.fadeIn)},0 0,${WAVE_H}`} fill="black" fillOpacity={0.45} />}
            {audio.fadeIn > 0 && <line x1={0} y1={WAVE_H} x2={px(audio.fadeIn)} y2={0} stroke="white" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {audio.fadeOut > 0 && <polygon points={`${WAVE_COLUMNS},0 ${WAVE_COLUMNS - px(audio.fadeOut)},0 ${WAVE_COLUMNS},${WAVE_H}`} fill="black" fillOpacity={0.45} />}
            {audio.fadeOut > 0 && <line x1={WAVE_COLUMNS} y1={WAVE_H} x2={WAVE_COLUMNS - px(audio.fadeOut)} y2={0} stroke="white" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          </svg>
          <EditorPlayhead clip={clip} />
        </div>
      </div>
      {chopping && <ChopToSlicerDialog clipId={clip.id} onClose={() => setChopping(false)} />}
    </div>
  );
};

/** The playhead over the waveform, following the store on its own so the editor doesn't re-render per frame. */
const EditorPlayhead: React.FC<{ clip: Clip }> = ({ clip }) => {
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const fraction = (playhead - clip.startBar) / clip.lengthBars;
  if (fraction < 0 || fraction > 1) return null;
  return <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 pointer-events-none" style={{ left: `${fraction * 100}%` }} />;
};
