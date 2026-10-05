import React from 'react';
import { Play, Square, Music, Waves, Drum, Radio } from 'lucide-react';
import { useAudioStore } from '../store/audioStore';

export const DemoSequencer: React.FC = () => {
  const {
    isDemoPlaying,
    toggleDemo,
    currentStep16,
    currentStep32,
    currentBar,
    activeTracks,
  } = useAudioStore();

  return (
    <div className="bg-forge-panel border border-forge-border rounded-xl p-5 shadow-xl flex flex-col gap-5">
      {/* Sequencer Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-forge-border">
        <div className="flex items-center gap-4">
          {/* Main Play/Stop Button */}
          <button
            onClick={toggleDemo}
            className={`flex items-center gap-2.5 px-6 py-3 rounded-lg font-mono font-bold text-sm tracking-wider transition-all duration-150 border shadow-lg ${
              isDemoPlaying
                ? 'bg-amber-500 text-black border-amber-300 shadow-glow-brass scale-[0.99]'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/80 shadow-glow-bass hover:scale-[1.02]'
            }`}
          >
            {isDemoPlaying ? (
              <>
                <Square className="w-4 h-4 fill-black" />
                <span>STOP DEMO GROOVE</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>PLAY DEMO GROOVE</span>
              </>
            )}
          </button>

          {/* Bar Indicator */}
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-forge-muted uppercase tracking-wider">LOOP:</span>
            <div className="flex items-center gap-1">
              <span
                className={`px-2.5 py-1 rounded border transition-colors ${
                  isDemoPlaying && currentBar === 0
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-[0_0_8px_#06b6d4]'
                    : 'bg-forge-bg text-forge-muted border-forge-border'
                }`}
              >
                BAR 1
              </span>
              <span
                className={`px-2.5 py-1 rounded border transition-colors ${
                  isDemoPlaying && currentBar === 1
                    ? 'bg-amber-500/20 text-amber-300 border-amber-400 shadow-[0_0_8px_#f59e0b]'
                    : 'bg-forge-bg text-forge-muted border-forge-border'
                }`}
              >
                BAR 2
              </span>
            </div>
          </div>
        </div>

        {/* Groove Meta Information */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="bg-forge-bg border border-forge-border px-3 py-1 rounded-md text-forge-muted flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>SWING: <strong className="text-forge-text">20% (16n)</strong></span>
          </div>
          <div className="bg-forge-bg border border-forge-border px-3 py-1 rounded-md text-forge-muted">
            KEY: <strong className="text-forge-text">D Dorian</strong>
          </div>
          <div className="bg-forge-bg border border-forge-border px-3 py-1 rounded-md text-forge-muted">
            STEP: <strong className="text-white">{isDemoPlaying ? `${currentStep32 + 1}/32` : '--/32'}</strong>
          </div>
        </div>
      </div>

      {/* 16-Step Transport Progress Indicator */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center text-[11px] font-mono text-forge-muted">
          <span>16-STEP BEAT POSITION</span>
          <span>QUARTER NOTE GROUPS (1-4 • 5-8 • 9-12 • 13-16)</span>
        </div>

        {/* 16 Step Buttons/Lamps */}
        <div className="grid grid-cols-16 gap-1.5 p-3 bg-forge-bg border border-forge-border rounded-lg">
          {Array.from({ length: 16 }, (_, i) => {
            const isStepActive = isDemoPlaying && currentStep16 === i;
            const isQuarterBeat = i % 4 === 0;

            return (
              <div key={i} className="flex flex-col items-center gap-1.5">
                {/* Step LED lamp */}
                <div
                  className={`w-full h-8 rounded flex items-center justify-center font-mono text-xs font-bold transition-all duration-75 border ${
                    isStepActive
                      ? 'bg-cyan-400 text-black border-white shadow-[0_0_15px_#22d3ee] scale-105 z-10'
                      : isQuarterBeat
                      ? 'bg-forge-panelLight text-forge-text border-forge-borderLight'
                      : 'bg-forge-panel text-forge-muted border-forge-border'
                  }`}
                >
                  {i + 1}
                </div>

                {/* Sub-dot for beat pulse */}
                <span
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    isStepActive
                      ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24] scale-125'
                      : isQuarterBeat
                      ? 'bg-forge-borderLight'
                      : 'bg-transparent'
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Real-time Track Activity Monitors */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
        {/* Bass Activity */}
        <div
          className={`p-3 rounded-lg border transition-all duration-100 flex items-center justify-between ${
            activeTracks.bass
              ? 'bg-emerald-950/60 border-emerald-400 shadow-glow-bass text-emerald-300'
              : 'bg-forge-bg border-forge-border text-forge-muted'
          }`}
        >
          <div className="flex items-center gap-2">
            <Waves className={`w-4 h-4 ${activeTracks.bass ? 'text-emerald-400' : 'text-forge-muted'}`} />
            <span className="font-mono text-xs font-semibold uppercase">Slap Bass</span>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              activeTracks.bass ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-forge-border'
            }`}
          />
        </div>

        {/* Keys Activity */}
        <div
          className={`p-3 rounded-lg border transition-all duration-100 flex items-center justify-between ${
            activeTracks.keys
              ? 'bg-cyan-950/60 border-cyan-400 shadow-glow-keys text-cyan-300'
              : 'bg-forge-bg border-forge-border text-forge-muted'
          }`}
        >
          <div className="flex items-center gap-2">
            <Music className={`w-4 h-4 ${activeTracks.keys ? 'text-cyan-400' : 'text-forge-muted'}`} />
            <span className="font-mono text-xs font-semibold uppercase">Space Clav</span>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              activeTracks.keys ? 'bg-cyan-400 shadow-[0_0_8px_#38bdf8]' : 'bg-forge-border'
            }`}
          />
        </div>

        {/* Brass Activity */}
        <div
          className={`p-3 rounded-lg border transition-all duration-100 flex items-center justify-between ${
            activeTracks.brass
              ? 'bg-amber-950/60 border-amber-400 shadow-glow-brass text-amber-300'
              : 'bg-forge-bg border-forge-border text-forge-muted'
          }`}
        >
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${activeTracks.brass ? 'text-amber-400' : 'text-forge-muted'}`} />
            <span className="font-mono text-xs font-semibold uppercase">Brass Stabs</span>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              activeTracks.brass ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' : 'bg-forge-border'
            }`}
          />
        </div>

        {/* Drums Activity */}
        <div
          className={`p-3 rounded-lg border transition-all duration-100 flex items-center justify-between ${
            activeTracks.drums
              ? 'bg-purple-950/60 border-purple-400 shadow-glow-drums text-purple-300'
              : 'bg-forge-bg border-forge-border text-forge-muted'
          }`}
        >
          <div className="flex items-center gap-2">
            <Drum className={`w-4 h-4 ${activeTracks.drums ? 'text-purple-400' : 'text-forge-muted'}`} />
            <span className="font-mono text-xs font-semibold uppercase">Drums</span>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              activeTracks.drums ? 'bg-purple-400 shadow-[0_0_8px_#c084fc]' : 'bg-forge-border'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
