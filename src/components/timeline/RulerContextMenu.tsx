/**
 * The ruler's right-click menu: add a marker, tempo or time-signature change there, insert or
 * delete bars across every track, key changes, and speeding up into a drop (on the loop or the
 * selected clips there).
 */
import React, { useRef, useState } from 'react';
import { CircleDot, ArrowLeftToLine, ArrowRightFromLine, ChevronsRight, Flag, Gauge, KeyRound, Music2, Scissors, TrendingUp, Zap } from 'lucide-react';
import { meterAt, tempoAt } from '../../audio/tempoMap';
import { useUiStore } from '../../store/uiStore';
import { songMeterOf, songTempo, useTimelineStore } from '../../store/timelineStore';
import { barToSeconds, formatBarsBeats, formatRulerTime } from '../../audio/transport';
import { formatBarCount } from '../../store/timelineTypes';
import { MenuItem, MenuNotice } from './ClipContextMenu';
import { openArrange } from './arrangeDialogStore';
import { suggestBlock } from '../../store/speedUpActions';
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
    st.rulerUnits === 'timecode' ? formatRulerTime(barToSeconds(menu.bar, songTempo(st)), st.fps, st.dropFrame) : formatBarsBeats(menu.bar)
  );
  // Speed up into here: the loop or the selected clips under the pointer, else the 4 bars before it
  const speedBlock = suggestBlock(menu.bar);
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
      key: 'tempo',
      label: 'Tempo change here',
      icon: <Gauge className="w-3.5 h-3.5" />,
      onClick: run(() => {
        if (menu.bar <= 1) return 'Bar 1 has the song\'s own tempo: click the tempo flag at the start of the ruler (or the BPM box) to change it.';
        s.addTempoChange(menu.bar, tempoAt(menu.bar, songTempo(s)));
        return null;
      }),
      divider: true,
    },
    {
      key: 'glide',
      label: 'Tempo glide to here',
      icon: <TrendingUp className="w-3.5 h-3.5" />,
      onClick: run(() => {
        if (menu.bar <= 1) return 'A glide needs somewhere to start from: pick a later place.';
        s.addTempoChange(menu.bar, tempoAt(menu.bar, songTempo(s)), true);
        return null;
      }),
    },
    {
      key: 'meter',
      label: 'Time signature change here',
      shortcut: 'nearest measure',
      icon: <Music2 className="w-3.5 h-3.5" />,
      onClick: run(() => {
        const current = meterAt(menu.bar, songMeterOf(s));
        s.addMeterChange(menu.bar, current.num === 4 && current.den === 4 ? { num: 3, den: 4 } : { num: 4, den: 4 });
        return null;
      }),
    },
    {
      key: 'punch-in',
      divider: true,
      label: 'Punch in here',
      shortcut: 'recording',
      icon: <CircleDot className="w-3.5 h-3.5" />,
      onClick: run(() => {
        const p = s.punch;
        s.setPunch({ enabled: true, inBar: menu.bar, outBar: p.outBar > menu.bar ? p.outBar : menu.bar + 1 });
        return null;
      }),
    },
    {
      key: 'punch-out',
      label: 'Punch out here',
      icon: <CircleDot className="w-3.5 h-3.5" />,
      onClick: run(() => {
        const p = s.punch;
        s.setPunch({ enabled: true, outBar: menu.bar, inBar: p.inBar < menu.bar ? p.inBar : Math.max(1, menu.bar - 1) });
        return null;
      }),
    },
    {
      key: 'drop',
      divider: true,
      label: 'Build-up & drop here',
      shortcut: `bar ${Math.round(menu.bar)}`,
      icon: <Zap className="w-3.5 h-3.5" />,
      onClick: run(() => s.addBuildAndDrop(menu.bar)),
    },
    {
      key: 'arrange',
      label: 'Drop, stop or beat switch here…',
      shortcut: 'arrange',
      icon: <Zap className="w-3.5 h-3.5" />,
      onClick: () => {
        onClose();
        openArrange('drops', Math.round(menu.bar));
      },
    },
    {
      key: 'speed-up',
      label: 'Speed up into here…',
      shortcut: speedBlock.source === 'loop' ? 'the loop' : speedBlock.source === 'clips' ? 'selected clips' : `bars ${speedBlock.from}–${speedBlock.to}`,
      icon: <ChevronsRight className="w-3.5 h-3.5" />,
      onClick: () => {
        onClose();
        openArrange('drops', Math.round(speedBlock.to), undefined, { from: speedBlock.from, to: speedBlock.to });
      },
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
    {
      key: 'cut',
      label: 'Cut song to length…',
      shortcut: '15 / 30 / 60 s',
      icon: <Scissors className="w-3.5 h-3.5" />,
      onClick: () => {
        onClose();
        useUiStore.getState().setDialog('cut');
      },
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
