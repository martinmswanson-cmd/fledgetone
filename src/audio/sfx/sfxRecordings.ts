/**
 * Loads the recordings modern sounds layer (sfxRecordingSets.ts; public/fledgetone-sfx/) when a
 * sound needs them, and hands them to the synth (sfxModern.setSfxRecordings). A sound renders
 * without a recording that hasn't loaded yet (that layer is silent), so whatever renders a sound
 * for keeps (an export, the game kit, the maker's preview) awaits ensureSfxRecordings first.
 * Every take of a group loads at once, since each variation of a sound picks a different one.
 */
import { setSfxRecordings, type SfxRecordingData } from './sfxModern';
import { SFX_RECORDING_SETS } from './sfxRecordingSets';
import { own } from '../../store/ownKey';
import type { SfxSound } from './sfxSynth';

const BASE = 'fledgetone-sfx/';
/** Where they're published, for a page without them next to it (the one-file build) */
const FALLBACK = 'https://fledgetone.com/app/fledgetone-sfx/';
const RATE = 48000;

const loaded = new Map<string, SfxRecordingData>();
const loading = new Map<string, Promise<void>>();
let decoder: OfflineAudioContext | null = null;

setSfxRecordings(
  (group, take) => loaded.get(`${group}/${take}`),
  (group) => own(SFX_RECORDING_SETS, group)?.takes ?? 0
);

async function fetchFirst(urls: string[]): Promise<ArrayBuffer> {
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.arrayBuffer();
      last = new Error(`${res.status} ${url}`);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('the recording could not be loaded');
}

async function loadTake(group: string, take: number): Promise<void> {
  const set = SFX_RECORDING_SETS[group];
  const file = `${group}/${take}.mp3?v=${set.hash}`;
  const bytes = await fetchFirst([`${BASE}${file}`, `${FALLBACK}${file}`]);
  decoder ??= new OfflineAudioContext(1, 1, RATE);
  const audio = await decoder.decodeAudioData(bytes);
  let samples = audio.getChannelData(0);
  if (!set.loop) {
    // An MP3 can start with a few milliseconds of the encoder's padding: start at the sound
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    let start = 0;
    while (start < samples.length && Math.abs(samples[start]) < peak * 0.003) start++;
    samples = samples.slice(Math.max(0, start - Math.round(audio.sampleRate * 0.001)));
  }
  loaded.set(`${group}/${take}`, { samples, sampleRate: audio.sampleRate });
}

/** Load every take of a recording group (once; later calls wait for the same load). */
export function loadSfxRecording(group: string): Promise<void> {
  const set = own(SFX_RECORDING_SETS, group);
  if (!set) return Promise.resolve();
  let p = loading.get(group);
  if (!p) {
    p = Promise.all(Array.from({ length: set.takes }, (_, t) => loadTake(group, t))).then(() => undefined);
    p.catch(() => loading.delete(group));
    loading.set(group, p);
  }
  return p;
}

/** The recording groups a sound's layers play */
export function recordingsOf(s: SfxSound): string[] {
  if (!s.modern) return [];
  return [...new Set(s.layers.filter((l) => l.on && l.wave === 'rec' && l.rec).map((l) => l.rec!))];
}

/** Whether a sound's recordings are all here (it renders as it will in the end) */
export function sfxRecordingsReady(s: SfxSound): boolean {
  return recordingsOf(s).every((g) => Array.from({ length: own(SFX_RECORDING_SETS, g)?.takes ?? 0 }, (_, t) => loaded.has(`${g}/${t}`)).every(Boolean));
}

/** Load the recordings the sounds need. A recording that can't load leaves its layer silent. */
export async function ensureSfxRecordings(sounds: SfxSound | readonly SfxSound[]): Promise<void> {
  const groups = new Set((Array.isArray(sounds) ? sounds : [sounds]).flatMap((s: SfxSound) => recordingsOf(s)));
  await Promise.all([...groups].map((g) => loadSfxRecording(g).catch(() => undefined)));
}
