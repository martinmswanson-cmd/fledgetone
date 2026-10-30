/**
 * The Sound FX tab: the sound effects maker. Make a sound (about sixty kinds in groups, shaped
 * with layers and a finishing chain), make a whole matching set in one go, or keep sounds in My
 * sounds. Every sound is levelled, trimmed and can export with variations, as WAV or Ogg, one file
 * or a zip named for game engines. The synth is sfxSynth.ts.
 */
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { afterMaster, liveContext } from '../../audio/liveContext';
import { previewVoice, type PreviewVoice } from '../../audio/previewFade';
import { Copy, Dices, Download, Gamepad2, Layers, Play, Plus, RefreshCw, Shuffle, Square, Star, Trash2, Upload, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { isAudioKind } from '../../audio/instrumentCatalog';
import { initAudio } from '../../audio/engine';
import { dropAudioFiles } from '../timeline/audioFiles';
import { detectKey, NOTE_NAMES, type SongKey } from '../../store/songKey';
import { createZip, type ZipEntry } from '../../audio/zip';
import {
  BASE_LAYER,
  generateSfx,
  groupOf,
  MAX_LAYERS,
  mutateSfx,
  parseSfx,
  renderSfx,
  renderSfxStereo,
  SFX_GROUPS,
  SFX_LABELS,
  SFX_LEVELS,
  SFX_SETS,
  SFX_WAVE_LABELS,
  SFX_WAVES,
  sfxFileName,
  sfxWav,
  sfxWavChannels,
  tuneSfx,
  UNPITCHED,
  varySfx,
  type SfxCategory,
  type SfxLayer,
  type SfxSetId,
  type SfxSound,
} from '../../audio/sfx/sfxSynth';
import { SFX_MATERIAL_LABELS, SFX_MATERIALS } from '../../audio/sfx/sfxModern';
import { ensureSfxRecordings, sfxRecordingsReady } from '../../audio/sfx/sfxRecordings';
import { SFX_RECORDING_SETS } from '../../audio/sfx/sfxRecordingSets';
import { claimPreview, registerPreview } from '../../audio/exclusivePreview';

interface Made {
  name: string;
  sound: SfxSound;
  kind?: SfxCategory;
  /** Opened from the song's game sounds: Update in game puts the changes back */
  gameId?: string;
}

type Mode = 'sound' | 'set' | 'mine' | 'game';
type Format = 'wav' | 'ogg';

interface ExportSettings {
  format: Format;
  rate: 44100 | 48000;
  /** How many versions of each sound to save (1: just the sound) */
  variations: number;
  /** How far variations move the pitch, semitones each way */
  spread: number;
}

const LIBRARY_KEY = 'bosBeatbox.mySounds';
const SETTINGS_KEY = 'bosBeatbox.sfxExport';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** My sounds as saved: the ones that still read */
function readLibrary(): Made[] {
  const raw = readJson<unknown[]>(LIBRARY_KEY, []);
  return (Array.isArray(raw) ? raw : []).flatMap((x) => {
    const o = x as { name?: unknown; sound?: unknown; kind?: unknown };
    const sound = parseSfx(o?.sound);
    return sound && typeof o.name === 'string' ? [{ name: o.name.slice(0, 60), sound, ...(typeof o.kind === 'string' && o.kind in SFX_LABELS ? { kind: o.kind as SfxCategory } : {}) }] : [];
  });
}

function readExport(): ExportSettings {
  const s = readJson<Partial<ExportSettings>>(SETTINGS_KEY, {});
  return {
    format: s.format === 'ogg' ? 'ogg' : 'wav',
    rate: s.rate === 48000 ? 48000 : 44100,
    variations: typeof s.variations === 'number' ? Math.max(1, Math.min(8, Math.round(s.variations))) : 1,
    spread: typeof s.spread === 'number' ? Math.max(0, Math.min(3, s.spread)) : 1,
  };
}

const freshSeed = () => Math.floor(Math.random() * 2 ** 31);

interface SfxState {
  mode: Mode;
  group: string;
  current: Made;
  layer: number;
  recent: Made[];
  counts: Partial<Record<SfxCategory, number>>;
  library: Made[];
  tune: boolean;
  exp: ExportSettings;
  setId: SfxSetId;
  set: Made[];
  setStyle: number;
}

const useSfx = create<SfxState>(() => ({
  mode: 'sound',
  group: 'UI',
  current: { name: 'Confirm 1', sound: generateSfx('uiConfirm', 7), kind: 'uiConfirm' },
  layer: 0,
  recent: [],
  counts: {},
  library: readLibrary(),
  tune: true,
  exp: readExport(),
  setId: 'ui',
  set: [],
  setStyle: 1,
}));

const st = useSfx.setState;

/** Show one part of the maker (for search). */
// oxlint-disable-next-line react/only-export-components
export const showSfxMode = (mode: Mode) => st({ mode });
const editSound = (patch: Partial<SfxSound>) => st((s) => ({ current: { ...s.current, sound: { ...s.current.sound, ...patch } } }));
const editLayer = (i: number, patch: Partial<SfxLayer>) => st((s) => ({ current: { ...s.current, sound: { ...s.current.sound, layers: s.current.sound.layers.map((l, k) => (k === i ? { ...l, ...patch } : l)) } } }));
const setExport = (patch: Partial<ExportSettings>) =>
  st((s) => {
    const exp = { ...s.exp, ...patch };
    writeJson(SETTINGS_KEY, exp);
    return { exp };
  });
const keepRecent = (made: Made) => st((s) => ({ recent: [made, ...s.recent.filter((r) => r.name !== made.name)].slice(0, 12) }));

/** A new sound of a kind, named "Kind n". */
function make(kind: SfxCategory): Made {
  const n = (useSfx.getState().counts[kind] ?? 0) + 1;
  const made = { name: `${SFX_LABELS[kind]} ${n}`, sound: generateSfx(kind, freshSeed()), kind };
  st((s) => ({ current: made, layer: 0, counts: { ...s.counts, [kind]: n } }));
  keepRecent(made);
  return made;
}

function saveLibrary(library: Made[]): boolean {
  st({ library });
  return writeJson(LIBRARY_KEY, library);
}

/** The sound as heard: with Tune to key, in the song's key. */
const tuned = (s: SfxSound, key: SongKey | null, tune: boolean) => (tune && key ? tuneSfx(s, key.root, key.steps) : s);

const noteName = (freq: number) => {
  const m = Math.round(69 + 12 * Math.log2(freq / 440));
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};

// ---- Playing ----

let playing: AudioBufferSourceNode | null = null;
/** Every sound playing or waiting to (Hear variations queues several), so Stop stops them all */
const sounding = new Map<AudioBufferSourceNode, PreviewVoice>();
const playListeners = new Set<() => void>();
const usePlaying = () => {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    playListeners.add(l);
    return () => void playListeners.delete(l);
  }, []);
  return playing;
};
/** Stop every sound (with a short fade: never cut mid-waveform). */
function stop() {
  for (const voice of sounding.values()) voice.stop();
  sounding.clear();
  playing = null;
  playListeners.forEach((l) => l());
}
// Another preview starting stops these
registerPreview('sfx-maker', stop);

/** Play rendered samples (mono, or stereo channels) now (a loop goes round until stopped), stopping whatever was playing. */
async function audition(samples: Float32Array | Float32Array[], sampleRate: number, loop = false, when = 0) {
  await initAudio();
  const ctx = liveContext.rawContext as AudioContext;
  const channels = Array.isArray(samples) ? samples : [samples];
  const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((x, c) => buffer.copyToChannel(x as Float32Array<ArrayBuffer>, c));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  const voice = previewVoice(src, afterMaster());
  if (!when) stop();
  // (the one preview playing: a suggestion's before-and-after, say, stops)
  claimPreview('sfx-maker');
  src.start(ctx.currentTime + when);
  playing = src;
  sounding.set(src, voice);
  src.onended = () => {
    sounding.delete(src);
    if (playing === src) {
      playing = null;
      playListeners.forEach((l) => l());
    }
  };
  playListeners.forEach((l) => l());
}

const PREVIEW_RATE = 44100;
/** Play a sound (once the recordings it layers have loaded) */
const hear = (s: SfxSound) => void ensureSfxRecordings(s).then(() => audition(renderSfxStereo(s, PREVIEW_RATE), PREVIEW_RATE, s.loop));

/** Each variation in turn, a moment apart. */
async function hearVariations(s: SfxSound, count: number, spread: number) {
  stop();
  await ensureSfxRecordings(s);
  let at = 0;
  for (let i = 0; i < count; i++) {
    const x = renderSfxStereo({ ...varySfx(s, i, spread), loop: false }, PREVIEW_RATE);
    await audition(x, PREVIEW_RATE, false, at + 0.01);
    at += Math.min(1.2, x[0].length / PREVIEW_RATE) + 0.25;
  }
}

// ---- Files ----

/** The files for a sound: itself, or its variations numbered. */
async function filesOf(made: Made, key: SongKey | null, tune: boolean, exp: ExportSettings, folder = ''): Promise<ZipEntry[]> {
  const sound = tuned(made.sound, key, tune);
  const count = exp.variations;
  const out: ZipEntry[] = [];
  await ensureSfxRecordings(sound);
  for (let i = 0; i < count; i++) {
    // A classic sound a 16-bit mono WAV as before; a modern one stereo, 24-bit
    const channels = renderSfxStereo(varySfx(sound, i, exp.spread), exp.rate);
    const name = `${folder}${sfxFileName(made.name, count > 1 ? i + 1 : undefined)}.${exp.format}`;
    if (exp.format === 'ogg') {
      const { encodeAudio } = await import('../../audio/encoders');
      // Held under full scale once decoded, not the music's -1 dBTP: a sound is levelled to its loudness
      // with its samples under SFX_CEILING (sfxSynth.ts) alike in either format, so the Ogg plays at the
      // WAV's level, and is turned down only where the decoded file would clip (rarely: a few tenths of a dB)
      out.push({ name, data: await encodeAudio(channels, exp.rate, 'ogg', { bitDepth: 16, ceilingDbtp: 0 }) });
    } else {
      const wav = sound.modern ? sfxWavChannels(channels, exp.rate, sound.loop, 24) : sfxWav(channels[0], exp.rate, sound.loop);
      out.push({ name, data: new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }) });
    }
  }
  return out;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The settings of these sounds as a file the maker can open again (Import). */
const recipesFile = (sounds: Made[]) => new Blob([JSON.stringify({ format: 'fledgetone-sounds', version: 1, sounds }, null, 1)], { type: 'application/json' });

/** Sounds from a file made by recipesFile (or a single sound's settings). */
function readRecipes(text: string): Made[] {
  const raw = JSON.parse(text) as { sounds?: unknown };
  const list = Array.isArray(raw?.sounds) ? raw.sounds : [raw];
  return list.flatMap((x) => {
    const o = x as { name?: unknown; sound?: unknown; kind?: unknown };
    const sound = parseSfx(o?.sound ?? o);
    return sound ? [{ name: typeof o?.name === 'string' ? o.name.slice(0, 60) : 'Imported sound', sound, ...(typeof o?.kind === 'string' && o.kind in SFX_LABELS ? { kind: o.kind as SfxCategory } : {}) }] : [];
  });
}

// ---- Pieces ----

const Wave: React.FC<{ samples: Float32Array }> = ({ samples }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#22d3ee';
    const per = samples.length / w;
    for (let x = 0; x < w; x++) {
      let peak = 0;
      const a = Math.floor(x * per);
      const b = Math.min(samples.length, Math.floor((x + 1) * per) + 1);
      for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(samples[i]));
      const bar = Math.max(1, peak * h * 1.05);
      g.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [samples]);
  return <canvas ref={ref} className="w-full h-16 rounded bg-black/50" aria-label="Waveform of the sound" />;
};

interface RowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
  title?: string;
}
const Row: React.FC<RowProps> = ({ label, value, min, max, step, show, onChange, title }) => (
  <label className="flex items-center gap-2 text-[10px] font-mono" title={title}>
    <span className="w-16 shrink-0 uppercase text-forge-muted">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0 h-1.5 accent-cyan-400" aria-label={label} />
    <span className="w-16 text-right tabular-nums text-forge-text">{show(value)}</span>
  </label>
);

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; title?: string }> = ({ on, onClick, children, title }) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    title={title}
    className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${on ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200' : 'border-forge-border hover:text-forge-text'}`}
  >
    {children}
  </button>
);

const button = 'h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border hover:text-forge-text disabled:opacity-40';
const primary = 'h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25 disabled:opacity-40';

const ms = (s: number) => (s >= 1 ? `${s.toFixed(2)} s` : `${Math.round(s * 1000)} ms`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const semis = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} st`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

/** A sound's layer: its source, pitch movement, filter and envelope. */
const LayerControls: React.FC<{ l: SfxLayer; i: number; count: number; modern: boolean }> = ({ l, i, count, modern }) => {
  const c = (patch: Partial<SfxLayer>) => editLayer(i, patch);
  // (The panel remounts this when the notes change from outside: see its key)
  const [notes, setNotes] = useState(l.seq.join(' '));
  const pitched = !UNPITCHED.has(l.wave);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Source">
        <span className="w-16 shrink-0 text-[10px] font-mono uppercase">Source</span>
        {SFX_WAVES.filter((w) => modern || w !== 'rec').map((w) => (
          <Chip key={w} on={l.wave === w} onClick={() => c(w === 'rec' ? { wave: w, rec: l.rec ?? 'cloth', freq: 440, hold: Math.max(l.hold, 2) } : { wave: w })} title={w === 'rec' ? 'A recording of a real sound (public domain), loaded when used' : undefined}>
            {SFX_WAVE_LABELS[w]}
          </Chip>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px]">
            <input type="checkbox" checked={l.on} onChange={(e) => c({ on: e.target.checked })} /> On
          </label>
          {count > 1 && (
            <button
              type="button"
              onClick={() => st((s) => ({ layer: Math.max(0, i - 1), current: { ...s.current, sound: { ...s.current.sound, layers: s.current.sound.layers.filter((_, k) => k !== i) } } }))}
              className="flex items-center gap-1 text-[10px] hover:text-rose-300"
              title="Remove this layer"
            >
              <X className="w-3 h-3" /> Remove
            </button>
          )}
        </span>
      </div>
      {l.wave === 'rec' && (
        <label className="flex items-center gap-2 text-[10px] font-mono" title="Each variation of the sound plays a different take">
          <span className="w-16 shrink-0 uppercase text-forge-muted">Recording</span>
          <select value={l.rec ?? ''} onChange={(e) => c({ rec: e.target.value })} className="h-6 min-w-0 bg-forge-bg border border-forge-border rounded px-1 text-forge-text" aria-label="Recording">
            {Object.entries(SFX_RECORDING_SETS).map(([id, set]) => (
              <option key={id} value={id}>
                {set.label} ({set.takes} {set.takes === 1 ? 'take' : 'takes'})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1.5">
        <div className="flex flex-col gap-1.5">
          {l.wave === 'rec' ? (
            <Row label="Speed" value={Math.log2(l.freq / 440)} min={-2} max={2} step={0.01} show={(v) => `×${(2 ** v).toFixed(2)}`} onChange={(v) => c({ freq: 440 * 2 ** v })} title="Faster is higher and shorter, as a tape played fast" />
          ) : (
          <Row label={l.wave === 'crackle' ? 'Pops' : pitched ? 'Pitch' : 'Rate'} value={Math.log2(l.freq)} min={Math.log2(20)} max={Math.log2(8000)} step={0.01} show={(v) => (l.wave === 'crackle' ? `${Math.round(2 ** v)}/s` : hz(2 ** v))} onChange={(v) => c({ freq: 2 ** v })} />
          )}
          <Row label="Slide" value={l.slide} min={-48} max={48} step={1} show={semis} onChange={(slide) => c({ slide })} title="Pitch change over the sound" />
          <Row label="Curve" value={l.curve} min={0} max={1} step={0.01} show={pct} onChange={(curve) => c({ curve })} title="0: an even glide; up: most of it at the start" />
          <Row label="Jump" value={l.arp} min={-12} max={24} step={1} show={(v) => (v ? semis(v) : 'off')} onChange={(arp) => c({ arp })} title="A jump in pitch partway through, as in a coin" />
          <Row label="Jump at" value={l.arpAt} min={0} max={1} step={0.01} show={pct} onChange={(arpAt) => c({ arpAt })} />
          <label className="flex items-center gap-2 text-[10px] font-mono" title="Notes in turn, in semitones from the pitch: 0 4 7 12 is a major arpeggio">
            <span className="w-16 shrink-0 uppercase text-forge-muted">Notes</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() =>
                c({
                  seq: notes
                    .split(/[\s,]+/)
                    .map(Number)
                    .filter(Number.isFinite)
                    .map((n) => Math.max(-36, Math.min(36, Math.round(n))))
                    .slice(0, 32),
                })
              }
              placeholder="e.g. 0 4 7 12"
              aria-label="Notes"
              className="flex-1 min-w-0 h-6 bg-forge-bg border border-forge-border rounded px-1.5 text-forge-text focus:outline-none focus:border-cyan-500"
            />
          </label>
          <Row label="Note time" value={l.seqStep} min={0.02} max={0.5} step={0.005} show={ms} onChange={(seqStep) => c({ seqStep })} />
          <Row label="Vibrato" value={l.vibDepth} min={0} max={2} step={0.05} show={(v) => (v ? `${v.toFixed(2)} st` : 'off')} onChange={(vibDepth) => c({ vibDepth })} />
          <Row label="Vib rate" value={l.vibRate} min={1} max={40} step={0.5} show={(v) => `${v} Hz`} onChange={(vibRate) => c({ vibRate })} />
          <Row label="Repeat" value={l.repeat} min={0} max={20} step={0.5} show={(v) => (v ? `${v}/s` : 'off')} onChange={(repeat) => c({ repeat })} title="Restart the slide this many times a second: a warble" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Row label="Attack" value={l.attack} min={0} max={0.5} step={0.005} show={ms} onChange={(attack) => c({ attack })} />
          <Row label="Hold" value={l.hold} min={0} max={2} step={0.005} show={ms} onChange={(hold) => c({ hold })} />
          <Row label="Punch" value={l.punch} min={0} max={1} step={0.01} show={pct} onChange={(punch) => c({ punch })} />
          <Row label="Decay" value={l.decay} min={0.005} max={2} step={0.005} show={ms} onChange={(decay) => c({ decay })} />
          <Row label="Tremolo" value={l.trem} min={0} max={1} step={0.01} show={(v) => (v ? pct(v) : 'off')} onChange={(trem) => c({ trem })} />
          <Row label="Trem rate" value={l.tremRate} min={0.1} max={40} step={0.1} show={(v) => `${v} Hz`} onChange={(tremRate) => c({ tremRate })} />
          {l.wave === 'square' && <Row label="Width" value={l.duty} min={0.05} max={0.5} step={0.01} show={pct} onChange={(duty) => c({ duty })} />}
          {l.wave === 'fm' && (
            <>
              <Row label="FM ratio" value={l.fmRatio} min={0.25} max={8} step={0.25} show={(v) => `×${v}`} onChange={(fmRatio) => c({ fmRatio })} />
              <Row label="FM amount" value={l.fmIndex} min={0} max={10} step={0.1} show={(v) => v.toFixed(1)} onChange={(fmIndex) => c({ fmIndex })} />
            </>
          )}
          <Row label="Level" value={l.gain} min={0} max={1} step={0.01} show={pct} onChange={(gain) => c({ gain })} title="This layer's level in the sound" />
          <Row label="Start" value={l.delay} min={0} max={1.5} step={0.005} show={(v) => (v ? `+${ms(v)}` : 'at once')} onChange={(delay) => c({ delay })} title="When this layer starts" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1" role="group" aria-label="Filter type">
            <span className="w-16 shrink-0 text-[10px] font-mono uppercase">Filter</span>
            <Chip on={!l.bandpass} onClick={() => c({ bandpass: false })}>
              low-pass
            </Chip>
            <Chip on={l.bandpass} onClick={() => c({ bandpass: true, lowpass: l.lowpass >= 19999 ? 1500 : l.lowpass })}>
              band-pass
            </Chip>
          </div>
          <Row label="Cutoff" value={Math.log2(l.lowpass)} min={Math.log2(100)} max={Math.log2(20000)} step={0.01} show={(v) => (2 ** v >= 19999 && !l.bandpass ? 'open' : hz(2 ** v))} onChange={(v) => c({ lowpass: 2 ** v })} />
          <Row label="Resonance" value={l.reso} min={0} max={1} step={0.01} show={pct} onChange={(reso) => c({ reso })} />
          <Row label="Sweep" value={l.lpSweep} min={-4} max={4} step={0.1} show={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`} onChange={(lpSweep) => c({ lpSweep })} title="How far the cutoff moves over the sound" />
          <Row label="Wobble" value={l.wobble} min={0} max={3} step={0.05} show={(v) => (v ? `${v.toFixed(2)} oct` : 'off')} onChange={(wobble) => c({ wobble })} title="The cutoff moving back and forth" />
          <Row label="Wob rate" value={l.wobbleRate} min={0.05} max={20} step={0.05} show={(v) => `${v} Hz`} onChange={(wobbleRate) => c({ wobbleRate })} />
          <Row label="High-pass" value={Math.log2(l.highpass)} min={Math.log2(20)} max={Math.log2(8000)} step={0.01} show={(v) => (2 ** v <= 21 ? 'off' : hz(2 ** v))} onChange={(v) => c({ highpass: 2 ** v })} />
          <Row label="Crush" value={l.crush} min={0} max={1} step={0.01} show={(v) => (v ? `${Math.round(16 - v * 14)}-bit` : 'off')} onChange={(crush) => c({ crush })} />
          {modern && (
            <>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Body" title="What the layer strikes: an object of this material ringing at the layer's pitch">
                <span className="w-16 shrink-0 text-[10px] font-mono uppercase">Body</span>
                <Chip on={!l.body} onClick={() => c({ body: undefined })}>
                  none
                </Chip>
                {SFX_MATERIALS.map((m) => (
                  <Chip key={m} on={l.body === m} onClick={() => c({ body: m, ring: l.ring ?? 1, bodyMix: l.bodyMix ?? 0.7 })}>
                    {SFX_MATERIAL_LABELS[m].toLowerCase()}
                  </Chip>
                ))}
              </div>
              {l.body && (
                <>
                  <Row label="Ring" value={l.ring ?? 1} min={0.2} max={3} step={0.05} show={(v) => `×${v.toFixed(2)}`} onChange={(ring) => c({ ring })} title="How long the body rings" />
                  <Row label="Body mix" value={l.bodyMix ?? 0.7} min={0} max={1} step={0.01} show={pct} onChange={(bodyMix) => c({ bodyMix })} title="How much of the ringing body you hear, against the strike itself" />
                </>
              )}
              <Row label="Pan" value={l.pan ?? 0} min={-1} max={1} step={0.01} show={(v) => (Math.abs(v) < 0.01 ? 'centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`)} onChange={(pan) => c({ pan, ...(l.panTo === undefined || l.panTo === l.pan ? { panTo: pan } : {}) })} />
              <Row label="Pan to" value={l.panTo ?? l.pan ?? 0} min={-1} max={1} step={0.01} show={(v) => (Math.abs(v) < 0.01 ? 'centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`)} onChange={(panTo) => c({ panTo })} title="Where it ends up: a sound moving past" />
              <Row label="Width" value={l.width ?? 0} min={0} max={1} step={0.01} show={(v) => (v ? pct(v) : 'narrow')} onChange={(width) => c({ width })} title="Noise spread across both sides" />
              <Row label="Gusts" value={l.gust ?? 0} min={0} max={1} step={0.01} show={(v) => (v ? pct(v) : 'off')} onChange={(gust) => c({ gust, gustRate: l.gustRate ?? 0.3 })} title="The layer swelling and dropping at random, as wind does; Wobble then moves the filter with the gusts" />
              {(l.gust ?? 0) > 0 && <Row label="Gust speed" value={l.gustRate ?? 0.3} min={0.05} max={2} step={0.01} show={(v) => `${v.toFixed(2)}/s`} onChange={(gustRate) => c({ gustRate })} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** What goes over the whole sound. */
const FinishControls: React.FC<{ s: SfxSound }> = ({ s }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1.5">
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1" role="group" aria-label="Engine">
        <span className="w-16 shrink-0 text-[10px] font-mono uppercase" title="Modern: clean waves, natural decays, struck bodies, recordings and stereo. Classic: the old 8-bit-style engine, mono">
          Engine
        </span>
        <Chip on={!!s.modern} onClick={() => editSound({ modern: true })}>
          modern
        </Chip>
        <Chip on={!s.modern} onClick={() => editSound({ modern: false })}>
          classic
        </Chip>
      </div>
      <Row label="Pitch" value={s.pitch} min={-24} max={24} step={0.5} show={semis} onChange={(pitch) => editSound({ pitch })} title="Every layer up or down" />
      <Row label="Drive" value={s.drive} min={0} max={1} step={0.01} show={(v) => (v ? pct(v) : 'off')} onChange={(drive) => editSound({ drive })} title="Soft clipping: grit and weight" />
      <div className="flex items-center gap-1" role="group" aria-label="Loudness">
        <span className="w-16 shrink-0 text-[10px] font-mono uppercase" title="Sounds are made to a loudness for their kind, so a set is even">
          Loudness
        </span>
        {SFX_LEVELS.map((lv) => (
          <Chip key={lv} on={s.level === lv} onClick={() => editSound({ level: lv })}>
            {lv}
          </Chip>
        ))}
      </div>
      <Row label="Volume" value={s.volume} min={0.1} max={1} step={0.01} show={pct} onChange={(volume) => editSound({ volume })} />
    </div>
    <div className="flex flex-col gap-1.5">
      <Row label="Echo" value={s.echo} min={0} max={1} step={0.01} show={(v) => (v ? pct(v) : 'off')} onChange={(echo) => editSound({ echo })} />
      <Row label="Echo time" value={s.echoTime} min={0.02} max={0.8} step={0.005} show={ms} onChange={(echoTime) => editSound({ echoTime })} />
      <Row label="Feedback" value={s.echoFeedback} min={0} max={0.9} step={0.01} show={pct} onChange={(echoFeedback) => editSound({ echoFeedback })} />
    </div>
    <div className="flex flex-col gap-1.5">
      <Row label="Reverb" value={s.reverb} min={0} max={1} step={0.01} show={(v) => (v ? pct(v) : 'off')} onChange={(reverb) => editSound({ reverb })} />
      <Row label="Room" value={s.room} min={0} max={1} step={0.01} show={pct} onChange={(room) => editSound({ room })} />
      <label className="flex items-center gap-2 text-[10px] font-mono" title="A seamless loop for engines, ambience and alarms: the file loops in a game">
        <span className="w-16 shrink-0 uppercase text-forge-muted">Loop</span>
        <input type="checkbox" checked={s.loop} onChange={(e) => editSound({ loop: e.target.checked })} aria-label="Loop" />
        {s.loop && <input type="range" min={0.5} max={30} step={0.25} value={s.loopLength} onChange={(e) => editSound({ loopLength: Number(e.target.value) })} className="flex-1 min-w-0 h-1.5 accent-cyan-400" aria-label="Loop length" />}
        {s.loop && <span className="w-16 text-right tabular-nums text-forge-text">{s.loopLength} s</span>}
      </label>
    </div>
  </div>
);

/** Format, sample rate and variations, shared by saving a sound and a set. */
const ExportControls: React.FC = () => {
  const exp = useSfx((s) => s.exp);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] font-mono">
      <span className="flex items-center gap-1" role="group" aria-label="Format">
        <span className="uppercase">Format</span>
        <Chip on={exp.format === 'wav'} onClick={() => setExport({ format: 'wav' })} title="WAV: exact, and loops carry their loop points">
          WAV
        </Chip>
        <Chip on={exp.format === 'ogg'} onClick={() => setExport({ format: 'ogg' })} title="Ogg Vorbis: small; Godot and Unity import it">
          OGG
        </Chip>
      </span>
      <span className="flex items-center gap-1" role="group" aria-label="Sample rate">
        <Chip on={exp.rate === 44100} onClick={() => setExport({ rate: 44100 })}>
          44.1 kHz
        </Chip>
        <Chip on={exp.rate === 48000} onClick={() => setExport({ rate: 48000 })}>
          48 kHz
        </Chip>
      </span>
      <label className="flex items-center gap-1.5" title="Save several versions of each sound, a little different, for the game to pick from: footsteps and hits heard often don't repeat">
        <span className="uppercase">Variations</span>
        <input type="range" min={1} max={8} step={1} value={exp.variations} onChange={(e) => setExport({ variations: Number(e.target.value) })} className="w-20 h-1.5 accent-cyan-400" aria-label="Variations" />
        <span className="w-4 text-forge-text">{exp.variations}</span>
      </label>
      {exp.variations > 1 && (
        <label className="flex items-center gap-1.5" title="How far the variations move in pitch">
          <span className="uppercase">Spread</span>
          <input type="range" min={0} max={3} step={0.25} value={exp.spread} onChange={(e) => setExport({ spread: Number(e.target.value) })} className="w-20 h-1.5 accent-cyan-400" aria-label="Spread" />
          <span className="w-12 text-forge-text">±{exp.spread} st</span>
        </label>
      )}
    </div>
  );
};

const TuneToKey: React.FC<{ keyOf: SongKey | null }> = ({ keyOf }) => {
  const tune = useSfx((s) => s.tune);
  return (
    <label className={`flex items-center gap-1.5 ${keyOf ? '' : 'opacity-50'}`} title={keyOf ? `Pitches and tunes snap to notes of ${keyOf.name}, the key the song's notes are in` : 'Write some notes first: the key comes from them'}>
      <input type="checkbox" checked={tune && !!keyOf} disabled={!keyOf} onChange={(e) => st({ tune: e.target.checked })} />
      Tune to key{keyOf ? ` (${keyOf.name})` : ''}
    </label>
  );
};

// ---- Make a sound ----

const SoundMaker: React.FC<{ keyOf: SongKey | null }> = ({ keyOf }) => {
  const { current, recent, tune, group, layer, exp, library } = useSfx();
  const inGame = useTimelineStore((t) => (current.gameId ? t.gameSfx.find((g) => g.id === current.gameId) : undefined));
  const s = current.sound;
  const heard = useMemo(() => tuned(s, keyOf, tune), [s, keyOf, tune]);
  const deferred = useDeferredValue(heard);
  // (Drawn again once the recordings the sound layers have loaded)
  const [arrived, setArrived] = useState(0);
  useEffect(() => {
    if (sfxRecordingsReady(deferred)) return;
    let live = true;
    void ensureSfxRecordings(deferred).then(() => live && setArrived((n) => n + 1));
    return () => {
      live = false;
    };
  }, [deferred]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const samples = useMemo(() => renderSfx(deferred, PREVIEW_RATE), [deferred, arrived]);
  const isPlaying = usePlaying();
  const [notice, setNotice] = useState('');
  const kinds = SFX_GROUPS.find((g) => g.name === group)?.kinds ?? [];
  const l = s.layers[Math.min(layer, s.layers.length - 1)];
  const replay = () => hear(tuned(useSfx.getState().current.sound, keyOf, useSfx.getState().tune));
  const firstPitched = heard.layers.find((x) => x.on && !UNPITCHED.has(x.wave));

  const save = async () => {
    const files = await filesOf(current, keyOf, tune, exp);
    if (files.length === 1) download(files[0].data, files[0].name);
    else download(await createZip(files), `${sfxFileName(current.name)}.zip`);
    setNotice(files.length === 1 ? `Saved ${files[0].name}.` : `Saved ${files.length} variations in ${sfxFileName(current.name)}.zip.`);
  };
  const addToSong = async () => {
    const t = useTimelineStore.getState();
    const selected = t.tracks.find((x) => x.id === t.selectedTrackId);
    const target = selected && isAudioKind(selected.instrumentKey) ? selected.id : null;
    await ensureSfxRecordings(heard);
    const wav = heard.modern ? sfxWavChannels(renderSfxStereo(heard, 48000), 48000, false, 24) : sfxWav(renderSfx(heard, 44100), 44100);
    const file = new File([wav as Uint8Array<ArrayBuffer>], `${current.name.trim() || 'Sound effect'}.wav`, { type: 'audio/wav' });
    await dropAudioFiles(target, t.playheadPosition, [file]);
    setNotice(`Added "${current.name}" at the playhead${target ? ` on ${selected!.name}` : ' on a new Audio track'}.`);
  };
  const keep = () => {
    const name = library.some((m) => m.name === current.name) ? `${current.name} (${library.length + 1})` : current.name;
    const ok = saveLibrary([{ ...current, name }, ...library]);
    setNotice(ok ? `Kept "${name}" in My sounds.` : 'This browser is out of room to keep sounds: delete some from My sounds.');
  };

  return (
    <div
      className="flex flex-col gap-3"
      onPointerUp={(e) => (e.target as HTMLElement).matches('input[type=range]') && replay()}
      onKeyUp={(e) => (e.target as HTMLElement).matches('input[type=range]') && replay()}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Kinds of sound">
          {SFX_GROUPS.map((g) => (
            <button
              key={g.name}
              type="button"
              aria-pressed={group === g.name}
              onClick={() => st({ group: g.name })}
              className={`h-7 px-2.5 rounded-full border text-[11px] ${group === g.name ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-100' : 'border-forge-border hover:text-forge-text'}`}
            >
              {g.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Make a new sound">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                const made = make(k);
                hear(tuned(made.sound, keyOf, useSfx.getState().tune));
                setNotice('');
              }}
              className={`h-8 px-3 rounded-md border bg-forge-bg font-semibold hover:border-cyan-400/60 ${current.kind === k ? 'border-cyan-400/50 text-cyan-100' : 'border-forge-border text-forge-text'}`}
              title={`A new ${SFX_LABELS[k].toLowerCase()} sound (each click makes a different one)`}
            >
              {SFX_LABELS[k]}
            </button>
          ))}
          <span className="w-px h-6 bg-forge-border mx-1" />
          <button
            type="button"
            onClick={() => {
              st((x) => ({ current: { ...x.current, sound: mutateSfx(x.current.sound, freshSeed()) } }));
              replay();
            }}
            className={button}
            title="Like this one, a little different"
          >
            <Shuffle className="w-3.5 h-3.5" /> Mutate
          </button>
          <button
            type="button"
            onClick={() => {
              const all = SFX_GROUPS.flatMap((g) => g.kinds);
              const made = make(all[Math.floor(Math.random() * all.length)]);
              st({ group: groupOf(made.kind!) });
              hear(tuned(made.sound, keyOf, useSfx.getState().tune));
            }}
            className={button}
            title="Any kind of sound"
          >
            <Dices className="w-3.5 h-3.5" /> Surprise me
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (isPlaying ? stop() : replay())}
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
          aria-label={isPlaying ? 'Stop' : 'Play the sound'}
          title={isPlaying ? 'Stop' : 'Play'}
        >
          {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <Wave samples={samples} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <input value={current.name} onChange={(e) => st((x) => ({ current: { ...x.current, name: e.target.value } }))} aria-label="Sound name" className="h-7 w-44 bg-forge-bg border border-forge-border rounded-md px-2 text-forge-text focus:outline-none focus:border-cyan-500" />
        <span className="font-mono">
          {ms(samples.length / PREVIEW_RATE)}
          {s.loop ? ' loop' : ''}
        </span>
        <TuneToKey keyOf={keyOf} />
        {firstPitched && <span className="font-mono text-forge-text">{noteName(firstPitched.freq * 2 ** (heard.pitch / 12))}</span>}
      </div>

      <section aria-label="Layers" className="flex flex-col gap-2 rounded-lg border border-forge-border p-2.5">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Layer">
          <Layers className="w-3.5 h-3.5 mr-1" />
          {s.layers.map((x, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === layer}
              onClick={() => st({ layer: i })}
              className={`h-6 px-2 rounded border text-[10px] font-mono ${i === layer ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200' : 'border-forge-border hover:text-forge-text'} ${x.on ? '' : 'line-through opacity-60'}`}
            >
              {i + 1}. {SFX_WAVE_LABELS[x.wave]}
            </button>
          ))}
          {s.layers.length < MAX_LAYERS && (
            <button
              type="button"
              onClick={() => st((x) => ({ layer: x.current.sound.layers.length, current: { ...x.current, sound: { ...x.current.sound, layers: [...x.current.sound.layers, { ...BASE_LAYER, wave: 'pink', bandpass: true, lowpass: 3000, hold: 0, decay: 0.05, gain: 0.5, seed: freshSeed() }] } } }))}
              className="h-6 px-2 flex items-center gap-1 rounded border border-dashed border-forge-border text-[10px] hover:text-forge-text"
              title="Add a layer: a click, a thump or a tail on top"
            >
              <Plus className="w-3 h-3" /> Layer
            </button>
          )}
          {s.layers.length < MAX_LAYERS && (
            <button type="button" onClick={() => st((x) => ({ layer: x.current.sound.layers.length, current: { ...x.current, sound: { ...x.current.sound, layers: [...x.current.sound.layers, { ...l, seed: freshSeed() }] } } }))} className="h-6 px-2 flex items-center gap-1 rounded border border-dashed border-forge-border text-[10px] hover:text-forge-text" title="A copy of this layer, to change">
              <Copy className="w-3 h-3" /> Copy layer
            </button>
          )}
        </div>
        <LayerControls key={`${layer}-${s.layers.length}-${l.seq.join(',')}`} l={l} i={Math.min(layer, s.layers.length - 1)} count={s.layers.length} modern={!!s.modern} />
      </section>

      <section aria-label="Finish" className="flex flex-col gap-2 rounded-lg border border-forge-border p-2.5">
        <h4 className="text-[10px] font-mono uppercase tracking-widest">Finish</h4>
        <FinishControls s={s} />
      </section>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Recent sounds">
          <span className="text-[10px] font-mono uppercase mr-1">Recent</span>
          {recent.map((r) => (
            <button
              key={r.name}
              type="button"
              onClick={() => {
                st({ current: r, layer: 0 });
                hear(tuned(r.sound, keyOf, useSfx.getState().tune));
              }}
              className={`px-1.5 py-0.5 rounded border text-[10px] ${r.name === current.name ? 'border-cyan-400/60 text-cyan-200' : 'border-forge-border hover:text-forge-text'}`}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-forge-border p-2.5">
        <ExportControls />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {notice && <span className="mr-auto text-emerald-300">{notice}</span>}
          {exp.variations > 1 && (
            <button type="button" onClick={() => void hearVariations(heard, exp.variations, exp.spread)} className={button} title="Play each variation in turn">
              <Play className="w-3.5 h-3.5" /> Hear variations
            </button>
          )}
          <button type="button" onClick={keep} className={button} title="Keep it in My sounds (in this browser)">
            <Star className="w-3.5 h-3.5" /> Keep
          </button>
          {inGame ? (
            <button
              type="button"
              onClick={() => {
                // (Only the sound: its variations and spread are set on the game sound itself)
                useTimelineStore.getState().updateGameSfx(inGame.id, { sound: heard });
                setNotice(`Updated ${inGame.name} in the game kit.`);
              }}
              className={button}
              title="Put your changes back into the song's game sounds"
            >
              <Gamepad2 className="w-3.5 h-3.5" /> Update in game
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const [name] = useTimelineStore.getState().addGameSfx([{ name: current.name.replace(/\s+\d+$/, '') || current.name, sound: heard, variations: exp.variations, spread: exp.spread }]);
                const id = useTimelineStore.getState().gameSfx.find((g) => g.name === name)?.id;
                st((x) => ({ current: { ...x.current, gameId: id } }));
                setNotice(`Added to the game kit as ${name}${exp.variations > 1 ? ` (${exp.variations} variations)` : ''}: the game plays it with playSfx("${name}").`);
              }}
              className={button}
              title="Add it to this song's game sounds: the game kit export carries it, with its variations, and its players can play it"
            >
              <Gamepad2 className="w-3.5 h-3.5" /> Add to game
            </button>
          )}
          <button type="button" onClick={() => void save()} className={button}>
            <Download className="w-3.5 h-3.5" /> {exp.variations > 1 ? `Save ${exp.variations} (.zip)` : `Save ${exp.format.toUpperCase()}`}
          </button>
          <button type="button" onClick={() => void addToSong()} className={primary} title="Put it on an Audio track at the playhead (the selected one, if it's an Audio track)">
            <Plus className="w-3.5 h-3.5" /> Add to song
          </button>
        </div>
      </div>
    </div>
  );
};

// ---- Make a set ----

function makeSet(id: SfxSetId, style = freshSeed()) {
  const def = SFX_SETS.find((x) => x.id === id)!;
  const set = def.kinds.map((k, i) => ({ name: SFX_LABELS[k], sound: generateSfx(k, (style + i * 104729) >>> 0, style), kind: k as SfxCategory }));
  st({ setId: id, set, setStyle: style });
}

const SetMaker: React.FC<{ keyOf: SongKey | null }> = ({ keyOf }) => {
  const { setId, set, setStyle, tune, exp, library } = useSfx();
  const def = SFX_SETS.find((x) => x.id === setId)!;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const files = set.length * exp.variations;

  const downloadSet = async () => {
    setBusy(true);
    try {
      const entries: ZipEntry[] = [];
      for (const made of set) entries.push(...(await filesOf(made, keyOf, tune, exp, `${def.folder}/`)));
      entries.push({ name: `${def.folder}/sounds.json`, data: recipesFile(set) });
      download(await createZip(entries), `${def.folder}_sounds.zip`);
      setNotice(`Saved ${entries.length - 1} files in ${def.folder}_sounds.zip (with sounds.json: Import it to change them later).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p>Every sound a game of this kind needs, made in one go with one style: they sound like a family, are levelled to sit together, and save as a zip with names ready for the game.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sets">
        {SFX_SETS.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={x.id === setId}
            onClick={() => {
              makeSet(x.id);
              setNotice('');
            }}
            className={`text-left rounded-lg border px-3 py-2 ${x.id === setId && set.length ? 'border-cyan-400/70 bg-cyan-500/10' : 'border-forge-border hover:border-cyan-400/50'}`}
            title={x.kinds.map((k) => SFX_LABELS[k]).join(', ')}
          >
            <div className="text-[12px] font-semibold text-forge-text">{x.name}</div>
            <div className="text-[10px]">{x.kinds.length} sounds</div>
          </button>
        ))}
      </div>
      {set.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => makeSet(setId)} className={button} title="The whole set again in a new style">
              <RefreshCw className="w-3.5 h-3.5" /> New style
            </button>
            <button
              type="button"
              onClick={async () => {
                stop();
                await ensureSfxRecordings(set.map((m) => m.sound));
                let at = 0;
                for (const m of set) {
                  const x = renderSfxStereo({ ...tuned(m.sound, keyOf, tune), loop: false, loopLength: Math.min(1.5, m.sound.loopLength) }, PREVIEW_RATE);
                  await audition(x, PREVIEW_RATE, false, at + 0.01);
                  at += Math.min(1.5, x[0].length / PREVIEW_RATE) + 0.3;
                }
              }}
              className={button}
              title="Each sound in turn"
            >
              <Play className="w-3.5 h-3.5" /> Hear all
            </button>
            <TuneToKey keyOf={keyOf} />
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5" aria-label="Sounds in the set">
            {set.map((m, i) => (
              <li key={i} className="flex items-center gap-1.5 rounded-md border border-forge-border bg-forge-bg/60 px-2 py-1">
                <button type="button" onClick={() => hear(tuned(m.sound, keyOf, tune))} className="h-6 w-6 flex items-center justify-center rounded-full border border-cyan-400/50 text-cyan-100" aria-label={`Play ${m.name}`}>
                  <Play className="w-3 h-3" />
                </button>
                <span className="flex-1 min-w-0 truncate text-forge-text">{m.name}</span>
                {m.sound.loop && <span className="text-[9px] font-mono">loop</span>}
                <button
                  type="button"
                  onClick={() => {
                    const sound = generateSfx(m.kind!, freshSeed(), setStyle);
                    st((x) => ({ set: x.set.map((y, k) => (k === i ? { ...y, sound } : y)) }));
                    hear(tuned(sound, keyOf, tune));
                  }}
                  className="p-1 hover:text-forge-text"
                  title="Another one, in the set's style"
                  aria-label={`Another ${m.name}`}
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => st({ current: m, layer: 0, mode: 'sound', group: groupOf(m.kind!) })} className="px-1.5 text-[10px] rounded border border-forge-border hover:text-forge-text" title="Open it in Make a sound to shape it">
                  Edit
                </button>
                <button type="button" onClick={() => st((x) => ({ set: x.set.filter((_, k) => k !== i) }))} className="p-1 hover:text-rose-300" aria-label={`Leave out ${m.name}`} title="Leave it out of the set">
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 rounded-lg border border-forge-border p-2.5">
            <ExportControls />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {notice && <span className="mr-auto text-emerald-300">{notice}</span>}
              <button
                type="button"
                onClick={() => {
                  const ok = saveLibrary([...set.map((m) => ({ ...m, name: `${def.name}: ${m.name}` })), ...library]);
                  setNotice(ok ? `Kept ${set.length} sounds in My sounds.` : 'This browser is out of room to keep sounds: delete some from My sounds.');
                }}
                className={button}
              >
                <Star className="w-3.5 h-3.5" /> Keep all
              </button>
              <button
                type="button"
                onClick={() => {
                  const names = useTimelineStore.getState().addGameSfx(set.map((m) => ({ name: `${def.folder}_${m.name}`, sound: tuned(m.sound, keyOf, tune), variations: exp.variations, spread: exp.spread })));
                  setNotice(`Added ${names.length} sounds to the game kit (${names[0]}, ${names[1] ?? ''}…).`);
                }}
                className={button}
                title="Add the whole set to this song's game sounds, for the game kit export"
              >
                <Gamepad2 className="w-3.5 h-3.5" /> Add all to game
              </button>
              <button type="button" disabled={busy} onClick={() => void downloadSet()} className={primary}>
                <Download className="w-3.5 h-3.5" /> {busy ? 'Making…' : `Download set (${files} files, .zip)`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ---- My sounds ----

const MySounds: React.FC<{ keyOf: SongKey | null }> = ({ keyOf }) => {
  const { library, tune, exp } = useSfx();
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto">Sounds you kept, in this browser. Export them to back them up or share them; Import opens a file of them (or a set's sounds.json).</p>
        <button type="button" onClick={() => input.current?.click()} className={button}>
          <Upload className="w-3.5 h-3.5" /> Import
        </button>
        <button type="button" disabled={!library.length} onClick={() => download(recipesFile(library), 'my_sounds.json')} className={button}>
          <Download className="w-3.5 h-3.5" /> Export all
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const got = readRecipes(await f.text());
              if (!got.length) return setNotice(`${f.name} has no sounds in it.`);
              const ok = saveLibrary([...got, ...useSfx.getState().library]);
              setNotice(ok ? `Added ${got.length} sound${got.length === 1 ? '' : 's'} from ${f.name}.` : 'This browser is out of room to keep sounds.');
            } catch {
              setNotice(`${f.name} isn't a sounds file.`);
            }
          }}
        />
      </div>
      {notice && <p className="text-emerald-300">{notice}</p>}
      {library.length === 0 ? (
        <p className="p-3 rounded-md border border-dashed border-forge-border">Nothing kept yet: press Keep on a sound you like, or Keep all on a set.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5" aria-label="My sounds">
          {library.map((m, i) => (
            <li key={`${m.name}-${i}`} className="flex items-center gap-1.5 rounded-md border border-forge-border bg-forge-bg/60 px-2 py-1">
              <button type="button" onClick={() => hear(tuned(m.sound, keyOf, tune))} className="h-6 w-6 flex items-center justify-center rounded-full border border-cyan-400/50 text-cyan-100" aria-label={`Play ${m.name}`}>
                <Play className="w-3 h-3" />
              </button>
              <span className="flex-1 min-w-0 truncate text-forge-text">{m.name}</span>
              <button type="button" onClick={() => st({ current: m, layer: 0, mode: 'sound', ...(m.kind ? { group: groupOf(m.kind) } : {}) })} className="px-1.5 text-[10px] rounded border border-forge-border hover:text-forge-text">
                Edit
              </button>
              <button
                type="button"
                onClick={async () => {
                  const files = await filesOf(m, keyOf, tune, exp);
                  if (files.length === 1) download(files[0].data, files[0].name);
                  else download(await createZip(files), `${sfxFileName(m.name)}.zip`);
                }}
                className="p-1 hover:text-forge-text"
                aria-label={`Save ${m.name}`}
                title="Save it (with the export settings in Make a sound)"
              >
                <Download className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => saveLibrary(library.filter((_, k) => k !== i))} className="p-1 hover:text-rose-300" aria-label={`Delete ${m.name}`}>
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ---- The song's game sounds ----

const GameSounds: React.FC = () => {
  const list = useTimelineStore((t) => t.gameSfx);
  const t = useTimelineStore.getState();
  return (
    <div className="flex flex-col gap-3">
      <p>
        Sounds that go into this song's <b>game kit</b> (File › Game kit) next to the music: each saved with its variations, named for the game, and played with <code className="text-forge-text">playSfx("name")</code> in the web, Godot and Unity players (a different variation each time). They're saved with the song.
      </p>
      {list.length === 0 ? (
        <p className="p-3 rounded-md border border-dashed border-forge-border">None yet: press <b>Add to game</b> on a sound, or <b>Add all to game</b> on a set.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Game sounds">
          {list.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-md border border-forge-border bg-forge-bg/60 px-2 py-1">
              <button type="button" onClick={() => hear(g.sound)} className="h-6 w-6 flex items-center justify-center rounded-full border border-cyan-400/50 text-cyan-100" aria-label={`Play ${g.name}`}>
                <Play className="w-3 h-3" />
              </button>
              <input
                key={g.name}
                defaultValue={g.name}
                onBlur={(e) => e.target.value !== g.name && t.updateGameSfx(g.id, { name: e.target.value })}
                aria-label={`Name of ${g.name}`}
                className="h-6 w-56 bg-forge-bg border border-forge-border rounded px-1.5 font-mono text-forge-text focus:outline-none focus:border-cyan-500"
              />
              {g.sound.loop && <span className="text-[9px] font-mono">loop</span>}
              <label className="flex items-center gap-1 text-[10px] font-mono" title="How many versions the kit makes: the game plays a different one each time">
                Variations
                <select value={g.variations} onChange={(e) => t.updateGameSfx(g.id, { variations: Number(e.target.value) })} className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-forge-text">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {g.variations > 1 && (
                <button type="button" onClick={() => void hearVariations(g.sound, g.variations, g.spread)} className="px-1.5 text-[10px] rounded border border-forge-border hover:text-forge-text">
                  Hear variations
                </button>
              )}
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => st({ current: { name: g.name, sound: g.sound, gameId: g.id }, layer: 0, mode: 'sound' })} className="px-1.5 text-[10px] rounded border border-forge-border hover:text-forge-text" title="Shape it in Make a sound, then Update in game">
                  Edit
                </button>
                <button type="button" onClick={() => t.deleteGameSfx(g.id)} className="p-1 hover:text-rose-300" aria-label={`Remove ${g.name}`} title="Take it out of the game kit">
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const SfxMakerPanel: React.FC = () => {
  const mode = useSfx((s) => s.mode);
  const count = useSfx((s) => s.library.length);
  const inGame = useTimelineStore((s) => s.gameSfx.length);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const keyOf = useMemo(() => detectKey(clips, tracks), [clips, tracks]);
  // A loop left playing stops when the panel closes
  useEffect(() => () => stop(), []);
  const tab = (id: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === id}
      onClick={() => st({ mode: id })}
      className={`h-8 px-3 rounded-t-md border-b-2 text-[12px] font-semibold ${mode === id ? 'border-cyan-400 text-cyan-100' : 'border-transparent hover:text-forge-text'}`}
    >
      {label}
    </button>
  );
  return (
    <div role="region" aria-label="Sound effects maker">
      <div className="flex flex-col gap-3 p-3 text-xs text-forge-muted max-w-6xl">
        <div className="flex items-center gap-1 border-b border-forge-border" role="tablist" aria-label="Sound effects maker">
          {tab('sound', 'Make a sound')}
          {tab('set', 'Make a set')}
          {tab('mine', `My sounds${count ? ` (${count})` : ''}`)}
          {tab('game', `In this game${inGame ? ` (${inGame})` : ''}`)}
        </div>
        {mode === 'sound' && <SoundMaker keyOf={keyOf} />}
        {mode === 'set' && <SetMaker keyOf={keyOf} />}
        {mode === 'mine' && <MySounds keyOf={keyOf} />}
        {mode === 'game' && <GameSounds />}
      </div>
    </div>
  );
};
