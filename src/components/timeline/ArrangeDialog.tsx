/**
 * The Arrange a beat dialog: the producer arrangement tools in four tabs. Dark melody (a short
 * seeded loop for trap, drill, rage or phonk), Drops & switches (drop-outs, stops, risers and
 * reverse cymbals, beat switches), Song form (a loop laid out as a whole song with section
 * markers) and Producer tag (record or import it once, place it with one click). The store side
 * is arrangeActions.ts; which tab is open lives in arrangeDialogStore.ts.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { showToast } from './toastStore';
import { useTimelineStore } from '../../store/timelineStore';
import { NOTE_NAMES } from '../../store/songKey';
import { songKey } from '../../store/smartActions';
import { DARK_SCALES, DARK_SOUNDS, DARK_STYLES, darkKeyFor, type DarkRegister, type DarkScale, type DarkSound, type DarkStyle } from '../../store/darkMelody';
import { ROLE_NAMES, SWITCH_MODES, trackRole, type SwitchMode } from '../../store/beatSwitch';
import { defaultLengths, planSongForm, SECTION_NAMES, SONG_FORM, type SectionKind, type SectionLengths } from '../../store/songForm';
import { TAG_DUCK_DB } from '../../store/producerTag';
import { DRUM_STYLES, type DrumStyle } from '../../store/smartTools';
import { addDropFx, addStop, beatSwitch, dropOut, importTag, layOutSong, loadTag, placeTag, saveTag, writeDarkMelody } from '../../store/arrangeActions';
import { startMic, type MicSession } from '../../audio/micRecorder';
import { initAudio } from '../../audio/engine';
import { pickAudioFiles } from './audioFiles';
import { useArrangeDialog, type ArrangeTab } from './arrangeDialogStore';

const field = 'flex flex-col gap-1 text-[11px] text-forge-muted';
const control = 'bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text';
const primary = 'px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-semibold hover:bg-cyan-400 disabled:opacity-40';
const secondary = 'px-3 py-1.5 rounded border border-forge-border text-xs text-forge-text hover:border-forge-borderLight disabled:opacity-40';
const TABS: ReadonlyArray<{ id: ArrangeTab; name: string }> = [
  { id: 'melody', name: 'Dark melody' },
  { id: 'drops', name: 'Drops & switches' },
  { id: 'form', name: 'Song form' },
  { id: 'tag', name: 'Producer tag' },
];

const say = (message: string | null | undefined) => message && showToast(message);

/** The Arrange a beat dialog (opened with openArrange). */
export const ArrangeDialog: React.FC = () => {
  const open = useArrangeDialog((s) => s.open);
  if (!open) return null;
  const close = () => useArrangeDialog.setState({ open: null });
  const setTab = (tab: ArrangeTab) => useArrangeDialog.setState({ open: { ...open, tab } });
  return (
    <Modal title="Arrange a beat" onClose={close} wide>
      <div className="flex gap-1 border-b border-forge-border -mt-1 pb-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={open.tab === t.id} onClick={() => setTab(t.id)} className={`px-2.5 py-1 rounded text-xs ${open.tab === t.id ? 'bg-cyan-500/20 text-cyan-200' : 'text-forge-muted hover:text-forge-text'}`}>
            {t.name}
          </button>
        ))}
      </div>
      {open.tab === 'melody' && <MelodyTab bar={open.bar} trackId={open.trackId} />}
      {open.tab === 'drops' && <DropsTab bar={open.bar} />}
      {open.tab === 'form' && <FormTab />}
      {open.tab === 'tag' && <TagTab />}
    </Modal>
  );
};

// ---------- Dark melody ----------

/** The choices made last, kept while the app is open (set outside render). */
const lastMelody = { style: 'trap' as DarkStyle, scale: 'minor' as DarkScale, bars: 2 as 1 | 2 | 4, density: 0.4, register: 'mid' as DarkRegister, seed: 1 };

const MelodyTab: React.FC<{ bar?: number; trackId?: string }> = ({ bar, trackId }) => {
  const detected = useMemo(() => darkKeyFor(songKey()), []);
  const [root, setRoot] = useState(detected.root);
  const [o, setO] = useState(lastMelody);
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedId = useTimelineStore((s) => s.selectedTrackId);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const pitched = tracks.filter((t) => { const r = trackRole(t); return r === 'melody' || r === 'bass'; });
  const initialTarget = pitched.find((t) => t.id === (trackId ?? selectedId))?.id ?? `new:${DARK_STYLES.find((d) => d.id === o.style)!.sound}`;
  const [target, setTarget] = useState(initialTarget);
  const [at, setAt] = useState(Math.max(1, Math.floor(bar ?? playhead)));
  /** The clip this dialog wrote last: New idea rewrites it */
  const written = useRef<string | null>(null);
  const set = (patch: Partial<typeof o>) => setO((x) => {
    const next = { ...x, ...patch };
    Object.assign(lastMelody, next);
    return next;
  });
  const pickStyle = (style: DarkStyle) => {
    const def = DARK_STYLES.find((d) => d.id === style)!;
    set({ style, scale: def.scale, density: def.density });
    if (target.startsWith('new:')) setTarget(`new:${def.sound}`);
  };
  const write = (seed: number, replace: boolean) => {
    const where = target.startsWith('new:') ? { sound: target.slice(4) as DarkSound } : { trackId: target };
    const result = writeDarkMelody({ ...o, root, seed }, replace && written.current ? { ...where, replaceClipId: written.current } : where, at);
    if (!result) return showToast('Pick a melody track (or a new one): drums, audio and FX tracks take no melody.');
    written.current = result.clipId;
    setTarget(result.trackId);
    showToast(`Dark melody in ${NOTE_NAMES[root]} ${DARK_SCALES.find((s) => s.id === o.scale)!.name.toLowerCase()}, idea ${seed}. Press Play to hear it; Undo takes it back.`);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className={field}>
          Style
          <select className={control} value={o.style} onChange={(e) => pickStyle(e.target.value as DarkStyle)}>
            {DARK_STYLES.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className={field}>
          Key {root === detected.root && <span className="text-cyan-300">({detected.note})</span>}
          <div className="flex gap-1 min-w-0">
            <select className={`${control} min-w-0`} value={root} onChange={(e) => setRoot(Number(e.target.value))} aria-label="Key root">
              {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
            <select className={`${control} min-w-0 flex-1`} value={o.scale} onChange={(e) => set({ scale: e.target.value as DarkScale })} aria-label="Scale">
              {DARK_SCALES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </label>
        <label className={field}>
          Length
          <select className={control} value={o.bars} onChange={(e) => set({ bars: Number(e.target.value) as 1 | 2 | 4 })}>
            {[1, 2, 4].map((n) => <option key={n} value={n}>{n} bar{n === 1 ? '' : 's'}</option>)}
          </select>
        </label>
        <label className={field}>
          Density: {o.density < 0.34 ? 'sparse' : o.density < 0.67 ? 'medium' : 'busy'}
          <input type="range" min={0} max={1} step={0.01} value={o.density} onChange={(e) => set({ density: Number(e.target.value) })} className="accent-cyan-500" />
        </label>
        <label className={field}>
          Register
          <select className={control} value={o.register} onChange={(e) => set({ register: e.target.value as DarkRegister })}>
            <option value="low">low</option>
            <option value="mid">middle</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className={field}>
          At bar
          <input type="number" min={1} max={400} className={control} value={at} onChange={(e) => setAt(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </label>
      </div>
      <label className={field}>
        Onto
        <select className={control} value={target} onChange={(e) => { setTarget(e.target.value); written.current = null; }}>
          {DARK_SOUNDS.map((s) => <option key={s.id} value={`new:${s.id}`}>a new {s.name.toLowerCase()} track</option>)}
          {pitched.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <p className="text-[11px] text-forge-muted">{o.style[0].toUpperCase() + o.style.slice(1)}: {DARK_STYLES.find((d) => d.id === o.style)!.detail}. A motif, repeated, with a different ending; the half step above the root for tension. Idea {o.seed}: the same idea number always writes the same melody.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={secondary} onClick={() => { set({ seed: o.seed + 1 }); write(o.seed + 1, true); }} title="Another melody with the same settings (in place of the last one written here)">
          New idea
        </button>
        <button type="button" className={primary} onClick={() => { written.current = null; write(o.seed, false); }}>
          Write melody at bar {at}
        </button>
      </div>
    </div>
  );
};

// ---------- Drops & switches ----------

const DropsTab: React.FC<{ bar?: number }> = ({ bar }) => {
  const tracks = useTimelineStore((s) => s.tracks);
  const loop = useTimelineStore((s) => s.loopRegion);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const sounding = tracks.filter((t) => trackRole(t) !== 'mix');
  const start = Math.max(2, Math.round(bar ?? playhead));
  const [dropBar, setDropBar] = useState(start);
  const [out, setOut] = useState<Set<string>>(() => new Set(sounding.filter((t) => trackRole(t) !== 'melody').map((t) => t.id)));
  const [outBars, setOutBars] = useState(1);
  const [stopBeats, setStopBeats] = useState<1 | 0.5>(1);
  const [fxBars, setFxBars] = useState(2);
  const [early, setEarly] = useState(0);
  const [from, setFrom] = useState(Math.max(1, Math.round(loop.inBar)));
  const [to, setTo] = useState(Math.max(Math.round(loop.inBar) + 1, Math.round(loop.outBar)));
  const [mode, setMode] = useState<SwitchMode>('half');
  const [style, setStyle] = useState<DrumStyle>('trap');
  const [seed, setSeed] = useState(1);
  const num = (v: string, min = 1) => Math.max(min, Math.round(Number(v) || min));
  const toggle = (id: string) => setOut((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-forge-text">Into a drop</h4>
        <label className={`${field} w-40`}>
          The drop is at bar
          <input type="number" min={2} max={400} className={control} value={dropBar} onChange={(e) => setDropBar(num(e.target.value, 2))} />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <span className="text-[11px] text-forge-muted w-full">Drop out (silent for the bars before the drop):</span>
          {sounding.map((t) => (
            <label key={t.id} className="flex items-center gap-1 text-[11px] text-forge-text">
              <input type="checkbox" className="accent-cyan-500" checked={out.has(t.id)} onChange={() => toggle(t.id)} />
              {t.name} <span className="text-forge-muted">({ROLE_NAMES[trackRole(t)].split(' ')[0].toLowerCase()})</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select className={control} value={outBars} onChange={(e) => setOutBars(Number(e.target.value))} aria-label="Drop-out length">
            <option value={0.5}>the last half bar</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </select>
          <button type="button" className={secondary} onClick={() => say(dropOut([...out], dropBar - outBars, dropBar))}>Drop out</button>
          <span className="w-px h-5 bg-forge-border mx-1" />
          <select className={control} value={stopBeats} onChange={(e) => setStopBeats(Number(e.target.value) as 1 | 0.5)} aria-label="Stop length">
            <option value={1}>1 beat</option>
            <option value={0.5}>half a beat</option>
          </select>
          <button type="button" className={secondary} onClick={() => say(addStop(dropBar - 1, stopBeats))} title="Every track silent at the end of the bar before the drop">Stop before the drop</button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select className={control} value={fxBars} onChange={(e) => setFxBars(Number(e.target.value))} aria-label="Riser length">
            {[1, 2, 4, 8].map((n) => <option key={n} value={n}>over {n} bar{n === 1 ? '' : 's'}</option>)}
          </select>
          <select className={control} value={early} onChange={(e) => setEarly(Number(e.target.value))} aria-label="Ends">
            <option value={0}>ending on the drop</option>
            <option value={0.25}>ending a beat early (for a stop)</option>
            <option value={0.125}>ending half a beat early</option>
          </select>
          <button type="button" className={secondary} onClick={() => say(addDropFx('riser', dropBar, fxBars, early))}>Riser</button>
          <button type="button" className={secondary} onClick={() => say(addDropFx('reverse', dropBar, fxBars, early))}>Reverse cymbal</button>
        </div>
      </section>
      <section className="flex flex-col gap-2 border-t border-forge-border pt-3">
        <h4 className="text-xs font-semibold text-forge-text">Beat switch</h4>
        <p className="text-[11px] text-forge-muted">A copy of the bars goes right after them with new drums and bass; the melody stays. The rest of the song moves later. (The bars start as the loop's In and Out.)</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className={field}>
            From bar
            <input type="number" min={1} className={`${control} w-20`} value={from} onChange={(e) => setFrom(num(e.target.value))} />
          </label>
          <label className={field}>
            To bar (not included)
            <input type="number" min={2} className={`${control} w-20`} value={to} onChange={(e) => setTo(num(e.target.value, 2))} />
          </label>
          <label className={field}>
            Switch to
            <select className={control} value={mode} onChange={(e) => setMode(e.target.value as SwitchMode)}>
              {SWITCH_MODES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {mode === 'pattern' && (
            <label className={field}>
              Drummer style
              <select className={control} value={style} onChange={(e) => setStyle(e.target.value as DrumStyle)}>
                {DRUM_STYLES.filter((d) => !d.meter).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className={primary} onClick={() => { say(beatSwitch(from, to, mode, style, seed)); setSeed(seed + 1); }}>Beat switch</button>
        </div>
        <p className="text-[11px] text-forge-muted">{SWITCH_MODES.find((m) => m.id === mode)!.detail}.</p>
      </section>
    </div>
  );
};

// ---------- Song form ----------

const LENGTH_CHOICES = [0, 4, 8, 12, 16, 24, 32];

const FormTab: React.FC = () => {
  const loop = useTimelineStore((s) => s.loopRegion);
  const bpm = useTimelineStore((s) => s.bpm);
  const [from, setFrom] = useState(Math.max(1, Math.round(loop.inBar)));
  const [loopBars, setLoopBars] = useState(Math.round(loop.outBar - loop.inBar) >= 8 ? 8 : 4);
  const [lengths, setLengths] = useState<SectionLengths>(() => defaultLengths(loopBars));
  const [drop, setDrop] = useState(true);
  const plan = planSongForm(lengths);
  const total = plan.reduce((n, s) => n + s.bars, 0);
  const seconds = Math.round((total * 240) / bpm);
  const kinds = [...new Set(SONG_FORM)] as SectionKind[];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className={field}>
          The loop starts at bar
          <input type="number" min={1} className={`${control} w-20`} value={from} onChange={(e) => setFrom(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </label>
        <label className={field}>
          and is
          <select className={control} value={loopBars} onChange={(e) => { const n = Number(e.target.value); setLoopBars(n); setLengths(defaultLengths(n)); }}>
            <option value={4}>4 bars</option>
            <option value={8}>8 bars</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {kinds.map((k) => (
          <label key={k} className={field}>
            {SECTION_NAMES[k]}{k === 'hook' || k === 'verse' ? ' (each)' : ''}
            <select className={control} value={lengths[k]} onChange={(e) => setLengths({ ...lengths, [k]: Number(e.target.value) })}>
              {LENGTH_CHOICES.map((n) => <option key={n} value={n}>{n ? `${n} bars` : 'none'}</option>)}
            </select>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-forge-text">
        <input type="checkbox" className="accent-cyan-500" checked={drop} onChange={(e) => setDrop(e.target.checked)} />
        Drums drop out for the last half bar before each hook
      </label>
      <p className="text-[11px] text-forge-muted">
        {plan.map((s) => `${s.name} ${s.bars}`).join(' · ')} = {total} bars, about {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} at {bpm} BPM. Intro and outro: the melody alone. Verses: a thinner beat and a softer melody. Bridge: the kick under the melody and bass. Hooks: everything. Markers name each section; anything after the loop moves later.
      </p>
      <div className="flex justify-end">
        <button type="button" className={primary} disabled={!total} onClick={() => say(layOutSong(from, loopBars, lengths, drop))}>Lay out the song</button>
      </div>
    </div>
  );
};

// ---------- Producer tag ----------

const TagTab: React.FC = () => {
  const [tag, setTag] = useState(loadTag);
  const [session, setSession] = useState<MicSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(1);
  const [every, setEvery] = useState(8);
  // Closing the dialog while recording throws the take away
  const live = useRef<MicSession | null>(null);
  useEffect(() => {
    live.current = session;
  }, [session]);
  useEffect(() => () => live.current?.cancel(), []);
  const record = async () => {
    try {
      await initAudio();
      setSession(await startMic());
    } catch (err) {
      showToast(`Couldn't start recording: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const stop = async () => {
    if (!session) return;
    const take = session.stop();
    setSession(null);
    if (!take) return showToast('Nothing was recorded.');
    setBusy(true);
    try {
      setTag(await saveTag(take.channels, take.sampleRate, 'Producer tag'));
      showToast('Tag saved in this browser: it\'s ready in every project.');
    } catch (err) {
      showToast(`Couldn't keep the tag: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  };
  const pick = async () => {
    const [file] = await pickAudioFiles(false);
    if (!file) return;
    setBusy(true);
    try {
      setTag(await importTag(file));
      showToast('Tag saved in this browser: it\'s ready in every project.');
    } catch (err) {
      showToast(`Couldn't use that file: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-forge-muted">Record or import your tag once: it stays in this browser for every project (silence at either end is trimmed off). Placing it ducks the beat {TAG_DUCK_DB} dB under it, live and in exports.</p>
      <p className="text-xs text-forge-text">{tag ? `Your tag: "${tag.name}", ${tag.seconds.toFixed(1)} s` : 'No tag yet.'}</p>
      <div className="flex flex-wrap gap-2">
        {session ? (
          <button type="button" className={primary} onClick={() => void stop()}>Stop and keep</button>
        ) : (
          <button type="button" className={secondary} disabled={busy} onClick={() => void record()}>Record a tag</button>
        )}
        <button type="button" className={secondary} disabled={busy || !!session} onClick={() => void pick()}>Import a sound file…</button>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-forge-border pt-3">
        <label className={field}>
          From bar
          <input type="number" min={1} className={`${control} w-20`} value={from} onChange={(e) => setFrom(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </label>
        <button type="button" className={primary} disabled={!tag} onClick={() => say(placeTag(from, 0))}>Tag the start</button>
        <span className="w-px h-5 bg-forge-border mx-1" />
        <select className={control} value={every} onChange={(e) => setEvery(Number(e.target.value))} aria-label="How often">
          {[4, 8, 16].map((n) => <option key={n} value={n}>every {n} bars</option>)}
        </select>
        <button type="button" className={secondary} disabled={!tag} onClick={() => say(placeTag(from, every))} title="For a beat-store preview">Tag the whole beat</button>
      </div>
    </div>
  );
};
