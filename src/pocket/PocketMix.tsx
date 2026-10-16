/**
 * Pocket's Mix screen: a light mixer. Each track's level, mute, solo and how much reverb it sends;
 * the master's level and its clipper (louder, with the peaks shaved). The rest of the mixer
 * (inserts, EQ, buses, automation) stays as set and is edited on a computer. A track's
 * instrument can be swapped (drums for drums, pitched for pitched) and a track deleted.
 */
import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { InstrumentSheet } from './PocketSong';
import { editorOf } from './pocketStore';
import { showToast } from '../components/timeline/toastStore';
import { useTimelineStore } from '../store/timelineStore';
import { defaultClipper } from '../audio/effects/clipper';
import { LEVEL_MAX, LEVEL_MIN } from '../store/timelineTypes';
import { isMixKind } from '../audio/instrumentCatalog';
import { Card, pillOn } from './pocketUi';

const small = 'h-10 w-10 rounded-lg border border-forge-border bg-forge-panel text-sm font-bold';

/** A slider sized for a thumb, with its value. */
const Fader: React.FC<{ label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void }> = ({
  label,
  value,
  min,
  max,
  step,
  show,
  onChange,
}) => (
  <label className="flex items-center gap-2 text-xs text-forge-muted">
    <span className="w-14 shrink-0">{label}</span>
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={() => useTimelineStore.getState().checkpoint()}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 h-8 accent-cyan-400"
    />
    <span className="w-12 text-right font-mono text-forge-text">{show}</span>
  </label>
);

export const PocketMix: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const master = useTimelineStore((s) => s.master);
  const s = useTimelineStore.getState;
  const clipper = master.clipper ?? defaultClipper();
  const [swap, setSwap] = useState<string | null>(null);
  const swapping = tracks.find((t) => t.id === swap);
  return (
    <>
      <Card title="Master">
        <Fader label="Level" value={master.level} min={LEVEL_MIN} max={LEVEL_MAX} step={0.5} show={`${master.level > 0 ? '+' : ''}${master.level.toFixed(1)}`} onChange={(v) => s().setMasterLevel(v, false)} />
        <button
          type="button"
          aria-pressed={clipper.on}
          className={`mt-2 w-full h-11 rounded-xl border border-forge-border text-sm ${clipper.on ? pillOn : 'bg-forge-panel'}`}
          onClick={() => s().setMasterClipper({ on: !clipper.on }, true)}
        >
          Clipper {clipper.on ? 'on' : 'off'}: louder, with the peaks shaved
        </button>
      </Card>
      {tracks
        .filter((t) => !isMixKind(t.instrumentKey))
        .map((t) => (
          <Card
            key={t.id}
            title={
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </span>
            }
            right={
              <span className="flex gap-1.5">
                <button type="button" aria-pressed={t.isMuted} className={`${small} ${t.isMuted ? '!bg-amber-500/30 !border-amber-400 text-amber-200' : ''}`} onClick={() => s().toggleMute(t.id)}>
                  M
                </button>
                <button type="button" aria-pressed={t.isSoloed} className={`${small} ${t.isSoloed ? '!bg-cyan-500/30 !border-cyan-400 text-cyan-200' : ''}`} onClick={() => s().toggleSolo(t.id)}>
                  S
                </button>
              </span>
            }
          >
            <Fader label="Level" value={t.volume} min={-60} max={6} step={0.5} show={t.volume <= -59.9 ? '-inf' : t.volume.toFixed(1)} onChange={(v) => s().setTrackVolume(t.id, v)} />
            <div className="flex items-center gap-2 mb-1">
              {editorOf(t.instrumentKey) ? (
                <button type="button" className="flex-1 min-w-0 h-9 rounded-lg border border-forge-border bg-forge-panel text-xs truncate px-2 text-left" onClick={() => setSwap(t.id)}>
                  Sound: <span className="text-forge-text">{INSTRUMENTS[t.instrumentKey]?.name}</span>
                </button>
              ) : (
                <span className="flex-1 text-xs text-forge-muted">{INSTRUMENTS[t.instrumentKey]?.name}</span>
              )}
              <button
                type="button"
                aria-label={`Delete ${t.name}`}
                className="h-9 w-9 rounded-lg border border-forge-border bg-forge-panel flex items-center justify-center text-forge-muted"
                onClick={() => {
                  s().deleteTrack(t.id);
                  showToast(`Deleted ${t.name} (Undo brings it back)`);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <Fader label="Reverb" value={t.reverbSend} min={0} max={1} step={0.01} show={`${Math.round(t.reverbSend * 100)}%`} onChange={(v) => s().setTrackReverbSend(t.id, v)} />
          </Card>
        ))}
      {swapping && (
        <InstrumentSheet
          title={`A new sound for ${swapping.name}`}
          current={swapping.instrumentKey}
          onClose={() => setSwap(null)}
          onPick={(key) => s().setTrackInstrument(swapping.id, key)}
        />
      )}
    </>
  );
};
