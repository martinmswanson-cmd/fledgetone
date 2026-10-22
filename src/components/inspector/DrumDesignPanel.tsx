import React, { useState } from 'react';
import { Drum, Play, Plus, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { initAudio } from '../../audio/engine';
import { previewTrackNotes } from '../../audio/liveTracks';
import {
  defaultLayer,
  DESIGN_ROWS,
  DRUM_PRESETS,
  DRUM_VOICE_LABELS,
  DRUM_VOICES,
  KEY_PITCH_RANGE,
  LAYER_RANGES,
  MAX_DRUM_LAYERS,
  presetSound,
  resetRowSound,
  ROW_GROUP,
  soundForRow,
  SOUND_LEVEL,
  VOICE_CONTROLS,
  withLayerValue,
  withRowSound,
} from '../../store/drumDesign';
import type { DesignRow, DrumControl, DrumSound, DrumVoice, PresetGroup } from '../../store/drumDesign';
import { FxSlider } from './InsertFx';
import { NOTE_NAMES } from '../../store/songKey';
import { keyPitchHz, songRoot } from '../../store/drumFollow';

/**
 * The Drum Designer: the Designed Kit's controls in the Track Inspector. Pick a drum row, load a
 * preset or shape its one or two layers (each a kick, snare, clap, hat, rim, tom, shaker or bell
 * voice, or a layered kick or snare, with its own knobs; a layered drum's note can follow the
 * song's key). Each change plays the row so you hear it; knob drags are one undo
 * step each (the sliders checkpoint), picks from a list are one step too.
 */

const select = 'h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text focus:outline-none focus:border-red-500';
const ACCENT = '#f87171';

const toLog = (v: number, lo: number, hi: number) => Math.log(v / lo) / Math.log(hi / lo);
const fromLog = (x: number, lo: number, hi: number) => lo * (hi / lo) ** x;

/** A knob's value as it reads. */
function shown(c: Pick<DrumControl, 'unit'>, v: number): string {
  switch (c.unit) {
    case 'Hz':
      return v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`;
    case 's':
      return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case 'ms':
      return `${v.toFixed(v < 10 ? 1 : 0)} ms`;
    case 'st':
      return `${Math.round(v)} st`;
    case 'dB':
      return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
    case '%':
      return `${Math.round(v * 100)}%`;
    default:
      return `${Math.round(v)}`;
  }
}

/** A note's frequency (MIDI number), Hz */
const hzOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const nameOfMidi = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
/** The notes a pitch knob reaches, low to high */
function notesIn([lo, hi]: [number, number]): number[] {
  const out: number[] = [];
  for (let m = 12; m < 120; m++) if (hzOf(m) >= lo - 0.01 && hzOf(m) <= hi + 0.01) out.push(m);
  return out;
}

/** When the last audition played (performance.now()): while a knob moves, a hit every 180 ms at most. */
let lastPlay = 0;
function auditionDue(force: boolean): boolean {
  const now = performance.now();
  if (!force && now - lastPlay < 180) return false;
  lastPlay = now;
  return true;
}

const GROUPS: PresetGroup[] = ['Kicks', 'Snares', 'Claps', 'Hats', 'Cymbals', 'Percussion'];

export const DrumDesignPanel: React.FC<{ track: Track }> = ({ track }) => {
  const [row, setRow] = useState<DesignRow>('kick');
  const sound = soundForRow(track.drumDesign, row);
  const note = DESIGN_ROWS.find((r) => r.row === row)!.note;
  const audition = async (force = true) => {
    if (!auditionDue(force)) return;
    await initAudio();
    previewTrackNotes(track.id, [{ note, duration: '8n', velocity: 0.9 }]);
  };
  const put = (next: DrumSound, record: boolean, force = record) => {
    useTimelineStore.getState().setTrackDrumDesign(track.id, withRowSound(track.drumDesign, row, next), record);
    void audition(force);
  };
  const setLayer = (i: number, key: keyof typeof LAYER_RANGES, v: number) => put(withLayerValue(sound, i, key, v), false, false);
  const setVoice = (i: number, voice: DrumVoice) => {
    const { preset: _p, ...rest } = sound;
    put({ ...rest, layers: sound.layers.map((l, k) => (k === i ? { ...defaultLayer(voice), level: l.level, delay: l.delay } : l)) }, true);
  };

  const knob = (i: number, c: DrumControl) => {
    const l = sound.layers[i];
    if (c.kind === 'toggle') {
      const on = l[c.key] >= 0.5;
      return (
        <label key={c.key} className="flex items-center gap-2 text-[10px] font-mono text-forge-muted">
          <input type="checkbox" checked={on} onChange={(e) => put(withLayerValue(sound, i, c.key, e.target.checked ? 1 : 0), true)} />
          {c.label}
        </label>
      );
    }
    if (c.kind === 'choice') {
      return (
        <label key={c.key} className="flex items-center gap-2 text-[10px] font-mono text-forge-muted">
          <span className="w-16 uppercase">{c.label}</span>
          <select className={select} aria-label={c.label} value={Math.round(l[c.key])} onChange={(e) => put(withLayerValue(sound, i, c.key, Number(e.target.value)), true)}>
            {(c.choices ?? []).map((name, k) => (
              <option key={name} value={k}>{name}</option>
            ))}
          </select>
        </label>
      );
    }
    const [lo, hi] = c.range ?? LAYER_RANGES[c.key];
    const d = defaultLayer(l.voice)[c.key];
    const v = Math.max(lo, Math.min(hi, l[c.key]));
    if (c.log) {
      return (
        <FxSlider key={c.key} label={c.label} value={toLog(v, lo, hi)} min={0} max={1} step={0.001} format={(x) => shown(c, fromLog(x, lo, hi))} onChange={(x) => setLayer(i, c.key, +fromLog(x, lo, hi).toPrecision(4))} reset={toLog(Math.max(lo, Math.min(hi, d)), lo, hi)} accent={ACCENT} disabled={false} />
      );
    }
    return <FxSlider key={c.key} label={c.label} value={v} min={lo} max={hi} step={c.step} format={(x) => shown(c, x)} onChange={(x) => setLayer(i, c.key, x)} reset={Math.max(lo, Math.min(hi, d))} accent={ACCENT} disabled={false} />;
  };

  /** A layered kick's tail note or a layered snare's body note: the song's key root, or a note picked */
  const notePicker = (i: number) => {
    const l = sound.layers[i];
    const range = KEY_PITCH_RANGE[l.voice]!;
    const notes = notesIn(l.voice === 'layerKick' ? [30, 90] : [100, 250]);
    const picked = notes.find((m) => Math.abs(hzOf(m) - l.pitch) < 0.05);
    const st = useTimelineStore.getState();
    const root = songRoot(st.clips, st.tracks);
    const label = l.voice === 'layerKick' ? 'Tail note' : 'Body note';
    return (
      <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted" title="Tune the drum to the song: its key's root (in the octave nearest its usual range), or a note you pick">
        <span className="w-16 uppercase">{label}</span>
        <select
          className={`${select} flex-1 min-w-0`}
          aria-label={label}
          value={l.keyTrack >= 0.5 ? 'key' : picked !== undefined ? String(picked) : ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'key') put(withLayerValue(sound, i, 'keyTrack', 1), true);
            else if (v) put(withLayerValue(withLayerValue(sound, i, 'keyTrack', 0), i, 'pitch', +hzOf(Number(v)).toFixed(2)), true);
          }}
        >
          <option value="key">{root !== null ? `Song key (${NOTE_NAMES[root]}, ${Math.round(keyPitchHz(root, range))} Hz)` : 'Song key (no notes yet)'}</option>
          {l.keyTrack < 0.5 && picked === undefined && <option value="">{`${Math.round(l.pitch)} Hz`}</option>}
          {notes.map((m) => (
            <option key={m} value={m}>{`${nameOfMidi(m)} (${hzOf(m).toFixed(1)} Hz)`}</option>
          ))}
        </select>
      </label>
    );
  };

  const layerBlock = (i: number) => {
    const l = sound.layers[i];
    return (
      <div key={i} className="flex flex-col gap-1.5 border-t border-forge-border pt-2">
        <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-forge-text">
          Layer {i + 1}
          <select className={select} aria-label={`Layer ${i + 1} voice`} value={l.voice} onChange={(e) => setVoice(i, e.target.value as DrumVoice)}>
            {DRUM_VOICES.map((v) => (
              <option key={v} value={v}>{DRUM_VOICE_LABELS[v]}</option>
            ))}
          </select>
          {i > 0 && (
            <button
              type="button"
              className="ml-auto text-forge-muted hover:text-forge-text"
              title="Remove this layer"
              onClick={() => {
                const { preset: _p, ...rest } = sound;
                put({ ...rest, layers: sound.layers.filter((_, k) => k !== i) }, true);
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {KEY_PITCH_RANGE[l.voice] && notePicker(i)}
        {VOICE_CONTROLS[l.voice].map((c) => knob(i, c))}
        {sound.layers.length > 1 && knob(i, { key: 'level', label: 'Level', unit: 'dB', step: 0.5 })}
        {i > 0 && knob(i, { key: 'delay', label: 'Delay', unit: 'ms', step: 0.5 })}
      </div>
    );
  };

  const group = ROW_GROUP[row];
  return (
    <section data-search="drum designer design drums kick snare clap hat" className="flex flex-col gap-2.5 bg-forge-bg p-3 rounded-lg border border-forge-border" aria-label="Drum Designer">
      <div className="flex items-center gap-2">
        <Drum className="w-4 h-4 text-red-400" />
        <span className="text-xs font-semibold text-forge-text">Drum Designer</span>
        <button type="button" onClick={() => void audition()} className="ml-auto flex items-center gap-1 text-[10px] font-mono text-forge-muted hover:text-forge-text" title="Play this drum">
          <Play className="w-3.5 h-3.5" /> PLAY
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Drum row">
        {DESIGN_ROWS.map((r) => (
          <button
            key={r.row}
            type="button"
            onClick={() => {
              setRow(r.row);
              void initAudio().then(() => previewTrackNotes(track.id, [{ note: r.note, duration: '8n', velocity: 0.9 }]));
            }}
            className={`h-6 rounded text-[10px] font-mono border ${row === r.row ? 'border-red-400 text-white bg-red-500/20' : 'border-forge-border text-forge-muted hover:text-forge-text'} ${track.drumDesign?.[r.row] ? 'font-bold' : ''}`}
            title={track.drumDesign?.[r.row] ? `${r.label}: designed` : `${r.label}: the default sound`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono">
        <span className="w-16 text-forge-muted uppercase">Preset</span>
        <select
          className={`${select} flex-1 min-w-0`}
          aria-label="Preset"
          value={sound.preset ?? ''}
          onChange={(e) => {
            const p = presetSound(e.target.value);
            if (p) put(p, true);
          }}
        >
          <option value="">{sound.preset ? '' : 'Your own sound'}</option>
          {[group, ...GROUPS.filter((g) => g !== group)].map((g) => (
            <optgroup key={g} label={g}>
              {DRUM_PRESETS.filter((p) => p.group === g).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <FxSlider label="Level" value={sound.level} min={SOUND_LEVEL[0]} max={SOUND_LEVEL[1]} step={0.5} format={(v) => shown({ unit: 'dB' }, v)} onChange={(v) => put({ ...sound, level: v }, false, false)} reset={0} accent={ACCENT} disabled={false} />
      {sound.layers.map((_, i) => layerBlock(i))}
      {sound.layers.length < MAX_DRUM_LAYERS && (
        <button
          type="button"
          className="flex items-center gap-1 text-[10px] font-mono text-forge-muted hover:text-forge-text"
          title="Stack a second sound on this drum (a clap on a snare, a click on a kick)"
          onClick={() => {
            const { preset: _p, ...rest } = sound;
            const voice: DrumVoice = row === 'kick' ? 'rim' : row === 'snare' ? 'clap' : 'hat';
            put({ ...rest, layers: [...sound.layers, { ...defaultLayer(voice), level: -8 }] }, true);
          }}
        >
          <Plus className="w-3.5 h-3.5" /> ADD LAYER
        </button>
      )}
      {track.drumDesign?.[row] && (
        <button
          type="button"
          className="self-start text-[10px] font-mono text-forge-muted hover:text-forge-text"
          title="Put this row back to its default sound"
          onClick={() => {
            useTimelineStore.getState().setTrackDrumDesign(track.id, resetRowSound(track.drumDesign, row), true);
            void audition();
          }}
        >
          RESET ROW
        </button>
      )}
    </section>
  );
};
