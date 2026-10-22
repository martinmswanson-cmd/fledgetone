/**
 * The Track Inspector (the side panel): the selected track's instrument and its own panel (Slicer,
 * Drum Rack, Multi Sampler, Synth Designer, 808 designer, Sampler, Audio track), the heavy bass
 * tools (Glide, Sub enhancer, kick clash check), Expressive playing, the insert
 * effects in chain order, sends to returns, and the Master tab.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  SlidersHorizontal,
  X,
  RotateCcw,
  Waves,
  Radio,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sliders,
  Trash2,
  Bookmark,
  Share2,
  FolderOpen,
} from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { useAudioStore } from '../../store/audioStore';
import { EqCurvePreview } from './EqCurvePreview';
import { DistortionPanel, DuckProxyPanel, DynamicsAndChorusPanels, FilterAndPumpPanels, HumanPanel } from './InsertFx';
import { SampleLoader } from './SampleLoader';
import { SlicerPanel } from './SlicerPanel';
import { MultiPanel, RackPanel } from './SampleKitPanels';
import { PeqPanel } from './PeqEditor';
import { MbcPanel } from './MbcPanel';
import { isSynthKit } from '../../store/synthKits';
import { DrumDesignPanel } from './DrumDesignPanel';
import { BusFxPanels, BusPresetPanel } from './BusFxPanels';
import { SynthPanel } from './SynthPanel';
import { Bass808Panel, BassDrivePanel, GlidePanel, KickClashPanel, SubLayerPanel } from './BassPanels';
import { RingPanel } from './RingPanel';
import { AudioTrackPanel } from './AudioTrackPanel';
import { MasterPanels } from './MasterPanels';
import { RecordedRoom, RoomStylePicker } from './RecordedRoom';
import { INSTRUMENTS, isAudioKind, isDropKind, isSlicerKind, seatOf } from '../../audio/instrumentCatalog';

/** Instruments Expressive playing changes: the recorded ones (but sound effects) and the drum kits. */
const canPlayExpressively = (key: keyof typeof INSTRUMENTS) => {
  const def = INSTRUMENTS[key];
  return (def.kind === 'sampled' && def.category !== 'Sound Effects') || def.kind === 'drums' || key === 'bass808';
};
import type { InstrumentDef } from '../../audio/instrumentCatalog';
import { InstrumentPicker } from '../InstrumentMenu';
import { useMySounds } from '../../store/mySounds';
import { captureWamStates } from '../../audio/wamHost';
import { pickSoundFile, shareTrackSound } from '../mySoundsFile';
import { showToast } from '../timeline/toastStore';
import { retryInstrumentDownload } from '../../audio/liveTracks';
import { UndoableRange } from '../UndoableRange';
import { AutoBadge, Automatable } from '../timeline/AutoBadge';
import { AUTOMATED_TIP } from '../timeline/automationHooks';
import { isBus, isMixTrack, sendTargets } from '../../store/buses';
import type { Track } from '../../store/timelineTypes';
import { REVERB_SEND_KNOB_MAX, REVERB_SEND_MAX } from '../../store/timelineTypes';

/** One click to a kind of space: the master reverb's length. */
const notAudio = (def: InstrumentDef) => !isAudioKind(def.key);
/**
 * A track with clips keeps to its side of the Drop Pad (its notes are moves on the whole mix, an
 * instrument's are notes): the picker offers only the instruments it can switch to (see setTrackInstrument)
 */
const onlyDrop = (def: InstrumentDef) => isDropKind(def.key);
const notDrop = (def: InstrumentDef) => notAudio(def) && !isDropKind(def.key);

/** Keep a track's whole sound under a name, to pick from the instrument lists (My sounds) in any song. */
async function saveTrackSound(trackId: string): Promise<void> {
  const before = useTimelineStore.getState().tracks.find((t) => t.id === trackId);
  if (!before) return;
  const name = window.prompt('Save this sound as (it appears under My sounds in the instrument lists):', before.name);
  if (name === null) return;
  // A plugin's knobs are read now, so the sound keeps what was just turned
  if (before.plugin || before.pluginFx?.length) await captureWamStates();
  const track = useTimelineStore.getState().tracks.find((t) => t.id === trackId);
  if (!track) return;
  const saved = useMySounds.getState().saveSound(name, track);
  showToast(
    saved === 'too-big'
      ? "That sound's plugin settings are too big for the browser to keep."
      : saved === 'not-kept'
        ? "The browser wouldn't keep it (its storage is full or blocked)."
        : `${saved === 'replaced' ? 'Updated' : 'Saved'} "${name.trim() || track.name}": pick it from My sounds at the top of any instrument list.`
  );
}

const REVERB_SPACES = [
  { name: 'Room', decay: 1, hint: 'Tight and close: drums, rock, hip-hop' },
  { name: 'Studio', decay: 1.8, hint: 'A little air: pop, lo-fi, electronic' },
  { name: 'Hall', decay: 3.2, hint: 'A concert hall: orchestra, piano, strings' },
  { name: 'Cathedral', decay: 7, hint: 'Stone and height: choir, organ, sacred music' },
  { name: 'Heaven', decay: 11, hint: 'Endless: angelic pads, ambient, dreams' },
];

export const TrackInspector: React.FC = () => {
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const tracks = useTimelineStore((s) => s.tracks);
  // The reverb send's 300% top, turned on with a click for the track shown (another track starts at 200%)
  const [boostedTrack, setBoostedTrack] = useState<string | null>(null);
  const reverbBoost = boostedTrack !== null && boostedTrack === selectedTrackId;
  // Another track's settings start from the top (a new Drum Rack's Load sounds is there)
  const aside = useRef<HTMLElement>(null);
  useEffect(() => {
    if (aside.current) aside.current.scrollTop = 0;
  }, [selectedTrackId]);
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
  const activeTab = useUiStore((s) => s.inspectorTab);
  const setActiveTab = useUiStore.getState().setInspectorTab;

  const hasClips = useTimelineStore((s) => {
    const id = (s.tracks.find((t) => t.id === s.selectedTrackId) ?? s.tracks[0])?.id;
    return s.clips.some((c) => c.trackId === id);
  });

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
    // As tall as the timeline beside it, scrolling inside: a long FX rack never holds the timeline open
    // past its last track (the panel is placed over a box that takes the row's height, not its own)
    <div className="relative w-80 shrink-0">
    <aside
      ref={aside}
      className="absolute inset-0 bg-forge-panel/95 backdrop-blur-md border-l border-forge-border flex flex-col shadow-2xl z-30 transition-all select-none overflow-y-auto"
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
          Master
        </button>
      </div>

      <div className="p-3.5 flex flex-col gap-4">
        {activeTab === 'track' ? (
          <>
            {/* Instrument Assignment & Status */}
            <div data-search="instrument" className="flex flex-col gap-1.5 bg-forge-bg p-2.5 rounded-lg border border-forge-border">
              <div className="flex items-center justify-between text-[10px] font-mono text-forge-muted">
                <span>{isMixTrack(currentTrack) ? (isBus(currentTrack) ? "BUS" : "RETURN") : "SOUND GENERATOR"}</span>
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

              {isMixTrack(currentTrack) ? (
                <div className="w-full bg-forge-panel border border-forge-border rounded px-2.5 py-1.5 text-xs text-forge-text">
                  {isBus(currentTrack)
                    ? 'A bus: it plays the tracks routed into it (right-click a track → Play into…), through the effects below.'
                    : 'A return: it plays what tracks send to it (their Sends, below each track’s effects), through the effects below. Turn on a Reverb or Delay here at 100% mix.'}
                </div>
              ) : isAudioKind(currentTrack.instrumentKey) ? (
                // An Audio track's clips are sound files, which no instrument could play: it stays an Audio track
                <div className="w-full bg-forge-panel border border-forge-border rounded px-2.5 py-1.5 text-xs font-semibold text-white">
                  {INSTRUMENTS[currentTrack.instrumentKey].name} track ({INSTRUMENTS[currentTrack.instrumentKey].blurb.toLowerCase()})
                </div>
              ) : (
                <div className="flex items-stretch gap-1.5">
                  <InstrumentPicker
                    value={currentTrack.instrumentKey}
                    onChange={(key) => setTrackInstrument(currentTrack.id, key)}
                    onPickSound={(sound) => useTimelineStore.getState().setTrackSound(currentTrack.id, sound)}
                    include={!hasClips ? notAudio : isDropKind(currentTrack.instrumentKey) ? onlyDrop : notDrop}
                    label="Instrument"
                    withBlurb
                    className="flex-1 min-w-0 bg-forge-panel border border-forge-border rounded px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer hover:border-cyan-400/60 focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    data-search="save sound my sounds favourite preset"
                    onClick={() => void saveTrackSound(currentTrack.id)}
                    title="Save this sound (the instrument with all its settings, plugin knobs and effects) to My sounds, to pick in any song"
                    aria-label="Save this sound to My sounds"
                    className="shrink-0 px-2 rounded border border-forge-border bg-forge-panel text-forge-muted hover:text-amber-200 hover:border-amber-400/60"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    data-search="share sound file send preset export"
                    onClick={() => void shareTrackSound(currentTrack.id)}
                    title="Share this sound: save it as a small file (the instrument with all its settings and plugin knobs) to send to anyone"
                    aria-label="Share this sound as a file"
                    className="shrink-0 px-2 rounded border border-forge-border bg-forge-panel text-forge-muted hover:text-cyan-200 hover:border-cyan-400/60"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    data-search="open sound file import preset"
                    onClick={() => pickSoundFile(currentTrack.id)}
                    title="Open a sound file: put a shared sound on this track (it goes into My sounds too)"
                    aria-label="Open a sound file onto this track"
                    className="shrink-0 px-2 rounded border border-forge-border bg-forge-panel text-forge-muted hover:text-cyan-200 hover:border-cyan-400/60"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {INSTRUMENTS[currentTrack.instrumentKey].kind === 'sampled' && (
                <span className="text-[10px] text-forge-muted">Recorded samples, downloaded the first time you use them (needs internet).</span>
              )}
              {canPlayExpressively(currentTrack.instrumentKey) && (
                <label
                  data-search="expressive"
                  className="flex items-center gap-2 text-[11px] text-forge-text cursor-pointer"
                  title={
                    INSTRUMENTS[currentTrack.instrumentKey].kind === 'drums'
                      ? 'Each hit a hair different in pitch and level, as a real drummer plays: no machine-gun repeats'
                      : 'Softer notes are darker as well as quieter (on a natural loudness curve), and no two notes are quite the same: the recording plays the way the instrument sounds at that velocity'
                  }
                >
                  <input
                    type="checkbox"
                    className="accent-cyan-500"
                    checked={!!currentTrack.expressive}
                    onChange={(e) => useTimelineStore.getState().setTrackExpressive(currentTrack.id, e.target.checked)}
                  />
                  Expressive playing
                  <span className="text-forge-muted text-[10px]">{INSTRUMENTS[currentTrack.instrumentKey].kind === 'drums' ? 'every hit a little different' : 'velocity shapes the tone'}</span>
                </label>
              )}
            </div>

            <BusPresetPanel track={currentTrack} />
            {currentTrack.instrumentKey === 'sampler' && <SampleLoader track={currentTrack} />}
            {isSlicerKind(currentTrack.instrumentKey) && <SlicerPanel track={currentTrack} />}
            {currentTrack.instrumentKey === 'drumRack' && <RackPanel track={currentTrack} />}
            {currentTrack.instrumentKey === 'multiSampler' && <MultiPanel track={currentTrack} />}
            {currentTrack.instrumentKey === 'synthDesigner' && <SynthPanel track={currentTrack} />}
            {currentTrack.instrumentKey === 'bass808' && <Bass808Panel track={currentTrack} />}
            <RingPanel track={currentTrack} />
            <GlidePanel track={currentTrack} />
            <SubLayerPanel track={currentTrack} />
            {INSTRUMENTS[currentTrack.instrumentKey].category === 'Bass' && <KickClashPanel track={currentTrack} />}
            {currentTrack.instrumentKey === 'designedKit' && <DrumDesignPanel track={currentTrack} />}
            {isSynthKit(currentTrack.instrumentKey) && (
              <button
                type="button"
                className="self-start h-7 px-2 rounded border border-forge-border text-[10px] font-mono text-forge-muted hover:text-forge-text"
                title="Turn this track into a Designed Kit that starts from this kit's sounds, to change them in the Drum Designer"
                onClick={() => useTimelineStore.getState().setTrackInstrument(currentTrack.id, 'designedKit')}
              >
                EDIT IN DRUM DESIGNER
              </button>
            )}
            {isAudioKind(currentTrack.instrumentKey) && <AudioTrackPanel track={currentTrack} />}

            {/* Human works on the notes before the instrument plays them */}
            {!isAudioKind(currentTrack.instrumentKey) && !isMixTrack(currentTrack) && <HumanPanel track={currentTrack} />}
            {!isMixTrack(currentTrack) && <DuckProxyPanel track={currentTrack} />}

            {/* Insert chain, in signal order: Distortion -> Bass Drive -> EQ -> Pro EQ -> Compressor -> Multiband -> Chorus -> Lo-fi -> Filter -> Gate -> Pump */}
            <DistortionPanel track={currentTrack} />
            {!isMixTrack(currentTrack) && <BassDrivePanel track={currentTrack} />}

            {/* 3-Band Parametric EQ Panel */}
            <div data-search="eq" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
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
                <Automatable track={currentTrack} param="eqLow">
                  {(auto) => (
                    <div className="flex flex-col items-center bg-black/40 p-2 rounded border border-forge-border/80" title={auto !== null ? AUTOMATED_TIP : undefined}>
                      <span className="text-[10px] font-mono font-bold text-cyan-300">LOW</span>
                      <span className="text-[9px] font-mono text-forge-muted mb-1">{auto !== null ? <AutoBadge trackId={currentTrack.id} param="eqLow" /> : '<400Hz'}</span>
                      <UndoableRange
                        min={-24}
                        max={12}
                        step={0.5}
                        value={auto ?? currentTrack.eq?.low ?? 0}
                        onValue={(v) => setTrackEq(currentTrack.id, { low: v })}
                        resetValue={0}
                        disabled={auto !== null}
                        className="h-24 w-1.5 appearance-none bg-zinc-700 rounded cursor-pointer disabled:cursor-default accent-cyan-400 [writing-mode:vertical-lr] [direction:rtl]"
                        title={auto !== null ? AUTOMATED_TIP : 'Low band, below 400 Hz (-24dB to +12dB)'}
                      />
                      <span className={`text-[10px] font-mono tabular-nums mt-1.5 font-semibold ${auto !== null ? 'text-amber-200' : 'text-white'}`}>
                        {formatDb(auto ?? currentTrack.eq?.low ?? 0)}
                      </span>
                    </div>
                  )}
                </Automatable>

                {/* Mid Band (1.0kHz) */}
                <Automatable track={currentTrack} param="eqMid">
                  {(auto) => (
                    <div className="flex flex-col items-center bg-black/40 p-2 rounded border border-forge-border/80" title={auto !== null ? AUTOMATED_TIP : undefined}>
                      <span className="text-[10px] font-mono font-bold text-emerald-300">MID</span>
                      <span className="text-[9px] font-mono text-forge-muted mb-1">{auto !== null ? <AutoBadge trackId={currentTrack.id} param="eqMid" /> : '400Hz–2.5k'}</span>
                      <UndoableRange
                        min={-24}
                        max={12}
                        step={0.5}
                        value={auto ?? currentTrack.eq?.mid ?? 0}
                        onValue={(v) => setTrackEq(currentTrack.id, { mid: v })}
                        resetValue={0}
                        disabled={auto !== null}
                        className="h-24 w-1.5 appearance-none bg-zinc-700 rounded cursor-pointer disabled:cursor-default accent-emerald-400 [writing-mode:vertical-lr] [direction:rtl]"
                        title={auto !== null ? AUTOMATED_TIP : 'Mid band, 400 Hz to 2.5 kHz (-24dB to +12dB)'}
                      />
                      <span className={`text-[10px] font-mono tabular-nums mt-1.5 font-semibold ${auto !== null ? 'text-amber-200' : 'text-white'}`}>
                        {formatDb(auto ?? currentTrack.eq?.mid ?? 0)}
                      </span>
                    </div>
                  )}
                </Automatable>

                {/* High Band (2.5kHz) */}
                <Automatable track={currentTrack} param="eqHigh">
                  {(auto) => (
                    <div className="flex flex-col items-center bg-black/40 p-2 rounded border border-forge-border/80" title={auto !== null ? AUTOMATED_TIP : undefined}>
                      <span className="text-[10px] font-mono font-bold text-amber-300">HIGH</span>
                      <span className="text-[9px] font-mono text-forge-muted mb-1">{auto !== null ? <AutoBadge trackId={currentTrack.id} param="eqHigh" /> : '>2.5kHz'}</span>
                      <UndoableRange
                        min={-24}
                        max={12}
                        step={0.5}
                        value={auto ?? currentTrack.eq?.high ?? 0}
                        onValue={(v) => setTrackEq(currentTrack.id, { high: v })}
                        resetValue={0}
                        disabled={auto !== null}
                        className="h-24 w-1.5 appearance-none bg-zinc-700 rounded cursor-pointer disabled:cursor-default accent-amber-400 [writing-mode:vertical-lr] [direction:rtl]"
                        title={auto !== null ? AUTOMATED_TIP : 'High band, above 2.5 kHz (-24dB to +12dB)'}
                      />
                      <span className={`text-[10px] font-mono tabular-nums mt-1.5 font-semibold ${auto !== null ? 'text-amber-200' : 'text-white'}`}>
                        {formatDb(auto ?? currentTrack.eq?.high ?? 0)}
                      </span>
                    </div>
                  )}
                </Automatable>
              </div>
            </div>

            <PeqPanel track={currentTrack} />
            <DynamicsAndChorusPanels track={currentTrack} />
            <MbcPanel track={currentTrack} />
            <BusFxPanels track={currentTrack} />
            <FilterAndPumpPanels track={currentTrack} />

            {/* Aux FX Sends Section */}
            <div data-search="sends" className="flex flex-col gap-3 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
              <div className="flex items-center gap-1.5">
                <Waves className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">
                  Post-Fader Aux Sends
                </span>
              </div>

              {/* Reverb Send */}
              <Automatable track={currentTrack} param="reverbSend">
                {(auto) => {
                  const send = auto ?? currentTrack.reverbSend ?? 0;
                  // Up to 200%, or 300% once the 300% button is on (or the send is already past 200%)
                  const top = reverbBoost || send > REVERB_SEND_KNOB_MAX ? REVERB_SEND_MAX : REVERB_SEND_KNOB_MAX;
                  return (
                    <div className="flex flex-col gap-1" title={auto !== null ? AUTOMATED_TIP : undefined}>
                      <div className="flex justify-between items-center gap-1.5 text-[10px] font-mono">
                        <span className="flex-1 text-cyan-300 font-semibold flex items-center gap-1">
                          <Waves className="w-3 h-3" />
                          Studio Reverb Send
                        </span>
                        {auto !== null && <AutoBadge trackId={currentTrack.id} param="reverbSend" />}
                        <button
                          type="button"
                          aria-pressed={top === REVERB_SEND_MAX}
                          disabled={auto !== null}
                          onClick={() => {
                            if (top === REVERB_SEND_MAX) {
                              setBoostedTrack(null);
                              if (send > REVERB_SEND_KNOB_MAX) setTrackReverbSend(currentTrack.id, REVERB_SEND_KNOB_MAX);
                            } else setBoostedTrack(currentTrack.id);
                          }}
                          title={top === REVERB_SEND_MAX ? 'Back to a 200% top' : 'Let the send go up to 300%: drenched, for washes and effects'}
                          className={`px-1 rounded border text-[9px] leading-tight ${top === REVERB_SEND_MAX ? 'border-cyan-400 text-cyan-200 bg-cyan-500/15' : 'border-zinc-700 text-zinc-400 hover:text-cyan-200'} disabled:opacity-40`}
                        >
                          300%
                        </button>
                        <span className={`tabular-nums font-bold ${auto !== null ? 'text-amber-200' : 'text-white'}`}>{Math.round(send * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UndoableRange
                          min={0}
                          max={top}
                          step={0.01}
                          value={send}
                          onValue={(v) => setTrackReverbSend(currentTrack.id, v)}
                          disabled={auto !== null}
                          className="flex-1 accent-cyan-400 cursor-pointer disabled:cursor-default h-1.5 bg-zinc-800 rounded-lg appearance-none"
                        />
                        <div
                          className="w-12 h-2 rounded bg-zinc-800 overflow-hidden border border-zinc-700"
                          title="Reverb send meter"
                        >
                          <div
                            className="h-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] transition-all"
                            style={{ width: `${(send / top) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                }}
              </Automatable>

              {/* Delay Send */}
              <Automatable track={currentTrack} param="delaySend">
                {(auto) => {
                  const send = auto ?? currentTrack.delaySend ?? 0;
                  return (
                    <div className="flex flex-col gap-1" title={auto !== null ? AUTOMATED_TIP : undefined}>
                      <div className="flex justify-between items-center gap-1.5 text-[10px] font-mono">
                        <span className="flex-1 text-amber-300 font-semibold flex items-center gap-1">
                          <Radio className="w-3 h-3" />
                          Ping-Pong Echo Send
                        </span>
                        {auto !== null && <AutoBadge trackId={currentTrack.id} param="delaySend" />}
                        <span className={`tabular-nums font-bold ${auto !== null ? 'text-amber-200' : 'text-white'}`}>{Math.round(send * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <UndoableRange
                          min={0}
                          max={1}
                          step={0.01}
                          value={send}
                          onValue={(v) => setTrackDelaySend(currentTrack.id, v)}
                          disabled={auto !== null}
                          className="flex-1 accent-amber-400 cursor-pointer disabled:cursor-default h-1.5 bg-zinc-800 rounded-lg appearance-none"
                        />
                        <div
                          className="w-12 h-2 rounded bg-zinc-800 overflow-hidden border border-zinc-700"
                          title="Delay send meter"
                        >
                          <div
                            className="h-full bg-amber-400 shadow-[0_0_8px_#f59e0b] transition-all"
                            style={{ width: `${send * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                }}
              </Automatable>
              <ReturnSends track={currentTrack} />
            </div>

            {/* Fader & Pan Strip */}
            <div data-search="volume" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border">
              <span className="text-[10px] font-mono font-bold uppercase text-forge-muted tracking-wider">
                CHANNEL FADER
              </span>
              <Automatable track={currentTrack} param="volume">
                {(auto) => {
                  const volume = auto ?? currentTrack.volume;
                  return (
                    <div className="flex items-center justify-between gap-3 text-xs font-mono" title={auto !== null ? AUTOMATED_TIP : undefined}>
                      <span className="text-forge-muted text-[10px]">VOL</span>
                      <UndoableRange
                        min={-60}
                        max={6}
                        step={0.5}
                        value={Math.max(-60, volume)}
                        onValue={(v) => setTrackVolume(currentTrack.id, v)}
                        resetValue={0}
                        disabled={auto !== null}
                        className="flex-1 accent-white cursor-pointer disabled:cursor-default h-1.5 bg-zinc-800 rounded appearance-none"
                      />
                      {auto !== null && <AutoBadge trackId={currentTrack.id} param="volume" />}
                      <span className={`w-12 text-right font-bold tabular-nums ${auto !== null ? 'text-amber-200' : 'text-white'}`}>
                        {volume <= -60 ? '-inf' : `${volume > 0 ? '+' : ''}${volume.toFixed(1)}`}
                      </span>
                    </div>
                  );
                }}
              </Automatable>
              <Automatable track={currentTrack} param="pan">
                {(auto) => {
                  const pan = auto ?? currentTrack.pan;
                  return (
                    <div className="flex items-center justify-between gap-3 text-xs font-mono" title={auto !== null ? AUTOMATED_TIP : undefined}>
                      <span className="text-forge-muted text-[10px]">PAN</span>
                      <UndoableRange
                        min={-1}
                        max={1}
                        step={0.01}
                        value={pan}
                        onValue={(v) => setTrackPan(currentTrack.id, v)}
                        resetValue={0}
                        disabled={auto !== null}
                        className="flex-1 accent-white cursor-pointer disabled:cursor-default h-1.5 bg-zinc-800 rounded appearance-none"
                      />
                      {auto !== null && <AutoBadge trackId={currentTrack.id} param="pan" />}
                      <span className={`w-12 text-right font-bold tabular-nums ${auto !== null ? 'text-amber-200' : 'text-white'}`}>
                        {Math.abs(pan) < 0.01 ? 'C' : `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`}
                      </span>
                    </div>
                  );
                }}
              </Automatable>
              <div className="flex items-center justify-between gap-3 text-xs font-mono" title="How far back on the stage it sits: further back is a little darker, quieter and more in the room">
                <span className="text-forge-muted text-[10px]">DIST</span>
                <UndoableRange
                  min={0}
                  max={1}
                  step={0.01}
                  value={currentTrack.distance ?? 0}
                  onValue={(v) => useTimelineStore.getState().setTrackDistance(currentTrack.id, v)}
                  resetValue={seatOf(currentTrack.instrumentKey)?.distance ?? 0}
                  className="flex-1 accent-white cursor-pointer h-1.5 bg-zinc-800 rounded appearance-none"
                />
                <span className="w-12 text-right font-bold tabular-nums text-white">{(currentTrack.distance ?? 0) < 0.01 ? 'Front' : `${Math.round((currentTrack.distance ?? 0) * 100)}%`}</span>
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
            <MasterPanels />
            {/* Master Reverb Unit */}
            <div data-search="master-reverb" className="flex flex-col gap-2.5 bg-forge-bg p-3 rounded-lg border border-forge-border shadow-md">
              <div className="flex items-center justify-between border-b border-forge-border pb-2">
                <div className="flex items-center gap-1.5">
                  <Waves className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                    Master Reverb
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
                  max={12}
                  step={0.1}
                  value={masterReverbDecay}
                  onValue={setMasterReverbDecay}
                  className="w-full accent-cyan-400 cursor-pointer h-2 bg-zinc-800 rounded-lg appearance-none"
                />
                <div className="grid grid-cols-5 gap-1" role="group" aria-label="Reverb space">
                  {REVERB_SPACES.map((sp) => (
                    <button
                      key={sp.name}
                      type="button"
                      title={`${sp.name}: ${sp.decay} s. ${sp.hint}`}
                      aria-pressed={Math.abs(masterReverbDecay - sp.decay) < 0.05}
                      onClick={() => {
                        if (Math.abs(masterReverbDecay - sp.decay) < 0.05) return;
                        useTimelineStore.getState().checkpoint();
                        setMasterReverbDecay(sp.decay);
                      }}
                      className={`py-0.5 rounded border text-[9px] font-mono font-bold transition ${Math.abs(masterReverbDecay - sp.decay) < 0.05 ? 'bg-cyan-500/25 border-cyan-400 text-cyan-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
                    >
                      {sp.name}
                    </button>
                  ))}
                </div>
                <RoomStylePicker />
              </div>

              <RecordedRoom />

              <div className="flex justify-between items-center text-[10px] font-mono text-forge-muted bg-black/40 p-2 rounded">
                <span>Pre-Delay: 20ms</span>
                <span>HF Damping: Enabled</span>
                <span>Mix: 100% Wet</span>
              </div>
            </div>

            {/* Master Delay Unit */}
            <div data-search="master-delay" className="flex flex-col gap-2.5 bg-forge-bg p-3 rounded-lg border border-forge-border shadow-md">
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
    </div>
  );
};

/** Sends to the song's effect returns: a level each, and pre-fader (it ignores this track's fader) or post. */
const ReturnSends: React.FC<{ track: Track }> = ({ track }) => {
  const returns = useTimelineStore((s) => s.tracks).filter((t) => sendTargets(track, [t]).length > 0);
  if (isMixTrack(track)) return null;
  const s = useTimelineStore.getState();
  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-forge-border" aria-label="Sends to returns" data-search="return sends">
      {returns.map((r) => {
        const send = track.sends?.find((x) => x.to === r.id);
        const level = send?.level ?? 0;
        return (
          <div key={r.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono">
              <span className="flex-1 truncate font-semibold" style={{ color: r.color }}>
                → {r.name}
              </span>
              <label className="flex items-center gap-1 text-forge-muted" title="Pre-fader: the send ignores this track's volume fader (and mute), so the return keeps going as the track fades">
                <input type="checkbox" checked={!!send?.pre} disabled={!send} onChange={(e) => s.setTrackSendPre(track.id, r.id, e.target.checked)} aria-label={`Send to ${r.name} pre-fader`} />
                pre
              </label>
              <span className="w-9 text-right tabular-nums font-bold text-white">{Math.round(level * 100)}%</span>
            </div>
            <UndoableRange
              min={0}
              max={1}
              step={0.01}
              value={level}
              onValue={(v) => s.setTrackSend(track.id, r.id, v, false)}
              resetValue={0}
              className="w-full cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
              style={{ accentColor: r.color }}
              aria-label={`Send to ${r.name}`}
            />
          </div>
        );
      })}
      <button type="button" onClick={() => s.addReturn(track.id)} className="self-start text-[10px] font-mono text-sky-300 hover:text-sky-200" title="A new effect return track, with this track sending to it">
        + Send to a new return
      </button>
    </div>
  );
};
