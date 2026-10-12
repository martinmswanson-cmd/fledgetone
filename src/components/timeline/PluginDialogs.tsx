import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, Plug, ShieldAlert, X } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { initAudio, liveMix } from '../../audio/engine';
import {
  allowPluginUrls,
  blockedPluginUrls,
  captureWamStates,
  describeWam,
  liveWam,
  nativeContextOf,
  normalizePluginUrl,
  subscribeWam,
  wamVersion,
} from '../../audio/wamHost';
import { showToast } from './toastStore';

/**
 * Web Audio Module plugins in the app: the dialog that adds one by URL (as a new Plugin track's
 * instrument, or as an effect on a track), the floating window showing a plugin's own controls,
 * and the bar asking before an opened project's plugins load.
 */

const RECENT_KEY = 'bosBeatbox.recentPlugins';
const readRecent = (): Array<{ url: string; name: string }> => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((r) => typeof r?.url === 'string' && typeof r?.name === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
};
const remember = (url: string, name: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ url, name }, ...readRecent().filter((r) => r.url !== url)].slice(0, 12)));
  } catch {
    // Storage blocked
  }
};

const useWamVersion = () => useSyncExternalStore(subscribeWam, wamVersion);

/** Add a plugin by URL: `trackId` null makes a new Plugin track, else an effect on that track. */
export const PluginUrlDialog: React.FC<{ trackId: string | null; onClose: () => void }> = ({ trackId, onClose }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = readRecent();
  const asEffect = trackId !== null;
  const track = useTimelineStore((s) => (trackId ? s.tracks.find((t) => t.id === trackId) : undefined));

  const load = async (raw: string) => {
    const u = normalizePluginUrl(raw);
    if (!u) {
      setError('That isn’t a web address. A plugin’s address ends in its module, usually index.js.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await initAudio();
      const { name, isInstrument } = await describeWam(nativeContextOf(liveMix.bus.context), u);
      // You chose it and it loads: it may load from now on, in this browser
      allowPluginUrls([u]);
      const s = useTimelineStore.getState();
      if (asEffect) {
        const id = s.addTrackPluginFx(trackId!, u, name);
        if (id) useUiStore.getState().setPluginWindow({ trackId: trackId!, pluginId: id });
        if (isInstrument) showToast(`${name} is an instrument: as an effect it may make no sound. Add it as a Plugin track instead.`);
      } else {
        const id = s.addPluginTrack(u, name);
        const plugin = useTimelineStore.getState().tracks.find((t) => t.id === id)?.plugin;
        if (plugin) useUiStore.getState().setPluginWindow({ trackId: id, pluginId: plugin.id });
        if (!isInstrument) showToast(`${name} says it's an effect: as an instrument it may make no sound. Add it to a track as a plugin effect instead.`);
      }
      remember(u, name);
      onClose();
    } catch (err) {
      setError(`Couldn't load it: ${err instanceof Error ? err.message : String(err)}. The address must be the plugin's module, and its server must allow other sites to load it (CORS).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={asEffect ? `Add a plugin effect to ${track?.name ?? 'the track'}` : 'Add a plugin instrument'} onClose={onClose}>
      <form
        className="p-4 flex flex-col gap-3 text-xs text-forge-muted"
        onSubmit={(e) => {
          e.preventDefault();
          void load(url);
        }}
      >
        <p className="leading-snug">
          Web Audio Modules (WAM 2) are instruments and effects made for the web by other people. Paste the address of a plugin's module
          (its <span className="font-mono">index.js</span>). {asEffect ? 'It goes after the instrument, before the track’s own inserts.' : 'It becomes a new track you play like any other.'}
        </p>
        <p className="leading-snug text-amber-300/90">A plugin is a program from that address: only load ones you trust.</p>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/index.js"
          className="h-8 bg-forge-bg border border-forge-border rounded-md px-2 font-mono text-forge-text focus:outline-none focus:border-cyan-500"
          aria-label="Plugin address"
        />
        {error && <p className="text-red-300 leading-snug">{error}</p>}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="uppercase tracking-wider text-[10px]">Used before</span>
            {recent.map((r) => (
              <button
                key={r.url}
                type="button"
                disabled={busy}
                onClick={() => void load(r.url)}
                className="text-left px-2 py-1 rounded border border-forge-border hover:border-cyan-500/70 text-forge-text truncate"
                title={r.url}
              >
                <Plug className="inline w-3 h-3 mr-1.5 text-fuchsia-300" />
                {r.name} <span className="text-forge-muted">{new URL(r.url).host}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-md border border-forge-border hover:text-forge-text">
            Cancel
          </button>
          <button type="submit" disabled={busy || !url.trim()} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-500/70 bg-cyan-500/15 text-cyan-100 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Load plugin
          </button>
        </div>
      </form>
    </Modal>
  );
};

/** A plugin's own controls, in a window that can be dragged by its title bar. */
export const PluginWindow: React.FC<{ trackId: string; pluginId: string; onClose: () => void }> = ({ trackId, pluginId, onClose }) => {
  useWamVersion();
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === trackId));
  const plugin = track?.plugin?.id === pluginId ? track.plugin : track?.pluginFx?.find((p) => p.id === pluginId);
  const inst = liveWam(pluginId);
  const holder = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: Math.max(16, window.innerWidth / 2 - 220), y: 90 });
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!inst || !holder.current) return;
    let gui: Element | null = null;
    let gone = false;
    const el = holder.current;
    (inst.createGui ? inst.createGui() : Promise.resolve(null)).then(
      (made) => {
        if (gone) {
          if (made) inst.destroyGui?.(made);
          return;
        }
        if (!made) {
          setFailed('This plugin has no window of its own.');
          return;
        }
        gui = made;
        el.appendChild(made);
      },
      (err) => setFailed(`Its window couldn't open: ${err instanceof Error ? err.message : String(err)}`)
    );
    return () => {
      gone = true;
      if (gui) {
        try {
          inst.destroyGui?.(gui);
        } catch {
          // Its own business
        }
        gui.remove();
      }
      // What was changed in it is kept with the project
      void captureWamStates();
    };
  }, [inst]);

  useEffect(() => {
    if (!plugin) onClose();
  }, [plugin, onClose]);
  if (!plugin) return null;

  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - start.x), y: Math.max(0, ev.clientY - start.y) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const isFx = track?.plugin?.id !== pluginId;

  return (
    <div
      role="dialog"
      aria-label={`${plugin.name} plugin`}
      className="fixed z-50 rounded-lg border border-fuchsia-400/50 bg-forge-panel shadow-2xl max-w-[95vw]"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="flex items-center gap-2 px-3 h-8 border-b border-forge-border cursor-move select-none" onPointerDown={drag}>
        <Plug className="w-3.5 h-3.5 text-fuchsia-300" />
        <span className="text-xs font-semibold text-forge-text truncate">{plugin.name}</span>
        <span className="text-[10px] text-forge-muted truncate">on {track?.name}</span>
        <div className="ml-auto flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {isFx && (
            <button
              type="button"
              onClick={() => useTimelineStore.getState().setPluginBypass(trackId, pluginId, !plugin.bypass)}
              className={`h-6 px-2 rounded border text-[10px] font-mono ${plugin.bypass ? 'border-amber-400/70 text-amber-200' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
              title="Bypass: the sound passes it by"
              aria-pressed={!!plugin.bypass}
            >
              BYPASS
            </button>
          )}
          <button type="button" onClick={onClose} className="h-6 w-6 flex items-center justify-center text-forge-muted hover:text-forge-text" title="Close (the plugin keeps playing)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div ref={holder} className="overflow-auto max-h-[80vh] bg-black/30" />
      {(!inst || failed) && (
        <p className="p-4 text-xs text-forge-muted max-w-sm">
          {failed ?? (plugin.bypass ? 'Bypassed: its window opens when it’s back in.' : blockedPluginUrls().includes(plugin.url) ? 'Not loaded: allow this project’s plugins first (the bar at the top).' : 'Loading the plugin…')}
        </p>
      )}
    </div>
  );
};

/** Asks before the plugins named by an opened project load (they're programs from those addresses). */
export const PluginPermissionBar: React.FC = () => {
  useWamVersion();
  const [dismissed, setDismissed] = useState<string>('');
  const urls = blockedPluginUrls();
  const key = urls.join('|');
  if (!urls.length || dismissed === key) return null;
  const hosts = [...new Set(urls.map((u) => new URL(u).host))];
  return (
    <div role="alert" className="fixed top-14 left-1/2 -translate-x-1/2 z-50 max-w-xl flex items-center gap-3 px-4 py-2 rounded-lg border border-amber-400/60 bg-forge-panel shadow-xl text-xs text-forge-text">
      <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0" />
      <span className="leading-snug">
        This project uses {urls.length} plugin{urls.length === 1 ? '' : 's'} from <b>{hosts.join(', ')}</b>. Plugins are programs from those
        sites: load them only if you trust them.
      </span>
      <button
        type="button"
        onClick={() => {
          allowPluginUrls(urls);
          // Rebuild the tracks that use them
          useTimelineStore.setState((s) => ({ tracks: s.tracks.map((t) => (t.plugin || t.pluginFx ? { ...t } : t)) }));
        }}
        className="shrink-0 h-7 px-2.5 rounded-md border border-amber-400/70 bg-amber-500/15 text-amber-100"
      >
        Load plugins
      </button>
      <button type="button" onClick={() => setDismissed(key)} className="shrink-0 text-forge-muted hover:text-forge-text" title="Not now (they stay silent)">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
