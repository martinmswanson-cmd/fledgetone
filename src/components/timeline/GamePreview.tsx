import React, { useEffect, useRef, useState } from 'react';
import { Gamepad2, GripHorizontal, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { getAudiblePositionBar } from '../../audio/transport';

/**
 * Hear the music the way a game will play it: each section (between markers) is a state the game
 * can be in, and a button moves to it on the next bar (or beat), looping there, the way adaptive
 * music switches; layers (tracks) come and go with their switches, or with the Intensity slider,
 * which brings tracks in from the top of the list down. Nothing here is an undo step: it's a
 * rehearsal, though the mutes and the loop it leaves stay as they are.
 */

type Quantize = 'bar' | 'beat' | 'now';

export const GamePreview: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const markers = useTimelineStore((s) => s.markers);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const loop = useTimelineStore((s) => s.loopRegion);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const [quantize, setQuantize] = useState<Quantize>('bar');
  const [pending, setPending] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(() => tracks.filter((t) => !t.isMuted).length);
  const timer = useRef<number>(0);
  const [pos, setPos] = useState({ left: 16, bottom: 16 });
  useEffect(() => () => clearTimeout(timer.current), []);

  const songEnd = Math.max(2, ...clips.map((c) => c.startBar + c.lengthBars));
  const sorted = [...markers].sort((a, b) => a.bar - b.bar);
  const sections = sorted
    .map((m, i) => ({ id: m.id, name: m.name, from: m.bar, to: sorted[i + 1]?.bar ?? songEnd }))
    .filter((sec) => sec.to - sec.from > 1e-6);

  const goTo = (sec: (typeof sections)[number]) => {
    const s = useTimelineStore.getState();
    clearTimeout(timer.current);
    const jump = () => {
      const st = useTimelineStore.getState();
      st.setLoopRange(sec.from, sec.to);
      if (!st.loopRegion.enabled) st.toggleLoop();
      st.seek(sec.from);
      setPending(null);
    };
    if (!s.isPlaying || quantize === 'now') {
      jump();
      if (!s.isPlaying) void s.togglePlay();
      return;
    }
    // On the next bar or beat line of the song
    const at = getAudiblePositionBar();
    const unit = quantize === 'bar' ? 1 : 0.25;
    const next = Math.floor((at - 1) / unit + 1e-6) * unit + unit + 1;
    const ms = ((next - at) * 240 * 1000) / s.bpm;
    setPending(sec.id);
    // Make the jump land on the line: the loop wraps there if the line is the loop's end
    timer.current = window.setTimeout(jump, Math.max(0, ms - 15));
  };

  const applyIntensity = (n: number) => {
    setIntensity(n);
    const s = useTimelineStore.getState();
    s.tracks.forEach((t, i) => s.setTrackMuted(t.id, i >= n));
  };

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const p0 = pos;
    const move = (ev: PointerEvent) => setPos({ left: Math.max(0, p0.left + ev.clientX - x0), bottom: Math.max(0, p0.bottom - (ev.clientY - y0)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const current = sections.find((sec) => Math.abs(sec.from - loop.inBar) < 1e-6 && Math.abs(sec.to - loop.outBar) < 1e-6 && loop.enabled);

  return (
    <div className="fixed z-40 w-80 rounded-lg border border-forge-borderLight bg-forge-panel shadow-2xl text-xs" style={{ left: pos.left, bottom: pos.bottom }} role="region" aria-label="Game preview">
      <div className="flex items-center gap-1.5 px-2 h-8 border-b border-forge-border cursor-move select-none text-forge-text" onPointerDown={startDrag}>
        <GripHorizontal className="w-3.5 h-3.5 text-forge-muted" />
        <Gamepad2 className="w-4 h-4 text-emerald-400" />
        <span className="font-semibold">Game preview</span>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} className="ml-auto text-forge-muted hover:text-forge-text" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono text-forge-muted uppercase">
            <span>States (sections)</span>
            <select className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text" value={quantize} onChange={(e) => setQuantize(e.target.value as Quantize)} aria-label="Switch timing">
              <option value="bar">on the next bar</option>
              <option value="beat">on the next beat</option>
              <option value="now">at once</option>
            </select>
          </div>
          {sections.length === 0 ? (
            <p className="text-forge-muted">Add markers (M) where your sections start: each section becomes a state to switch to.</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => goTo(sec)}
                  className={`h-9 rounded-md border px-2 text-left truncate font-semibold transition ${
                    pending === sec.id ? 'border-amber-400 bg-amber-500/20 text-amber-100 animate-pulse' : current?.id === sec.id ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100' : 'border-forge-border text-forge-text hover:border-emerald-400/60'
                  }`}
                  title={`Bars ${sec.from} to ${sec.to}: play and loop here`}
                >
                  {sec.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted uppercase">
            Intensity
            <input type="range" min={1} max={Math.max(1, tracks.length)} step={1} value={Math.min(intensity, tracks.length)} onChange={(e) => applyIntensity(Number(e.target.value))} className="flex-1 accent-emerald-400" aria-label="Intensity" />
            <span className="w-10 text-right text-forge-text tabular-nums">{Math.min(intensity, tracks.length)}/{tracks.length}</span>
          </label>
          <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
            {tracks.map((t) => (
              <label key={t.id} className="flex items-center gap-2 cursor-pointer text-forge-text">
                <input type="checkbox" checked={!t.isMuted} onChange={(e) => useTimelineStore.getState().setTrackMuted(t.id, !e.target.checked)} className="accent-emerald-400" />
                <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-forge-muted">{isPlaying ? 'Switch states while it plays, the way the game will.' : 'Pick a state to start.'} Intensity brings layers in from the top track down.</p>
      </div>
    </div>
  );
};
