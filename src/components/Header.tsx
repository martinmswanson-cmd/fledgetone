import React from 'react';
import { Volume2, Power } from 'lucide-react';
import { useAudioStore } from '../store/audioStore';
import { useTimelineStore } from '../store/timelineStore';
import boLogo from '../assets/bo.svg';

export const Header: React.FC = () => {
  const { audioState, initializeAudio, masterVolume, setMasterVolume } = useAudioStore();
  // Tempo lives in the timeline store so the Transport has a single source of truth
  const bpm = useTimelineStore((s) => s.bpm);
  const { setBpm, tapTempo } = useTimelineStore.getState();

  const isRunning = audioState === 'running';

  return (
    <header className="bg-forge-panel border-b border-forge-border px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
      {/* Brand Title */}
      <div className="flex items-center gap-3">
        <img src={boLogo} alt="Bo wearing headphones" className="w-12 h-12 drop-shadow-[0_0_10px_rgba(61,158,224,0.45)]" />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white font-sans">Bo's Beatbox</h1>
          <p className="text-xs text-forge-muted font-sans">Arrange, mix and export music in your browser</p>
        </div>
      </div>

      {/* Middle & Right Controls */}
      <div className="flex flex-wrap items-center gap-5">
        {/* BPM & Tap Tempo Control */}
        <div className="flex items-center bg-forge-bg border border-forge-border rounded-lg px-3 py-1.5 gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-mono text-forge-muted tracking-wide">TEMPO</span>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold font-mono text-white tracking-wider">{bpm}</span>
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
              min="60"
              max="180"
              value={bpm}
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
              className="w-28 accent-amber-400 cursor-pointer h-1.5 bg-forge-border rounded-lg appearance-none mt-1"
            />
          </div>
        </div>

        {/* Audio Context Status Button */}
        <button
          onClick={initializeAudio}
          className={`flex items-center gap-2.5 px-4 py-2 rounded-lg font-medium text-xs font-mono tracking-wider transition-all duration-200 border ${
            isRunning
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/50 shadow-glow-bass'
              : 'bg-red-950/40 text-red-300 border-red-500/50 hover:bg-red-900/50 hover:border-red-400 shadow-lg animate-pulse'
          }`}
        >
          <Power className={`w-3.5 h-3.5 ${isRunning ? 'text-emerald-400' : 'text-red-400'}`} />
          <span>{isRunning ? 'AUDIO RUNNING' : 'START AUDIO'}</span>
          <span
            className={`w-2 h-2 rounded-full ${
              isRunning ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-red-500 shadow-[0_0_8px_#f87171]'
            }`}
          />
        </button>
      </div>
    </header>
  );
};
