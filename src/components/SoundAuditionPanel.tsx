import React, { useEffect, useState } from 'react';
import {
  triggerBass,
  triggerKeys,
  triggerBrass,
  triggerKick,
  triggerSnare,
  triggerHat,
  triggerCowbell,
  BASS_NOTES,
  CHORD_PRESETS,
  BRASS_PRESETS,
} from '../audio';
import { useAudioStore } from '../store/audioStore';

export const SoundAuditionPanel: React.FC = () => {
  const { audioState, initializeAudio, activePad, flashPad } = useAudioStore();
  const [activeBtn, setActiveBtn] = useState<string | null>(null);

  const ensureAudio = async () => {
    if (audioState !== 'running') {
      await initializeAudio();
    }
  };

  const handleTriggerBass = async (note: string) => {
    await ensureAudio();
    flashPad(`bass-${note}`);
    setActiveBtn(`bass-${note}`);
    triggerBass(note, '8n', undefined, 0.95);
    setTimeout(() => setActiveBtn(null), 150);
  };

  const handleTriggerKeys = async (name: keyof typeof CHORD_PRESETS) => {
    await ensureAudio();
    flashPad(`keys-${name}`);
    setActiveBtn(`keys-${name}`);
    triggerKeys([...CHORD_PRESETS[name]], '4n', undefined, 0.85);
    setTimeout(() => setActiveBtn(null), 180);
  };

  const handleTriggerBrass = async (name: keyof typeof BRASS_PRESETS) => {
    await ensureAudio();
    flashPad(`brass-${name}`);
    setActiveBtn(`brass-${name}`);
    triggerBrass([...BRASS_PRESETS[name]], '8n', undefined, 0.9);
    setTimeout(() => setActiveBtn(null), 160);
  };

  const handleTriggerDrum = async (drum: 'kick' | 'snare' | 'hat' | 'openhat' | 'cowbell') => {
    await ensureAudio();
    flashPad(`drum-${drum}`);
    setActiveBtn(`drum-${drum}`);

    switch (drum) {
      case 'kick':
        triggerKick(undefined, 0.95);
        break;
      case 'snare':
        triggerSnare(undefined, 0.9);
        break;
      case 'hat':
        triggerHat(false, undefined, 0.75);
        break;
      case 'openhat':
        triggerHat(true, undefined, 0.8);
        break;
      case 'cowbell':
        triggerCowbell(undefined, 0.85);
        break;
    }

    setTimeout(() => setActiveBtn(null), 140);
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case 'q':
          handleTriggerDrum('kick');
          break;
        case 'w':
          handleTriggerDrum('snare');
          break;
        case 'e':
          handleTriggerDrum('hat');
          break;
        case 'r':
          handleTriggerDrum('cowbell');
          break;
        case 't':
          handleTriggerDrum('openhat');
          break;
        case '1':
          handleTriggerBass('D1');
          break;
        case '2':
          handleTriggerBass('F1');
          break;
        case '3':
          handleTriggerBass('G1');
          break;
        case '4':
          handleTriggerBass('A1');
          break;
        case 'a':
          handleTriggerKeys('Dm9');
          break;
        case 's':
          handleTriggerKeys('G13');
          break;
        case 'd':
          handleTriggerKeys('Bbmaj7');
          break;
        case 'z':
          handleTriggerBrass('Dm_Stab');
          break;
        case 'x':
          handleTriggerBrass('C_Stab');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioState]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* 1. Bass Section (Cols 3) */}
      <div className="lg:col-span-3 bg-forge-panel border border-forge-border rounded-xl p-4 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-forge-border mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-forge-accent-bass shadow-[0_0_8px_#10b981]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-forge-text font-mono">
              Funk Slap Bass
            </h2>
          </div>
          <span className="text-[10px] font-mono uppercase text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
            MonoSynth -24dB
          </span>
        </div>

        <p className="text-xs text-forge-muted mb-4 font-sans leading-relaxed">
          Tight resonant squelch bass with fast transient attack and analog saturation.
        </p>

        <div className="grid grid-cols-2 gap-2.5 mt-auto">
          {BASS_NOTES.map((note, index) => {
            const id = `bass-${note}`;
            const isActive = activeBtn === id || activePad === id;
            return (
              <button
                key={note}
                onClick={() => handleTriggerBass(note)}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border font-mono transition-all duration-100 ${
                  isActive
                    ? 'bg-emerald-500 text-black border-emerald-300 scale-95 shadow-glow-bass'
                    : 'bg-forge-bg text-emerald-300 border-forge-border hover:border-emerald-500/60 hover:bg-emerald-950/20'
                }`}
              >
                <span className="text-base font-bold">{note}</span>
                <span className="text-[10px] text-forge-muted mt-0.5 font-mono">Key [{index + 1}]</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Keys Section (Cols 4) */}
      <div className="lg:col-span-4 bg-forge-panel border border-forge-border rounded-xl p-4 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-forge-border mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-forge-accent-keys shadow-[0_0_8px_#06b6d4]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-forge-text font-mono">
              Space Clav / Keys
            </h2>
          </div>
          <span className="text-[10px] font-mono uppercase text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
            PolyFM + Chorus
          </span>
        </div>

        <p className="text-xs text-forge-muted mb-4 font-sans leading-relaxed">
          Vintage harmonic FM clavinet chords with wide stereo chorus and subtle room reverb.
        </p>

        <div className="grid grid-cols-3 gap-2.5 mt-auto">
          {(Object.keys(CHORD_PRESETS) as Array<keyof typeof CHORD_PRESETS>).map((chordName, index) => {
            const id = `keys-${chordName}`;
            const isActive = activeBtn === id || activePad === id;
            const shortcutKey = ['A', 'S', 'D'][index];
            return (
              <button
                key={chordName}
                onClick={() => handleTriggerKeys(chordName)}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border font-mono transition-all duration-100 ${
                  isActive
                    ? 'bg-cyan-400 text-black border-cyan-200 scale-95 shadow-glow-keys'
                    : 'bg-forge-bg text-cyan-300 border-forge-border hover:border-cyan-500/60 hover:bg-cyan-950/20'
                }`}
              >
                <span className="text-sm font-bold truncate max-w-full">{chordName}</span>
                <span className="text-[10px] text-forge-muted mt-0.5 font-mono">[{shortcutKey}]</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Brass Stabs Section (Cols 2) */}
      <div className="lg:col-span-2 bg-forge-panel border border-forge-border rounded-xl p-4 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-forge-border mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-forge-accent-brass shadow-[0_0_8px_#f59e0b]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-forge-text font-mono">
              Brass Stabs
            </h2>
          </div>
          <span className="text-[10px] font-mono uppercase text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
            Horn Swell
          </span>
        </div>

        <p className="text-xs text-forge-muted mb-4 font-sans leading-relaxed">
          Polyphonic sawtooth section stabs with envelope-driven filter swell.
        </p>

        <div className="grid grid-cols-2 gap-2 mt-auto">
          <button
            onClick={() => handleTriggerBrass('Dm_Stab')}
            className={`flex flex-col items-center justify-center p-2.5 rounded-lg border font-mono transition-all duration-100 ${
              activeBtn === 'brass-Dm_Stab'
                ? 'bg-amber-400 text-black border-amber-200 scale-95 shadow-glow-brass'
                : 'bg-forge-bg text-amber-300 border-forge-border hover:border-amber-500/60 hover:bg-amber-950/20'
            }`}
          >
            <span className="text-xs font-bold">Dm Stab</span>
            <span className="text-[9px] text-forge-muted mt-0.5">[Z]</span>
          </button>
          <button
            onClick={() => handleTriggerBrass('C_Stab')}
            className={`flex flex-col items-center justify-center p-2.5 rounded-lg border font-mono transition-all duration-100 ${
              activeBtn === 'brass-C_Stab'
                ? 'bg-amber-400 text-black border-amber-200 scale-95 shadow-glow-brass'
                : 'bg-forge-bg text-amber-300 border-forge-border hover:border-amber-500/60 hover:bg-amber-950/20'
            }`}
          >
            <span className="text-xs font-bold">C Stab</span>
            <span className="text-[9px] text-forge-muted mt-0.5">[X]</span>
          </button>
        </div>
      </div>

      {/* 4. Groove Drum Kit (Cols 3) */}
      <div className="lg:col-span-3 bg-forge-panel border border-forge-border rounded-xl p-4 flex flex-col justify-between shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-forge-border mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-forge-accent-drums shadow-[0_0_8px_#a855f7]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-forge-text font-mono">
              Groove Drum Kit
            </h2>
          </div>
          <span className="text-[10px] font-mono uppercase text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-500/30">
            MPC 4-Voice
          </span>
        </div>

        <p className="text-xs text-forge-muted mb-4 font-sans leading-relaxed">
          Punchy 909 kick, snappy filtered snare clap, metallic hats & funk cowbell.
        </p>

        <div className="grid grid-cols-2 gap-2 mt-auto">
          {/* Kick */}
          <button
            onClick={() => handleTriggerDrum('kick')}
            className={`flex flex-col items-center justify-center p-3 rounded-lg border font-mono transition-all duration-100 ${
              activeBtn === 'drum-kick' || activePad === 'drum-kick'
                ? 'bg-purple-500 text-white border-purple-200 scale-95 shadow-glow-drums'
                : 'bg-forge-bg text-purple-300 border-forge-border hover:border-purple-500/60 hover:bg-purple-950/20'
            }`}
          >
            <span className="text-xs font-bold">KICK</span>
            <span className="text-[10px] text-forge-muted mt-0.5">[Q]</span>
          </button>

          {/* Snare */}
          <button
            onClick={() => handleTriggerDrum('snare')}
            className={`flex flex-col items-center justify-center p-3 rounded-lg border font-mono transition-all duration-100 ${
              activeBtn === 'drum-snare' || activePad === 'drum-snare'
                ? 'bg-purple-500 text-white border-purple-200 scale-95 shadow-glow-drums'
                : 'bg-forge-bg text-purple-300 border-forge-border hover:border-purple-500/60 hover:bg-purple-950/20'
            }`}
          >
            <span className="text-xs font-bold">SNARE</span>
            <span className="text-[10px] text-forge-muted mt-0.5">[W]</span>
          </button>

          {/* Hat (Closed & Open) */}
          <div className="flex gap-1 col-span-1">
            <button
              onClick={() => handleTriggerDrum('hat')}
              className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border font-mono transition-all duration-100 ${
                activeBtn === 'drum-hat' || activePad === 'drum-hat'
                  ? 'bg-purple-500 text-white border-purple-200 scale-95 shadow-glow-drums'
                  : 'bg-forge-bg text-purple-300 border-forge-border hover:border-purple-500/60 hover:bg-purple-950/20'
              }`}
              title="Closed Hi-Hat (0.05s decay)"
            >
              <span className="text-xs font-bold">C-HAT</span>
              <span className="text-[9px] text-forge-muted mt-0.5">[E]</span>
            </button>
            <button
              onClick={() => handleTriggerDrum('openhat')}
              className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border font-mono transition-all duration-100 ${
                activeBtn === 'drum-openhat'
                  ? 'bg-purple-500 text-white border-purple-200 scale-95 shadow-glow-drums'
                  : 'bg-forge-bg text-purple-300 border-forge-border hover:border-purple-500/60 hover:bg-purple-950/20'
              }`}
              title="Open Hi-Hat (0.28s decay)"
            >
              <span className="text-xs font-bold">O-HAT</span>
              <span className="text-[9px] text-forge-muted mt-0.5">[T]</span>
            </button>
          </div>

          {/* Cowbell */}
          <button
            onClick={() => handleTriggerDrum('cowbell')}
            className={`flex flex-col items-center justify-center p-3 rounded-lg border font-mono transition-all duration-100 ${
              activeBtn === 'drum-cowbell' || activePad === 'drum-cowbell'
                ? 'bg-purple-500 text-white border-purple-200 scale-95 shadow-glow-drums'
                : 'bg-forge-bg text-purple-300 border-forge-border hover:border-purple-500/60 hover:bg-purple-950/20'
            }`}
          >
            <span className="text-xs font-bold">COWBELL</span>
            <span className="text-[10px] text-forge-muted mt-0.5">[R]</span>
          </button>
        </div>
      </div>
    </div>
  );
};
