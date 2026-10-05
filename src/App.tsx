import React from 'react';
import { Header } from './components/Header';
import { SoundAuditionPanel } from './components/SoundAuditionPanel';
import { DemoSequencer } from './components/DemoSequencer';
import { Cpu, Sparkles } from 'lucide-react';

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-forge-bg text-forge-text flex flex-col font-sans selection:bg-cyan-500/30">
      {/* Top DAW Header */}
      <Header />

      {/* Main Workstation Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-6">
        {/* Section 1: 2-Bar Funk Demo Sequencer */}
        <section aria-label="Demo Sequencer">
          <DemoSequencer />
        </section>

        {/* Section 2: Soundbank Audition & MPC Trigger Deck */}
        <section aria-label="Soundbank Audition Panel">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-forge-accent-brass" />
              <h2 className="text-xs font-mono font-bold tracking-wider uppercase text-forge-muted">
                Interactive Soundbank Audition Deck
              </h2>
            </div>
            <span className="text-[11px] font-mono text-forge-muted hidden sm:inline">
              Use pads or keyboard shortcuts (Q, W, E, R, 1-4, A-D, Z-X)
            </span>
          </div>

          <SoundAuditionPanel />
        </section>

        {/* Section 3: Audio Engine Architecture & Signal Flow Specs */}
        <section
          aria-label="Signal Flow Architecture"
          className="bg-forge-panel border border-forge-border rounded-xl p-4 sm:p-5 shadow-lg flex flex-col gap-4 text-xs font-mono"
        >
          <div className="flex items-center justify-between pb-3 border-b border-forge-border">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-forge-accent-keys" />
              <h3 className="font-bold uppercase tracking-wider text-forge-text text-sm">
                Master Bus & Preset Chain Architecture
              </h3>
            </div>
            <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
              Web Audio 48kHz / 32-bit float
            </span>
          </div>

          {/* Signal Flow Breadcrumb */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] text-forge-muted">
            <span className="px-2.5 py-1 bg-forge-bg border border-forge-border rounded text-forge-accent-bass">
              Bass (Sawtooth -24dB Q:5)
            </span>
            <span className="text-forge-borderLight">→</span>
            <span className="px-2.5 py-1 bg-forge-bg border border-forge-border rounded text-forge-accent-keys">
              Keys (FM Synth + Chorus + Reverb)
            </span>
            <span className="text-forge-borderLight">→</span>
            <span className="px-2.5 py-1 bg-forge-bg border border-forge-border rounded text-forge-accent-brass">
              Brass (Sawtooth + Swell Filter)
            </span>
            <span className="text-forge-borderLight">→</span>
            <span className="px-2.5 py-1 bg-forge-bg border border-forge-border rounded text-forge-accent-drums">
              Drums (Kick/Snare/Hat/Cowbell)
            </span>
            <span className="text-forge-borderLight">⇒</span>
            <span className="px-2.5 py-1 bg-amber-950/40 border border-amber-500/40 rounded text-amber-300 font-bold">
              Master Compressor (-18dB, 4:1)
            </span>
            <span className="text-forge-borderLight">→</span>
            <span className="px-2.5 py-1 bg-red-950/40 border border-red-500/40 rounded text-red-300 font-bold">
              Limiter (-0.5dB)
            </span>
            <span className="text-forge-borderLight">→</span>
            <span className="px-2.5 py-1 bg-cyan-950/40 border border-cyan-500/40 rounded text-cyan-300 font-bold">
              Tone.Destination
            </span>
          </div>

          {/* Keyboard Reference Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 pt-1 text-[11px]">
            <div className="bg-forge-bg p-2 rounded border border-forge-border flex items-center justify-between">
              <span className="text-forge-muted">Bass Keys:</span>
              <span className="text-emerald-400 font-bold">[1] D1 • [2] F1 • [3] G1 • [4] A1</span>
            </div>
            <div className="bg-forge-bg p-2 rounded border border-forge-border flex items-center justify-between">
              <span className="text-forge-muted">Keys Chords:</span>
              <span className="text-cyan-400 font-bold">[A] Dm9 • [S] G13 • [D] Bbmaj7</span>
            </div>
            <div className="bg-forge-bg p-2 rounded border border-forge-border flex items-center justify-between">
              <span className="text-forge-muted">Brass Stabs:</span>
              <span className="text-amber-400 font-bold">[Z] Dm Stab • [X] C Stab</span>
            </div>
            <div className="bg-forge-bg p-2 rounded border border-forge-border flex items-center justify-between">
              <span className="text-forge-muted">Drums:</span>
              <span className="text-purple-400 font-bold">[Q] Kick • [W] Snr • [E] Hat • [R] Bell</span>
            </div>
          </div>
        </section>
      </main>

      {/* Workstation Footer */}
      <footer className="border-t border-forge-border bg-forge-panel px-6 py-3 text-center text-xs text-forge-muted font-mono flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
          <span>GrooveForge Production Audio Workstation</span>
        </div>
        <div>
          <span>Electric Funk Soundbank Engine • Tone.js Web Audio API</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
