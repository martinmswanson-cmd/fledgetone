/**
 * The editor docked under the timeline for an audio clip (where the piano roll goes for note
 * clips): its stretch of the sound with warp markers and gain envelope, gain and fades, Follow
 * tempo (time-stretch), Tune, Chop to Slicer.
 */
import React, { useEffect, useState } from 'react';
import { AudioWaveform, FlipHorizontal2, Gauge, Magnet, Maximize2, Slice, Spline, Wand2, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useLivePlayhead } from '../../store/playheadClock';
import { useTimelineStore, songTempo } from '../../store/timelineStore';
import { tempoAt } from '../../audio/tempoMap';
import type { Clip, Track } from '../../store/timelineTypes';
import { AUDIO_GAIN_MAX, AUDIO_GAIN_MIN, STRETCH_BPM_MAX, STRETCH_BPM_MIN } from '../../store/timelineTypes';
import { audioClipSeconds, audioSourceSeconds, loopTempos, stretchRatio } from '../../store/audioClips';
import { useSoundLibrary } from '../../audio/soundLibrary';
import { dbToGain } from '../../audio/clipEnvelope';
import { shouldIgnoreShortcut } from '../keyboard';
import { UndoableRange } from '../UndoableRange';
import { ChopToSlicerDialog } from './ChopToSlicerDialog';
import { ClipWaveform } from './Waveform';
import { AudioWarpGain, type AudioTool } from './AudioWarpGain';
import { normalizeClip, quantizeClipAudio, reverseClip } from '../../audio/audioEdits';
import { showToast } from './toastStore';

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
  // The tempo where the clip starts, which its sound plays at
  const bpm = useTimelineStore((s) => tempoAt(clip.startBar, songTempo(s)));
  const audio = clip.audio!;
  const meta = useSoundLibrary((s) => s.metas[audio.soundId]);
  const [chopping, setChopping] = useState(false);
  const [tool, setTool] = useState<AudioTool>(null);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState(0.25);
  const [strength, setStrength] = useState(1);
  /** Run an edit that works on the sound, with a word if it fails. */
  const edit = async (work: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const said = await work();
      if (said) showToast(said);
    } catch (err) {
      showToast(`Couldn't do that: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  const seconds = audioClipSeconds(clip, bpm);
  /** Seconds of the sound it plays (more or fewer than `seconds` when it follows the tempo) */
  const sourceSeconds = audioSourceSeconds(clip, bpm);
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
            // One undo step for the whole rename
            onFocus={() => useTimelineStore.getState().checkpoint()}
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
        <StretchControls clip={clip} bpm={bpm} />
        <button type="button" onClick={() => useUiStore.getState().setTuneClip(clip.id)} className={`${select} flex items-center gap-1.5 hover:border-cyan-500 ${audio.tunedFrom ? '!border-cyan-500/70 text-cyan-200' : ''}`} title="Pull a vocal's pitch onto the notes of a key">
          <Wand2 className="w-3.5 h-3.5" /> {audio.tunedFrom ? 'Tuned…' : 'Tune vocal…'}
        </button>
        <button type="button" onClick={() => setChopping(true)} className={`${select} flex items-center gap-1.5 hover:border-cyan-500`} title="Cut this clip's sound into slices on a new Slicer track">
          <Slice className="w-3.5 h-3.5" /> Chop to Slicer…
        </button>
        <span className="hidden xl:inline text-[11px]">
          {meta ? `${meta.name} · ${formatSeconds(meta.seconds)}` : 'Sound'} · plays {formatSeconds(audio.offset)} to {formatSeconds(audio.offset + sourceSeconds)} · drag the clip's edges to trim, its top corners for the fades
        </span>
        <button type="button" onClick={() => useTimelineStore.getState().closeEditor()} className="ml-auto flex items-center gap-1 text-forge-muted hover:text-forge-text" title="Close editor (Esc)">
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      <div className="relative px-4 py-3 select-none">
        <div className="relative rounded-md overflow-hidden border border-forge-border bg-black/40" style={{ height: WAVE_H }}>
          <ClipWaveform audio={audio} bpm={bpm} seconds={seconds} columns={WAVE_COLUMNS} height={WAVE_H} gain={dbToGain(audio.gain)} color={track.color} className="block" />
          {/* The fades: the quiet corners shaded, as on the clip */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${WAVE_COLUMNS} ${WAVE_H}`} preserveAspectRatio="none" aria-hidden="true">
            {audio.fadeIn > 0 && <polygon points={`0,0 ${px(audio.fadeIn)},0 0,${WAVE_H}`} fill="black" fillOpacity={0.45} />}
            {audio.fadeIn > 0 && <line x1={0} y1={WAVE_H} x2={px(audio.fadeIn)} y2={0} stroke="white" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {audio.fadeOut > 0 && <polygon points={`${WAVE_COLUMNS},0 ${WAVE_COLUMNS - px(audio.fadeOut)},0 ${WAVE_COLUMNS},${WAVE_H}`} fill="black" fillOpacity={0.45} />}
            {audio.fadeOut > 0 && <line x1={WAVE_COLUMNS} y1={WAVE_H} x2={WAVE_COLUMNS - px(audio.fadeOut)} y2={0} stroke="white" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          </svg>
          <EditorPlayhead clip={clip} />
          <AudioWarpGain clip={clip} bpm={bpm} seconds={seconds} width={WAVE_COLUMNS} height={WAVE_H} tool={tool} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono text-forge-muted" role="toolbar" aria-label="Audio editing">
          <button type="button" aria-pressed={tool === 'warp'} onClick={() => setTool(tool === 'warp' ? null : 'warp')} className={`${select} flex items-center gap-1.5 ${tool === 'warp' ? '!border-amber-400 text-amber-200 bg-amber-500/15' : 'hover:border-cyan-500'}`} title="Warp markers: double-click the waveform to pin a moment, drag a marker to move it in time (snaps to 16ths, Shift for anywhere), right-click to remove">
            <Spline className="w-3.5 h-3.5" /> Warp{audio.warp?.length ? ` · ${audio.warp.length}` : ''}
          </button>
          <button type="button" aria-pressed={tool === 'gain'} onClick={() => setTool(tool === 'gain' ? null : 'gain')} className={`${select} flex items-center gap-1.5 ${tool === 'gain' ? '!border-lime-400 text-lime-200 bg-lime-500/15' : 'hover:border-cyan-500'}`} title="Gain envelope: click to add a point, drag points up and down, right-click to remove">
            <AudioWaveform className="w-3.5 h-3.5" /> Gain envelope{audio.envelope?.length ? ` · ${audio.envelope.length}` : ''}
          </button>
          <span className="mx-1 h-5 w-px bg-forge-border" />
          <span>Quantize audio</span>
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} className={select} aria-label="Quantize grid">
            <option value={1}>1/4</option>
            <option value={0.5}>1/8</option>
            <option value={0.25}>1/16</option>
            <option value={0.125}>1/32</option>
          </select>
          <select value={strength} onChange={(e) => setStrength(Number(e.target.value))} className={select} aria-label="Quantize strength" title="How far each hit moves toward the grid">
            <option value={1}>100%</option>
            <option value={0.75}>75%</option>
            <option value={0.5}>50%</option>
            <option value={0.25}>25%</option>
          </select>
          <button type="button" disabled={busy} onClick={() => void edit(async () => `Moved ${await quantizeClipAudio(clip.id, grid, strength)} hits onto the grid (with warp markers: drag them to adjust, Undo to go back)`)} className={`${select} flex items-center gap-1.5 hover:border-cyan-500 disabled:opacity-50`} title="Find the hits in the audio and pull each onto the grid with warp markers">
            <Magnet className="w-3.5 h-3.5" /> Quantize
          </button>
          {!!audio.warp?.length && (
            <button type="button" onClick={() => useTimelineStore.getState().setClipAudio(clip.id, { warp: undefined }, true)} className={`${select} hover:border-red-400`} title="Remove every warp marker">
              Clear warp
            </button>
          )}
          {!!audio.envelope?.length && (
            <button type="button" onClick={() => useTimelineStore.getState().setClipAudio(clip.id, { envelope: undefined }, true)} className={`${select} hover:border-red-400`} title="Remove the gain envelope">
              Clear envelope
            </button>
          )}
          <span className="mx-1 h-5 w-px bg-forge-border" />
          <button type="button" disabled={busy} onClick={() => void edit(async () => (await reverseClip(clip.id), null))} className={`${select} flex items-center gap-1.5 hover:border-cyan-500 disabled:opacity-50 ${audio.reversedFrom ? '!border-cyan-500/70 text-cyan-200' : ''}`} title={audio.reversedFrom ? 'Reversed: click to play it forwards again' : 'Play the clip backwards'}>
            <FlipHorizontal2 className="w-3.5 h-3.5" /> {audio.reversedFrom ? 'Reversed' : 'Reverse'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void edit(async () => {
              const gain = await normalizeClip(clip.id);
              return gain === null ? 'That clip is silent' : `Gain set to ${formatDb(gain)}: its loudest moment now peaks just under full scale`;
            })}
            className={`${select} flex items-center gap-1.5 hover:border-cyan-500 disabled:opacity-50`}
            title="Set the clip gain so its loudest moment peaks just under full scale"
          >
            <Maximize2 className="w-3.5 h-3.5" /> Normalize
          </button>
        </div>
      </div>
      {chopping && <ChopToSlicerDialog clipId={clip.id} onClose={() => setChopping(false)} />}
    </div>
  );
};

/**
 * Follow tempo: time-stretch the clip to the song's tempo (same pitch), given the tempo it was
 * recorded at. Suggested tempos are the ones at which it lasts a whole number of bars.
 */
const StretchControls: React.FC<{ clip: Clip; bpm: number }> = ({ clip, bpm }) => {
  const audio = clip.audio!;
  const on = !!audio.stretchBpm;
  const [draft, setDraft] = useState<string | null>(null);
  const set = (v: number | undefined) => useTimelineStore.getState().setClipStretch(clip.id, v);
  const asRecorded = audioSourceSeconds(clip, bpm);
  const guesses = loopTempos(asRecorded, bpm).slice(0, 3);
  const ratio = stretchRatio(audio, bpm);
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Follow tempo">
      <label className="flex items-center gap-1.5" title="Time-stretch the clip with the song's tempo (it keeps its pitch), the way loops should behave">
        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked ? guesses[0] ?? bpm : undefined)} aria-label="Follow the song's tempo" />
        <Gauge className="w-3.5 h-3.5" /> FOLLOW TEMPO
      </label>
      {on && (
        <>
          <span>recorded at</span>
          <input
            value={draft ?? String(audio.stretchBpm)}
            onFocus={(e) => {
              setDraft(String(audio.stretchBpm));
              e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const v = Number(draft);
              if (draft !== null && Number.isFinite(v) && v >= STRETCH_BPM_MIN && v <= STRETCH_BPM_MAX) set(v);
              setDraft(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-7 w-16 bg-forge-bg border border-forge-border rounded-md px-1.5 text-forge-text tabular-nums focus:outline-none focus:border-cyan-500"
            aria-label="The tempo the recording was made at (BPM)"
            title="The tempo the recording was made at"
          />
          <span>BPM</span>
          {guesses
            .filter((g) => Math.abs(g - (audio.stretchBpm ?? 0)) > 0.05)
            .map((g) => (
              <button key={g} type="button" onClick={() => set(g)} className="h-6 px-1.5 rounded border border-forge-border text-[10px] hover:text-forge-text hover:border-cyan-500" title={`It lasts a whole number of bars at ${g} BPM`}>
                {g}
              </button>
            ))}
          <span className={`tabular-nums ${Math.abs(ratio - 1) > 0.3 ? 'text-amber-300' : 'text-forge-text'}`} title="How fast it plays: over about 30% faster or slower, hits start to smear">
            ×{ratio.toFixed(2)}
          </span>
        </>
      )}
    </div>
  );
};

/** The playhead over the waveform, following the store on its own so the editor doesn't re-render per frame. */
const EditorPlayhead: React.FC<{ clip: Clip }> = ({ clip }) => {
  const playhead = useLivePlayhead();
  const fraction = (playhead - clip.startBar) / clip.lengthBars;
  if (fraction < 0 || fraction > 1) return null;
  return <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 pointer-events-none" style={{ left: `${fraction * 100}%` }} />;
};
