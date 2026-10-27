/**
 * The Chord progression and Drummer dialogs: make a clip from a few choices at the right-clicked
 * bar (smartTools.ts writes the notes).
 */
import { GROOVE_FEELS } from '../../store/grooveFeels';
import React, { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useTimelineStore } from '../../store/timelineStore';
import { keyOf, NOTE_NAMES } from '../../store/songKey';
import { ACCOMP_STYLES, CHORD_STYLES, DRUM_STYLES, PROGRESSIONS, chordName, progressionChords } from '../../store/smartTools';
import type { AccompStyle, ChordStyle, DrumStyle } from '../../store/smartTools';
import type { InstrumentKey } from '../../store/timelineTypes';
import { INSTRUMENTS } from '../../audio/instrumentCatalog';
import { accompanyChords, drumMeterAt, makeChordClip, makeDrumClip, makeMathClip, songKey, useSmartDialog, varyMelody } from '../../store/smartActions';
import { MATH_PATTERNS, type MathPatternId } from '../../store/mathPatterns';
import { MELODY_VARIATIONS, type MelodyVariation, type VariationPlace } from '../../store/melodyVariations';
import { meterAt } from '../../audio/tempoMap';
import { showToast } from './toastStore';

const field = 'flex flex-col gap-1 text-[11px] text-forge-muted';
const control = 'bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text';
const primary = 'px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-semibold hover:bg-cyan-400';

/** Chord progression and Drummer: make a clip from a few choices, at the bar that was right-clicked. */
export const SmartDialog: React.FC = () => {
  const open = useSmartDialog((s) => s.open);
  if (!open) return null;
  const close = () => useSmartDialog.setState({ open: null });
  if (open.mode === 'accompany' && open.clipId) return <AccompanyForm clipId={open.clipId} onClose={close} />;
  if (open.mode === 'melody' && open.clipId) return <MelodyForm clipId={open.clipId} onClose={close} />;
  if (open.mode === 'math') return <MathForm trackId={open.trackId} bar={open.bar} onClose={close} />;
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

let lastDrums = { style: 'rock' as DrumStyle, bars: 8, intensity: 0.5, fillEvery: 4, setMeter: true, feel: '' };
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
  const baseMeter = useTimelineStore((s) => s.meter);
  const meterPoints = useTimelineStore((s) => s.meterPoints);
  const songMeter = meterAt(bar, { base: baseMeter, points: meterPoints });
  const meter = drumMeterAt(opts.style, bar);
  const meterDiffers = meter.num !== songMeter.num || meter.den !== songMeter.den;
  const make = () => {
    const seed = rememberDrums(opts);
    const id = makeDrumClip(trackId, bar, opts.style, opts.bars, opts.intensity, opts.fillEvery, seed, opts.setMeter, opts.feel);
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
                <option key={n} value={n}>{n} {meter.num === 4 && meter.den === 4 ? 'bar' : `measure${n === 1 ? '' : 's'} of ${meter.num}/${meter.den}`}{meter.num === 4 && meter.den === 4 && n !== 1 ? 's' : ''}</option>
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
        {meterDiffers && (
          <label className="flex items-center gap-2 text-xs text-forge-text">
            <input type="checkbox" className="accent-cyan-500" checked={opts.setMeter} onChange={(e) => set({ setMeter: e.target.checked })} />
            This style is in {meter.num}/{meter.den}; the song is in {songMeter.num}/{songMeter.den} here. Change the song to {meter.num}/{meter.den} for the clip (and back after it)
          </label>
        )}
        <label className={field} title="A feel measured from real music: each drum a hair early or late on each 16th, with its accents (change it with GROOVE in the piano roll)">
          Groove feel
          <select className={control} value={opts.feel} onChange={(e) => set({ feel: e.target.value })}>
            <option value="">The style's own</option>
            {GROOVE_FEELS.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        {style.groove && !opts.feel && <p className="text-[11px] text-cyan-300">Swung 8ths: the clip gets a shuffle feel (change it with FEEL in the piano roll).</p>}
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

/** Instruments an accompaniment can go on besides its own suggestion. */
const ACCOMP_INSTRUMENTS: InstrumentKey[] = ['realGrandPiano', 'realUprightPiano', 'rhodes', 'realHarp', 'guitar', 'nylonGuitar', 'mandolin', 'realViolinsShort', 'realPizzicato', 'slowStrings', 'realCelesta', 'realGlockenspiel', 'musicBox', 'realMarimba', 'vibraphone', 'realHorn', 'realTrumpet', 'accordion', 'realUprightBass', 'realElectricBass', 'chipLead', 'pluck'];

let lastAccomp: { style: AccompStyle; instrument: InstrumentKey | null } = { style: 'waltz', instrument: null };
let accompSeed = 1;

/** Accompaniment: a pattern from a chord clip's chords, on a new track under it. */
const AccompanyForm: React.FC<{ clipId: string; onClose: () => void }> = ({ clipId, onClose }) => {
  const [style, setStyle] = useState<AccompStyle>(lastAccomp.style);
  const [instrument, setInstrument] = useState<InstrumentKey | null>(lastAccomp.instrument);
  const def = ACCOMP_STYLES.find((a) => a.id === style)!;
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const make = () => {
    lastAccomp = { style, instrument };
    const id = accompanyChords(clipId, style, instrument ?? undefined, accompSeed++);
    if (id) showToast(`${def.name} on a new track under "${clip?.name ?? 'the chords'}"`);
    else showToast('This clip has no chords to accompany.');
    onClose();
  };
  const options = [def.instrument, ...ACCOMP_INSTRUMENTS.filter((k) => k !== def.instrument)];
  return (
    <Modal title="Accompaniment for these chords" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 w-[30rem] max-w-full">
        <div className="grid grid-cols-1 gap-1" role="radiogroup" aria-label="Pattern">
          {ACCOMP_STYLES.map((a) => (
            <label key={a.id} className={`flex items-start gap-2 rounded px-2 py-1 cursor-pointer ${a.id === style ? 'bg-cyan-500/15' : 'hover:bg-white/5'}`}>
              <input type="radio" name="accomp" className="mt-1 accent-cyan-500" checked={a.id === style} onChange={() => {
                setStyle(a.id);
                setInstrument(null);
              }} />
              <span className="text-xs text-forge-text">
                {a.name}
                <span className="block text-[11px] text-forge-muted">{a.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <label className={field}>
          On
          <select className={control} value={instrument ?? def.instrument} onChange={(e) => setInstrument(e.target.value === def.instrument ? null : (e.target.value as InstrumentKey))}>
            {options.map((k, i) => (
              <option key={k} value={k}>{INSTRUMENTS[k].name}{i === 0 ? ' (suggested)' : ''}</option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-forge-muted">Follows each chord change in the clip and the song's time signature. Make another for a different take of the ones with a little chance in them.</p>
        <div className="flex justify-end">
          <button type="button" className={primary} onClick={make}>
            Make the track
          </button>
        </div>
      </div>
    </Modal>
  );
};

let lastMelody: { kind: MelodyVariation; place: VariationPlace | null } = { kind: 'answer', place: null };
let melodySeed = 1;

const PLACES: ReadonlyArray<{ id: VariationPlace; label: string }> = [
  { id: 'after', label: 'after it, on its track' },
  { id: 'track', label: 'on a new track under it (to play together)' },
  { id: 'replace', label: 'in place of it' },
];

/** Melody variations: an answer, the tune darker or brighter, simpler, busier... in the song's key. */
const MelodyForm: React.FC<{ clipId: string; onClose: () => void }> = ({ clipId, onClose }) => {
  const [kind, setKind] = useState<MelodyVariation>(lastMelody.kind);
  const [place, setPlace] = useState<VariationPlace | null>(lastMelody.place);
  const detected = useMemo(() => songKey(), []);
  const [root, setRoot] = useState(detected.root);
  const [mode, setMode] = useState(detected.mode);
  const key = keyOf(root, mode);
  const def = MELODY_VARIATIONS.find((v) => v.id === kind)!;
  const where = place ?? def.place;
  const make = () => {
    lastMelody = { kind, place };
    const said = varyMelody(clipId, kind, where, melodySeed++, key);
    showToast(said ?? 'This clip has no notes to vary.');
    onClose();
  };
  return (
    <Modal title="Melody variations" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 w-[30rem] max-w-full">
        <div className="flex items-end gap-2">
          <label className={field}>
            Key
            <select className={control} value={root} onChange={(e) => setRoot(Number(e.target.value))} aria-label="Key root">
              {NOTE_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className="sr-only">Mode</span>
            <select className={control} value={mode} onChange={(e) => setMode(e.target.value as 'major' | 'minor')} aria-label="Major or minor">
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
          </label>
          <p className="flex-1 text-[11px] text-forge-muted">The song's key, from its notes ({detected.name}). Every note moves by the scale's own steps, so the result stays in key; a major key and its relative minor share their notes, so pick the one the tune feels like.</p>
        </div>
        <div className="grid grid-cols-1 gap-1" role="radiogroup" aria-label="Variation">
          {MELODY_VARIATIONS.map((v) => (
            <label key={v.id} className={`flex items-start gap-2 rounded px-2 py-1 cursor-pointer ${v.id === kind ? 'bg-cyan-500/15' : 'hover:bg-white/5'}`}>
              <input type="radio" name="melody-variation" className="mt-1 accent-cyan-500" checked={v.id === kind} onChange={() => {
                setKind(v.id);
                setPlace(null);
              }} />
              <span className="text-xs text-forge-text">
                {v.name}
                <span className="block text-[11px] text-forge-muted">{v.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <label className={field}>
          Put it
          <select className={control} value={where} onChange={(e) => setPlace(e.target.value as VariationPlace)} aria-label="Where the variation goes">
            {PLACES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end">
          <button type="button" className={primary} onClick={make}>
            Make it
          </button>
        </div>
      </div>
    </Modal>
  );
};

let lastMath = { pattern: 'pendulum' as MathPatternId, bars: 8 };

/** Math patterns: a clip a formula writes, in the song's key. */
const MathForm: React.FC<{ trackId: string; bar: number; onClose: () => void }> = ({ trackId, bar, onClose }) => {
  const detected = useMemo(() => songKey(), []);
  const [root, setRoot] = useState(detected.root);
  const [mode, setMode] = useState(detected.mode);
  const [opts, setOpts] = useState(lastMath);
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === trackId));
  const chosen = MATH_PATTERNS.find((m) => m.id === opts.pattern) ?? MATH_PATTERNS[0];
  const make = () => {
    lastMath = opts;
    const key = keyOf(root, mode);
    if (makeMathClip(trackId, bar, opts.pattern, key, opts.bars)) showToast(`${chosen.name} in ${key.name}`);
    onClose();
  };
  return (
    <Modal title={`Math patterns${track ? ` on ${track.name}` : ''}`} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>
            Pattern
            <select className={control} value={opts.pattern} onChange={(e) => setOpts((o) => ({ ...o, pattern: e.target.value as MathPatternId }))}>
              {MATH_PATTERNS.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
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
            Length
            <select className={control} value={opts.bars} onChange={(e) => setOpts((o) => ({ ...o, bars: Number(e.target.value) }))}>
              {[4, 8, 16].map((n) => (
                <option key={n} value={n}>{n} bars</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-forge-text">{chosen.detail}</p>
        <div className="flex justify-end">
          <button type="button" className={primary} onClick={make}>
            Make clip at bar {bar}
          </button>
        </div>
      </div>
    </Modal>
  );
};
