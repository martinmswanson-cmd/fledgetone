import * as Tone from 'tone';
import { triggerBass } from './presets/bass';
import { triggerKeys } from './presets/keys';
import { triggerBrass } from './presets/brass';
import { triggerKick, triggerSnare, triggerHat, triggerCowbell } from './presets/drums';

export interface DemoStepEvent {
  step: number;        // 0 to 31 across 2 bars
  step16: number;      // 0 to 15 within the current bar
  bar: number;         // 0 or 1
  activeTracks: {
    bass: boolean;
    keys: boolean;
    brass: boolean;
    drums: boolean;
  };
}

let repeatId: number | null = null;
let currentStep = 0;
let isPlaying = false;
let stepCallback: ((event: DemoStepEvent) => void) | null = null;

// Chords
const CHORD_DM9 = ['D3', 'F3', 'A3', 'C4', 'E4'];
const CHORD_G13 = ['G2', 'F3', 'B3', 'E4'];
const CHORD_BBMAJ7 = ['Bb2', 'F3', 'A3', 'D4'];
const CHORD_A7SHARP9 = ['A2', 'G3', 'C#4', 'C5'];
const BRASS_D_MIN = ['D4', 'F4', 'A4'];
const BRASS_C_MAJ = ['C4', 'E4', 'G4'];

/**
 * Executes a single step of the 2-bar syncopated electric funk groove.
 */
function handleStep(time: number) {
  const step = currentStep;
  const step16 = step % 16;
  const bar = Math.floor(step / 16);

  let activeBass = false;
  let activeKeys = false;
  let activeBrass = false;
  let activeDrums = false;

  // --- DRUMS ---
  // Kick
  if (
    step === 0 ||
    step === 3 ||
    step === 8 ||
    step === 10 ||
    step === 16 ||
    step === 22 ||
    step === 24 ||
    step === 27
  ) {
    triggerKick(time, step === 0 || step === 16 ? 0.95 : 0.85);
    activeDrums = true;
  }

  // Snare
  if (step === 4 || step === 12 || step === 20 || step === 28) {
    // Backbeat
    triggerSnare(time, 0.9);
    activeDrums = true;
  } else if (step === 2 || step === 7 || step === 14 || step === 18 || step === 26 || step === 30) {
    // Ghost snare
    triggerSnare(time, 0.35);
    activeDrums = true;
  }

  // Hi-Hat
  if (step === 6 || step === 30) {
    triggerHat(true, time, 0.7); // Open hat
    activeDrums = true;
  } else {
    // 16th hats with dynamic groove
    const hatVel = step % 4 === 0 ? 0.75 : step % 2 === 0 ? 0.6 : 0.45;
    triggerHat(false, time, hatVel);
    activeDrums = true;
  }

  // Cowbell accent
  if (step === 10 || step === 26 || step === 31) {
    triggerCowbell(time, 0.65);
    activeDrums = true;
  }

  // --- BASS (D Dorian 16th Slap & Pop Riff) ---
  if (step === 0) {
    triggerBass('D1', '16n', time, 0.95);
    activeBass = true;
  } else if (step === 3) {
    triggerBass('D2', '16n', time, 0.8);
    activeBass = true;
  } else if (step === 5) {
    triggerBass('F1', '16n', time, 0.85);
    activeBass = true;
  } else if (step === 8) {
    triggerBass('D1', '16n', time, 0.9);
    activeBass = true;
  } else if (step === 10) {
    triggerBass('G1', '16n', time, 0.85);
    activeBass = true;
  } else if (step === 11) {
    triggerBass('G#1', '16n', time, 0.75); // Chromatic slip
    activeBass = true;
  } else if (step === 12) {
    triggerBass('A1', '16n', time, 0.9);
    activeBass = true;
  } else if (step === 15) {
    triggerBass('C2', '16n', time, 0.85);
    activeBass = true;
  } else if (step === 16) {
    triggerBass('D1', '16n', time, 0.95);
    activeBass = true;
  } else if (step === 18) {
    triggerBass('D1', '16n', time, 0.6);
    activeBass = true;
  } else if (step === 19) {
    triggerBass('F1', '16n', time, 0.8);
    activeBass = true;
  } else if (step === 22) {
    triggerBass('G1', '16n', time, 0.85);
    activeBass = true;
  } else if (step === 24) {
    triggerBass('A1', '16n', time, 0.9);
    activeBass = true;
  } else if (step === 26) {
    triggerBass('C2', '16n', time, 0.85);
    activeBass = true;
  } else if (step === 28) {
    triggerBass('D2', '16n', time, 0.9);
    activeBass = true;
  } else if (step === 30) {
    triggerBass('C2', '16n', time, 0.8);
    activeBass = true;
  }

  // --- KEYS (Offbeat funk clav/Rhodes chords) ---
  if (step === 4) {
    triggerKeys(CHORD_DM9, '16n', time, 0.75);
    activeKeys = true;
  } else if (step === 7) {
    triggerKeys(CHORD_DM9, '16n', time, 0.6);
    activeKeys = true;
  } else if (step === 12) {
    triggerKeys(CHORD_G13, '16n', time, 0.7);
    activeKeys = true;
  } else if (step === 14) {
    triggerKeys(CHORD_G13, '16n', time, 0.65);
    activeKeys = true;
  } else if (step === 20) {
    triggerKeys(CHORD_BBMAJ7, '16n', time, 0.75);
    activeKeys = true;
  } else if (step === 23) {
    triggerKeys(CHORD_BBMAJ7, '16n', time, 0.6);
    activeKeys = true;
  } else if (step === 28) {
    triggerKeys(CHORD_A7SHARP9, '16n', time, 0.8);
    activeKeys = true;
  }

  // --- BRASS (Bar 2 turnaround stabs) ---
  if (step === 28) {
    triggerBrass(BRASS_D_MIN, '16n', time, 0.85);
    activeBrass = true;
  } else if (step === 30) {
    triggerBrass(BRASS_C_MAJ, '16n', time, 0.9);
    activeBrass = true;
  }

  // Schedule UI update on animation frame using Tone.Draw for perfect visual sync
  Tone.Draw.schedule(() => {
    if (stepCallback && isPlaying) {
      stepCallback({
        step,
        step16,
        bar,
        activeTracks: {
          bass: activeBass,
          keys: activeKeys,
          brass: activeBrass,
          drums: activeDrums,
        },
      });
    }
  }, time);

  // Advance step (0 through 31)
  currentStep = (currentStep + 1) % 32;
}

/**
 * Start the 2-bar Electric Funk demo groove
 */
export async function startDemoLoop(onStep?: (event: DemoStepEvent) => void): Promise<void> {
  if (isPlaying) return;

  stepCallback = onStep || null;
  currentStep = 0;
  isPlaying = true;

  Tone.Transport.swing = 0.2;
  Tone.Transport.swingSubdivision = '16n';

  // Schedule 16th-note repeat loop
  repeatId = Tone.Transport.scheduleRepeat(handleStep, '16n');

  if (Tone.Transport.state !== 'started') {
    Tone.Transport.start();
  }
}

/**
 * Stop the demo groove
 */
export function stopDemoLoop(): void {
  if (!isPlaying) return;

  if (repeatId !== null) {
    Tone.Transport.clear(repeatId);
    repeatId = null;
  }

  isPlaying = false;
  currentStep = 0;
  Tone.Transport.stop();

  if (stepCallback) {
    stepCallback({
      step: 0,
      step16: 0,
      bar: 0,
      activeTracks: { bass: false, keys: false, brass: false, drums: false },
    });
  }
}

/**
 * Returns true if the demo groove is currently playing
 */
export function isDemoLoopPlaying(): boolean {
  return isPlaying;
}
