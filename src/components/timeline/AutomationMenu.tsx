/**
 * The right-click menu of an automation lane: quick ramps over the loop region, clear, remove the
 * lane.
 */
import React, { useRef } from 'react';
import { Eraser, Minus, Spline, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { AutomationParam } from '../../store/timelineTypes';
import { formatBarRange } from '../../store/timelineTypes';
import { specOf, laneOf, rampPoints } from '../../audio/automation';
import { MenuItem } from './ClipContextMenu';
import type { MenuItemProps } from './ClipContextMenu';
import { menuClass, useKeepOnScreen, useMenuDismiss } from './menuHooks';

export interface AutomationMenuState {
  x: number;
  y: number;
  trackId: string;
  param: AutomationParam;
  /** Where on the lane it was opened */
  bar?: number;
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
  const spec = specOf(menu.param, track, s.tracks);
  const points = laneOf(track, menu.param)?.points ?? [];
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  // Ramps run between the setting's usual extremes (for Volume: silence and the fader's level)
  const [low, high] = spec.rampRange(track).map(spec.toNorm);
  const ramp = (from: number, to: number) => run(() => s.setAutomationPoints(track.id, menu.param, rampPoints(points, inBar, outBar, from, to), true));
  const span = formatBarRange(inBar, outBar);
  // The line under the pointer, between two points: it can be bent
  const after = menu.bar === undefined ? -1 : points.findIndex((p) => p.bar > menu.bar!);
  const left = after > 0 && points[after - 1].value !== points[after].value ? after - 1 : -1;
  const bendTo = (curve: number) =>
    run(() => {
      const a = points[left];
      s.setAutomationPoints(track.id, menu.param, points.map((p, i) => (i === left ? (curve ? { ...a, curve } : { bar: a.bar, value: a.value }) : p)), true);
    });
  const current = left >= 0 ? points[left].curve ?? 0 : 0;
  const bends: Array<MenuItemProps & { key: string }> =
    left < 0
      ? []
      : [
          { key: 'slow', label: 'Bend: slow start', icon: <Spline className="w-3.5 h-3.5" />, onClick: bendTo(0.6), disabled: current === 0.6, divider: true },
          { key: 'fast', label: 'Bend: fast start', icon: <Spline className="w-3.5 h-3.5 -scale-x-100" />, onClick: bendTo(-0.6), disabled: current === -0.6 },
          { key: 'straight', label: 'Straighten line', shortcut: 'Alt-drag', icon: <Minus className="w-3.5 h-3.5" />, onClick: bendTo(0), disabled: current === 0 },
        ];

  const items: Array<MenuItemProps & { key: string }> = [
    { key: 'up', label: 'Ramp up In → Out', shortcut: span, icon: <TrendingUp className="w-3.5 h-3.5" />, onClick: ramp(low, high) },
    { key: 'down', label: 'Ramp down In → Out', shortcut: span, icon: <TrendingDown className="w-3.5 h-3.5" />, onClick: ramp(high, low) },
    ...bends,
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
    <div
      ref={ref}
      role="menu"
      aria-label={`${spec.label} automation`}
      data-automation-menu=""
      className={menuClass}
      // The menu sits inside the track's lane: its clicks mustn't also start a marquee or clear
      // the clip selection there, open the lane's clip menu, or add a clip
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 pt-1 pb-1.5 text-[10px] text-forge-muted truncate">
        {track.name} · {spec.label}
      </div>
      {items.map(({ key, ...item }) => (
        <MenuItem key={key} {...item} />
      ))}
    </div>
  );
};
