/**
 * The Pads tool of a Drum Rack track ("Your pads") in Pocket's drawer: its 16 pads, the chosen
 * one's level and pitch, and ways to fill it: bounce the selected section onto it (the whole mix
 * or one track), or a vocal take. The work is in bounceToPadActions.ts (and pocketBounce.ts).
 */
import React, { useState } from 'react';
import { Disc3, Loader2, Trash2 } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { RACK_PADS, type Track } from '../store/timelineTypes';
import { defaultRack, padNote, RACK_GAIN_MAX } from '../store/sampleKits';
import { isAudioKind } from '../audio/instrumentCatalog';
import { clearPad } from '../store/bounceToPad';
import { clipToPad, placedMessage, usePadBounce } from '../store/bounceToPadActions';
import { bounceSection } from './pocketBounce';
import { showToast } from '../components/timeline/toastStore';
import { Card, pill } from './pocketUi';
import { audition } from './pocketSound';
import { gridTracks, type PocketSection } from './pocketSections';
import { usePocket } from './pocketStore';
import { buzz } from './pocketSession';

/** A bounce under way, as a line with its progress (nothing when none is). */
export const BounceProgress: React.FC = () => {
  const fraction = usePadBounce((b) => b.fraction);
  const label = usePadBounce((b) => b.label);
  if (fraction === null) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-forge-muted my-2" role="status">
      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      <span className="flex-1 min-w-0 truncate">Bouncing {label}</span>
      <span className="font-mono">{Math.round(fraction * 100)}%</span>
    </div>
  );
};

const Range: React.FC<{ label: string; value: number; min: number; max: number; step: number; show: string; color: string; onChange: (v: number) => void }> = ({ label, value, min, max, step, show, color, onChange }) => (
  <label className="grid grid-cols-[52px_minmax(0,1fr)_64px] items-center gap-2.5 text-[13px] text-forge-muted min-h-11">
    <span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onPointerDown={() => useTimelineStore.getState().beginEdit()} onChange={(e) => onChange(Number(e.target.value))} className="w-full h-8" style={{ accentColor: color }} />
    <span className="font-mono text-xs text-forge-text text-right">{show}</span>
  </label>
);

export const PocketRack: React.FC<{ track: Track; sec: PocketSection }> = ({ track, sec }) => {
  const selected = usePocket((p) => Math.max(0, Math.min(RACK_PADS - 1, p.rackPad)));
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const bouncing = usePadBounce((b) => b.fraction !== null);
  const [only, setOnly] = useState('');
  const rack = track.rack ?? defaultRack();
  const pad = rack.pads[selected];
  const s = useTimelineStore.getState;
  const setPad = (patch: Partial<typeof pad>, record = false) => s().setTrackRack(track.id, { pads: rack.pads.map((p, j) => (j === selected ? { ...p, ...patch } : p)) }, record);
  const target = { trackId: track.id, pad: selected };
  const others = gridTracks(tracks).filter((t) => t.id !== track.id && clips.some((c) => c.trackId === t.id && c.startBar < sec.to && c.startBar + c.lengthBars > sec.from));
  const takes = clips.filter((c) => c.audio && tracks.some((t) => t.id === c.trackId && isAudioKind(t.instrumentKey))).sort((a, b) => a.startBar - b.startBar);
  return (
    <div className="pk-scroll">
      <div className="grid grid-cols-8 gap-1 mb-3" role="group" aria-label="Pads">
        {Array.from({ length: RACK_PADS }, (_, k) => {
          // Pad 1 bottom left, as on the pads
          const i = (1 - Math.floor(k / 8)) * 8 + (k % 8);
          const p = rack.pads[i];
          return (
            <button
              key={i}
              type="button"
              aria-pressed={i === selected}
              aria-label={`Pad ${i + 1}: ${p.soundId ? p.name : 'empty'}`}
              className={`h-10 rounded-lg border text-[11px] font-mono ${i === selected ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100' : p.soundId ? 'border-forge-border bg-forge-panelLight' : 'border-dashed border-forge-border text-forge-muted'}`}
              onClick={() => {
                usePocket.getState().set({ rackPad: i });
                if (p.soundId) {
                  buzz(10);
                  void audition(track.id, padNote(i));
                }
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <Card
        title={`Pad ${selected + 1}: ${pad.soundId ? pad.name : 'empty'}`}
        right={
          pad.soundId ? (
            <button type="button" aria-label={`Empty pad ${selected + 1}`} className={`${pill} !h-9 !px-3`} onClick={() => s().setTrackRack(track.id, clearPad(rack, selected), true)}>
              <Trash2 className="w-4 h-4" />
            </button>
          ) : undefined
        }
      >
        {pad.soundId ? (
          <>
            <Range label="Level" color={track.color} value={pad.gain} min={Math.min(-30, Math.floor(pad.gain))} max={RACK_GAIN_MAX} step={0.5} show={`${pad.gain > 0 ? '+' : ''}${pad.gain.toFixed(1)} dB`} onChange={(v) => setPad({ gain: v })} />
            <Range label="Pitch" color={track.color} value={pad.pitch} min={-12} max={12} step={1} show={`${pad.pitch > 0 ? '+' : ''}${pad.pitch} st`} onChange={(v) => setPad({ pitch: v })} />
            <button type="button" aria-pressed={!!pad.reverse} className={`${pill} w-full mt-1 ${pad.reverse ? '!border-cyan-400 !bg-cyan-500/15 text-cyan-200' : ''}`} onClick={() => setPad({ reverse: pad.reverse ? undefined : true }, true)}>
              Reverse {pad.reverse ? 'on' : 'off'}
            </button>
          </>
        ) : (
          <p className="text-sm text-forge-muted">Fill it with a bounce of the song or a vocal take, below.</p>
        )}
      </Card>
      <Card title={pad.soundId ? 'Put something else on it' : 'Fill it'}>
        <BounceProgress />
        <button type="button" disabled={bouncing} className={`${pill} w-full`} onClick={() => void bounceSection(sec, undefined, target)}>
          <Disc3 className="w-4 h-4" /> Bounce {sec.letter} (everything playing)
        </button>
        {others.length > 0 && (
          <div className="flex gap-2 mt-2">
            <select aria-label="Track to bounce" className="flex-1 min-w-0 h-11 rounded-xl border border-forge-border bg-forge-panel px-2 text-sm" value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="">Just one track…</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={bouncing || !only} className={pill} onClick={() => void bounceSection(sec, only, target)}>
              Bounce
            </button>
          </div>
        )}
        {takes.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[11px] text-forge-muted">Or a vocal take:</p>
            {takes.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2.5 rounded-xl active:bg-white/5 text-sm truncate"
                onClick={() => {
                  const placed = clipToPad(c.id, target);
                  showToast(placed ? placedMessage(`"${c.name}"`, placed) : `${c.name}'s sound isn't loaded yet`);
                }}
              >
                {c.name} <span className="text-[11px] text-forge-muted">bar {Math.round(c.startBar * 10) / 10}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-forge-muted mt-2">
          A bounce is {sec.letter} as you hear it, made into one sound: play it from the pad, write it into the steps, or pitch it. Undo takes it back off.
        </p>
      </Card>
    </div>
  );
};
