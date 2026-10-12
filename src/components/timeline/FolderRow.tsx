import React, { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, X } from 'lucide-react';
import { TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import type { Track, TrackFolder } from '../../store/timelineTypes';
import { TRACK_COLORS } from '../../store/timelineTypes';
import { HEADER_WIDTH } from './layout';
import { FOLDER_ROW_HEIGHT } from './rows';
import { useMenuDismiss } from './menuHooks';

/**
 * A folder's row in the timeline: fold it away, rename and recolour it, mute or solo all its
 * tracks, or ungroup it. The lane shows its tracks' clips in miniature, so a folded folder still
 * shows where its music is.
 */
export const FolderRow: React.FC<{ folder: TrackFolder; members: Track[] }> = ({ folder, members }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const clips = useTimelineStore((s) => s.clips);
  const [renaming, setRenaming] = useState(false);
  const [colors, setColors] = useState(false);
  const s = useTimelineStore.getState();
  const allMuted = members.every((t) => t.isMuted);
  const allSoloed = members.every((t) => t.isSoloed);
  const ids = new Map(members.map((t, i) => [t.id, i]));
  const lineH = Math.max(2, Math.min(6, Math.floor((FOLDER_ROW_HEIGHT - 8) / Math.max(1, members.length))));

  return (
    <div className="flex border-b border-forge-border" style={{ height: FOLDER_ROW_HEIGHT }} data-folder={folder.id} aria-label={`Folder ${folder.name}`}>
      <div
        className="sticky left-0 z-20 shrink-0 flex items-center gap-1 px-1.5 bg-forge-panelLight border-r border-forge-border text-[11px]"
        style={{ width: HEADER_WIDTH, boxShadow: `inset 3px 0 0 ${folder.color}` }}
      >
        <button
          type="button"
          onClick={() => s.setFolder(folder.id, { collapsed: !folder.collapsed })}
          className="w-5 h-5 flex items-center justify-center text-forge-muted hover:text-forge-text"
          title={folder.collapsed ? 'Unfold: show its tracks' : 'Fold: hide its tracks (they still play)'}
          aria-label={folder.collapsed ? `Unfold ${folder.name}` : `Fold ${folder.name}`}
          aria-expanded={!folder.collapsed}
        >
          {folder.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <div className="relative">
          <button type="button" onClick={() => setColors((v) => !v)} title="Folder colour" aria-label={`${folder.name} colour`} className="flex items-center">
            {folder.collapsed ? <Folder className="w-3.5 h-3.5" style={{ color: folder.color }} /> : <FolderOpen className="w-3.5 h-3.5" style={{ color: folder.color }} />}
          </button>
          {colors && <ColorPicker current={folder.color} onPick={(c) => s.setFolder(folder.id, { color: c }, true)} onClose={() => setColors(false)} note="Colours its tracks too" />}
        </div>
        {renaming ? (
          <input
            autoFocus
            defaultValue={folder.name}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              if (name && name !== folder.name) s.setFolder(folder.id, { name });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="flex-1 min-w-0 h-6 bg-forge-bg border border-cyan-500 rounded px-1 text-forge-text focus:outline-none"
            aria-label="Folder name"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate font-semibold text-forge-text" onDoubleClick={() => setRenaming(true)} title={`${folder.name} (double-click to rename)`}>
            {folder.name}
          </span>
        )}
        <span className="text-[9px] font-mono text-forge-muted">{members.length}</span>
        <button
          type="button"
          onClick={() => s.toggleFolderMute(folder.id)}
          aria-pressed={allMuted}
          title={allMuted ? 'Unmute the folder' : 'Mute every track in the folder'}
          className={`w-5 h-5 rounded text-[9px] font-bold border ${allMuted ? 'bg-amber-500/30 border-amber-400 text-amber-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
        >
          M
        </button>
        <button
          type="button"
          onClick={() => s.toggleFolderSolo(folder.id)}
          aria-pressed={allSoloed}
          title={allSoloed ? 'Unsolo the folder' : 'Solo every track in the folder'}
          className={`w-5 h-5 rounded text-[9px] font-bold border ${allSoloed ? 'bg-emerald-500/30 border-emerald-400 text-emerald-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
        >
          S
        </button>
        <button type="button" onClick={() => s.ungroupFolder(folder.id)} title="Ungroup: take the tracks out of the folder" aria-label={`Ungroup ${folder.name}`} className="w-5 h-5 flex items-center justify-center text-forge-muted hover:text-red-300">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Its tracks' clips in miniature */}
      <div className="relative flex-1" style={{ width: TOTAL_BARS * zoom, background: `${folder.color}14` }} onDoubleClick={() => s.setFolder(folder.id, { collapsed: !folder.collapsed })} title="Double-click to fold or unfold">
        {clips.map((c) => {
          const row = ids.get(c.trackId);
          if (row === undefined) return null;
          const track = members[row];
          return (
            <div
              key={c.id}
              className="absolute rounded-[1px] pointer-events-none"
              style={{ left: (c.startBar - 1) * zoom, width: Math.max(2, c.lengthBars * zoom - 1), top: 4 + row * lineH, height: Math.max(1, lineH - 1), background: track.color, opacity: track.isMuted ? 0.3 : 0.85 }}
            />
          );
        })}
      </div>
    </div>
  );
};

/** A row of colour swatches in a small popover. */
export const ColorPicker: React.FC<{ current: string; onPick: (color: string) => void; onClose: () => void; note?: string }> = ({ current, onPick, onClose, note }) => {
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(ref, onClose);
  return (
    <div ref={ref} className="absolute z-50 top-6 left-0 p-2 rounded-md border border-forge-borderLight bg-forge-panelLight shadow-2xl w-44" role="dialog" aria-label="Colour" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-6 gap-1">
        {TRACK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              onPick(c);
              onClose();
            }}
            className={`w-5 h-5 rounded ${c === current ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/60'}`}
            style={{ background: c }}
            aria-label={`Colour ${c}`}
          />
        ))}
      </div>
      {note && <p className="mt-1.5 text-[10px] text-forge-muted">{note}</p>}
    </div>
  );
};
