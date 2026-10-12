import React, { useRef, useState } from 'react';
import * as Tone from 'tone';
import { Download, Loader2, ListPlus, Play } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore } from '../../store/timelineStore';
import { DEFAULT_BOUNDS, variationTakes, type VariationBounds } from '../../store/microVariations';
import { renderVariations } from '../../audio/microVariations';
import { downloadBlob, encodeChannels } from '../../audio/exportWav';
import { createZip } from '../../audio/zip';
import { importSoundFile } from '../../audio/soundLibrary';
import { initAudio } from '../../audio/engine';
import { showToast } from './toastStore';

/**
 * Generate variations: from one short clip, 4 to 8 takes for a game to pick from at random
 * (footsteps, swings, clicks), each a little different in pitch, brightness, length and level.
 * Save them as a .zip of WAVs, or lay them out on a new Audio track after the clip.
 */

const SLIDERS: ReadonlyArray<{ key: keyof VariationBounds; label: string; max: number; unit: string }> = [
  { key: 'pitch', label: 'Pitch', max: 20, unit: '%' },
  { key: 'cutoff', label: 'Brightness', max: 50, unit: '%' },
  { key: 'release', label: 'Length', max: 200, unit: ' ms' },
  { key: 'velocity', label: 'Level', max: 40, unit: '%' },
];

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sound';

export const VariationsDialog: React.FC<{ clipId: string; onClose: () => void }> = ({ clipId, onClose }) => {
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === clip?.trackId));
  const [count, setCount] = useState(8);
  const [bounds, setBounds] = useState<VariationBounds>(DEFAULT_BOUNDS);
  const [keepSends, setKeepSends] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [busy, setBusy] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{ key: string; takes: Float32Array[][]; sampleRate: number } | null>(null);
  const seconds = useTimelineStore((s) => (clip ? (clip.lengthBars * 240) / s.bpm : 0));
  const playing = useRef<AudioBufferSourceNode | null>(null);
  if (!clip || !track) return null;
  const key = JSON.stringify([count, bounds, keepSends, seed]);
  const base = safe(clip.name || track.name);

  const render = async () => {
    if (rendered?.key === key) return rendered;
    const s = useTimelineStore.getState();
    setBusy(0);
    try {
      const r = await renderVariations(
        clip,
        track,
        { bpm: s.bpm, masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback }, master: s.master },
        variationTakes(count, bounds, seed),
        keepSends,
        setBusy
      );
      const result = { key, ...r };
      setRendered(result);
      return result;
    } catch (err) {
      showToast(`Couldn't render the variations: ${err instanceof Error ? err.message : String(err)}.`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const files = (r: { takes: Float32Array[][]; sampleRate: number }) =>
    r.takes.map((t, i) => new File([encodeChannels(t, r.sampleRate, 16)], `${base}_${String(i + 1).padStart(2, '0')}.wav`, { type: 'audio/wav' }));

  const play = async (i: number) => {
    const r = await render();
    if (!r) return;
    await initAudio();
    const ctx = Tone.getContext().rawContext as AudioContext;
    playing.current?.stop();
    const buf = ctx.createBuffer(r.takes[i].length, r.takes[i][0].length, r.sampleRate);
    r.takes[i].forEach((ch, k) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, k));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    playing.current = src;
  };

  const save = async () => {
    const r = await render();
    if (!r) return;
    downloadBlob(await createZip(files(r).map((f) => ({ name: f.name, data: f }))), `${base} variations.zip`);
  };

  const layOut = async () => {
    const r = await render();
    if (!r) return;
    const sounds = [];
    for (const f of files(r)) sounds.push(await importSoundFile(f, f.name));
    const st = useTimelineStore.getState();
    const message = st.addAudioClips(null, clip.startBar + clip.lengthBars, sounds);
    showToast(message ?? `${sounds.length} variations are on a new Audio track after the clip.`);
    onClose();
  };

  return (
    <Modal title="Generate variations" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 text-xs text-forge-muted">
        <p>
          Takes of <span className="text-forge-text">{clip.name || track.name}</span> ({seconds.toFixed(2)} s) for a game to pick from at random, so a sound that plays
          again and again (a footstep, a swing, a click) never sounds the same twice. Each take differs within these bounds; the first is the clip as it is.
          {seconds > 2.5 && <span className="text-amber-300"> It works best on a short clip (a beat or two).</span>}
        </p>
        <label className="flex items-center gap-2">
          <span className="w-20 font-mono text-[10px] uppercase">Takes</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text" aria-label="How many takes">
            {[4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))} className="ml-auto h-7 px-2 rounded-md border border-forge-border hover:text-forge-text" title="Draw new takes within the same bounds">
            Reroll
          </button>
        </label>
        {SLIDERS.map((sl) => (
          <label key={sl.key} className="flex items-center gap-2 font-mono text-[10px]">
            <span className="w-20 uppercase">{sl.label}</span>
            <input type="range" min={0} max={sl.max} step={1} value={bounds[sl.key]} onChange={(e) => setBounds({ ...bounds, [sl.key]: Number(e.target.value) })} className="flex-1 accent-cyan-400" aria-label={`${sl.label} variation`} />
            <span className="w-16 text-right text-forge-text">±{bounds[sl.key]}{sl.unit}</span>
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={keepSends} onChange={(e) => setKeepSends(e.target.checked)} />
          Keep the reverb and echo (off: dry, as game sounds usually are)
        </label>
        <div className="flex flex-wrap gap-1" aria-label="Hear a take">
          {Array.from({ length: count }, (_, i) => (
            <button key={i} type="button" disabled={busy !== null} onClick={() => void play(i)} className="h-7 px-2 flex items-center gap-1 rounded border border-forge-border hover:text-forge-text disabled:opacity-50" title={`Hear take ${i + 1}`}>
              <Play className="w-3 h-3" /> {String(i + 1).padStart(2, '0')}
            </button>
          ))}
        </div>
        {busy !== null && (
          <div className="flex items-center gap-2 text-forge-text">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400" /> Rendering… {Math.round(busy * 100)}%
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void save()} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border hover:text-forge-text disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> Save .zip
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void layOut()} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25 disabled:opacity-50">
            <ListPlus className="w-3.5 h-3.5" /> Lay out on the timeline
          </button>
        </div>
      </div>
    </Modal>
  );
};
