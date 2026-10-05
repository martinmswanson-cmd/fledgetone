import React, { useEffect, useRef } from 'react';
import { ClipboardPaste, Copy, CopyPlus, Piano, Plus, Scissors, Trash2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { patternsFor } from '../../store/demoSong';

export interface ContextMenuState {
  x: number;
  y: number;
  /** Snapped bar under the pointer; used by "Paste here". */
  bar: number;
  /** Track (lane) under the pointer. */
  trackId: string;
  /** Set when the menu was opened on a clip. */
  clipId: string | null;
}

interface ClipContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onDuplicate: () => void;
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Right-click menu for clips (Edit / Copy / Cut / Duplicate / Delete) and empty lane space (New clip, Insert pattern, Paste). Also opened by a track header's + button. */
export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({ menu, onClose, onDuplicate }) => {
  const ref = useRef<HTMLDivElement>(null);
  const hasClipboard = useTimelineStore((s) => s.clipboard.length > 0);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.id === menu.trackId);
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  type Item = { label: string; shortcut: string; icon: React.ReactNode; action: () => void; disabled?: boolean; divider?: boolean };
  const newClip = (bars: number): Item => ({
    label: `New empty clip (${bars} bar${bars === 1 ? '' : 's'})`,
    shortcut: bars === 1 ? 'dbl-click' : '',
    icon: <Piano className="w-3.5 h-3.5" />,
    action: () => {
      const id = track && s.createEmptyClip(track.id, menu.bar, bars);
      if (id) s.openEditor(id);
    },
  });

  const items: Item[] = menu.clipId
    ? [
        { label: 'Edit notes', shortcut: 'dbl-click', icon: <Piano className="w-3.5 h-3.5" />, action: () => s.openEditor(menu.clipId!) },
        { label: 'Copy', shortcut: `${MOD}C`, icon: <Copy className="w-3.5 h-3.5" />, action: s.copySelectedClips, divider: true },
        { label: 'Cut', shortcut: `${MOD}X`, icon: <Scissors className="w-3.5 h-3.5" />, action: s.cutSelectedClips },
        { label: 'Duplicate', shortcut: `${MOD}D`, icon: <CopyPlus className="w-3.5 h-3.5" />, action: onDuplicate },
        {
          label: 'Paste here',
          shortcut: '',
          icon: <ClipboardPaste className="w-3.5 h-3.5" />,
          action: () => s.pasteClips(menu.bar),
          disabled: !hasClipboard,
        },
        { label: 'Delete', shortcut: 'Del', icon: <Trash2 className="w-3.5 h-3.5" />, action: s.deleteSelectedClips, divider: true },
      ]
    : [
        ...(track ? [newClip(1), newClip(2), newClip(4)] : []),
        ...(track
          ? patternsFor(track.instrumentKey).map((p, i) => ({
              label: `Insert ${p.name}`,
              shortcut: `${p.lengthBars} bars`,
              icon: <Plus className="w-3.5 h-3.5" />,
              action: () => s.insertPatternClip(track.id, p.id, menu.bar),
              divider: i === 0,
            }))
          : []),
        {
          label: 'Paste here',
          shortcut: '',
          icon: <ClipboardPaste className="w-3.5 h-3.5" />,
          action: () => s.pasteClips(menu.bar),
          disabled: !hasClipboard,
          divider: true,
        },
        {
          label: 'Paste at playhead',
          shortcut: `${MOD}V`,
          icon: <ClipboardPaste className="w-3.5 h-3.5" />,
          action: () => s.pasteClips(),
          disabled: !hasClipboard,
        },
      ];

  // Keep the menu on-screen near the right/bottom edges
  const left = Math.min(menu.x, window.innerWidth - 250);
  const top = Math.min(menu.y, window.innerHeight - items.length * 30 - 12);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-60 py-1 rounded-md border border-forge-borderLight bg-forge-panelLight shadow-2xl text-xs font-mono"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <React.Fragment key={item.label}>
        {item.divider && <div className="my-1 border-t border-forge-border" role="separator" />}
        <button
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={run(item.action)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-forge-text hover:bg-cyan-500/20 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          <span className="text-forge-muted text-[10px]">{item.shortcut}</span>
        </button>
        </React.Fragment>
      ))}
    </div>
  );
};
