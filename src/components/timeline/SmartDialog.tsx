/**
 * The Chord progression, Chills progression and Drummer dialogs: make a clip from a few choices at
 * the right-clicked bar (smartTools.ts and chills.ts write the notes); and Build into a peak.
 */
import { GROOVE_FEELS } from '../../store/grooveFeels';
import React, { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useSongMeter, useTimelineStore } from '../../store/timelineStore';
import { keyOf, NOTE_NAMES } from '../../store/songKey';
import { ACCOMP_STYLES, CHORD_STYLES, DRUM_STYLES, PROGRESSIONS, chordName, progressionChords } from '../../store/smartTools';
import type { AccompStyle, ChordStyle, DrumStyle } from '../../store/smartTools';
import { formatBarPosition, formatBarRange, type InstrumentKey } from '../../store/timelineTypes';
import { INSTRUMENTS } from '../../audio/instrumentCatalog';
import { accompanyChords, drumMeterAt, makeChordClip, makeDrumClip, makeMathClip, songKey, useSmartDialog, varyMelody } from '../../store/smartActions';
import { MATH_PATTERNS, type MathPatternId } from '../../store/mathPatterns';
import { MELODY_VARIATIONS, type MelodyVariation, type VariationPlace } from '../../store/melodyVariations';
import { meterAt } from '../../audio/tempoMap';
import { showToast } from './toastStore';
import { CHILLS, CHILLS_VOICINGS, chillsById, chillsKeyName, chillsNames, playsOnce, registerOf, voicingOf, type ChillsVoicingStyle } from '../../store/chills';
import { BUILD_DEFAULTS, buildChosen, buildForChills, buildTracks, makeChillsClip, PAD_UNDER_LU, RISER_UNDER_DB, type BuildChoices } from '../../store/chillsActions';
import { BUILD_DEPTHS } from '../../store/chillsBuild';

const field = 'flex flex-col gap-1 text-[11px] text-forge-muted';
const control = 'bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text';
const primary = 'px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-semibold hover:bg-cyan-400';

/** A position as the ruler numbers it (measure.beat, not in 4/4). */
const BarAt: React.FC<{ bar: number }> = ({ bar }) => <>{formatBarPosition(bar, useSongMeter())}</>;

/** Chord progression and Drummer: make a clip from a few choices, at the bar that was right-clicked. */
export const SmartDialog: React.FC = () => {
  const open = useSmartDialog((s) => s.open);
  if (!open) return null;
  const close = () => useSmartDialog.setState({ open: null });
  if (open.mode === 'accompany' && open.clipId) return <AccompanyForm clipId={open.clipId} onClose={close} />;
  if (open.mode === 'melody' && open.clipId) return <MelodyForm clipId={open.clipId} onClose={close} />;
  if (open.mode === 'math') return <MathForm trackId={open.trackId} bar={open.bar} onClose={close} />;
  if (open.mode === 'chills') return <ChillsForm trackId={open.trackId} bar={open.bar} onClose={close} />;
  if (open.mode === 'build' && open.range) return <BuildForm range={open.range} trackIds={open.trackIds} onClose={close} />;
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
            Make clip at bar <BarAt bar={bar} />
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
            Make clip at bar <BarAt bar={bar} />
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
    // (false: past the caps, already said)
    else if (id !== false) showToast('This clip has no chords to accompany.');
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
            Make clip at bar <BarAt bar={bar} />
          </button>
        </div>
      </div>
    </Modal>
  );
};

let lastChills = { progression: CHILLS[0].id as string, chordBars: 1, repeats: 1, voicing: null as ChillsVoicingStyle | null };
const rememberChills = (o: typeof lastChills) => {
  lastChills = o;
};

/** Chills progressions: a clip of one, in the song's key (or one picked), at the bar right-clicked. */
const ChillsForm: React.FC<{ trackId: string; bar: number; onClose: () => void }> = ({ trackId, bar, onClose }) => {
  const detected = useMemo(() => songKey(), []);
  const [root, setRoot] = useState(detected.root);
  const [mode, setMode] = useState(detected.mode);
  const [opts, setOpts] = useState(lastChills);
  const key = keyOf(root, mode);
  const prog = chillsById(opts.progression) ?? CHILLS[0];
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === trackId));
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));
  const once = playsOnce(prog);
  const count = (once ? 1 : opts.repeats) * (mode === 'minor' ? prog.minor : prog.major).length;
  // Plain or rich: the progression's own until another is picked (picking another progression goes back to its own)
  const voicing = voicingOf(prog, opts.voicing);
  const range = track ? INSTRUMENTS[track.instrumentKey]?.range : undefined;
  const names = chillsNames(key, prog, voicing, range).join(' – ');
  const make = () => {
    rememberChills({ ...opts, progression: prog.id });
    if (makeChillsClip(trackId, bar, prog.id, key, opts.chordBars, opts.repeats, voicing)) showToast(`${prog.name} in ${chillsKeyName(key)}: ${names}. Undo takes it out.`);
    onClose();
  };
  return (
    <Modal title={`Chills progression${track ? ` on ${track.name}` : ''}`} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 w-[32rem] max-w-full">
        <p className="text-[11px] text-forge-muted">
          Chord moves that give listeners chills at an emotional peak.{' '}
          {track && registerOf(INSTRUMENTS[track.instrumentKey]?.range).kind === 'roots' ? 'On this bass instrument it plays each chord’s root (or the held home note), inside its range.' : 'Held chords, voiced for synths and pads: one low note, the chord in the middle.'}
        </p>
        <div className="grid grid-cols-1 gap-1" role="radiogroup" aria-label="Progression">
          {CHILLS.map((p) => (
            <label key={p.id} className={`flex items-start gap-2 rounded px-2 py-1 cursor-pointer ${p.id === prog.id ? 'bg-cyan-500/15' : 'hover:bg-white/5'}`}>
              <input type="radio" name="chills" className="mt-1 accent-cyan-500" checked={p.id === prog.id} onChange={() => set({ progression: p.id, voicing: null })} />
              <span className="text-xs text-forge-text">
                {p.name}
                <span className="block text-[11px] text-forge-muted">{p.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <label className={field}>
          Chords
          <select className={control} value={voicing} onChange={(e) => set({ voicing: e.target.value as ChillsVoicingStyle })} aria-label="Plain or rich chords" title={CHILLS_VOICINGS.find((v) => v.id === voicing)?.detail}>
            {CHILLS_VOICINGS.map((v) => (
              <option key={v.id} value={v.id} title={v.detail}>{v.name}{v.id === (prog.voicing ?? 'plain') ? ' (as written)' : ''}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
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
            Each chord lasts
            <select className={control} value={opts.chordBars} onChange={(e) => set({ chordBars: Number(e.target.value) })}>
              <option value={0.5}>half a bar</option>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
          </label>
          <label className={field}>
            Times through
            <select className={control} value={once ? 1 : opts.repeats} disabled={once} onChange={(e) => set({ repeats: Number(e.target.value) })} title={prog.lift ? 'Once: played again it would drop back down' : once ? 'Once: its last chord is where it arrives' : undefined}>
              {[1, 2].map((n) => (
                <option key={n} value={n}>{n}×</option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-forge-text">
          {names} <span className="text-forge-muted">· {count} chords, {count * opts.chordBars} bar{count * opts.chordBars === 1 ? '' : 's'}</span>
        </p>
        <div className="flex justify-end">
          <button type="button" className={primary} onClick={make}>
            Make clip at bar <BarAt bar={bar} />
          </button>
        </div>
      </div>
    </Modal>
  );
};

let lastBuild: Omit<BuildChoices, 'from' | 'peak' | 'trackIds'> = { ...BUILD_DEFAULTS };
const rememberBuild = (o: typeof lastBuild) => {
  lastBuild = o;
};

/** The build into a peak, over a block of bars: a swell (or none, from the music's level), a riser, a moment of near-silence and a pad at the peak. */
const BuildForm: React.FC<{ range: { from: number; to: number }; trackIds?: string[]; onClose: () => void }> = ({ range, trackIds, onClose }) => {
  const [opts, setOpts] = useState(lastBuild);
  const [picked, setPicked] = useState(!!trackIds?.length);
  const meter = useSongMeter();
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));
  const tracks = buildTracks(range.from, range.to, picked ? trackIds : undefined);
  const make = () => {
    rememberBuild(opts);
    showToast('Measuring the music for the build…');
    void buildForChills({ ...opts, from: range.from, peak: range.to, ...(picked && trackIds?.length ? { trackIds } : {}) }).then(showToast);
    onClose();
  };
  const dip = opts.start === 'dip';
  const way = (start: BuildChoices['start'], label: string, detail: string) => (
    <label className="flex items-start gap-2 text-xs text-forge-text">
      <input type="radio" name="build-start" className="mt-0.5 accent-cyan-500" checked={opts.start === start} onChange={() => set({ start })} />
      <span>
        {label}
        <span className="block text-[11px] text-forge-muted">{detail}</span>
      </span>
    </label>
  );
  const box = (k: 'volume' | 'filter' | 'riser' | 'gap' | 'layer', label: string, detail: string, disabled = false) => (
    <label className={`flex items-start gap-2 text-xs text-forge-text ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" className="mt-0.5 accent-cyan-500" checked={opts[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked })} />
      <span>
        {label}
        <span className="block text-[11px] text-forge-muted">{detail}</span>
      </span>
    </label>
  );
  return (
    <Modal title="Build into a peak" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4 w-[32rem] max-w-full">
        <p className="text-[11px] text-forge-muted">
          Over {formatBarRange(range.from, range.to, meter)}, into bar {formatBarPosition(range.to, meter)}. No track already there is turned up past its level. A riser and a pad are set under the music by measuring it first, and the build is measured again afterwards: you're told what the peak comes out at, with a caution if anything is much louder.
        </p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="How the build starts">
          {way('dip', 'Dip, then swell', 'The tracks start a little quieter and darker and grow back to where they were by the peak (the swell and the filter below).')}
          {way('level', 'Start from the music’s level', 'Nothing gets quieter or darker first: the tracks keep their level all through the build, and the lift into the peak comes from the riser, the breath and the pad.')}
        </div>
        {box('volume', 'Swell', 'Each track’s volume rises over the build, written as a volume lane you can see and change.', !dip)}
        <label className={`${field} ml-6`}>
          Starts this far under its level
          <select className={control} value={opts.depthDb} disabled={!opts.volume || !dip} onChange={(e) => set({ depthDb: Number(e.target.value) })}>
            {BUILD_DEPTHS.map((d) => (
              <option key={d} value={d}>{d} dB{d === BUILD_DEPTHS[BUILD_DEPTHS.length - 1] ? ' (the most)' : ''}</option>
            ))}
          </select>
        </label>
        {box('filter', 'Filter opens', 'A low-pass filter on the pitched tracks opens over the build, as a filter lane (not a Filter with a resonant peak: it would sing through the sweep).', !dip)}
        {box('riser', 'Riser', `A riser on a new track up to the peak, its loudest moment ${RISER_UNDER_DB} dB under the music there (measured).`)}
        {box('gap', 'A breath before the peak', 'Half a beat of near-silence just before it, then back to the level the build reached (a volume lane).')}
        {box('layer', 'Pad at the peak', `A new pad track joins at the peak, playing the chords there spread wide, ${PAD_UNDER_LU} dB under the music (measured).`)}
        {!!trackIds?.length && (
          <label className="flex items-center gap-2 text-xs text-forge-text">
            <input type="checkbox" className="accent-cyan-500" checked={picked} onChange={(e) => setPicked(e.target.checked)} />
            Only the tracks of the selected clips
          </label>
        )}
        <p className="text-[11px] text-forge-muted">
          {tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'} playing there: ${tracks.slice(0, 4).map((t) => t.name).join(', ')}${tracks.length > 4 ? ' and more' : ''}.` : 'Nothing plays in these bars yet.'} One Undo takes it all out.
        </p>
        <div className="flex justify-end">
          <button type="button" className={`${primary} disabled:opacity-40 disabled:cursor-not-allowed`} onClick={make} disabled={!tracks.length || !buildChosen(opts)} title={buildChosen(opts) ? undefined : 'Choose at least one part of the build'}>
            Make the build
          </button>
        </div>
      </div>
    </Modal>
  );
};
