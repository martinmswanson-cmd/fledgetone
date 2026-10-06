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
import { useTimelineStore } from '../store/timelineStore';
import { DRUM_NOTES } from '../audio/scheduler';
import { patternsFor } from '../store/demoSong';
import { setDragPayload } from '../store/dragSounds';
import type { DragPayload } from '../store/dragSounds';
import type { InstrumentKey } from '../store/timelineTypes';
import { triggerAuditionSampler } from '../audio/samplers/samplerManager';

type DrumPad = 'kick' | 'snare' | 'hat' | 'openhat' | 'cowbell';

const DRUM_PAD_NOTES: Record<DrumPad, { note: string; label: string; velocity: number }> = {
  kick: { note: DRUM_NOTES.kick, label: 'Kick', velocity: 0.95 },
  snare: { note: DRUM_NOTES.snare, label: 'Snare', velocity: 0.9 },
  hat: { note: DRUM_NOTES.closedHat, label: 'Closed Hat', velocity: 0.7 },
  openhat: { note: DRUM_NOTES.openHat, label: 'Open Hat', velocity: 0.75 },
  cowbell: { note: DRUM_NOTES.cowbell, label: 'Cowbell', velocity: 0.8 },
};

const ACOUSTIC_CHORDS = {
  piano: [
    { label: 'Cmaj9', notes: ['C3', 'G3', 'B3', 'D4', 'E4'], duration: '2n' },
    { label: 'Am9', notes: ['A2', 'E3', 'G3', 'C4', 'E4'], duration: '2n' },
    { label: 'Fmaj7', notes: ['F2', 'C3', 'E3', 'A3', 'C4'], duration: '2n' },
  ],
  guitar: [
    { label: 'Em', notes: ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'], duration: '2n' },
    { label: 'Gmaj', notes: ['G2', 'B2', 'D3', 'G3', 'D4', 'G4'], duration: '2n' },
    { label: 'Cmaj', notes: ['C3', 'E3', 'G3', 'C4', 'E4'], duration: '2n' },
  ],
  violin: [
    { label: 'A4 Solo', notes: ['A4'], duration: '2n' },
    { label: 'C5 Solo', notes: ['C5'], duration: '2n' },
    { label: 'E5 Solo', notes: ['E5'], duration: '2n' },
  ],
  cello: [
    { label: 'C2 Bass', notes: ['C2'], duration: '2n' },
    { label: 'G2 Deep', notes: ['G2'], duration: '2n' },
    { label: 'D3 Warm', notes: ['D3'], duration: '2n' },
  ],
};

/** Props that make a pad draggable onto the timeline (lanes for the same instrument light up). */
function dragProps(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragPayload(e, payload);
      useTimelineStore.getState().setDraggingInstrument(payload.instrument);
    },
    onDragEnd: () => useTimelineStore.getState().setDraggingInstrument(null),
    title: `Click to play • drag onto the ${payload.instrument} track`,
  };
}

const drumDrag = (pad: DrumPad) => {
  const d = DRUM_PAD_NOTES[pad];
  return dragProps({ kind: 'sound', instrument: 'drums', label: d.label, notes: [d.note], duration: '16n', velocity: d.velocity });
};

const PATTERN_GROUPS: Array<{ instrument: InstrumentKey; label: string; className: string }> = [
  { instrument: 'drums', label: 'Drums', className: 'text-purple-300 border-purple-500/40 hover:bg-purple-950/30' },
  { instrument: 'bass', label: 'Bass', className: 'text-emerald-300 border-emerald-500/40 hover:bg-emerald-950/30' },
  { instrument: 'keys', label: 'Keys', className: 'text-cyan-300 border-cyan-500/40 hover:bg-cyan-950/30' },
  { instrument: 'brass', label: 'Brass', className: 'text-amber-300 border-amber-500/40 hover:bg-amber-950/30' },
  { instrument: 'piano', label: 'Piano', className: 'text-slate-200 border-slate-400/40 hover:bg-slate-800/30' },
  { instrument: 'violin', label: 'Violin', className: 'text-red-300 border-red-500/40 hover:bg-red-950/30' },
  { instrument: 'cello', label: 'Cello', className: 'text-orange-300 border-orange-500/40 hover:bg-orange-950/30' },
  { instrument: 'guitar', label: 'Guitar', className: 'text-amber-600 border-amber-600/40 hover:bg-amber-950/30' },
];

export const SoundAuditionPanel: React.FC = () => {
  const { audioState, initializeAudio, activePad, flashPad, instrumentStatus } = useAudioStore();
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

  const handleTriggerSampler = async (
    inst: 'piano' | 'guitar' | 'violin' | 'cello',
    padId: string,
    notes: string[],
    duration: string
  ) => {
    await ensureAudio();
    flashPad(padId);
    setActiveBtn(padId);
    void triggerAuditionSampler(inst, notes, duration, 0.85);
    setTimeout(() => setActiveBtn(null), 180);
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // Leave modifier chords (Ctrl+D etc.) to the timeline
      if (e.ctrlKey || e.metaKey || e.altKey) return;

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
                {...dragProps({ kind: 'sound', instrument: 'bass', label: note, notes: [note], duration: '8n', velocity: 0.9 })}
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
                {...dragProps({ kind: 'sound', instrument: 'keys', label: chordName, notes: [...CHORD_PRESETS[chordName]], duration: '4n', velocity: 0.8 })}
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
            {...dragProps({ kind: 'sound', instrument: 'brass', label: 'Dm Stab', notes: [...BRASS_PRESETS.Dm_Stab], duration: '8n', velocity: 0.85 })}
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
            {...dragProps({ kind: 'sound', instrument: 'brass', label: 'C Stab', notes: [...BRASS_PRESETS.C_Stab], duration: '8n', velocity: 0.85 })}
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
            {...drumDrag('kick')}
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
            {...drumDrag('snare')}
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
              {...drumDrag('hat')}
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
              {...drumDrag('openhat')}
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
            {...drumDrag('cowbell')}
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

      {/* Acoustic Sampled Instruments (Piano, Guitar, Violin, Cello) */}
      <div className="lg:col-span-12 bg-forge-panel border border-forge-border rounded-xl p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-forge-border mb-4 gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-forge-text font-mono">
              Acoustic Sampled Instruments
            </h2>
            <span className="text-[10px] font-mono uppercase text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
              Tone.Sampler Multi-sampled
            </span>
          </div>
          <p className="text-xs text-forge-muted font-sans">
            Streamed live from public audio CDNs • Click to audition or drag chords/notes into the timeline
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Grand Piano */}
          <div className="bg-forge-bg border border-forge-border/80 rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-200 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-200" />
                Grand Piano
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                instrumentStatus['piano'] === 'ready'
                  ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30'
                  : instrumentStatus['piano'] === 'loading'
                  ? 'text-amber-400 bg-amber-950/40 border-amber-500/30 animate-pulse'
                  : 'text-forge-muted bg-forge-panel border-forge-border'
              }`}>
                {instrumentStatus['piano'] === 'ready' ? 'Ready' : instrumentStatus['piano'] === 'loading' ? 'Loading...' : 'Salamander C8'}
              </span>
            </div>
            <p className="text-[11px] text-forge-muted mb-3 font-sans">
              Yamaha C5 Grand Piano multi-samples (A0–C8)
            </p>
            <div className="grid grid-cols-3 gap-1.5 mt-auto">
              {ACOUSTIC_CHORDS.piano.map((chord) => {
                const id = `piano-${chord.label}`;
                const isActive = activeBtn === id || activePad === id;
                return (
                  <button
                    key={chord.label}
                    onClick={() => handleTriggerSampler('piano', id, chord.notes, chord.duration)}
                    {...dragProps({ kind: 'sound', instrument: 'piano', label: chord.label, notes: chord.notes, duration: chord.duration, velocity: 0.85 })}
                    className={`flex flex-col items-center justify-center p-2 rounded border font-mono transition-all text-xs ${
                      isActive
                        ? 'bg-slate-200 text-black border-white scale-95 shadow-[0_0_10px_rgba(255,255,255,0.4)]'
                        : 'bg-forge-panel text-slate-300 border-forge-border hover:border-slate-300/60 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="font-bold">{chord.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Acoustic Guitar */}
          <div className="bg-forge-bg border border-forge-border/80 rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-500 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Acoustic Guitar
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                instrumentStatus['guitar'] === 'ready'
                  ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30'
                  : instrumentStatus['guitar'] === 'loading'
                  ? 'text-amber-400 bg-amber-950/40 border-amber-500/30 animate-pulse'
                  : 'text-forge-muted bg-forge-panel border-forge-border'
              }`}>
                {instrumentStatus['guitar'] === 'ready' ? 'Ready' : instrumentStatus['guitar'] === 'loading' ? 'Loading...' : 'Steel String'}
              </span>
            </div>
            <p className="text-[11px] text-forge-muted mb-3 font-sans">
              Steel string fingerpicked acoustic chords (E2–E4)
            </p>
            <div className="grid grid-cols-3 gap-1.5 mt-auto">
              {ACOUSTIC_CHORDS.guitar.map((chord) => {
                const id = `guitar-${chord.label}`;
                const isActive = activeBtn === id || activePad === id;
                return (
                  <button
                    key={chord.label}
                    onClick={() => handleTriggerSampler('guitar', id, chord.notes, chord.duration)}
                    {...dragProps({ kind: 'sound', instrument: 'guitar', label: chord.label, notes: chord.notes, duration: chord.duration, velocity: 0.85 })}
                    className={`flex flex-col items-center justify-center p-2 rounded border font-mono transition-all text-xs ${
                      isActive
                        ? 'bg-amber-500 text-black border-amber-300 scale-95 shadow-[0_0_10px_#f59e0b]'
                        : 'bg-forge-panel text-amber-400 border-forge-border hover:border-amber-500/60 hover:bg-amber-950/20'
                    }`}
                  >
                    <span className="font-bold">{chord.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Concert Violin */}
          <div className="bg-forge-bg border border-forge-border/80 rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-red-400 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Concert Violin
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                instrumentStatus['violin'] === 'ready'
                  ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30'
                  : instrumentStatus['violin'] === 'loading'
                  ? 'text-amber-400 bg-amber-950/40 border-amber-500/30 animate-pulse'
                  : 'text-forge-muted bg-forge-panel border-forge-border'
              }`}>
                {instrumentStatus['violin'] === 'ready' ? 'Ready' : instrumentStatus['violin'] === 'loading' ? 'Loading...' : 'Solo Expressive'}
              </span>
            </div>
            <p className="text-[11px] text-forge-muted mb-3 font-sans">
              Expressive orchestral violin sustains (A3–G6)
            </p>
            <div className="grid grid-cols-3 gap-1.5 mt-auto">
              {ACOUSTIC_CHORDS.violin.map((chord) => {
                const id = `violin-${chord.label}`;
                const isActive = activeBtn === id || activePad === id;
                return (
                  <button
                    key={chord.label}
                    onClick={() => handleTriggerSampler('violin', id, chord.notes, chord.duration)}
                    {...dragProps({ kind: 'sound', instrument: 'violin', label: chord.label, notes: chord.notes, duration: chord.duration, velocity: 0.85 })}
                    className={`flex flex-col items-center justify-center p-2 rounded border font-mono transition-all text-xs ${
                      isActive
                        ? 'bg-red-500 text-white border-red-300 scale-95 shadow-[0_0_10px_#ef4444]'
                        : 'bg-forge-panel text-red-300 border-forge-border hover:border-red-500/60 hover:bg-red-950/20'
                    }`}
                  >
                    <span className="font-bold">{chord.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Deep Cello */}
          <div className="bg-forge-bg border border-forge-border/80 rounded-lg p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-orange-400 font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                Deep Cello
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                instrumentStatus['cello'] === 'ready'
                  ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30'
                  : instrumentStatus['cello'] === 'loading'
                  ? 'text-amber-400 bg-amber-950/40 border-amber-500/30 animate-pulse'
                  : 'text-forge-muted bg-forge-panel border-forge-border'
              }`}>
                {instrumentStatus['cello'] === 'ready' ? 'Ready' : instrumentStatus['cello'] === 'loading' ? 'Loading...' : 'Resonant Bow'}
              </span>
            </div>
            <p className="text-[11px] text-forge-muted mb-3 font-sans">
              Rich resonant lower register cello notes (C2–C4)
            </p>
            <div className="grid grid-cols-3 gap-1.5 mt-auto">
              {ACOUSTIC_CHORDS.cello.map((chord) => {
                const id = `cello-${chord.label}`;
                const isActive = activeBtn === id || activePad === id;
                return (
                  <button
                    key={chord.label}
                    onClick={() => handleTriggerSampler('cello', id, chord.notes, chord.duration)}
                    {...dragProps({ kind: 'sound', instrument: 'cello', label: chord.label, notes: chord.notes, duration: chord.duration, velocity: 0.85 })}
                    className={`flex flex-col items-center justify-center p-2 rounded border font-mono transition-all text-xs ${
                      isActive
                        ? 'bg-orange-500 text-white border-orange-300 scale-95 shadow-[0_0_10px_#ea580c]'
                        : 'bg-forge-panel text-orange-300 border-forge-border hover:border-orange-500/60 hover:bg-orange-950/20'
                    }`}
                  >
                    <span className="font-bold">{chord.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 6. Patterns: drag whole stock patterns onto the matching track */}
      <div className="lg:col-span-12 bg-forge-panel border border-forge-border rounded-xl p-4 shadow-lg flex flex-wrap items-center gap-x-5 gap-y-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-forge-text font-mono">Patterns</h2>
          <p className="text-[11px] text-forge-muted">Drag onto the matching track</p>
        </div>
        {PATTERN_GROUPS.map((g) => (
          <div key={g.instrument} className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase text-forge-muted">{g.label}</span>
            {patternsFor(g.instrument).map((p) => (
              <div
                key={p.id}
                {...dragProps({ kind: 'pattern', instrument: g.instrument, patternId: p.id, label: p.name })}
                title={`Drag onto the ${g.label.toLowerCase()} track (${p.lengthBars} bars)`}
                className={`cursor-grab active:cursor-grabbing select-none px-2.5 py-1.5 rounded-md border bg-forge-bg text-xs font-mono ${g.className}`}
              >
                {p.name} <span className="text-forge-muted text-[10px]">{p.lengthBars} bars</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
