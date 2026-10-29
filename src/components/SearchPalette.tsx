import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { PALETTE_SHORTCUT, useUiStore } from '../store/uiStore';
import { paletteEntries, SUGGESTED, type PaletteEntry } from '../search/paletteEntries';
import { rank, snippet } from '../search/searchCore';
import { showToast } from './timeline/toastStore';

/**
 * Search everything (Ctrl+K, or the SEARCH button): tools, settings, instruments, starters and
 * the guide. Enter runs the highlighted result: it opens the thing or takes you to the control and
 * rings it. Shift+Enter on an instrument puts it on the selected track instead of adding a track.
 */

const MAX_RESULTS = 60;

const GROUP_STYLE: Record<PaletteEntry['group'], string> = {
  Tool: 'text-emerald-300 border-emerald-500/40',
  Setting: 'text-cyan-300 border-cyan-500/40',
  Instrument: 'text-amber-300 border-amber-500/40',
  Starter: 'text-violet-300 border-violet-500/40',
  Guide: 'text-sky-300 border-sky-500/40',
};


const Palette: React.FC<{ onClose: (ran: boolean) => void }> = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idBase = `pal${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const results = useMemo(() => {
    const all = paletteEntries();
    if (!query.trim()) return SUGGESTED.map((t) => all.find((e) => e.title === t)).filter((e): e is PaletteEntry => !!e);
    return rank(all, query, (e) => e).slice(0, MAX_RESULTS);
  }, [query]);

  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`#${idBase}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, idBase, results]);

  const run = (entry: PaletteEntry, alt: boolean) => {
    const result = entry.run({ alt });
    if (typeof result === 'string') {
      setMessage(result);
      return;
    }
    onClose(true);
    if (result instanceof Promise) void result.then((m) => typeof m === 'string' && showToast(m));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (results.length ? (a + step + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = results[active];
      if (entry) run(entry, e.shiftKey);
    } else if (e.key === 'Tab') {
      // Nothing else in here to go to
      e.preventDefault();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-2 pt-[10vh]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}
    >
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl rounded-xl border border-forge-borderLight bg-forge-panel shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        <label className="flex items-center gap-2 px-4 py-3 border-b border-forge-border">
          <Search className="w-4 h-4 text-cyan-400 shrink-0" />
          <input
            // The palette exists to be typed into
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setMessage(null);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search tools, settings, instruments, starters, the guide…"
            className="flex-1 min-w-0 bg-transparent text-sm text-forge-text placeholder:text-forge-muted/70 focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${idBase}-list`}
            aria-activedescendant={results[active] ? `${idBase}-${active}` : undefined}
            aria-label="Search"
          />
          <button type="button" onClick={() => onClose(false)} className="text-forge-muted hover:text-forge-text" aria-label="Close search" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </label>
        {message && (
          <div role="status" className="px-4 py-2 text-xs text-amber-200 bg-amber-500/10 border-b border-amber-500/30">
            {message}
          </div>
        )}
        <div ref={listRef} id={`${idBase}-list`} role="listbox" aria-label="Results" className="overflow-y-auto py-1 min-h-0">
          {!query.trim() && <div className="px-4 pt-1.5 pb-1 text-[9px] uppercase tracking-widest text-forge-muted/80 font-bold font-mono">Try</div>}
          {results.length === 0 && <div className="px-4 py-4 text-xs text-forge-muted">Nothing matches “{query}”. Try another word, or fewer words.</div>}
          {results.map((entry, i) => {
            const sub = entry.group === 'Guide' ? (query.trim() ? snippet(entry.detail ?? '', query) : '') : entry.detail;
            return (
              <div
                key={entry.id}
                id={`${idBase}-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerMove={() => i !== active && setActive(i)}
                onClick={(e) => run(entry, e.shiftKey)}
                title={sub ? `${entry.title}\n${sub}` : entry.title}
                className={`px-4 py-2 flex items-start gap-2.5 cursor-pointer ${i === active ? 'bg-cyan-500/15' : ''}`}
              >
                {entry.color ? (
                  <span className="w-2.5 h-2.5 mt-1 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                ) : (
                  <span className="w-2.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  {/* Cut short to fit; the result under the pointer (or the keys) shows all of it */}
                  <div className={`text-[13px] text-forge-text font-medium ${i === active ? 'break-words' : 'truncate'}`}>{entry.title}</div>
                  {sub && <div className={`text-[11px] text-forge-muted ${i === active ? '' : 'line-clamp-2'}`}>{sub}</div>}
                  {i === active && entry.altHint && <div className="text-[10px] text-forge-muted/80 mt-0.5">Enter: add a track · {entry.altHint}</div>}
                </div>
                <span className={`shrink-0 mt-0.5 px-1.5 rounded border text-[9px] font-mono uppercase tracking-wider ${GROUP_STYLE[entry.group]}`}>{entry.group}</span>
                {i === active && <CornerDownLeft className="w-3.5 h-3.5 mt-0.5 shrink-0 text-forge-muted" />}
              </div>
            );
          })}
        </div>
        <div className="px-4 py-1.5 border-t border-forge-border text-[10px] text-forge-muted font-mono flex gap-3">
          <span>↑↓ choose</span>
          <span>Enter go</span>
          <span>Esc close</span>
          <span className="ml-auto">{PALETTE_SHORTCUT} anywhere</span>
        </div>
      </div>
    </div>
  );
};

/** Mounted once: opens on Ctrl+K / ⌘K from anywhere (even while typing) and when asked to. */
export const SearchPalette: React.FC = () => {
  const open = useUiStore((s) => s.paletteOpen);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      const ui = useUiStore.getState();
      ui.setPaletteOpen(!ui.paletteOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Where focus was as it opens (Ctrl+K, the menu, a button), noted before its own field takes the
  // focus: closing it puts the focus back there (the field you were typing in, say)
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        if (s.paletteOpen && !prev.paletteOpen) opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      }),
    []
  );

  // Esc closes it before anything else hears the key (the piano roll, a dialog under it)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      useUiStore.getState().setPaletteOpen(false);
      opener.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <Palette
      onClose={(ran) => {
        useUiStore.getState().setPaletteOpen(false);
        // After running something, focus goes where it took you (or stays put)
        if (!ran) opener.current?.focus();
      }}
    />
  );
};
