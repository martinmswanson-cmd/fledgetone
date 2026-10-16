/**
 * The tempo and key of the sounds in the library (sampleAnalysis.ts), worked out once per sound
 * when something on screen asks, in idle time, and remembered in this browser by the sound's id
 * (a hash of its bytes, so the same file always has the same answer).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { liveMix } from './engine';
import { decodeSound } from './soundLibrary';
import { analyzeSample, ANALYSIS_RATE, forAnalysis, type SampleAnalysis } from './sampleAnalysis';

export type AnalysisState = SampleAnalysis | 'busy' | 'failed';

export const useSampleAnalysis = create<{ results: Record<string, AnalysisState> }>(() => ({ results: {} }));

const STORAGE_KEY = 'fledgetone.sampleAnalysis.v1';
/** How many sounds' answers this browser remembers */
const REMEMBER = 300;

function remembered(): Record<string, SampleAnalysis> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function remember(id: string, result: SampleAnalysis): void {
  try {
    const all = remembered();
    delete all[id];
    all[id] = result;
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - REMEMBER))) delete all[old];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: it's worked out again next time
  }
}

const set = (id: string, state: AnalysisState) => useSampleAnalysis.setState((s) => ({ results: { ...s.results, [id]: state } }));
const idle = () => new Promise<void>((resolve) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => resolve(), { timeout: 500 }) : setTimeout(resolve, 0)));

/** The sound's tempo and key (null if it can't be read). Worked out once; asking again gives the same answer. */
export async function analyzeSound(id: string): Promise<SampleAnalysis | null> {
  const known = useSampleAnalysis.getState().results[id];
  if (known && known !== 'busy' && known !== 'failed') return known;
  const stored = remembered()[id];
  if (stored) {
    set(id, stored);
    return stored;
  }
  if (known === 'busy') return null;
  set(id, 'busy');
  try {
    // The copy decoded for playback (no second decode kept in memory), brought to the analysis rate
    const buffer = await decodeSound(id, liveMix.bus.context.sampleRate);
    await idle();
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const result = analyzeSample(forAnalysis(channels, buffer.sampleRate), ANALYSIS_RATE);
    set(id, result);
    remember(id, result);
    return result;
  } catch {
    set(id, 'failed');
    return null;
  }
}

/** A sound's tempo and key for a component: starts working it out on first use. */
export function useSoundAnalysis(id: string | undefined): AnalysisState | undefined {
  const state = useSampleAnalysis((s) => (id ? s.results[id] : undefined));
  useEffect(() => {
    if (id && !state) void analyzeSound(id);
  }, [id, state]);
  return state;
}
