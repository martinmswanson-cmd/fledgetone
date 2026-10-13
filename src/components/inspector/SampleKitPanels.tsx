/**
 * The Inspector panels of the Drum Rack (16 pads, each a sound with its own settings) and the
 * Multi Sampler (sounds laid across the keys and velocities).
 */
import React, { useState } from 'react';
import { Drum, Piano, Trash2, Upload } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { DrumRack, MultiSample, RackPad, Track } from '../../store/timelineTypes';
import { RACK_PADS } from '../../store/timelineTypes';
import { defaultMulti, defaultRack, mapZones, midiName, padNote, RACK_CHOKE_GROUPS, RACK_DECAY_MAX, RACK_GAIN_MAX, RACK_GAIN_MIN, rootFromName } from '../../store/sampleKits';
import { decodeSound } from '../../audio/soundLibrary';
import { detectPitch, hzToMidi } from '../../audio/vocalTune';
import { previewTrackNotes } from '../../audio/liveTracks';
import { initAudio } from '../../audio/engine';
import { hasFiles, importAudioFiles, pickAudioFiles } from '../timeline/audioFiles';
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
 * The Drum Rack: 16 pads (C2 up), each your own sound with its own level, pan, pitch, decay,
 * filters, drive and choke group. Click a pad to hear and edit it; drop sound files on a pad, or
 * load several at once to fill the pads in order.
 */
export const RackPanel: React.FC<{ track: Track }> = ({ track }) => {
  const rack = track.rack ?? defaultRack();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const pad = rack.pads[selected];
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
            onFocus={() => s.checkpoint()}
            onChange={(e) => setPad(selected, { name: e.target.value.slice(0, 40) })}
            className="flex-1 min-w-0 h-6 bg-forge-panel border border-forge-border rounded px-1.5 text-xs text-forge-text"
            aria-label="Pad name"
          />
          <button type="button" className={small} onClick={() => void pickAudioFiles(false).then((f) => (f.length ? fill(f, selected) : undefined))} title="Load a sound onto this pad">
            Load…
          </button>
          {pad.soundId && (
            <button type="button" className={small} onClick={() => setPad(selected, { soundId: undefined }, true)} title="Empty this pad" aria-label="Empty this pad">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
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
      <SoundLibraryFooter />
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
