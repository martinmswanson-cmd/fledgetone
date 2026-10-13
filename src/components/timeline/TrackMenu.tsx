/**
 * The right-click menu of a track header: colour, move, folders, buses, freeze / bounce, delete.
 */
import React, { useRef, useState } from 'react';
import { Plug, Radio, ArrowDown, ArrowUp, FolderMinus, FolderPlus, FolderInput, Palette, Route, Snowflake, Trash2, Waypoints, AudioLines } from 'lucide-react';
import { busTargets, isBus, isMixTrack, sendTargets } from '../../store/buses';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { TRACK_COLORS } from '../../store/timelineTypes';
import { foldersOf } from '../../store/folders';
import { MenuItem } from './ClipContextMenu';
import type { MenuItemProps } from './ClipContextMenu';
import { menuClass, useKeepOnScreen, useMenuDismiss } from './menuHooks';
import { bounceTrack, canFreeze, freezeTrack, unfreezeTrack } from '../../store/freezeActions';
import { showToast } from './toastStore';

/**
 * The tracks a "new bus" takes: the ones with clips selected, if this track is one of them, else
 * just this track.
 */
function selectedTrackIds(trackId: string): string[] {
  const s = useTimelineStore.getState();
  const withSelected = [...new Set(s.clips.filter((c) => c.isSelected).map((c) => c.trackId))];
  return withSelected.includes(trackId) ? withSelected : [trackId];
}

export interface TrackMenuState {
  x: number;
  y: number;
  trackId: string;
}

/** Right-click menu of a track header: its colour, moving it, folders, freezing and deleting. */
export const TrackMenu: React.FC<{ menu: TrackMenuState; onClose: () => void }> = ({ menu, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(ref, onClose);
  useKeepOnScreen(ref, menu.x, menu.y);
  const tracks = useTimelineStore((s) => s.tracks);
  const [naming, setNaming] = useState(false);
  const track = tracks.find((t) => t.id === menu.trackId);
  if (!track) return null;
  const s = useTimelineStore.getState();
  const ui = useUiStore.getState();
  const index = tracks.indexOf(track);
  const folders = foldersOf(tracks).filter((f) => f.id !== track.folder?.id);
  const run = (action: () => unknown) => () => {
    action();
    onClose();
  };

  const items: Array<MenuItemProps & { key: string }> = [
    { key: 'up', label: 'Move up', icon: <ArrowUp className="w-3.5 h-3.5" />, onClick: run(() => s.moveTrackRow(track.id, -1)), disabled: index === 0 && !track.folder },
    { key: 'down', label: 'Move down', icon: <ArrowDown className="w-3.5 h-3.5" />, onClick: run(() => s.moveTrackRow(track.id, 1)), disabled: index === tracks.length - 1 && !track.folder },
    { key: 'new-folder', label: 'New folder…', icon: <FolderPlus className="w-3.5 h-3.5" />, onClick: () => setNaming(true), divider: true },
    ...folders.map((f) => ({
      key: `to-${f.id}`,
      label: `Move into “${f.name}”`,
      icon: <FolderInput className="w-3.5 h-3.5" style={{ color: f.color }} />,
      onClick: run(() => s.setTrackFolder(track.id, f.id)),
    })),
    ...(track.folder ? [{ key: 'out', label: `Take out of “${track.folder.name}”`, icon: <FolderMinus className="w-3.5 h-3.5" />, onClick: run(() => s.setTrackFolder(track.id, null)) }] : []),
    // Where it plays: the master, or a bus
    {
      key: 'out-master',
      label: track.output ? 'Output: back to the master' : 'Output: master',
      icon: <Route className="w-3.5 h-3.5" />,
      onClick: run(() => s.setTrackOutput(track.id, null)),
      disabled: !track.output,
      divider: true,
    },
    ...busTargets(track, tracks).map((b) => ({
      key: `bus-${b.id}`,
      label: `${track.output === b.id ? 'Output: ' : 'Play into '}“${b.name}”`,
      icon: <Route className="w-3.5 h-3.5" style={{ color: b.color }} />,
      onClick: run(() => s.setTrackOutput(track.id, b.id)),
      disabled: track.output === b.id,
    })),
    ...(isBus(track)
      ? []
      : [
          {
            key: 'new-bus',
            label: (() => {
              const selected = selectedTrackIds(track.id);
              return selected.length > 1 ? `Group ${selected.length} tracks into a new bus` : 'Send to a new bus';
            })(),
            icon: <Waypoints className="w-3.5 h-3.5" />,
            onClick: run(() => s.groupIntoBus(selectedTrackIds(track.id))),
          },
        ]),
    // Sends to effect returns (a track can feed several, and still play to its output)
    ...(isMixTrack(track)
      ? []
      : [
          ...sendTargets(track, tracks).map((r) => {
            const on = track.sends?.some((x) => x.to === r.id);
            return {
              key: `send-${r.id}`,
              label: on ? `Stop sending to “${r.name}”` : `Send to “${r.name}”`,
              icon: <Radio className="w-3.5 h-3.5" style={{ color: r.color }} />,
              onClick: run(() => s.setTrackSend(track.id, r.id, on ? null : 0.5)),
            };
          }),
          { key: 'new-return', label: 'Send to a new return', icon: <Radio className="w-3.5 h-3.5" />, onClick: run(() => s.addReturn(track.id)) },
        ]),
    ...(track.plugin
      ? [{ key: 'plugin-open', label: `Open ${track.plugin.name}`, icon: <Plug className="w-3.5 h-3.5 text-fuchsia-300" />, onClick: run(() => ui.setPluginWindow({ trackId: track.id, pluginId: track.plugin!.id })), divider: true }]
      : []),
    ...(isBus(track)
      ? []
      : [
          {
            key: 'plugin-add',
            label: 'Add plugin effect (WAM)…',
            icon: <Plug className="w-3.5 h-3.5" />,
            onClick: run(() => ui.setPluginDialog({ trackId: track.id })),
            divider: !track.plugin,
          },
        ]),
    ...(track.pluginFx ?? []).flatMap((p) => [
      {
        key: `fx-open-${p.id}`,
        label: `Open ${p.name}${p.bypass ? ' (bypassed)' : ''}`,
        icon: <Plug className="w-3.5 h-3.5 text-fuchsia-300" />,
        onClick: run(() => ui.setPluginWindow({ trackId: track.id, pluginId: p.id })),
      },
      { key: `fx-remove-${p.id}`, label: `Remove ${p.name}`, icon: <Trash2 className="w-3.5 h-3.5" />, onClick: run(() => s.removeTrackPluginFx(track.id, p.id)) },
    ]),
    track.frozen
      ? { key: 'freeze', label: 'Unfreeze', icon: <Snowflake className="w-3.5 h-3.5" />, onClick: run(() => unfreezeTrack(track.id)), divider: true }
      : { key: 'freeze', label: 'Freeze', icon: <Snowflake className="w-3.5 h-3.5" />, onClick: run(() => void freezeTrack(track.id)), disabled: isMixTrack(track) || !canFreeze(track.id), divider: true },
    {
      key: 'bounce',
      label: 'Bounce in place',
      icon: <AudioLines className="w-3.5 h-3.5" />,
      onClick: run(() =>
        bounceTrack(track.id).then(
          (id) => id && showToast(`Bounced ${track.name} to audio: the original is muted, under it`),
          (err) => showToast(`Couldn't bounce ${track.name}: ${err instanceof Error ? err.message : String(err)}`)
        )
      ),
      disabled: isMixTrack(track) || !canFreeze(track.id),
    },
    { key: 'delete', label: 'Delete track', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: run(() => s.deleteTrack(track.id)) },
  ];

  return (
    <div ref={ref} role="menu" aria-label={`${track.name} track`} className={menuClass} onContextMenu={(e) => e.preventDefault()}>
      <div className="px-3 pt-1 pb-1.5 text-[10px] text-forge-muted truncate">{track.name}</div>
      <div className="px-3 pb-2 flex flex-wrap gap-1" role="group" aria-label="Track colour">
        <Palette className="w-3.5 h-3.5 text-forge-muted mr-0.5" />
        {TRACK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={run(() => s.setTrackColor(track.id, c))}
            className={`w-4 h-4 rounded-sm ${c === track.color ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/60'}`}
            style={{ background: c }}
            aria-label={`Colour ${c}`}
            title="Track colour"
          />
        ))}
      </div>
      {naming ? (
        <form
          className="px-3 py-1.5 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get('name');
            s.groupIntoFolder([track.id], typeof name === 'string' ? name : undefined);
            onClose();
          }}
        >
          <input name="name" autoFocus placeholder={`Folder ${foldersOf(tracks).length + 1}`} className="flex-1 min-w-0 h-7 bg-forge-bg border border-forge-border rounded px-1.5 text-forge-text focus:outline-none focus:border-cyan-500" aria-label="Folder name" />
          <button type="submit" className="h-7 px-2 rounded border border-cyan-400/60 text-cyan-100">
            OK
          </button>
        </form>
      ) : (
        items.map(({ key, ...item }) => <MenuItem key={key} {...item} />)
      )}
    </div>
  );
};
