/**
 * The Inspector panels of the Drum Rack (16 pads, each a sound with its own settings) and the
 * Multi Sampler (sounds laid across the keys and velocities).
 */
import React, { useState } from 'react';
import { Disc3, Drum, FolderOpen, Piano, Shuffle, Trash2, Upload } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { DrumRack, MultiSample, RackPad, Track } from '../../store/timelineTypes';
import { formatBarRange, RACK_PADS } from '../../store/timelineTypes';
import { defaultMulti, defaultRack, mapZones, midiName, padNote, RACK_CHOKE_GROUPS, RACK_DECAY_MAX, RACK_FADE_MAX, RACK_GAIN_MAX, RACK_GAIN_MIN, rootFromName } from '../../store/sampleKits';
import { decodeSound, useSoundLibrary } from '../../audio/soundLibrary';
import { DEFAULT_CHOP_FADE, MIN_CHOP } from '../../store/sampleFlip';
import { newFlipIdea } from '../../store/flipActions';
import { bounceName } from '../../store/bounceToPad';
import { bounceRangeToPad, placedMessage, usePadBounce } from '../../store/bounceToPadActions';
import { BassCutToggle } from '../timeline/SampleInfo';
import { showToast } from '../timeline/toastStore';
import { detectPitch, hzToMidi } from '../../audio/vocalTune';
import { previewTrackNotes } from '../../audio/liveTracks';
import { initAudio } from '../../audio/engine';
import { dropHasFolder, filesFromDrop, hasFiles, importAudioFiles, pickAudioFiles, pickAudioFolder, type PathFile } from '../timeline/audioFiles';
import { kitFromFolder } from '../timeline/samplePackImport';
import { isAudioPath } from '../../store/samplePack';
import { UndoableRange } from '../UndoableRange';
import { SoundLibraryFooter } from './SoundLibraryFooter';

const panel = 'flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border shadow-md';
const small = 'h-6 px-2 rounded border border-forge-border text-[10px] font-mono text-forge-muted hover:text-forge-text hover:border-cyan-500 disabled:opacity-50';
const fileBase = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
const fmtDb = (db: number) => (db <= RACK_GAIN_MIN ? '-inf' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`);
const fmtHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`);
/** A log scale for the filters' sliders (0 to 1). */
const logPos = (v: number, lo: number, hi: number) => Math.log(v / lo) / Math.log(hi / lo);
const logVal = (x: number, lo: number, hi: number) => Math.round(lo * (hi / lo) ** x);

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onValue: (v: number) => void; reset: number }> = ({ label, value, min, max, step, format, onValue, reset }) => (
  <label className="flex items-center gap-2 text-[10px] font-mono">
    <span className="w-14 text-forge-muted uppercase">{label}</span>
    <UndoableRange min={min} max={max} step={step} value={value} onValue={onValue} resetValue={reset} className="flex-1 min-w-0 h-1.5 cursor-pointer accent-rose-400" aria-label={label} />
    <span className="w-14 text-right tabular-nums text-white">{format(value)}</span>
  </label>
);

/**
 * The Drum Rack: 16 pads (C2 up), each your own sound (or a chop of one: its start, end and fade) with its own level, pan, pitch, decay,
 * filters, drive and choke group. Click a pad to hear and edit it; drop sound files on a pad, or
 * load several at once to fill the pads in order; or fill it from the loop range (In to Out),
 * bounced: the song as it sounds there, as one sound.
 */
export const RackPanel: React.FC<{ track: Track }> = ({ track }) => {
  const rack = track.rack ?? defaultRack();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const pad = rack.pads[selected];
  const bounce = usePadBounce((b) => b.fraction);
  const loopIn = useTimelineStore((st) => st.loopRegion.inBar);
  const loopOut = useTimelineStore((st) => st.loopRegion.outBar);
  const s = useTimelineStore.getState();
  const setRack = (next: DrumRack, record = true) => s.setTrackRack(track.id, next, record);
  const setPad = (i: number, patch: Partial<RackPad>, record = false) => setRack({ pads: rack.pads.map((p, j) => (j === i ? { ...p, ...patch } : p)) }, record);

  /** Put sounds on the pads from `first` on, each named after its file. */
  const fill = async (files: File[], first: number) => {
    setBusy(true);
    try {
      const sounds = await importAudioFiles(files.slice(0, RACK_PADS - first));
      if (!sounds.length) return;
      const pads = rack.pads.map((p, j) => {
        const sound = sounds[j - first];
        return sound && j >= first ? { ...p, soundId: sound.id, name: fileBase(sound.name).slice(0, 40) } : p;
      });
      setRack({ pads });
    } finally {
      setBusy(false);
    }
  };
  /** A folder of drums onto the pads, in kit order (kick on pad 1, snare on 2, hats on 5 and 6…). */
  const fromFolder = async (files: PathFile[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const next = await kitFromFolder(files, rack);
      if (next) setRack(next);
    } finally {
      setBusy(false);
    }
  };
  /** The loop range bounced (everything playing) onto the selected pad. */
  const fromLoop = () => {
    const name = bounceName(loopIn, loopOut);
    void bounceRangeToPad({ from: loopIn, to: loopOut, name, target: { trackId: track.id, pad: selected } }).then(
      (placed) => placed && showToast(placedMessage(`"${name}"`, placed)),
      (err) => showToast(`Couldn't bounce ${formatBarRange(loopIn, loopOut)}: ${err instanceof Error ? err.message : String(err)}`)
    );
  };
  const audition = async (i: number) => {
    await initAudio();
    previewTrackNotes(track.id, [{ note: padNote(i), duration: '8n', velocity: 0.9 }]);
  };

  return (
    <div className={`${panel} border-rose-500/40`} data-search="drum rack pads">
      <div className="flex items-center gap-1.5">
        <Drum className="w-3.5 h-3.5 text-rose-400" />
        <span className="flex-1 text-[11px] font-mono font-bold tracking-wider uppercase text-white">Drum Rack</span>
        <button type="button" disabled={busy} className={small} onClick={() => void pickAudioFiles(true).then((f) => (f.length ? fill(f, 0) : undefined))} title="Load up to 16 sounds: they fill the pads in order, from pad 1">
          <Upload className="w-3 h-3 inline mr-1" />
          {busy ? 'Loading…' : 'Load sounds…'}
        </button>
        <button type="button" disabled={busy} className={small} onClick={() => void pickAudioFolder().then(fromFolder)} title="Load a kit from a folder (a sample pack's drums): kick on pad 1, snare on 2, clap on 3, hats on 5 and 6… sorted by their names and folders">
          <FolderOpen className="w-3 h-3 inline mr-1" />
          Kit folder…
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1" role="grid" aria-label="Pads">
        {Array.from({ length: RACK_PADS }, (_, k) => {
          // Pad 1 bottom left, as on a pad controller
          const i = (3 - Math.floor(k / 4)) * 4 + (k % 4);
          const p = rack.pads[i];
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                setSelected(i);
                void audition(i);
              }}
              onDragOver={(e) => hasFiles(e) && e.preventDefault()}
              onDrop={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                // A folder: a whole kit, sorted onto the pads
                if (dropHasFolder(e.dataTransfer)) {
                  void filesFromDrop(e.dataTransfer).then(fromFolder);
                  return;
                }
                setSelected(i);
                void fill(Array.from(e.dataTransfer.files), i);
              }}
              className={`h-12 rounded border px-1 text-left flex flex-col justify-between overflow-hidden ${
                i === selected ? 'border-rose-400 bg-rose-500/20' : p.soundId ? 'border-forge-border bg-rose-500/10 hover:border-rose-400/60' : 'border-dashed border-forge-border hover:border-rose-400/60'
              }`}
              title={`${p.name} (${padNote(i)}). Click to hear and edit it; drop a sound file on it to load it`}
              aria-label={`Pad ${i + 1}: ${p.name}`}
            >
              <span className="text-[9px] font-mono text-forge-muted">{padNote(i)}{p.choke ? ` · ch${p.choke}` : ''}</span>
              <span className={`text-[10px] truncate w-full ${p.soundId ? 'text-forge-text' : 'text-forge-muted/70'}`}>{p.soundId ? p.name : 'empty'}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-forge-border pt-2">
        <div className="flex items-center gap-1.5">
          <input
            value={pad.name}
            onFocus={() => s.beginEdit()}
            onChange={(e) => setPad(selected, { name: e.target.value.slice(0, 40) })}
            className="flex-1 min-w-0 h-6 bg-forge-panel border border-forge-border rounded px-1.5 text-xs text-forge-text"
            aria-label="Pad name"
          />
          <button type="button" className={small} onClick={() => void pickAudioFiles(false).then((f) => (f.length ? fill(f, selected) : undefined))} title="Load a sound onto this pad">
            Load…
          </button>
          <button
            type="button"
            className={small}
            disabled={bounce !== null || !(loopOut > loopIn)}
            onClick={fromLoop}
            title={`Fill this pad from the loop range: ${formatBarRange(loopIn, loopOut)} as they sound now (every track playing), bounced to one sound. Undo takes it off.`}
          >
            <Disc3 className="w-3 h-3 inline mr-1" />
            {bounce !== null ? `${Math.round(bounce * 100)}%` : 'From loop'}
          </button>
          {pad.soundId && (
            <button type="button" className={small} onClick={() => setPad(selected, { soundId: undefined }, true)} title="Empty this pad" aria-label="Empty this pad">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        {pad.soundId && pad.start !== undefined && pad.end !== undefined && <ChopSliders pad={pad} onPad={(patch) => setPad(selected, patch)} />}
        <Slider label="Level" value={pad.gain} min={RACK_GAIN_MIN} max={RACK_GAIN_MAX} step={0.5} format={fmtDb} onValue={(v) => setPad(selected, { gain: v })} reset={0} />
        <Slider label="Pan" value={pad.pan} min={-1} max={1} step={0.01} format={(v) => (Math.abs(v) < 0.01 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`)} onValue={(v) => setPad(selected, { pan: v })} reset={0} />
        <Slider label="Pitch" value={pad.pitch} min={-24} max={24} step={1} format={(v) => `${v > 0 ? '+' : ''}${v} st`} onValue={(v) => setPad(selected, { pitch: v })} reset={0} />
        <Slider label="Decay" value={pad.decay} min={0} max={RACK_DECAY_MAX} step={0.01} format={(v) => (v <= 0 ? 'full' : `${v.toFixed(2)} s`)} onValue={(v) => setPad(selected, { decay: v })} reset={0} />
        <Slider label="Low-pass" value={logPos(pad.lowpass, 100, 20000)} min={0} max={1} step={0.001} format={(x) => fmtHz(logVal(x, 100, 20000))} onValue={(x) => setPad(selected, { lowpass: logVal(x, 100, 20000) })} reset={1} />
        <Slider label="High-pass" value={logPos(pad.highpass, 20, 5000)} min={0} max={1} step={0.001} format={(x) => fmtHz(logVal(x, 20, 5000))} onValue={(x) => setPad(selected, { highpass: logVal(x, 20, 5000) })} reset={0} />
        <Slider label="Drive" value={pad.drive} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onValue={(v) => setPad(selected, { drive: v })} reset={0} />
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="w-14 text-forge-muted uppercase">Choke</span>
          <select value={pad.choke} onChange={(e) => setPad(selected, { choke: Number(e.target.value) }, true)} className="h-6 bg-forge-panel border border-forge-border rounded px-1 text-forge-text" aria-label="Choke group" title="Pads in the same group cut each other off (a closed hat stops an open one)">
            <option value={0}>none</option>
            {Array.from({ length: RACK_CHOKE_GROUPS }, (_, g) => (
              <option key={g + 1} value={g + 1}>
                group {g + 1}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-forge-muted ml-auto">
            <input type="checkbox" checked={!!pad.reverse} onChange={(e) => setPad(selected, { reverse: e.target.checked || undefined }, true)} aria-label="Reverse" />
            reverse
          </label>
        </div>
      </div>
      <p className="text-[10px] text-forge-muted/80">Pads play on C2 to D#3 (any octave of a MIDI keyboard). In the piano roll each pad is a row, with STEPS for a step sequencer.</p>
      <FlipControls trackId={track.id} />
      <SoundLibraryFooter />
    </div>
  );
};

/** A chop's own stretch of its sound: where it starts and ends, and its fade (see sampleFlip.ts). */
const ChopSliders: React.FC<{ pad: RackPad; onPad: (patch: Partial<RackPad>) => void }> = ({ pad, onPad }) => {
  const seconds = useSoundLibrary((s) => (pad.soundId ? s.metas[pad.soundId]?.seconds : undefined)) ?? Math.max(pad.end ?? 1, 1);
  const start = pad.start ?? 0;
  const end = pad.end ?? seconds;
  const fmt = (v: number) => `${v.toFixed(3)} s`;
  return (
    <>
      <Slider label="Start" value={start} min={0} max={Math.max(0, end - MIN_CHOP)} step={0.001} format={fmt} onValue={(v) => onPad({ start: Math.min(v, end - MIN_CHOP) })} reset={start} />
      <Slider label="End" value={end} min={Math.min(seconds, start + MIN_CHOP)} max={seconds} step={0.001} format={fmt} onValue={(v) => onPad({ end: Math.max(v, start + MIN_CHOP) })} reset={end} />
      <Slider label="Fade" value={pad.fade ?? 0} min={0} max={RACK_FADE_MAX} step={0.001} format={(v) => `${Math.round(v * 1000)} ms`} onValue={(v) => onPad({ fade: v > 0 ? v : undefined })} reset={DEFAULT_CHOP_FADE} />
    </>
  );
};

/**
 * For a rack of chops (Chop sample): "New idea" writes the next starting pattern into the track's
 * selected clip (or its first), and the bass cut for laying an 808 under it.
 */
const FlipControls: React.FC<{ trackId: string }> = ({ trackId }) => {
  const chopped = useTimelineStore((s) => s.tracks.find((t) => t.id === trackId)?.rack?.pads[0]?.start !== undefined);
  const clipId = useTimelineStore((s) => (s.clips.find((c) => c.trackId === trackId && c.isSelected) ?? s.clips.find((c) => c.trackId === trackId))?.id);
  if (!chopped) return <BassCutToggle trackId={trackId} />;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-forge-border pt-2">
      <button
        type="button"
        className={small}
        disabled={!clipId}
        onClick={() => clipId && newFlipIdea(clipId) && showToast('A new idea for the chops (Undo for the last one).')}
        title="Write a new pattern that plays the chops in another order on the beat grid, into this track's selected clip"
      >
        <Shuffle className="w-3 h-3 inline mr-1" />
        New idea
      </button>
      <BassCutToggle trackId={trackId} />
    </div>
  );
};

/** A sound's pitch as a key, from its file name or (failing that) by listening to it. */
async function guessRoot(soundId: string, name: string): Promise<number> {
  const named = rootFromName(name);
  if (Number.isFinite(named)) return named;
  try {
    const audio = await decodeSound(soundId, 22050);
    const mono = audio.getChannelData(0).subarray(0, Math.min(audio.length, 22050 * 3));
    const frames = detectPitch(mono, 22050).filter((f) => f.hz > 0);
    if (frames.length) {
      const midis = frames.map((f) => hzToMidi(f.hz)).sort((a, b) => a - b);
      return Math.round(midis[Math.floor(midis.length / 2)]);
    }
  } catch {
    // Unreadable: middle C
  }
  return 60;
}

/**
 * The Multi Sampler: several sounds laid across the keyboard (and velocities): each plays the keys
 * nearest its own pitch, read from its file name ("Piano C4.wav") or heard. Sounds of the same
 * pitch marked pp / mf / ff become velocity layers. Every range can be set by hand.
 */
export const MultiPanel: React.FC<{ track: Track }> = ({ track }) => {
  const multi = track.multi ?? defaultMulti();
  const [busy, setBusy] = useState(false);
  const s = useTimelineStore.getState();
  const setMulti = (next: MultiSample, record = true) => s.setTrackMulti(track.id, next, record);

  const add = async (files: File[]) => {
    setBusy(true);
    try {
      const sounds = await importAudioFiles(files);
      const found = await Promise.all(sounds.map(async (m) => ({ soundId: m.id, name: fileBase(m.name), root: await guessRoot(m.id, m.name) })));
      const all = [...multi.zones.map((z) => ({ soundId: z.soundId, name: z.name, root: z.root })), ...found];
      setMulti({ ...multi, zones: mapZones(all) });
    } finally {
      setBusy(false);
    }
  };
  const setZone = (i: number, patch: Partial<MultiSample['zones'][number]>) => setMulti({ ...multi, zones: multi.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  const num = (value: number, onValue: (v: number) => void, lo: number, hi: number, label: string, asNote = false) => (
    <input
      type="number"
      min={lo}
      max={hi}
      value={value}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) onValue(Math.max(lo, Math.min(hi, v)));
      }}
      className="w-11 h-5 bg-forge-panel border border-forge-border rounded px-1 text-[10px] text-forge-text tabular-nums"
      aria-label={label}
      title={asNote ? `${label}: ${midiName(value)}` : label}
    />
  );

  return (
    <div
      className={`${panel} border-teal-500/40`}
      data-search="multi sampler zones"
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        // (A folder of notes: every sound file in it)
        if (dropHasFolder(e.dataTransfer)) {
          void filesFromDrop(e.dataTransfer).then((files) => add(files.filter((f) => isAudioPath(f.path)).map((f) => f.file)));
          return;
        }
        void add(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center gap-1.5">
        <Piano className="w-3.5 h-3.5 text-teal-400" />
        <span className="flex-1 text-[11px] font-mono font-bold tracking-wider uppercase text-white">Multi Sampler</span>
        <button type="button" disabled={busy} className={small} onClick={() => void pickAudioFiles(true).then((f) => (f.length ? add(f) : undefined))} title="Add sounds: each is placed by its pitch (from its file name, or heard)">
          <Upload className="w-3 h-3 inline mr-1" />
          {busy ? 'Listening…' : 'Add sounds…'}
        </button>
        <button type="button" disabled={busy} className={small} onClick={() => void pickAudioFolder().then((files) => (files.length ? add(files.filter((f) => isAudioPath(f.path)).map((f) => f.file)) : undefined))} title="Add every sound in a folder (an instrument's notes, e.g. Piano C2.wav, Piano C3.wav…)">
          <FolderOpen className="w-3 h-3 inline mr-1" />
          Folder…
        </button>
      </div>
      {multi.zones.length === 0 ? (
        <p className="text-[11px] text-forge-muted">Add (or drop) a set of notes of an instrument, e.g. "Piano C2.wav", "Piano C3.wav"…: each plays the keys nearest its own pitch. Name layers pp / mf / ff for velocity.</p>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-[10px] font-mono">
            <thead className="text-forge-muted">
              <tr>
                <th className="text-left font-normal">Sound</th>
                <th className="font-normal" title="Its own pitch">Root</th>
                <th className="font-normal" title="Lowest and highest key">Keys</th>
                <th className="font-normal" title="Softest and hardest velocity (1 to 127)">Vel</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {multi.zones.map((z, i) => (
                <tr key={`${z.soundId}-${i}`} className="border-t border-forge-border/60">
                  <td className="max-w-[90px] truncate text-forge-text" title={z.name}>
                    <button type="button" className="hover:text-teal-300" onClick={() => void initAudio().then(() => previewTrackNotes(track.id, [{ note: midiName(z.root), duration: '4n', velocity: (z.velLo + z.velHi) / 254 }]))} title="Play it at its own pitch">
                      {z.name}
                    </button>
                  </td>
                  <td className="text-center">{num(z.root, (v) => setZone(i, { root: v }), 0, 127, 'Root key', true)}</td>
                  <td className="text-center whitespace-nowrap">
                    {num(z.lo, (v) => setZone(i, { lo: Math.min(v, z.hi) }), 0, 127, 'Lowest key', true)}
                    {num(z.hi, (v) => setZone(i, { hi: Math.max(v, z.lo) }), 0, 127, 'Highest key', true)}
                  </td>
                  <td className="text-center whitespace-nowrap">
                    {num(z.velLo, (v) => setZone(i, { velLo: Math.min(v, z.velHi) }), 1, 127, 'Softest velocity')}
                    {num(z.velHi, (v) => setZone(i, { velHi: Math.max(v, z.velLo) }), 1, 127, 'Hardest velocity')}
                  </td>
                  <td>
                    <button type="button" className="text-forge-muted hover:text-red-300" onClick={() => setMulti({ ...multi, zones: multi.zones.filter((_, j) => j !== i) })} aria-label={`Remove ${z.name}`} title="Remove this sound">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {multi.zones.length > 1 && (
        <button type="button" className={`${small} self-start`} onClick={() => setMulti({ ...multi, zones: mapZones(multi.zones) })} title="Lay the sounds out again from their roots: each takes the keys nearest it">
          Re-map by root
        </button>
      )}
      <Slider label="Attack" value={multi.attack} min={0} max={2} step={0.001} format={(v) => `${Math.round(v * 1000)} ms`} onValue={(v) => setMulti({ ...multi, attack: v }, false)} reset={0.002} />
      <Slider label="Release" value={multi.release} min={0.005} max={10} step={0.005} format={(v) => `${v.toFixed(2)} s`} onValue={(v) => setMulti({ ...multi, release: v }, false)} reset={0.3} />
      <SoundLibraryFooter />
    </div>
  );
};
