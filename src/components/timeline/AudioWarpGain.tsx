import React, { useRef } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, GainPoint, WarpMarker } from '../../store/timelineTypes';
import { ENVELOPE_DB_MAX, ENVELOPE_DB_MIN } from '../../store/timelineTypes';
import { beatAt, clipSecondsAt, sourceAt, WARP_MIN_GAP } from '../../store/warp';
import { envelopeDbAt } from '../../store/audioClips';

export type AudioTool = 'warp' | 'gain' | null;

/** How close (px) the pointer must be to grab a marker or a point. */
const GRAB_PX = 7;
/** A 16th note, in beats: where a dragged warp marker snaps (Shift: anywhere). */
const SNAP_BEATS = 0.25;

const dbToY = (db: number, h: number) => ((ENVELOPE_DB_MAX - Math.max(ENVELOPE_DB_MIN, Math.min(ENVELOPE_DB_MAX, db))) / (ENVELOPE_DB_MAX - ENVELOPE_DB_MIN)) * h;
const yToDb = (y: number, h: number) => Math.round((ENVELOPE_DB_MAX - (y / h) * (ENVELOPE_DB_MAX - ENVELOPE_DB_MIN)) * 2) / 2;

/**
 * Over the audio clip editor's waveform: its warp markers (amber lines) and its gain envelope
 * (a line with points), editable with the tool chosen. Warp: double-click to add a marker, drag
 * one to move that moment of the sound in time (it snaps to 16ths; Shift for anywhere),
 * right-click to remove it. Gain: click to add a point, drag one, right-click to remove it.
 */
export const AudioWarpGain: React.FC<{ clip: Clip; bpm: number; seconds: number; width: number; height: number; tool: AudioTool }> = ({ clip, bpm, seconds, width, height, tool }) => {
  const ref = useRef<SVGSVGElement>(null);
  const audio = clip.audio!;
  const xOfSrc = (src: number) => (clipSecondsAt(audio, src, bpm) / seconds) * width;
  const markers = audio.stretchBpm ? (audio.warp ?? []) : [];
  const envelope = audio.envelope ?? [];
  const store = () => useTimelineStore.getState();

  /** Pointer position over the drawing: x in its columns, y in px, and seconds into the clip. */
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return { x: fx * width, y: ((e.clientY - r.top) / r.height) * height, t: fx * seconds };
  };
  const near = (xs: number[], x: number) => {
    const r = ref.current!.getBoundingClientRect();
    const scale = r.width / width;
    let best = -1;
    let dist = GRAB_PX;
    xs.forEach((mx, i) => {
      const d = Math.abs(mx - x) * scale;
      if (d <= dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };

  /** Follow the pointer until it's let go. */
  const drag = (e: React.PointerEvent, move: (ev: PointerEvent) => void, checkpoint = true) => {
    e.preventDefault();
    e.stopPropagation();
    if (checkpoint) store().checkpoint();
    const onMove = (ev: PointerEvent) => move(ev);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ---------- Warp ----------
  /** The clip follows the tempo (as recorded, at the song's tempo) so that it can warp. */
  const ensureFollowing = () => {
    if (!audio.stretchBpm) store().setClipStretch(clip.id, bpm);
    return store().clips.find((c) => c.id === clip.id)!.audio!;
  };
  const setWarp = (warp: WarpMarker[], record: boolean) => store().setClipAudio(clip.id, { warp }, record);
  const onWarpDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = at(e);
    const i = near(markers.map((m) => xOfSrc(m.src)), p.x);
    if (i < 0) return;
    const startSongBeat = (clip.startBar - 1) * 4;
    const offsetBeat = beatAt(audio, audio.offset);
    drag(e, (ev) => {
      const q = at(ev);
      let beat = offsetBeat + (q.t * bpm) / 60;
      if (!ev.shiftKey) beat = offsetBeat + Math.round((startSongBeat + beat - offsetBeat) / SNAP_BEATS) * SNAP_BEATS - startSongBeat;
      // Never past the markers either side (that would fold the sound back on itself)
      const k = (audio.stretchBpm ?? 60) / 60;
      const lo = i > 0 ? markers[i - 1].beat + WARP_MIN_GAP * k * 2 : -Infinity;
      const hi = i < markers.length - 1 ? markers[i + 1].beat - WARP_MIN_GAP * k * 2 : Infinity;
      beat = Math.max(lo, Math.min(hi, beat));
      setWarp(markers.map((m, j) => (j === i ? { src: m.src, beat } : m)), false);
    });
  };
  const onWarpDouble = (e: React.MouseEvent) => {
    const p = at(e);
    if (near(markers.map((m) => xOfSrc(m.src)), p.x) >= 0) return;
    const now = ensureFollowing();
    const src = sourceAt(now, p.t, bpm);
    const warp = [...(now.warp ?? []), { src, beat: beatAt(now, src) }].sort((a, b) => a.src - b.src);
    setWarp(warp, true);
  };
  const onWarpMenu = (e: React.MouseEvent) => {
    const i = near(markers.map((m) => xOfSrc(m.src)), at(e).x);
    if (i < 0) return;
    e.preventDefault();
    setWarp(markers.filter((_, j) => j !== i), true);
  };

  // ---------- Gain ----------
  const setEnvelope = (points: GainPoint[], record: boolean) => store().setClipAudio(clip.id, { envelope: points }, record);
  const onGainDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = at(e);
    let i = near(envelope.map((g) => xOfSrc(g.src)), p.x);
    let points = envelope;
    if (i < 0) {
      // A new point where clicked, then dragged like any other
      const src = sourceAt(audio, p.t, bpm);
      points = [...envelope, { src, db: envelope.length ? envelopeDbAt(envelope, src) : yToDb(p.y, height) }].sort((a, b) => a.src - b.src);
      i = points.findIndex((g) => g.src === src);
      // Adding it and dragging it is one undo step
      store().checkpoint();
      setEnvelope(points, false);
    }
    const added = points !== envelope;
    const index = i;
    const base = points;
    drag(e, (ev) => {
      const q = at(ev);
      const lo = index > 0 ? base[index - 1].src : -Infinity;
      const hi = index < base.length - 1 ? base[index + 1].src : Infinity;
      const src = Math.max(lo, Math.min(hi, sourceAt(audio, q.t, bpm)));
      setEnvelope(base.map((g, j) => (j === index ? { src, db: yToDb(q.y, height) } : g)), false);
    }, !added);
  };
  const onGainMenu = (e: React.MouseEvent) => {
    const i = near(envelope.map((g) => xOfSrc(g.src)), at(e).x);
    if (i < 0) return;
    e.preventDefault();
    setEnvelope(envelope.filter((_, j) => j !== i), true);
  };

  // The envelope's line across the clip: through its points, held flat beyond them
  const line = envelope.length
    ? [`0,${dbToY(envelopeDbAt(envelope, audio.offset), height)}`, ...envelope.map((g) => `${xOfSrc(g.src)},${dbToY(g.db, height)}`), `${width},${dbToY(envelopeDbAt(envelope, sourceAt(audio, seconds, bpm)), height)}`].join(' ')
    : `0,${dbToY(0, height)} ${width},${dbToY(0, height)}`;

  return (
    <svg
      ref={ref}
      className={`absolute inset-0 w-full h-full ${tool ? (tool === 'warp' ? 'cursor-col-resize' : 'cursor-crosshair') : 'pointer-events-none'}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onPointerDown={tool === 'warp' ? onWarpDown : tool === 'gain' ? onGainDown : undefined}
      onDoubleClick={tool === 'warp' ? onWarpDouble : undefined}
      onContextMenu={tool === 'warp' ? onWarpMenu : tool === 'gain' ? onGainMenu : undefined}
      aria-label={tool === 'warp' ? 'Warp markers' : tool === 'gain' ? 'Gain envelope' : undefined}
    >
      {markers.map((m) => {
        const x = xOfSrc(m.src);
        if (x < -1 || x > width + 1) return null;
        return (
          <g key={`${m.src}`}>
            <line x1={x} x2={x} y1={0} y2={height} stroke="#f59e0b" strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={tool === 'warp' ? 1 : 0.55} />
            <rect x={x - 5} y={0} width={10} height={9} fill="#f59e0b" opacity={tool === 'warp' ? 1 : 0.55} />
          </g>
        );
      })}
      {(envelope.length > 0 || tool === 'gain') && (
        <polyline points={line} fill="none" stroke="#a3e635" strokeWidth={1.5} strokeDasharray={envelope.length ? undefined : '6 4'} vectorEffect="non-scaling-stroke" opacity={tool === 'gain' ? 1 : 0.6} />
      )}
      {tool === 'gain' &&
        envelope.map((g) => <ellipse key={g.src} cx={xOfSrc(g.src)} cy={dbToY(g.db, height)} rx={5} ry={4} fill="#a3e635" stroke="black" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
};
