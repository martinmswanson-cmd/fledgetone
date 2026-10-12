import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import * as Tone from 'tone';
import { Dices, Download, Play, Plus, Shuffle } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { isAudioKind } from '../../audio/instrumentCatalog';
import { initAudio } from '../../audio/engine';
import { dropAudioFiles } from '../timeline/audioFiles';
import { detectKey, NOTE_NAMES } from '../../store/songKey';
import {
  generateSfx,
  mutateSfx,
  renderSfx,
  SFX_CATEGORIES,
  SFX_LABELS,
  SFX_WAVES,
  sfxLength,
  sfxWav,
  snapToScale,
  type SfxCategory,
  type SfxParams,
} from '../../audio/sfx/sfxSynth';

/**
 * The sound effects maker: jump, coin, laser, hit, power-up, explosion and blip sounds for games,
 * made with a click and shaped with sliders. Tune to key snaps the pitches to the song's key (worked
 * out from its notes), so a coin or a power-up sits in the music. Save as a WAV, or add it to the
 * song at the playhead. What you made stays while the page is open.
 */

const SAMPLE_RATE = 44100;

interface Made {
  name: string;
  params: SfxParams;
}

interface SfxState {
  current: Made;
  recent: Made[];
  counts: Partial<Record<SfxCategory, number>>;
  tune: boolean;
  make: (category: SfxCategory) => Made;
  set: (patch: Partial<SfxParams>) => void;
  setName: (name: string) => void;
  use: (made: Made) => void;
  setTune: (tune: boolean) => void;
}

const freshSeed = () => Math.floor(Math.random() * 2 ** 31);

const useSfx = create<SfxState>((set, get) => ({
  current: { name: 'Coin 1', params: generateSfx('coin', 7) },
  recent: [],
  counts: {},
  tune: true,
  make: (category) => {
    const n = (get().counts[category] ?? 0) + 1;
    const made = { name: `${SFX_LABELS[category]} ${n}`, params: generateSfx(category, freshSeed()) };
    set((s) => ({ current: made, counts: { ...s.counts, [category]: n }, recent: [made, ...s.recent.filter((r) => r.name !== made.name)].slice(0, 10) }));
    return made;
  },
  set: (patch) => set((s) => ({ current: { ...s.current, params: { ...s.current.params, ...patch } } })),
  setName: (name) => set((s) => ({ current: { ...s.current, name } })),
  use: (made) => set({ current: made }),
  setTune: (tune) => set({ tune }),
}));

/** The settings as played: with Tune to key, the pitch (and the jump) on notes of the key. */
function tuned(p: SfxParams, key: ReturnType<typeof detectKey>, tune: boolean): SfxParams {
  if (!tune || !key || p.wave === 'noise') return p;
  const freq = snapToScale(p.freq, key.root, key.steps);
  const arp = p.arp ? Math.round(12 * Math.log2(snapToScale(p.freq * 2 ** (p.arp / 12), key.root, key.steps) / freq)) : 0;
  return { ...p, freq, arp };
}

const noteName = (freq: number) => {
  const m = Math.round(69 + 12 * Math.log2(freq / 440));
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};

/** Play rendered samples once, now. */
async function audition(samples: Float32Array) {
  await initAudio();
  const ctx = Tone.getContext().rawContext as AudioContext;
  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
}

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
      const bar = Math.max(1, peak * h * 0.95);
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
}
const Row: React.FC<RowProps> = ({ label, value, min, max, step, show, onChange }) => (
  <label className="flex items-center gap-2 text-[10px] font-mono">
    <span className="w-16 shrink-0 uppercase text-forge-muted">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0 h-1.5 accent-cyan-400" aria-label={label} />
    <span className="w-16 text-right tabular-nums text-forge-text">{show(value)}</span>
  </label>
);

const ms = (s: number) => `${Math.round(s * 1000)} ms`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const st = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} st`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

export const SfxMakerPanel: React.FC = () => {
  const { current, recent, tune } = useSfx();
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const key = useMemo(() => detectKey(clips, tracks), [clips, tracks]);
  const played = tuned(current.params, key, tune);
  const samples = useMemo(() => renderSfx(played, SAMPLE_RATE), [played]);
  const [notice, setNotice] = useState('');
  const p = current.params;
  const set = useSfx.getState().set;
  // Releasing a slider plays the sound, so you hear what you changed
  const change = (patch: Partial<SfxParams>) => set(patch);
  const replay = () => void audition(renderSfx(tuned(useSfx.getState().current.params, key, useSfx.getState().tune), SAMPLE_RATE));

  const file = () => new File([sfxWav(samples, SAMPLE_RATE) as Uint8Array<ArrayBuffer>], `${current.name.trim() || 'Sound effect'}.wav`, { type: 'audio/wav' });

  const save = () => {
    const url = URL.createObjectURL(file());
    const a = document.createElement('a');
    a.href = url;
    a.download = file().name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const addToSong = async () => {
    const s = useTimelineStore.getState();
    const selected = s.tracks.find((t) => t.id === s.selectedTrackId);
    const target = selected && isAudioKind(selected.instrumentKey) ? selected.id : null;
    await dropAudioFiles(target, s.playheadPosition, [file()]);
    setNotice(`Added "${current.name}" at the playhead${target ? ` on ${selected!.name}` : ' on a new Audio track'}.`);
  };

  return (
    <div role="region" aria-label="Sound effects maker">
      <div className="flex flex-col gap-3 p-3 text-xs text-forge-muted" onPointerUp={(e) => (e.target as HTMLElement).matches('input[type=range]') && replay()} onKeyUp={(e) => (e.target as HTMLElement).matches('input[type=range]') && replay()}>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Make a new sound">
          {SFX_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                const made = useSfx.getState().make(c);
                void audition(renderSfx(tuned(made.params, key, useSfx.getState().tune), SAMPLE_RATE));
                setNotice('');
              }}
              className="h-8 px-3 rounded-md border border-forge-border bg-forge-bg text-forge-text font-semibold hover:border-cyan-400/60"
              title={`A new ${SFX_LABELS[c].toLowerCase()} sound (each click rolls a different one)`}
            >
              {SFX_LABELS[c]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              set(mutateSfx(useSfx.getState().current.params, freshSeed()));
              replay();
            }}
            className="h-8 px-3 flex items-center gap-1 rounded-md border border-forge-border hover:text-forge-text"
            title="Like this one, a little different"
          >
            <Shuffle className="w-3.5 h-3.5" /> Mutate
          </button>
          <button
            type="button"
            onClick={() => {
              const made = useSfx.getState().make(SFX_CATEGORIES[Math.floor(Math.random() * SFX_CATEGORIES.length)]);
              void audition(renderSfx(tuned(made.params, key, useSfx.getState().tune), SAMPLE_RATE));
            }}
            className="h-8 px-3 flex items-center gap-1 rounded-md border border-forge-border hover:text-forge-text"
            title="Any kind of sound"
          >
            <Dices className="w-3.5 h-3.5" /> Random
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={replay} className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25" aria-label="Play the sound" title="Play">
            <Play className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <Wave samples={samples} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={current.name} onChange={(e) => useSfx.getState().setName(e.target.value)} aria-label="Sound name" className="h-7 w-40 bg-forge-bg border border-forge-border rounded-md px-2 text-forge-text focus:outline-none focus:border-cyan-500" />
          <span className="font-mono">{ms(sfxLength(p))}</span>
          <label className={`flex items-center gap-1.5 ${key ? '' : 'opacity-50'}`} title={key ? `Pitches snap to notes of ${key.name}, the key the song's notes are in` : 'Write some notes first: the key comes from them'}>
            <input type="checkbox" checked={tune && !!key} disabled={!key} onChange={(e) => useSfx.getState().setTune(e.target.checked)} />
            Tune to key{key ? ` (${key.name})` : ''}
          </label>
          {p.wave !== 'noise' && <span className="font-mono text-forge-text">{noteName(played.freq)}</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-x-8 gap-y-1.5 max-w-5xl">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1" role="group" aria-label="Wave">
              <span className="w-16 shrink-0 text-[10px] font-mono uppercase">Wave</span>
              {SFX_WAVES.map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={p.wave === w}
                  onClick={() => {
                    change({ wave: w });
                    replay();
                  }}
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${p.wave === w ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200' : 'border-forge-border hover:text-forge-text'}`}
                >
                  {w}
                </button>
              ))}
            </div>
            <Row label="Pitch" value={Math.log2(p.freq)} min={Math.log2(30)} max={Math.log2(4000)} step={0.01} show={(v) => hz(2 ** v)} onChange={(v) => change({ freq: 2 ** v })} />
            <Row label="Slide" value={p.slide} min={-48} max={48} step={1} show={st} onChange={(slide) => change({ slide })} />
            <Row label="Curve" value={p.curve} min={0} max={1} step={0.01} show={pct} onChange={(curve) => change({ curve })} />
            <Row label="Jump" value={p.arp} min={-12} max={24} step={1} show={(v) => (v ? st(v) : 'off')} onChange={(arp) => change({ arp })} />
            <Row label="Jump at" value={p.arpAt} min={0} max={1} step={0.01} show={pct} onChange={(arpAt) => change({ arpAt })} />
            <Row label="Vibrato" value={p.vibDepth} min={0} max={2} step={0.05} show={(v) => (v ? `${v.toFixed(2)} st` : 'off')} onChange={(vibDepth) => change({ vibDepth })} />
            <Row label="Vib rate" value={p.vibRate} min={1} max={30} step={0.5} show={(v) => `${v} Hz`} onChange={(vibRate) => change({ vibRate })} />
            <Row label="Repeat" value={p.repeat} min={0} max={20} step={0.5} show={(v) => (v ? `${v}/s` : 'off')} onChange={(repeat) => change({ repeat })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Row label="Attack" value={p.attack} min={0} max={0.3} step={0.005} show={ms} onChange={(attack) => change({ attack })} />
            <Row label="Hold" value={p.hold} min={0} max={1} step={0.005} show={ms} onChange={(hold) => change({ hold })} />
            <Row label="Punch" value={p.punch} min={0} max={1} step={0.01} show={pct} onChange={(punch) => change({ punch })} />
            <Row label="Decay" value={p.decay} min={0.01} max={2} step={0.01} show={ms} onChange={(decay) => change({ decay })} />
            <Row label="Width" value={p.duty} min={0.05} max={0.5} step={0.01} show={pct} onChange={(duty) => change({ duty })} />
            <Row label="Low-pass" value={Math.log2(p.lowpass)} min={Math.log2(200)} max={Math.log2(20000)} step={0.01} show={(v) => (2 ** v >= 19999 ? 'open' : hz(2 ** v))} onChange={(v) => change({ lowpass: 2 ** v })} />
            <Row label="LP sweep" value={p.lpSweep} min={-4} max={4} step={0.1} show={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`} onChange={(lpSweep) => change({ lpSweep })} />
            <Row label="High-pass" value={Math.log2(p.highpass)} min={Math.log2(20)} max={Math.log2(4000)} step={0.01} show={(v) => (2 ** v <= 21 ? 'off' : hz(2 ** v))} onChange={(v) => change({ highpass: 2 ** v })} />
            <Row label="Crush" value={p.crush} min={0} max={1} step={0.01} show={(v) => (v ? `${Math.round(16 - v * 14)}-bit` : 'off')} onChange={(crush) => change({ crush })} />
            <Row label="Volume" value={p.volume} min={0.1} max={1} step={0.01} show={pct} onChange={(volume) => change({ volume })} />
          </div>
        </div>

        {recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Recent sounds">
            <span className="text-[10px] font-mono uppercase mr-1">Recent</span>
            {recent.map((r) => (
              <button
                key={r.name}
                type="button"
                onClick={() => {
                  useSfx.getState().use(r);
                  void audition(renderSfx(tuned(r.params, key, useSfx.getState().tune), SAMPLE_RATE));
                }}
                className={`px-1.5 py-0.5 rounded border text-[10px] ${r.name === current.name ? 'border-cyan-400/60 text-cyan-200' : 'border-forge-border hover:text-forge-text'}`}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {notice && <span className="mr-auto text-emerald-300">{notice}</span>}
          <button type="button" onClick={save} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border hover:text-forge-text">
            <Download className="w-3.5 h-3.5" /> Save WAV
          </button>
          <button type="button" onClick={() => void addToSong()} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25" title="Put it on an Audio track at the playhead (the selected one, if it's an Audio track)">
            <Plus className="w-3.5 h-3.5" /> Add to song
          </button>
        </div>
      </div>
    </div>
  );
};
