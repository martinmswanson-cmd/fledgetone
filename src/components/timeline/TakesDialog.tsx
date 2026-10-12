import React, { useRef, useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { songTempo, useTimelineStore } from '../../store/timelineStore';
import { compSegments } from '../../store/takes';
import { useSoundLibrary } from '../../audio/soundLibrary';
import { waveformPath } from '../../audio/waveform';
import { secondsPerBar, stretchRatio } from '../../store/audioClips';
import { tempoAt } from '../../audio/tempoMap';
import { durationToBars, type Clip, type ClipTake } from '../../store/timelineTypes';
import { midiOf } from '../../store/noteTools';

/**
 * A take folder's takes, one row each, with the comp: the lit stretch of each row is what plays.
 * Drag along a row to have that take play there (snapped to beats; Shift for 16ths), or click a
 * row's name to have it play throughout. Delete drops a take; Flatten keeps what the comp plays and
 * drops the folder.
 */

const ROW_H = 44;
const WIDTH = 560;
const COLORS = ['#22d3ee', '#ff2bd6', '#facc15', '#a855f7', '#34d399', '#fb923c'];

const TakeContent: React.FC<{ clip: Clip; take: ClipTake; color: string; width: number }> = ({ clip, take, color, width }) => {
  const peaks = useSoundLibrary((s) => (take.audio ? s.peaks[take.audio.soundId] : undefined));
  const barW = width / clip.lengthBars;
  if (take.audio) {
    if (!peaks) return null;
    const bpm = tempoAt(clip.startBar, songTempo(useTimelineStore.getState()));
    const spb = secondsPerBar(bpm) * stretchRatio(take.audio, bpm);
    return <path d={waveformPath(peaks, take.audio.offset, take.audio.offset + clip.lengthBars * spb, width, ROW_H - 8)} fill={color} opacity={0.75} transform="translate(0 4)" />;
  }
  const notes = take.notes ?? [];
  const pitches = notes.map((n) => (Number.isFinite(midiOf(n.note)) ? midiOf(n.note) : 60));
  const lo = Math.min(...pitches, 127);
  const hi = Math.max(...pitches, 0);
  const span = Math.max(12, hi - lo + 1);
  return (
    <>
      {notes.map((n, i) => (
        <rect
          key={n.id}
          x={n.startOffset * barW}
          y={4 + (1 - (pitches[i] - lo + 1) / span) * (ROW_H - 10)}
          width={Math.max(2, durationToBars(n.duration) * barW)}
          height={3}
          rx={1}
          fill={color}
        />
      ))}
    </>
  );
};

export const TakesDialog: React.FC<{ clipId: string; onClose: () => void }> = ({ clipId, onClose }) => {
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const [drag, setDrag] = useState<{ take: number; from: number; to: number } | null>(null);
  const svgs = useRef<Array<SVGSVGElement | null>>([]);
  if (!clip?.takes?.length) {
    return (
      <Modal title="Takes" onClose={onClose}>
        <p className="p-4 text-sm text-forge-muted">This clip has no takes left.</p>
      </Modal>
    );
  }
  const takes = clip.takes;
  const segs = compSegments(clip);
  const ends = segs.map((_, i) => (i + 1 < segs.length ? segs[i + 1].at : clip.lengthBars));
  const barW = WIDTH / clip.lengthBars;
  const store = () => useTimelineStore.getState();
  const snap = (at: number, fine: boolean) => {
    const step = fine ? 1 / 16 : 1 / 4;
    return Math.max(0, Math.min(clip.lengthBars, Math.round(at / step) * step));
  };

  const onRowDown = (e: React.PointerEvent, take: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const svg = svgs.current[take];
    if (!svg) return;
    const atOf = (ev: { clientX: number; shiftKey: boolean }) => snap((ev.clientX - svg.getBoundingClientRect().left) / barW, ev.shiftKey);
    const from = atOf(e);
    let current = { take, from, to: from };
    setDrag(current);
    const onMove = (ev: PointerEvent) => {
      current = { take, from, to: atOf(ev) };
      setDrag(current);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      let { from: a, to: b } = current;
      // A click: the beat it's on
      if (Math.abs(b - a) < 1e-6) {
        a = Math.floor(a * 4) / 4;
        b = Math.min(clip.lengthBars, a + 1 / 4);
      }
      store().setTakeComp(clip.id, a, b, take);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <Modal title={`Takes: ${clip.name}`} onClose={onClose} wide>
      <div className="p-4 flex flex-col gap-3 text-xs text-forge-muted overflow-auto">
        <p className="leading-snug">
          The lit part of each take is what plays. Drag along a take to use it there (it snaps to beats; hold Shift for 16ths), or click
          its name to use it all the way through. Each change is one undo step.
        </p>
        <div className="flex flex-col gap-1">
          {takes.map((take, i) => {
            const color = COLORS[i % COLORS.length];
            const used = segs.map((s, k) => ({ s, end: ends[k] })).filter(({ s }) => s.take === i);
            return (
              <div key={take.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => store().setTakeComp(clip.id, 0, clip.lengthBars, i)}
                  className="w-20 shrink-0 h-8 rounded border border-forge-border text-left px-2 font-mono text-[11px] text-forge-text hover:border-cyan-500/70 truncate"
                  title={`Use ${take.name} all the way through`}
                  style={{ borderLeft: `3px solid ${color}` }}
                >
                  {take.name}
                </button>
                <svg
                  ref={(el) => {
                    svgs.current[i] = el;
                  }}
                  width={WIDTH}
                  height={ROW_H}
                  className="shrink-0 rounded bg-black/40 cursor-crosshair"
                  onPointerDown={(e) => onRowDown(e, i)}
                  aria-label={`${take.name}: drag to use it there`}
                >
                  {used.map(({ s, end }) => (
                    <rect key={s.at} x={s.at * barW} y={0} width={(end - s.at) * barW} height={ROW_H} fill={color} opacity={0.18} />
                  ))}
                  {Array.from({ length: Math.ceil(clip.lengthBars * 4) + 1 }, (_, b) => (
                    <line key={b} x1={b * barW / 4} x2={b * barW / 4} y1={0} y2={ROW_H} stroke={b % 4 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.14)'} />
                  ))}
                  <TakeContent clip={clip} take={take} color={color} width={WIDTH} />
                  {/* What doesn't play is shaded */}
                  {segs.map((sg, k) =>
                    sg.take === i ? null : <rect key={`d${sg.at}`} x={sg.at * barW} y={0} width={(ends[k] - sg.at) * barW} height={ROW_H} fill="#0c0c0e" opacity={0.6} />
                  )}
                  {used.map(({ s, end }) => (
                    <rect key={`o${s.at}`} x={s.at * barW + 0.5} y={0.5} width={(end - s.at) * barW - 1} height={ROW_H - 1} fill="none" stroke={color} rx={2} />
                  ))}
                  {drag?.take === i && (
                    <rect
                      x={Math.min(drag.from, drag.to) * barW}
                      y={0}
                      width={Math.max(2, Math.abs(drag.to - drag.from) * barW)}
                      height={ROW_H}
                      fill="white"
                      opacity={0.2}
                    />
                  )}
                </svg>
                <button
                  type="button"
                  onClick={() => store().deleteTake(clip.id, i)}
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded border border-forge-border hover:border-red-400 hover:text-red-300"
                  title={`Delete ${take.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="sr-only">Delete {take.name}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span>
            {takes.length} takes, comped from {segs.length} {segs.length === 1 ? 'part' : 'parts'}
          </span>
          <button
            type="button"
            onClick={() => {
              store().flattenClipTakes(clip.id);
              onClose();
            }}
            className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border text-forge-text hover:border-cyan-500/70"
            title={clip.audio && segs.length > 1 ? 'Keep only the take the comp starts with (a sound comped from several takes can only be kept as a folder)' : 'Keep what the comp plays as a plain clip; the other takes go'}
          >
            <Layers className="w-3.5 h-3.5" />
            Flatten
          </button>
        </div>
      </div>
    </Modal>
  );
};
