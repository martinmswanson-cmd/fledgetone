import React, { useRef, useState } from 'react';
import { ArrowLeftToLine, ArrowRightFromLine, Flag, KeyRound, Zap } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { barToSeconds, formatBarsBeats, formatRulerTime } from '../../audio/transport';
import { formatBarCount } from '../../store/timelineTypes';
import { MenuItem, MenuNotice } from './ClipContextMenu';
import { menuClass, useKeepOnScreen, useMenuDismiss } from './menuHooks';
import type { MenuItemProps } from './ClipContextMenu';

export interface RulerMenuState {
  x: number;
  y: number;
  /** Bar under the pointer, snapped unless Shift was held. */
  bar: number;
}

const INSERT_SIZES = [1, 2, 4, 8];
/** Key changes offered: the classic final-chorus lifts, and a step down. */
const KEY_CHANGES: ReadonlyArray<[semitones: number, label: string]> = [
  [1, 'Key change here: up a semitone'],
  [2, 'Key change here: up a whole step'],
  [-1, 'Key change here: down a semitone'],
];

/**
 * Right-click menu for the time ruler: a marker at the clicked place, and edits that add or remove
 * time across every track at once (later clips, markers, the loop and the playhead move with the music).
 */
export const RulerContextMenu: React.FC<{ menu: RulerMenuState; onClose: () => void }> = ({ menu, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useMenuDismiss(ref, onClose);
  useKeepOnScreen(ref, menu.x, menu.y);

  const s = useTimelineStore.getState();
  // Live, in case I / O move the loop while the menu is open
  const inBar = useTimelineStore((st) => st.loopRegion.inBar);
  const outBar = useTimelineStore((st) => st.loopRegion.outBar);
  // Where the menu was opened, in the ruler's own units
  const at = useTimelineStore((st) =>
    st.rulerUnits === 'timecode' ? formatRulerTime(barToSeconds(menu.bar, st.bpm), st.fps, st.dropFrame) : formatBarsBeats(menu.bar)
  );
  const run = (action: () => string | null) => () => {
    const message = action();
    if (message) setNotice(message);
    else onClose();
  };

  const items: Array<MenuItemProps & { key: string }> = [
    {
      key: 'marker',
      label: 'Add marker here',
      icon: <Flag className="w-3.5 h-3.5" />,
      onClick: run(() => s.addMarker(menu.bar)),
    },
    {
      key: 'drop',
      label: 'Build-up & drop here',
      shortcut: `bar ${Math.round(menu.bar)}`,
      icon: <Zap className="w-3.5 h-3.5" />,
      onClick: run(() => s.addBuildAndDrop(menu.bar)),
    },
    ...KEY_CHANGES.map(([semitones, label], i) => ({
      key: `key${semitones}`,
      label,
      shortcut: i === 0 ? 'to the end' : undefined,
      icon: <KeyRound className="w-3.5 h-3.5" />,
      onClick: run(() => s.keyChangeFrom(menu.bar, semitones)),
      divider: i === 0,
    })),
    ...INSERT_SIZES.map((n, i) => ({
      key: `insert-${n}`,
      label: `Insert ${n} bar${n === 1 ? '' : 's'} here`,
      icon: <ArrowRightFromLine className="w-3.5 h-3.5" />,
      onClick: run(() => s.insertBars(menu.bar, n)),
      divider: i === 0,
    })),
    {
      key: 'delete',
      label: 'Delete bars In → Out',
      shortcut: `${formatBarCount(outBar - inBar)} bar${outBar - inBar === 1 ? '' : 's'}`,
      icon: <ArrowLeftToLine className="w-3.5 h-3.5" />,
      onClick: run(() => s.removeBars(inBar, outBar)),
      divider: true,
    },
  ];

  return (
    <div ref={ref} role="menu" aria-label="Ruler" className={menuClass} onContextMenu={(e) => e.preventDefault()}>
      <div className="px-3 pt-1 pb-1.5 text-[10px] text-forge-muted tabular-nums">At {at} · all tracks</div>
      {items.map(({ key, ...item }) => (
        <MenuItem key={key} {...item} />
      ))}
      <MenuNotice text={notice} />
    </div>
  );
};
