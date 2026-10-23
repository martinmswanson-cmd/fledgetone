import React, { useEffect, useMemo, useState } from 'react';
import { Plug, Search, Star } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore } from '../../store/timelineStore';
import { isBus } from '../../store/buses';
import { pluginFamilies, preloadFamily } from '../../audio/plugins/builtinHost';
import { addBuiltinPlugin, allBuiltinPlugins, FAVOURITES_KEY, readList, RECENT_KEY, writeList, type BuiltinEntry as Entry } from '../../store/builtinPlugins';
import { showToast } from './toastStore';
import { FledgeTourButton } from '../FledgeTourButton';

/**
 * The built-in plugins (see audio/plugins/builtinHost.ts): search them, browse by category or
 * collection, star favourites, and add one as an effect on a track (after its instrument, before
 * its own inserts) or, for an instrument, as a new track. Its window opens once it's added.
 */

const ALL = 'All';
const FAVOURITES = '★ Favourites';
/** The tags that are groups of their own (the rest are search words) */
const COLLECTIONS = ['Recommended', 'Basic'];
const RECENT = 'Recently used';
const INSTRUMENTS = 'Instruments';

export const PluginBrowser: React.FC<{ trackId: string | null; category?: string; onClose: () => void }> = ({ trackId, category, onClose }) => {
  const entries = useMemo(() => allBuiltinPlugins(), []);
  const tracks = useTimelineStore((s) => s.tracks);
  const targets = tracks.filter((t) => !isBus(t));
  const [target, setTarget] = useState<string | null>(trackId && targets.some((t) => t.id === trackId) ? trackId : (targets[0]?.id ?? null));
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(category ?? ALL);
  const [favourites, setFavourites] = useState(() => new Set(readList(FAVOURITES_KEY)));
  const recent = useMemo(() => readList(RECENT_KEY), []);

  // They'll want one: start downloading the plugins now (once; kept in this browser)
  useEffect(() => {
    for (const f of pluginFamilies()) void preloadFamily(f).catch(() => {});
  }, []);

  /** The groups down the side: favourites and recents, collections, then each category. */
  const groups = useMemo(() => {
    const count = new Map<string, number>();
    const add = (g: string) => count.set(g, (count.get(g) ?? 0) + 1);
    for (const e of entries) {
      add(e.info.instrument ? INSTRUMENTS : e.info.category);
      // (Only the collections make groups: other tags are words to search by)
      for (const t of e.info.tags ?? []) if (COLLECTIONS.includes(t)) add(t);
    }
    const collections = COLLECTIONS.filter((c) => count.has(c));
    const categories = [...count.keys()].filter((g) => !collections.includes(g) && g !== INSTRUMENTS).sort((a, b) => a.localeCompare(b));
    return [ALL, FAVOURITES, RECENT, ...(count.has(INSTRUMENTS) ? [INSTRUMENTS] : []), ...collections, ...categories].map((g) => ({
      name: g,
      count: g === ALL ? entries.length : g === FAVOURITES ? favourites.size : g === RECENT ? recent.length : (count.get(g) ?? 0),
    }));
  }, [entries, favourites, recent]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const inGroup = (e: Entry) =>
      group === ALL ||
      (group === FAVOURITES && favourites.has(e.key)) ||
      (group === RECENT && recent.includes(e.key)) ||
      (group === INSTRUMENTS && !!e.info.instrument) ||
      (!e.info.instrument && e.info.category === group) ||
      !!e.info.tags?.includes(group);
    const list = entries.filter((e) => (words.length ? true : inGroup(e)) && words.every((w) => `${e.info.name} ${e.info.category} ${e.info.about} ${e.family.label} ${(e.info.tags ?? []).join(' ')}`.toLowerCase().includes(w)));
    if (group === RECENT && !words.length) list.sort((a, b) => recent.indexOf(a.key) - recent.indexOf(b.key));
    // A search shows plugins named for it first, then those of that kind, then the rest
    const rank = (e: Entry) => {
      const name = e.info.name.toLowerCase();
      if (words.every((w) => name.includes(w))) return 0;
      return words.every((w) => `${name} ${e.info.category}`.toLowerCase().includes(w)) ? 1 : 2;
    };
    if (words.length) list.sort((a, b) => rank(a) - rank(b));
    return list;
  }, [entries, query, group, favourites, recent]);

  const toggleFavourite = (key: string) => {
    const next = new Set(favourites);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFavourites(next);
    writeList(FAVOURITES_KEY, [...next]);
  };

  const add = (e: Entry) => {
    if (!e.info.instrument && !target) {
      showToast('Add a track first: an effect goes on a track.');
      return;
    }
    addBuiltinPlugin(e, target);
    onClose();
  };

  const targetName = targets.find((t) => t.id === target)?.name;
  return (
    <Modal title="Plugins" onClose={onClose} wide>
      <div className="flex flex-col gap-2 p-3 min-h-0 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-forge-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${entries.length} plugins: reverb, tape, warm, drums…`}
              aria-label="Search plugins"
              className="w-full h-8 pl-7 pr-2 bg-forge-bg border border-forge-border rounded-md text-forge-text focus:outline-none focus:border-fuchsia-400"
            />
          </div>
          <label className="flex items-center gap-1.5 text-forge-muted">
            Effects go on
            <select
              value={target ?? ''}
              onChange={(e) => setTarget(e.target.value || null)}
              aria-label="Track to add the effect to"
              className="h-8 max-w-[160px] bg-forge-bg border border-forge-border rounded-md px-1 text-forge-text"
            >
              {targets.length === 0 && <option value="">(no tracks yet)</option>}
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2 min-h-0 h-[60vh]">
          <nav aria-label="Plugin groups" className="w-40 shrink-0 overflow-y-auto flex flex-col gap-0.5 pr-1">
            {groups.map((g) => (
              <button
                key={g.name}
                type="button"
                aria-pressed={group === g.name && !query}
                onClick={() => {
                  setGroup(g.name);
                  setQuery('');
                }}
                className={`flex justify-between gap-1 px-2 py-1 rounded text-left ${group === g.name && !query ? 'bg-fuchsia-500/20 text-fuchsia-100' : 'text-forge-muted hover:text-forge-text hover:bg-white/5'}`}
              >
                <span className="truncate">{g.name}</span>
                <span className="text-[10px] opacity-70">{g.count}</span>
              </button>
            ))}
          </nav>
          <ul aria-label="Plugins found" className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
            {shown.length === 0 && (
              <li className="p-4 text-forge-muted">{group === FAVOURITES && !query ? 'Star a plugin to keep it here.' : 'Nothing matches.'}</li>
            )}
            {shown.map((e) => (
              <li key={e.key} className="flex items-start gap-2 p-2 rounded-md border border-forge-border bg-forge-bg/60 hover:border-fuchsia-400/50">
                <button
                  type="button"
                  onClick={() => toggleFavourite(e.key)}
                  title={favourites.has(e.key) ? 'Remove from favourites' : 'Add to favourites'}
                  aria-label={`${favourites.has(e.key) ? 'Unstar' : 'Star'} ${e.info.name}`}
                  aria-pressed={favourites.has(e.key)}
                  className={`mt-0.5 ${favourites.has(e.key) ? 'text-amber-300' : 'text-forge-muted hover:text-amber-200'}`}
                >
                  <Star className="w-3.5 h-3.5" fill={favourites.has(e.key) ? 'currentColor' : 'none'} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-forge-text">{e.info.name}</span>
                    <span className="text-[10px] text-forge-muted truncate">
                      {e.info.instrument ? `Instrument · ${e.info.category}` : e.info.category} · {e.family.label}
                    </span>
                  </div>
                  <p className="text-forge-muted leading-snug">{e.info.about}</p>
                </div>
                {e.family.family === 'fledge' && e.info.instrument && <FledgeTourButton size="large" className="!w-7 !h-7" />}
                <button
                  type="button"
                  onClick={() => add(e)}
                  disabled={!e.info.instrument && !target}
                  title={e.info.instrument ? 'Add it as a new track' : `Add it to ${targetName ?? 'a track'}`}
                  className="shrink-0 h-7 px-2.5 flex items-center gap-1 rounded-md border border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-40"
                >
                  <Plug className="w-3 h-3" />
                  {e.info.instrument ? 'New track' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[10px] text-forge-muted">
          Effects go after the track’s instrument, before its own inserts. Each plugin’s window has its settings; automate them from the track’s Automation lanes. The
          plugins download once, the first time you open this, and are kept in this browser.
        </p>
      </div>
    </Modal>
  );
};
