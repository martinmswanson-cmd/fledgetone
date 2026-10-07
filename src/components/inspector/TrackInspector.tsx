import React, { useState } from 'react';
import {
  SlidersHorizontal,
  X,
  RotateCcw,
  Waves,
  Sparkles,
  Radio,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sliders,
  Trash2,
} from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { useAudioStore } from '../../store/audioStore';
import type { InstrumentKey } from '../../store/timelineTypes';
import { EqCurvePreview } from './EqCurvePreview';
import { DistortionPanel, DynamicsAndChorusPanels } from './InsertFx';
import { SampleLoader } from './SampleLoader';
import { INSTRUMENTS, instrumentsByCategory } from '../../audio/instrumentCatalog';
import { retryInstrumentDownload } from '../../audio/liveTracks';
import { UndoableRange } from '../UndoableRange';

export const TrackInspector: React.FC = () => {
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const tracks = useTimelineStore((s) => s.tracks);
  const isInspectorOpen = useTimelineStore((s) => s.isInspectorOpen);
  // Subscribed (not read once from getState) so the Master Aux Bus controls follow their values
  const masterReverbDecay = useTimelineStore((s) => s.masterReverbDecay);
  const masterDelayTime = useTimelineStore((s) => s.masterDelayTime);
  const masterDelayFeedback = useTimelineStore((s) => s.masterDelayFeedback);
  const {
    toggleInspector,
    setTrackInstrument,
    setTrackEq,
    resetTrackEq,
    setTrackReverbSend,
    setTrackDelaySend,
    setTrackVolume,
    setTrackPan,
    setMasterReverbDecay,
    setMasterDelayTime,
    setMasterDelayFeedback,
  } = useTimelineStore.getState();

  const instrumentStatus = useAudioStore((s) => s.instrumentStatus);
  const [activeTab, setActiveTab] = useState<'track' | 'master'>('track');

  if (!isInspectorOpen) return null;

  const currentTrack = tracks.find((t) => t.id === selectedTrackId) || tracks[0];
  if (!currentTrack) return null;

  const trackIndex = tracks.findIndex((t) => t.id === currentTrack.id);
  const status = instrumentStatus[currentTrack.instrumentKey] ?? 'ready';

  const formatDb = (val: number) => {
    if (Math.abs(val) < 0.05) return '0.0 dB';
    return `${val > 0 ? '+' : ''}${val.toFixed(1)} dB`;
  };

  /** Delete the track (and its clips), confirming first when there's music on it. */
  const removeTrack = () => {
    const clipCount = useTimelineStore.getState().clips.filter((c) => c.trackId === currentTrack.id).length;
    const ok =
      clipCount === 0 ||
      window.confirm(
        `Delete "${currentTrack.name}" and its ${clipCount} clip${clipCount === 1 ? '' : 's'}?\n\nUndo (Ctrl+Z) brings it back.`
      );
    if (ok) useTimelineStore.getState().deleteTrack(currentTrack.id);
  };

  const delaySubdivisions = [
    { label: '1/4', value: '4n' },
    { label: '1/8', value: '8n' },
    { label: '1/8D', value: '8n.' },
    { label: '1/16', value: '16n' },
  ];

  return (
    <aside
      className="w-80 shrink-0 bg-forge-panel/95 backdrop-blur-md border-l border-forge-border flex flex-col shadow-2xl z-30 transition-all select-none overflow-y-auto max-h-[640px]"
      aria-label="Audio Track Inspector and FX Rack"
    >
      {/* Header */}
      <div className="p-3 border-b border-forge-border bg-black/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-3 h-3 rounded-full shrink-0 shadow-sm"
            style={{ backgroundColor: currentTrack.color, boxShadow: `0 0 8px ${currentTrack.color}88` }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-forge-muted font-bold tracking-wider uppercase">
                CH {String(trackIndex + 1).padStart(2, '0')}
              </span>
              <span className="text-xs font-bold text-white truncate">{currentTrack.name}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={removeTrack}
            className="w-6 h-6 rounded flex items-center justify-center text-forge-muted hover:text-red-300 hover:bg-red-950/40 transition"
            title="Delete this track"
            aria-label={`Delete track ${currentTrack.name}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => toggleInspector(false)}
            className="w-6 h-6 rounded flex items-center justify-center text-forge-muted hover:text-white hover:bg-forge-bg transition"
            title="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs: Track Strip vs Master Return FX */}
      <div className="flex border-b border-forge-border bg-black/20 text-[10px] font-mono uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setActiveTab('track')}
          className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 border-b-2 font-semibold transition ${
            activeTab === 'track'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
              : 'border-transparent text-forge-muted hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Track FX
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('master')}
          className={`flex-1 py-1.5 flex items-center justify-center gap-1.5 border-b-2 font-semibold transition ${
            activeTab === 'master'
              ? 'border-amber-400 text-amber-300 bg-amber-950/20'
              : 'border-transparent text-forge-muted hover:text-white'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          Master Aux Bus
        </button>
      </div>

      <div className="p-3.5 flex flex-col gap-4">
        {activeTab === 'track' ? (
          <>
            {/* Instrument Assignment & Status */}
            <div className="flex flex-col gap-1.5 bg-forge-bg p-2.5 rounded-lg border border-forge-border">
              <div className="flex items-center justify-between text-[10px] font-mono text-forge-muted">
                <span>SOUND GENERATOR</span>
                {/* Soundbank Loading Status Badge */}
                <div className="flex items-center gap-1">
                  {status === 'loading' && (
                    <span className="flex items-center gap-1 text-cyan-400 font-semibold animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading CDN...
                    </span>
                  )}
                  {status === 'ready' && (
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      Ready
                    </span>
                  )}
                  {status === 'error' && (
                    <span className="flex items-center gap-1 text-red-400 font-semibold" title="Couldn't download the sounds">
                      <AlertCircle className="w-3 h-3" />
                      Error
                      <button
                        type="button"
                        onClick={() => void retryInstrumentDownload(currentTrack.instrumentKey).catch(() => {})}
                        className="ml-1 px-1.5 py-0.5 rounded border border-red-500/50 text-red-200 hover:bg-red-950/50 transition"
                        title="Try the download again"
                      >
                        Retry
                      </button>
                    </span>
                  )}
                  {status === 'unloaded' && (
                    <span className="text-zinc-500 font-semibold">Idle</span>
                  )}
                </div>
              </div>

              <select
                value={currentTrack.instrumentKey}
                onChange={(e) => setTrackInstrument(currentTrack.id, e.target.value as InstrumentKey)}
                className="w-full bg-forge-panel border border-forge-border rounded px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer focus:border-cyan-400 focus:outline-none"
              >
                {instrumentsByCategory().map(({ category, instruments }) => (
                  <optgroup key={category} label={category}>
                    {instruments.map((inst) => (
                      <option key={inst.key} value={inst.key}>
                        {inst.name} ({inst.blurb})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {INSTRUMENTS[currentTrack.instrumentKey].kind === 'sampled' && (
                <span className="text-[10px] text-forge-muted">Recorded samples, downloaded the first time you use them (needs internet).</span>
              )}
            </div>

            {currentTrack.instrumentKey === 'sampler' && <SampleLoader track={currentTrack} />}

            {/* Insert chain, in signal order: Distortion -> EQ -> Compressor -> Chorus */}
            <DistortionPanel track={currentTrack} />

            {/* 3-Band Parametric EQ Panel */}
            <div className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">
                    3-Band Parametric EQ
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => resetTrackEq(currentTrack.id)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-forge-muted hover:text-white bg-forge-panel hover:bg-forge-border flex items-center gap-1 border border-forge-border transition"
                  title="Reset EQ bands to 0 dB"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset
                </button>
              </div>

              {/* Dynamic SVG Frequency Curve Visualizer */}
              <EqCurvePreview eq={currentTrack.eq} color={currentTrack.color} />

              {/* 3 Vertical Sliders */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                {/* Low Band (400Hz) */}
                <div className="flex flex-col items-center bg-black/40 p-2 rounded border border-forge-border/80">
                  <span className="text-[10px] font-mono font-bold text-cyan-300">LOW</span>
                  <span className="text-[9px] font-mono text-forge-muted mb-1">400Hz</span>
                  <UndoableRange
                    min={-24}
                    max={12}
                    step={0.5}
                    value={currentTrack.eq?.low ?? 0}
                    onValue={(v) => setTrackEq(currentTrack.id, { low: v })}
                    resetValue={0}
                    className="h-24 w-1.5 appearance-none bg-zinc-700 rounded cursor-pointer accent-cyan-400 [writing-mode:vertical-lr] [direction:rtl]"
                    title="Low Shelf (-24dB to +12dB)"
                  />
                  <span className="text-[10px] font-mono tabular-nums text-white mt-1.5 font-semibold">
                    {formatDb(currentTrack.eq?.low ?? 0)}
                  </span>
                </div>

                {/* Mid Band (1.0kHz) */}
                <div className="flex flex-col items-center bg-black/40 p-2 rounded border border-forge-border/80">
                  <span className="text-[10px] font-mono font-bold text-emerald-300">MID</span>
                  <span className="text-[9px] font-mono text-forge-muted mb-1">1.0kHz</span>
                  <UndoableRange
                    min={-24}
                    max={12}
                    step={0.5}
                    value={currentTrack.eq?.mid ?? 0}
                    onValue={(v) => setTrackEq(currentTrack.id, { mid: v })}
                    resetValue={0}
                    className="h-24 w-1.5 appearance-none bg-zinc-700 rounded cursor-pointer accent-emerald-400 [writing-mode:vertical-lr] [direction:rtl]"
                    title="Mid Bell (-24dB to +12dB)"
                  />
                  <span className="text-[10px] font-mono tabular-nums text-white mt-1.5 font-semibold">
                    {formatDb(currentTrack.eq?.mid ?? 0)}
                  </span>
                </div>

                {/* High Band (2.5kHz) */}
                <div className="flex flex-col items-center bg-black/40 p-2 rounded border border-forge-border/80">
                  <span className="text-[10px] font-mono font-bold text-amber-300">HIGH</span>
                  <span className="text-[9px] font-mono text-forge-muted mb-1">2.5kHz</span>
                  <UndoableRange
                    min={-24}
                    max={12}
                    step={0.5}
                    value={currentTrack.eq?.high ?? 0}
                    onValue={(v) => setTrackEq(currentTrack.id, { high: v })}
                    resetValue={0}
                    className="h-24 w-1.5 appearance-none bg-zinc-700 rounded cursor-pointer accent-amber-400 [writing-mode:vertical-lr] [direction:rtl]"
                    title="High Shelf (-24dB to +12dB)"
                  />
                  <span className="text-[10px] font-mono tabular-nums text-white mt-1.5 font-semibold">
                    {formatDb(currentTrack.eq?.high ?? 0)}
                  </span>
                </div>
              </div>
            </div>

            <DynamicsAndChorusPanels track={currentTrack} />

            {/* Aux FX Sends Section */}
            <div className="flex flex-col gap-3 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">
                  Post-Fader Aux Sends
                </span>
              </div>

              {/* Reverb Send */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-cyan-300 font-semibold flex items-center gap-1">
                    <Waves className="w-3 h-3" />
                    Studio Reverb Send
                  </span>
                  <span className="text-white tabular-nums font-bold">
                    {Math.round((currentTrack.reverbSend ?? 0) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <UndoableRange
                    min={0}
                    max={1}
                    step={0.01}
                    value={currentTrack.reverbSend ?? 0}
                    onValue={(v) => setTrackReverbSend(currentTrack.id, v)}
                    className="flex-1 accent-cyan-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
                  />
                  <div
                    className="w-12 h-2 rounded bg-zinc-800 overflow-hidden border border-zinc-700"
                    title="Reverb send meter"
                  >
                    <div
                      className="h-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] transition-all"
                      style={{ width: `${(currentTrack.reverbSend ?? 0) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Delay Send */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-amber-300 font-semibold flex items-center gap-1">
                    <Radio className="w-3 h-3" />
                    Ping-Pong Echo Send
                  </span>
                  <span className="text-white tabular-nums font-bold">
                    {Math.round((currentTrack.delaySend ?? 0) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <UndoableRange
                    min={0}
                    max={1}
                    step={0.01}
                    value={currentTrack.delaySend ?? 0}
                    onValue={(v) => setTrackDelaySend(currentTrack.id, v)}
                    className="flex-1 accent-amber-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
                  />
                  <div
                    className="w-12 h-2 rounded bg-zinc-800 overflow-hidden border border-zinc-700"
                    title="Delay send meter"
                  >
                    <div
                      className="h-full bg-amber-400 shadow-[0_0_8px_#f59e0b] transition-all"
                      style={{ width: `${(currentTrack.delaySend ?? 0) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Fader & Pan Strip */}
            <div className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border">
              <span className="text-[10px] font-mono font-bold uppercase text-forge-muted tracking-wider">
                CHANNEL FADER
              </span>
              <div className="flex items-center justify-between gap-3 text-xs font-mono">
                <span className="text-forge-muted text-[10px]">VOL</span>
                <UndoableRange
                  min={-60}
                  max={6}
                  step={0.5}
                  value={currentTrack.volume}
                  onValue={(v) => setTrackVolume(currentTrack.id, v)}
                  resetValue={0}
                  className="flex-1 accent-white cursor-pointer h-1.5 bg-zinc-800 rounded appearance-none"
                />
                <span className="w-12 text-right font-bold tabular-nums text-white">
                  {currentTrack.volume <= -60 ? '-inf' : `${currentTrack.volume > 0 ? '+' : ''}${currentTrack.volume.toFixed(1)}`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs font-mono">
                <span className="text-forge-muted text-[10px]">PAN</span>
                <UndoableRange
                  min={-1}
                  max={1}
                  step={0.01}
                  value={currentTrack.pan}
                  onValue={(v) => setTrackPan(currentTrack.id, v)}
                  resetValue={0}
                  className="flex-1 accent-white cursor-pointer h-1.5 bg-zinc-800 rounded appearance-none"
                />
                <span className="w-12 text-right font-bold tabular-nums text-white">
                  {Math.abs(currentTrack.pan) < 0.01
                    ? 'C'
                    : `${currentTrack.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(currentTrack.pan) * 100)}`}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={removeTrack}
              className="h-8 flex items-center justify-center gap-1.5 rounded-md border border-red-500/40 text-red-300 text-xs font-mono hover:bg-red-950/40 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete this track
            </button>
          </>
        ) : (
          /* Master Bus Effects Return Controls */
          <div className="flex flex-col gap-4">
            {/* Master Reverb Unit */}
            <div className="flex flex-col gap-2.5 bg-forge-bg p-3 rounded-lg border border-forge-border shadow-md">
              <div className="flex items-center justify-between border-b border-forge-border pb-2">
                <div className="flex items-center gap-1.5">
                  <Waves className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                    Master Convolution Reverb
                  </span>
                </div>
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-500/30">
                  Return 1
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-forge-muted">Room Decay Time:</span>
                  <span className="text-cyan-300 font-bold tabular-nums">{masterReverbDecay.toFixed(1)}s</span>
                </div>
                <UndoableRange
                  min={0.8}
                  max={6.0}
                  step={0.1}
                  value={masterReverbDecay}
                  onValue={setMasterReverbDecay}
                  className="w-full accent-cyan-400 cursor-pointer h-2 bg-zinc-800 rounded-lg appearance-none"
                />
                <div className="flex justify-between text-[9px] font-mono text-forge-muted">
                  <span>Tight (0.8s)</span>
                  <span>Cathedral (6.0s)</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-[10px] font-mono text-forge-muted bg-black/40 p-2 rounded">
                <span>Pre-Delay: 20ms</span>
                <span>HF Damping: Enabled</span>
                <span>Mix: 100% Wet</span>
              </div>
            </div>

            {/* Master Delay Unit */}
            <div className="flex flex-col gap-2.5 bg-forge-bg p-3 rounded-lg border border-forge-border shadow-md">
              <div className="flex items-center justify-between border-b border-forge-border pb-2">
                <div className="flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                    Ping-Pong Echo Delay
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30">
                  Return 2
                </span>
              </div>

              {/* Tempo-Synced Delay Division Picker */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-mono text-forge-muted">Echo Subdivision:</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {delaySubdivisions.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setMasterDelayTime(d.value)}
                      className={`py-1.5 text-xs font-mono font-bold rounded border transition ${
                        masterDelayTime === d.value
                          ? 'bg-amber-500 text-black border-amber-300 shadow-[0_0_8px_#f59e0b88]'
                          : 'bg-black/40 text-forge-muted border-forge-border hover:text-white'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feedback Dial */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-forge-muted">Echo Feedback:</span>
                  <span className="text-amber-300 font-bold tabular-nums">
                    {Math.round(masterDelayFeedback * 100)}%
                  </span>
                </div>
                <UndoableRange
                  min={0}
                  max={0.8}
                  step={0.02}
                  value={masterDelayFeedback}
                  onValue={setMasterDelayFeedback}
                  className="w-full accent-amber-400 cursor-pointer h-2 bg-zinc-800 rounded-lg appearance-none"
                />
                <div className="flex justify-between text-[9px] font-mono text-forge-muted">
                  <span>Single Slap (0%)</span>
                  <span>Infinite Space (80%)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
