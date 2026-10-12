import React, { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useTimelineStore } from '../../store/timelineStore';
import { keyOf, NOTE_NAMES } from '../../store/songKey';
import { CHORD_STYLES, DRUM_STYLES, PROGRESSIONS, chordName, progressionChords } from '../../store/smartTools';
import type { ChordStyle, DrumStyle } from '../../store/smartTools';
import { makeChordClip, makeDrumClip, songKey, useSmartDialog } from '../../store/smartActions';
import { showToast } from './toastStore';

const field = 'flex flex-col gap-1 text-[11px] text-forge-muted';
const control = 'bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text';
const primary = 'px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-semibold hover:bg-cyan-400';

/** Chord progression and Drummer: make a clip from a few choices, at the bar that was right-clicked. */
export const SmartDialog: React.FC = () => {
  const open = useSmartDialog((s) => s.open);
  if (!open) return null;
  const close = () => useSmartDialog.setState({ open: null });
  return open.mode === 'chords' ? <ChordsForm trackId={open.trackId} bar={open.bar} onClose={close} /> : <DrummerForm trackId={open.trackId} bar={open.bar} onClose={close} />;
};

/** The choices made last, kept while the app is open (set outside render) */
let lastChords = { progression: 'pop', chordBars: 1, repeats: 2, style: 'sustain' as ChordStyle, sevenths: false };
const rememberChords = (o: typeof lastChords) => {
  lastChords = o;
};

const ChordsForm: React.FC<{ trackId: string; bar: number; onClose: () => void }> = ({ trackId, bar, onClose }) => {
  const detected = useMemo(() => songKey(), []);
  const [root, setRoot] = useState(detected.root);
  const [mode, setMode] = useState(detected.mode);
  const [opts, setOpts] = useState(lastChords);
  const key = keyOf(root, mode);
  const fitting = PROGRESSIONS.filter((p) => p.mode === mode);
  const prog = PROGRESSIONS.find((p) => p.id === opts.progression && p.mode === mode) ?? fitting[0];
  const chords = progressionChords(key, prog, opts.sevenths);
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === trackId));
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));
  const make = () => {
    rememberChords({ ...opts, progression: prog.id });
    const all = Array.from({ length: opts.repeats }, () => chords).flat();
    const id = makeChordClip(trackId, bar, all, opts.chordBars, opts.style);
    if (id) showToast(`Chords in ${key.name}: ${chords.map(chordName).join(' – ')}`);
    onClose();
  };
  return (
    <Modal title={`Chord progression${track ? ` on ${track.name}` : ''}`} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>
            Key {root === detected.root && mode === detected.mode && <span className="text-cyan-300">(the song's)</span>}
            <div className="flex gap-1">
              <select className={control} value={root} onChange={(e) => setRoot(Number(e.target.value))} aria-label="Key root">
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>{n}</option>
                ))}
              </select>
              <select className={control} value={mode} onChange={(e) => setMode(e.target.value as 'major' | 'minor')} aria-label="Major or minor">
                <option value="major">major</option>
                <option value="minor">minor</option>
              </select>
            </div>
          </label>
          <label className={field}>
            Progression
            <select className={control} value={prog.id} onChange={(e) => set({ progression: e.target.value })}>
              {fitting.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className={field}>
            Each chord lasts
            <select className={control} value={opts.chordBars} onChange={(e) => set({ chordBars: Number(e.target.value) })}>
              <option value={0.5}>half a bar</option>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
          </label>
          <label className={field}>
            Times through
            <select className={control} value={opts.repeats} onChange={(e) => set({ repeats: Number(e.target.value) })}>
              {[1, 2, 4].map((n) => (
                <option key={n} value={n}>{n}× ({n * 4 * opts.chordBars} bars)</option>
              ))}
            </select>
          </label>
          <label className={field}>
            Played as
            <select className={control} value={opts.style} onChange={(e) => set({ style: e.target.value as ChordStyle })}>
              {CHORD_STYLES.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-forge-text mt-4">
            <input type="checkbox" className="accent-cyan-500" checked={opts.sevenths} onChange={(e) => set({ sevenths: e.target.checked })} />
            7th chords (jazzier)
          </label>
        </div>
        <p className="text-xs text-forge-text">
          {chords.map(chordName).join(' – ')} <span className="text-forge-muted">· voiced so each chord moves as little as it can from the last</span>
        </p>
        <div className="flex justify-end">
          <button type="button" className={primary} onClick={make}>
            Make clip at bar {bar}
          </button>
        </div>
      </div>
    </Modal>
  );
};

let lastDrums = { style: 'rock' as DrumStyle, bars: 8, intensity: 0.5, fillEvery: 4 };
let drumSeed = 1;
const rememberDrums = (o: typeof lastDrums) => {
  lastDrums = o;
  return drumSeed++;
};

const DrummerForm: React.FC<{ trackId: string; bar: number; onClose: () => void }> = ({ trackId, bar, onClose }) => {
  const [opts, setOpts] = useState(lastDrums);
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));
  const bpm = useTimelineStore((s) => s.bpm);
  const style = DRUM_STYLES.find((d) => d.id === opts.style)!;
  const make = () => {
    const seed = rememberDrums(opts);
    const id = makeDrumClip(trackId, bar, opts.style, opts.bars, opts.intensity, opts.fillEvery, seed);
    if (id) showToast(`Drummer: ${opts.bars} bars of ${style.name.split(' (')[0].toLowerCase()}. Make another for a different take`);
    onClose();
  };
  return (
    <Modal title="Drummer" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <label className={field}>
          Style
          <select className={control} value={opts.style} onChange={(e) => set({ style: e.target.value as DrumStyle })}>
            {DRUM_STYLES.map((d) => (
              <option key={d.id} value={d.id}>{d.name} · {d.bpm} BPM</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>
            Length
            <select className={control} value={opts.bars} onChange={(e) => set({ bars: Number(e.target.value) })}>
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>{n} bar{n === 1 ? '' : 's'}</option>
              ))}
            </select>
          </label>
          <label className={field}>
            A fill every
            <select className={control} value={opts.fillEvery} onChange={(e) => set({ fillEvery: Number(e.target.value) })}>
              <option value={0}>no fills</option>
              <option value={2}>2 bars</option>
              <option value={4}>4 bars</option>
              <option value={8}>8 bars</option>
            </select>
          </label>
        </div>
        <label className={field}>
          Energy: {opts.intensity < 0.34 ? 'sparse' : opts.intensity < 0.67 ? 'steady' : 'busy'}
          <input type="range" min={0} max={1} step={0.01} value={opts.intensity} onChange={(e) => set({ intensity: Number(e.target.value) })} className="accent-cyan-500" />
        </label>
        <p className="text-[11px] text-forge-muted">
          The song is at {bpm} BPM; this style usually sits at {style.bpm}. Each clip is a new take: the hats breathe and kicks move a little bar to bar.
        </p>
        <div className="flex justify-end">
          <button type="button" className={primary} onClick={make}>
            Make clip at bar {bar}
          </button>
        </div>
      </div>
    </Modal>
  );
};
