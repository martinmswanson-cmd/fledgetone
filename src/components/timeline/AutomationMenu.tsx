import React, { useRef } from 'react';
import { Eraser, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { AutomationParam } from '../../store/timelineTypes';
import { formatBarCount } from '../../store/timelineTypes';
import { AUTOMATION, laneOf, rampPoints } from '../../audio/automation';
import { MenuItem } from './ClipContextMenu';
import type { MenuItemProps } from './ClipContextMenu';
import { menuClass, useKeepOnScreen, useMenuDismiss } from './menuHooks';

export interface AutomationMenuState {
  x: number;
  y: number;
  trackId: string;
  param: AutomationParam;
}

/** Right-click menu of an automation lane: quick ramps over the loop region, clearing and removing the lane. */
export const AutomationMenu: React.FC<{ menu: AutomationMenuState; onClose: () => void }> = ({ menu, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(ref, onClose);
  useKeepOnScreen(ref, menu.x, menu.y);
  const inBar = useTimelineStore((s) => s.loopRegion.inBar);
  const outBar = useTimelineStore((s) => s.loopRegion.outBar);
  const selected = useTimelineStore((s) =>
    s.automationSelection?.trackId === menu.trackId && s.automationSelection.param === menu.param ? s.automationSelection.points.size : 0
  );

  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.id === menu.trackId);
  if (!track) return null;
  const spec = AUTOMATION[menu.param];
  const points = laneOf(track, menu.param)?.points ?? [];
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  // Ramps run between the setting's usual extremes (for Volume: silence and the fader's level)
  const [low, high] = spec.rampRange(track).map(spec.toNorm);
  const ramp = (from: number, to: number) => run(() => s.setAutomationPoints(track.id, menu.param, rampPoints(points, inBar, outBar, from, to), true));
  const span = `bars ${formatBarCount(inBar)}–${formatBarCount(outBar)}`;

  const items: Array<MenuItemProps & { key: string }> = [
    { key: 'up', label: 'Ramp up In → Out', shortcut: span, icon: <TrendingUp className="w-3.5 h-3.5" />, onClick: ramp(low, high) },
    { key: 'down', label: 'Ramp down In → Out', shortcut: span, icon: <TrendingDown className="w-3.5 h-3.5" />, onClick: ramp(high, low) },
    {
      key: 'delete',
      label: 'Delete selected points',
      shortcut: selected ? `${selected} · Del` : 'Del',
      icon: <X className="w-3.5 h-3.5" />,
      onClick: run(() => s.deleteSelectedAutomationPoints()),
      disabled: selected === 0,
      divider: true,
    },
    {
      key: 'clear',
      label: 'Clear lane',
      shortcut: `${points.length} pt${points.length === 1 ? '' : 's'}`,
      icon: <Eraser className="w-3.5 h-3.5" />,
      onClick: run(() => s.setAutomationPoints(track.id, menu.param, [], true)),
      disabled: points.length === 0,
    },
    {
      key: 'remove',
      label: 'Remove lane',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: run(() => {
        s.removeAutomationLane(track.id, menu.param);
        s.showAutomation(track.id, false);
      }),
    },
  ];

  return (
    <div ref={ref} role="menu" aria-label={`${spec.label} automation`} className={menuClass} onContextMenu={(e) => e.preventDefault()}>
      <div className="px-3 pt-1 pb-1.5 text-[10px] text-forge-muted truncate">
        {track.name} · {spec.label}
      </div>
      {items.map(({ key, ...item }) => (
        <MenuItem key={key} {...item} />
      ))}
    </div>
  );
};
