/**
 * The Launcher tab: the clip launcher's grid (a column per track, a row per scene) with launch,
 * stop and drag-to-move. The logic is launcher.ts.
 */
import React, { useEffect, useState } from 'react';
import { Play, Square, Undo2, LayoutList, Send, ListPlus, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { isMixTrack } from '../../store/buses';
import { useLauncher, launcherActive, slotAt } from '../../store/launcherView';
import {
  backToArrangement,
  clearScene,
  clearSlot,
  launchScene,
  launchSlot,
  moveSlot,
  sceneCount,
  scenesFromSections,
  sendSelectionToLauncher,
  stopAllSlots,
  stopSlot,
  trackState,
  writeSessionToArrangement,
} from '../../store/launcher';
import { getAudiblePositionBar } from '../../audio/transport';
import { showToast } from './toastStore';

/** Where the music is, about 20 times a second while it plays (the playhead's bar while stopped). */
function useHeardBar(): number {
  const playing = useTimelineStore((s) => s.isPlaying);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const [bar, setBar] = useState(playhead);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setBar(getAudiblePositionBar()), 50);
    return () => window.clearInterval(id);
  }, [playing]);
  return playing ? bar : playhead;
}

const QUANTIZE: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.25, label: '1 beat' },
  { value: 0.5, label: '1/2 bar' },
  { value: 1, label: '1 bar' },
  { value: 2, label: '2 bars' },
  { value: 4, label: '4 bars' },
];

const btn = 'flex items-center gap-1 px-2 py-1 rounded border border-forge-border text-[11px] text-forge-text hover:bg-cyan-500/15 disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The clip launcher: a column per track, a row per scene. Click a clip to launch it (it starts on
 * the next bar line and loops), a scene's ▶ to launch the row, a ■ to stop a track. Drag a clip
 * to another slot to move it (Alt: copy).
 */
export const LauncherPanel: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const anySelected = useTimelineStore((s) => s.clips.some((c) => c.isSelected));
  const segments = useLauncher((s) => s.segments);
  const last = useLauncher((s) => s.last);
  const quantize = useLauncher((s) => s.quantize);
  const bar = useHeardBar();
  const [drag, setDrag] = useState<{ trackId: string; scene: number } | null>(null);
  const columns = tracks.filter((t) => !isMixTrack(t));
  const rows = sceneCount(columns);
  const active = launcherActive(segments);

  if (!columns.length) return <p className="p-3 text-xs text-forge-muted">Add a track first: each track is a column of the launcher.</p>;

  const sceneName = (scene: number) => columns.map((t) => slotAt(t, scene)?.clip.name).find(Boolean) ?? `Scene ${scene + 1}`;

  return (
    <div className="flex flex-col gap-2 p-2 text-xs" aria-label="Clip launcher">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={btn} onClick={() => stopAllSlots()} disabled={!active || !isPlaying} title="Stop every clip at the next bar line">
          <Square className="w-3 h-3" /> Stop all
        </button>
        <button type="button" className={btn} onClick={() => backToArrangement()} disabled={!active} title="Every track plays its arrangement again, from the next bar line">
          <Undo2 className="w-3 h-3" /> Back to arrangement
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            const r = writeSessionToArrangement();
            showToast(r ? `Wrote what you played into the arrangement, bars ${Math.round(r.from)} to ${Math.round(r.to * 4) / 4}` : 'Launch some clips first: what you play is what gets written');
          }}
          disabled={!active && !last}
          title="Write what you played in the launcher (from the first launch to where you stopped) into the arrangement"
        >
          <ListPlus className="w-3 h-3" /> Write to arrangement
        </button>
        <span className="mx-1 h-4 w-px bg-forge-border" />
        <button
          type="button"
          className={btn}
          onClick={() => {
            const n = scenesFromSections();
            showToast(n ? `Made ${n} scene${n === 1 ? '' : 's'} from the song's sections` : 'The song has no clips to make scenes from');
          }}
          title="Each section of the song (between its markers, else every 4 or 8 bars) becomes a scene, replacing what's in those rows"
        >
          <LayoutList className="w-3 h-3" /> Scenes from song
        </button>
        <button
          type="button"
          className={btn}
          disabled={!anySelected}
          onClick={() => {
            const n = sendSelectionToLauncher();
            showToast(n ? `Put the selected clips in ${n} slot${n === 1 ? '' : 's'}` : 'Select clips on the timeline first');
          }}
          title="The selected clips go into the launcher: each track's into its first empty slot"
        >
          <Send className="w-3 h-3" /> Send selected clips
        </button>
        <label className="ml-auto flex items-center gap-1 text-forge-muted" title="Launches land on the next multiple of this">
          Launch on
          <select
            value={quantize}
            onChange={(e) => useLauncher.setState({ quantize: Number(e.target.value) })}
            className="bg-forge-panel border border-forge-border rounded px-1 py-0.5 text-forge-text"
            aria-label="Launch quantize"
          >
            {QUANTIZE.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-auto">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-forge-bg text-left text-[10px] font-mono text-forge-muted px-1">SCENES</th>
              {columns.map((t) => {
                const st = trackState(t.id, bar);
                const taken = !!segments[t.id];
                return (
                  <th key={t.id} className="min-w-[112px] max-w-[140px] font-normal">
                    <div className="flex items-center gap-1 rounded px-1.5 py-1 bg-forge-panel border border-forge-border" title={taken ? `${t.name}: playing from the launcher` : `${t.name}: playing its arrangement`}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                      <span className="truncate flex-1 text-left text-forge-text">{t.name}</span>
                      {taken && <span className="text-[9px] font-mono text-cyan-300">{st.playing !== null ? 'LIVE' : 'OFF'}</span>}
                      <button type="button" onClick={() => stopSlot(t.id)} disabled={!isPlaying} className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30" aria-label={`Stop ${t.name}`} title="Stop this track at the next bar line">
                        <Square className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, scene) => {
              const used = columns.some((t) => slotAt(t, scene));
              return (
                <tr key={scene}>
                  <td className="sticky left-0 z-10 bg-forge-bg">
                    <div className="flex items-center gap-1 w-[120px]">
                      <button
                        type="button"
                        onClick={() => launchScene(scene)}
                        disabled={!used}
                        className="flex items-center gap-1 flex-1 min-w-0 px-1.5 py-1.5 rounded border border-forge-border hover:bg-cyan-500/15 disabled:opacity-30"
                        aria-label={`Launch scene ${scene + 1}`}
                        title="Launch this row: its clips play, the other launched tracks stop"
                      >
                        <Play className="w-3 h-3 shrink-0 text-cyan-300" />
                        <span className="truncate text-forge-text">{used ? sceneName(scene) : `Scene ${scene + 1}`}</span>
                      </button>
                      {used && (
                        <button type="button" onClick={() => clearScene(scene)} className="p-0.5 rounded text-forge-muted hover:text-forge-text" aria-label={`Empty scene ${scene + 1}`} title="Empty this row">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  {columns.map((t) => {
                    const slot = slotAt(t, scene);
                    const st = trackState(t.id, bar);
                    const playing = st.playing === scene;
                    const queued = st.queued?.kind === 'slot' && st.queued.scene === scene;
                    const leaving = playing && !!st.queued;
                    const dropProps = {
                      onDragOver: (e: React.DragEvent) => {
                        if (drag) e.preventDefault();
                      },
                      onDrop: (e: React.DragEvent) => {
                        e.preventDefault();
                        if (drag && !moveSlot(drag.trackId, drag.scene, t.id, scene, e.altKey)) showToast("That clip can't go there: audio clips go on Audio tracks, notes on instruments");
                        setDrag(null);
                      },
                    };
                    if (!slot) {
                      return (
                        <td key={t.id} {...dropProps}>
                          <button
                            type="button"
                            onClick={() => stopSlot(t.id)}
                            className="w-full h-8 rounded border border-dashed border-forge-border/60 text-forge-muted/50 hover:border-forge-border flex items-center justify-center"
                            aria-label={`Empty slot, ${t.name}, scene ${scene + 1}`}
                            title="Empty slot: click to stop this track. Drag a clip here to move it (Alt: copy)"
                          >
                            <Square className="w-2 h-2" />
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td key={t.id} {...dropProps}>
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'copyMove';
                            setDrag({ trackId: t.id, scene });
                          }}
                          onDragEnd={() => setDrag(null)}
                          className={`group relative h-8 rounded flex items-center gap-1 px-1.5 border ${playing ? 'border-emerald-300 shadow-[0_0_0_1px_rgba(110,231,183,0.6)]' : 'border-transparent'} ${queued || leaving ? 'animate-pulse' : ''}`}
                          style={{ background: `${t.color}${playing ? '66' : '33'}` }}
                        >
                          <button type="button" onClick={() => launchSlot(t.id, scene)} className="flex items-center gap-1 flex-1 min-w-0 text-left" aria-label={`Launch ${slot.clip.name} on ${t.name}`} title={`${slot.clip.name}: ${Math.round(slot.clip.lengthBars * 100) / 100} bars. Click to launch on the next ${quantize === 1 ? 'bar line' : 'launch point'}`}>
                            <Play className={`w-3 h-3 shrink-0 ${playing ? 'text-emerald-300' : 'text-forge-text'}`} />
                            <span className="truncate text-forge-text">{slot.clip.name}</span>
                          </button>
                          <button type="button" onClick={() => clearSlot(t.id, scene)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/30" aria-label={`Delete ${slot.clip.name} from the launcher`} title="Delete this slot">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
