/**
 * The header bar: the menu bar, the project bar (name, Save, Export, Share), tempo, Fit to time
 * and swing, the intensity slider, master volume, the loudness and performance badges, and the
 * Search, Learn, Guide and Start Audio buttons. Also the ? shortcut that opens the guide.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, GraduationCap, Search, Volume2, Power } from 'lucide-react';
import { useAudioStore } from '../store/audioStore';
import { useTimelineStore } from '../store/timelineStore';
import boLogo from '../assets/bo.svg';
import { GuidePanel } from './guide/GuidePanel';
import { FitTempoPopover, TempoField } from './TempoControls';
import { shouldIgnoreShortcut } from './keyboard';
import { LoudnessBadge } from './LoudnessBadge';
import { PerfBadge } from './PerfBadge';
import { PALETTE_SHORTCUT, useUiStore } from '../store/uiStore';
import { MenuBar } from './menu/MenuBar';
import { ProjectBar } from './timeline/ProjectBar';

export const Header: React.FC = () => {
  const { audioState, initializeAudio, masterVolume, setMasterVolume } = useAudioStore();
  // Tempo lives in the timeline store so the Transport has a single source of truth
  const bpm = useTimelineStore((s) => s.bpm);
  const swing = useTimelineStore((s) => s.swing);
  const { setBpm, tapTempo, setSwing } = useTimelineStore.getState();

  const isRunning = audioState === 'running';
  const guide = useUiStore((s) => s.guide);
  const { openGuide, closeGuide } = useUiStore.getState();
  const [fitOpen, setFitOpen] = useState(false);
  const closeFit = useCallback(() => setFitOpen(false), []);
  const fitButton = useRef<HTMLButtonElement>(null);

  // ? opens the guide from anywhere (except while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || shouldIgnoreShortcut(e)) return;
      if (document.querySelector('[role="menu"]')) return;
      e.preventDefault();
      useUiStore.getState().openGuide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="bg-forge-panel border-b border-forge-border shadow-xl">
      {/* Menu bar and project */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-b border-forge-border">
        <div className="flex items-center gap-2 mr-1">
          <img src={boLogo} alt="Bo wearing headphones" className="w-8 h-8 drop-shadow-[0_0_8px_rgba(61,158,224,0.45)]" />
          <h1 className="text-sm font-bold tracking-tight text-white font-sans whitespace-nowrap">Fledgetone</h1>
        </div>
        <MenuBar />
        <div className="ml-auto">
          <ProjectBar />
        </div>
      </div>
      <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-3">
      {/* Middle & Right Controls */}
      <div className="flex flex-wrap items-center gap-3 w-full">
        {/* BPM & Tap Tempo Control */}
        <div className="relative flex flex-wrap items-center bg-forge-bg border border-forge-border rounded-lg px-3 py-1.5 gap-x-3 gap-y-2">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-mono text-forge-muted tracking-wide">TEMPO</span>
            <div className="flex items-baseline gap-1">
              <TempoField />
              <span className="text-[10px] text-forge-muted font-mono">BPM</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setBpm(bpm - 1)}
              className="w-6 h-6 rounded bg-forge-panel hover:bg-forge-border text-forge-text flex items-center justify-center text-xs font-mono font-bold border border-forge-border transition"
              title="Decrease 1 BPM"
            >
              -
            </button>
            <input
              type="range"
              min="40"
              max="240"
              step="1"
              // Shows a tempo like 115.2 at 115 without changing it; only moving the slider sets whole BPM
              value={bpm}
              aria-label="Tempo (BPM)"
              onChange={(e) => setBpm(Number(e.target.value))}
              className="w-20 accent-forge-accent-keys cursor-pointer h-1.5 bg-forge-border rounded-lg appearance-none"
            />
            <button
              onClick={() => setBpm(bpm + 1)}
              className="w-6 h-6 rounded bg-forge-panel hover:bg-forge-border text-forge-text flex items-center justify-center text-xs font-mono font-bold border border-forge-border transition"
              title="Increase 1 BPM"
            >
              +
            </button>
          </div>

          <button
            onClick={tapTempo}
            className="px-2.5 py-1 text-xs font-mono font-semibold rounded bg-forge-panel hover:bg-forge-panelLight text-forge-accent-brass border border-amber-500/30 hover:border-amber-500/60 active:scale-95 transition"
            title="Click repeatedly to tap tempo"
          >
            TAP
          </button>
          <button
            ref={fitButton}
            type="button"
            onClick={() => setFitOpen((open) => !open)}
            aria-expanded={fitOpen}
            aria-haspopup="dialog"
            className={`px-2 py-1 text-xs font-mono font-semibold rounded border transition ${
              fitOpen
                ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200'
                : 'bg-forge-panel hover:bg-forge-panelLight text-cyan-300 border-cyan-500/30 hover:border-cyan-500/60'
            }`}
            title="Fit to time: set the tempo so the loop, the song or some bars last a given time"
          >
            FIT
          </button>
          {fitOpen && <FitTempoPopover anchorRef={fitButton} onClose={closeFit} />}

          <label className="flex flex-col border-l border-forge-border pl-3" title="Swing delays every other 16th note. Set 0% for straight timing (e.g. to hit video frames exactly).">
            <span className="flex justify-between text-[10px] uppercase font-mono text-forge-muted tracking-wide">
              Swing <span className="text-forge-text tabular-nums">{Math.round(swing * 100)}%</span>
            </span>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.05"
              value={swing}
              onChange={(e) => setSwing(Number(e.target.value))}
              onDoubleClick={() => setSwing(0)}
              className="w-20 mt-1.5 accent-forge-accent-keys cursor-pointer h-1.5 bg-forge-border rounded-lg appearance-none"
              aria-label="Swing"
            />
          </label>
          <IntensitySlider />
        </div>

        {/* Master Volume Slider */}
        <div className="flex items-center bg-forge-bg border border-forge-border rounded-lg px-3 py-1.5 gap-3">
          <Volume2 className="w-4 h-4 text-forge-muted" />
          <div className="flex flex-col">
            <div className="flex justify-between items-center w-28 text-[10px] font-mono text-forge-muted">
              <span>MASTER</span>
              <span className="text-forge-text font-bold">
                {masterVolume > 0 ? `+${masterVolume.toFixed(1)}` : masterVolume.toFixed(1)} dB
              </span>
            </div>
            <input
              type="range"
              min="-30"
              max="6"
              step="0.5"
              value={masterVolume}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
              aria-label="Master volume"
              className="w-28 accent-amber-400 cursor-pointer h-1.5 bg-forge-border rounded-lg appearance-none mt-1"
            />
          </div>
        </div>

        {isRunning && <LoudnessBadge />}
        {isRunning && <PerfBadge />}

        <button
          type="button"
          onClick={() => useUiStore.getState().setPaletteOpen(true)}
          className="ml-auto flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono tracking-wider border border-forge-border bg-forge-bg text-forge-text hover:border-cyan-500/70 hover:bg-cyan-500/10 transition"
          title={`Search tools, settings, instruments and the guide (${PALETTE_SHORTCUT})`}
        >
          <Search className="w-3.5 h-3.5 text-cyan-400" />
          SEARCH
          <kbd className="hidden sm:inline px-1 rounded border border-forge-border text-[9px] text-forge-muted">{PALETTE_SHORTCUT}</kbd>
        </button>

        <button
          type="button"
          onClick={() => useUiStore.getState().setDialog('learn')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono tracking-wider border border-forge-border bg-forge-bg text-forge-text hover:border-cyan-500/70 hover:bg-cyan-500/10 transition"
          title="Tour and tutorials: learn by doing, from beginner to expert"
        >
          <GraduationCap className="w-3.5 h-3.5 text-cyan-400" />
          LEARN
        </button>

        <button
          type="button"
          onClick={() => openGuide()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono tracking-wider border border-forge-border bg-forge-bg text-forge-text hover:border-cyan-500/70 hover:bg-cyan-500/10 transition"
          title="How Fledgetone works (?)"
        >
          <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
          GUIDE
        </button>

        {/* Audio Context Status Button */}
        <button
          onClick={initializeAudio}
          data-tour="start-audio"
          title={isRunning ? 'Audio is running' : 'Start audio (browsers only let sound play after a click)'}
          aria-label={isRunning ? 'Audio running' : 'Start audio'}
          className={`flex items-center gap-2.5 ${isRunning ? 'px-2.5' : 'px-4'} py-2 rounded-lg font-medium text-xs font-mono tracking-wider transition-all duration-200 border ${
            isRunning
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/50 shadow-glow-bass'
              : 'bg-red-950/40 text-red-300 border-red-500/50 hover:bg-red-900/50 hover:border-red-400 shadow-lg animate-pulse'
          }`}
        >
          <Power className={`w-3.5 h-3.5 ${isRunning ? 'text-emerald-400' : 'text-red-400'}`} />
          {/* Running, it shrinks to its light: the loudness badge appears beside it, and the header stays one row */}
          {!isRunning && <span>START AUDIO</span>}
          <span
            className={`w-2 h-2 rounded-full ${
              isRunning ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-red-500 shadow-[0_0_8px_#f87171]'
            }`}
          />
        </button>
      </div>
      </div>
      {/* Keyed by section, so search opening another section while it's open starts there */}
      {guide !== null && <GuidePanel key={guide} onClose={closeGuide} section={guide} />}
    </header>
  );
};

/**
 * Intensity: scrub it to crossfade the tracks' stem groups along their curves (see intensity.ts),
 * live, the way a game turns the music up. Tracks without a group aren't affected.
 */
const IntensitySlider: React.FC = () => {
  const intensity = useTimelineStore((s) => s.intensity);
  const grouped = useTimelineStore((s) => s.tracks.some((t) => t.stemGroup));
  return (
    <label
      className={`flex flex-col border-l border-forge-border pl-3 ${grouped ? '' : 'opacity-50'}`}
      title={
        grouped
          ? 'Intensity: crossfades the stem groups along their curves (Game preview). Double-click for 100%.'
          : 'Intensity: give tracks a stem group (in the Game preview) and this crossfades them, the way a game turns the music up'
      }
    >
      <span className="flex justify-between text-[10px] uppercase font-mono text-forge-muted tracking-wide">
        Intensity <span className="text-forge-text tabular-nums">{Math.round(intensity * 100)}%</span>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={intensity}
        onChange={(e) => useTimelineStore.getState().setIntensity(Number(e.target.value))}
        onDoubleClick={() => useTimelineStore.getState().setIntensity(1)}
        className="w-24 mt-1.5 accent-emerald-400 cursor-pointer h-1.5 bg-forge-border rounded-lg appearance-none"
        aria-label="Intensity"
      />
    </label>
  );
};
