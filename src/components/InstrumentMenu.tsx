import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFloatingMenu } from './useFloatingMenu';
import { ChevronDown, Play, Search, Star, Trash2 } from 'lucide-react';
import { previewInstrument } from '../audio/instrumentPreview';
import type { InstrumentDef, InstrumentKey } from '../audio/instrumentCatalog';
import { INSTRUMENTS, RETRO_CATEGORY, instrumentsByCategory } from '../audio/instrumentCatalog';
import { useRetroInstruments } from '../store/retroInstruments';
import { searchInstruments } from '../search/instrumentSearch';
import { useMySounds, type MySound } from '../store/mySounds';

/**
 * Choosing an instrument by typing: a search field over the instrument list. With nothing typed
 * the list is grouped as in the catalog; typing narrows it to the best matches first (by name,
 * then by style or mood words like "8-bit", "angelic" or "orchestral", then by description).
 * Up and Down move through it, Enter picks. The retro instruments (1990s soundfonts) are left out
 * unless shown (a switch at the bottom), except the one a track already plays. Starred instruments
 * are listed first under Favourites, and where a list can take them, the sounds you've saved
 * (mySounds.ts) above those, under My sounds.
 */

/** A row of the list: an instrument, or a saved sound (which plays one) */
interface Row {
  def: InstrumentDef;
  sound?: MySound;
  heading: string | null;
  key: string;
}

const MY_SOUNDS = 'My sounds';
const FAVOURITES = 'Favourites';

interface ListProps {
  /** Which instruments to offer (all when left out) */
  include?: (def: InstrumentDef) => boolean;
  /** The one chosen now: marked, and where the list starts */
  current?: InstrumentKey;
  onPick: (key: InstrumentKey) => void;
  /** Where saved sounds can be picked: what picking one does (left out, they aren't listed) */
  onPickSound?: (sound: MySound) => void;
  /** Heading over the search field */
  heading?: string;
}

/** The search field and the list it filters. */
export const InstrumentList: React.FC<ListProps> = ({ include, current, onPick, onPickSound, heading }) => {
  /** The instrument whose preview is playing (or loading) */
  const [previewing, setPreviewing] = useState<InstrumentKey | null>(null);
  const preview = (key: InstrumentKey) => {
    setPreviewing(key);
    void previewInstrument(key).finally(() => setPreviewing((k) => (k === key ? null : k)));
  };
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const idBase = `inst${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const showRetro = useRetroInstruments((s) => s.shown);
  const favourites = useMySounds((s) => s.favourites);
  const mySounds = useMySounds((s) => s.sounds);
  // Rows in display order, with the group headings to show before some of them
  const { rows, hiddenRetro } = useMemo(() => {
    const allow = include ?? (() => true);
    const listed = (def: InstrumentDef) => allow(def) && (showRetro || !def.retro || def.key === current);
    const sounds = onPickSound ? mySounds.filter((s) => allow(INSTRUMENTS[s.settings.instrumentKey])) : [];
    const soundRows = (list: MySound[]): Row[] =>
      list.map((sound, i) => ({ def: INSTRUMENTS[sound.settings.instrumentKey], sound, heading: i === 0 ? MY_SOUNDS : null, key: `sound-${sound.id}` }));
    const q = query.trim().toLowerCase();
    if (q) {
      const found = searchInstruments(query, allow);
      const words = q.split(/\s+/);
      const soundsFound = sounds.filter((s) => words.every((w) => `${s.name} ${INSTRUMENTS[s.settings.instrumentKey].name}`.toLowerCase().includes(w)));
      return {
        rows: [...soundRows(soundsFound).map((r) => ({ ...r, heading: null })), ...found.filter(listed).map((def) => ({ def, heading: null, key: def.key }))] as Row[],
        hiddenRetro: found.filter((d) => !listed(d)).length,
      };
    }
    const starred = favourites.map((k) => INSTRUMENTS[k]).filter((def) => def && listed(def));
    const groups = instrumentsByCategory().map(({ category, instruments }) => ({ category, instruments: instruments.filter(listed) }));
    return {
      rows: [
        ...soundRows(sounds),
        ...starred.map((def, i) => ({ def, heading: i === 0 ? FAVOURITES : null, key: `fav-${def.key}` })),
        ...groups.flatMap(({ category, instruments }) => instruments.map((def, i) => ({ def, heading: i === 0 ? (category as string | null) : null, key: def.key }))),
      ] as Row[],
      hiddenRetro: showRetro ? 0 : instrumentsByCategory().find((g) => g.category === RETRO_CATEGORY)?.instruments.filter((d) => allow(d) && d.key !== current).length ?? 0,
    };
  }, [query, include, showRetro, current, favourites, mySounds, onPickSound]);

  const [active, setActive] = useState(() => Math.max(0, rows.findIndex((r) => !r.sound && r.def.key === current)));
  const pick = (row: Row) => (row.sound ? onPickSound?.(row.sound) : onPick(row.def.key));
  const changeQuery = (q: string) => {
    setQuery(q);
    setActive(0);
  };

  // Keep the highlighted row in view (and start the list at the current instrument)
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`#${idBase}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, idBase, rows]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (rows.length ? (a + step + rows.length) % rows.length : 0));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(rows.length - 1, a + (e.key === 'PageDown' ? 8 : -8))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) pick(row);
    }
  };

  return (
    <>
      {heading && (
        <div className="px-3 py-1.5 text-[10px] text-forge-muted font-bold uppercase tracking-wider border-b border-forge-border bg-black/40">{heading}</div>
      )}
      <label className="flex items-center gap-2 px-3 py-2 border-b border-forge-border bg-forge-bg/60">
        <Search className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <input
          // A menu that opens to be searched: the field takes focus straight away
          autoFocus
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search: name, style (8-bit, angelic, jazz)…"
          className="flex-1 min-w-0 bg-transparent text-forge-text placeholder:text-forge-muted/70 focus:outline-none font-sans text-xs"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${idBase}-list`}
          aria-activedescendant={rows[active] ? `${idBase}-${active}` : undefined}
          aria-label="Search instruments"
        />
        <span className="text-[10px] text-forge-muted tabular-nums">{rows.length}</span>
      </label>
      <div ref={listRef} id={`${idBase}-list`} role="listbox" aria-label="Instruments" className="overflow-y-auto py-1 min-h-0">
        {rows.length === 0 && <div className="px-3 py-3 text-forge-muted font-sans">No instrument matches “{query}”{hiddenRetro ? ' (except retro ones, below)' : ''}.</div>}
        {rows.map((row, i) => {
          const { def, sound, heading: group } = row;
          const starred = !sound && favourites.includes(def.key);
          return (
          <React.Fragment key={row.key}>
            {group && <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-forge-muted/80 font-bold">{group}</div>}
            <div
              id={`${idBase}-${i}`}
              role="option"
              aria-selected={!sound && def.key === current}
              onPointerMove={() => i !== active && setActive(i)}
              onClick={() => pick(row)}
              title={sound ? `${sound.name}: your saved sound (${def.name} with your settings)` : `${def.name}: ${def.category} · ${def.blurb}`}
              className={`w-full px-3 py-1.5 flex items-center gap-2 text-left cursor-pointer ${i === active ? 'bg-cyan-500/15' : ''}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: def.color }} />
              <span className={`font-medium whitespace-nowrap ${!sound && def.key === current ? 'text-cyan-200' : 'text-forge-text'}`}>{sound ? sound.name : def.name}</span>
              {/* Cut short to fit; the row under the pointer (or the keys) opens up to show all of it */}
              <span className={`ml-auto text-[10px] text-forge-muted pl-2 ${i === active ? 'whitespace-normal' : 'truncate'}`}>
                {sound ? `${def.name} · your settings` : query.trim() ? `${def.category} · ${def.blurb}` : def.blurb}
              </span>
              {sound ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete your saved sound "${sound.name}"? Tracks playing it keep their settings.`)) useMySounds.getState().removeSound(sound.id);
                  }}
                  aria-label={`Delete ${sound.name}`}
                  title={`Delete ${sound.name} from My sounds`}
                  className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-forge-muted hover:text-red-300 ${i === active ? '' : 'invisible'}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    useMySounds.getState().toggleFavourite(def.key);
                  }}
                  aria-label={`${starred ? 'Unstar' : 'Star'} ${def.name}`}
                  aria-pressed={starred}
                  title={starred ? 'Remove from Favourites' : 'Add to Favourites (listed first)'}
                  className={`shrink-0 w-6 h-6 rounded flex items-center justify-center ${starred ? 'text-amber-300' : `text-forge-muted hover:text-amber-200 ${i === active ? '' : 'invisible'}`}`}
                >
                  <Star className="w-3 h-3" fill={starred ? 'currentColor' : 'none'} />
                </button>
              )}
              {!sound && (def.kind === 'synth' || def.kind === 'drums' || def.kind === 'sampled') && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    preview(def.key);
                  }}
                  aria-label={`Hear ${def.name}`}
                  title={`Hear ${def.name}`}
                  className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${previewing === def.key ? 'border-cyan-400 text-cyan-300 bg-cyan-500/15' : 'border-forge-border text-forge-muted hover:text-cyan-300 hover:border-cyan-500/60'}`}
                >
                  <Play className={`w-3 h-3 ${previewing === def.key ? 'animate-pulse fill-current' : ''}`} />
                </button>
              )}
            </div>
          </React.Fragment>
          );
        })}
        {(hiddenRetro > 0 || showRetro) && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => useRetroInstruments.getState().setShown(!showRetro)}
            title="The 1990s General MIDI soundfont instruments, kept so older songs sound as they did: most have a recorded instrument now"
            className="w-full mt-1 px-3 py-2 border-t border-forge-border text-left text-[10px] text-forge-muted hover:text-cyan-300 font-sans"
          >
            {showRetro ? 'Hide the retro instruments (1990s soundfonts)' : `Show ${hiddenRetro} retro instrument${hiddenRetro === 1 ? '' : 's'} (1990s soundfonts)${query.trim() ? ' that match' : ''}`}
          </button>
        )}
      </div>
    </>
  );
};

interface PickerProps {
  value: InstrumentKey;
  onChange: (key: InstrumentKey) => void;
  include?: (def: InstrumentDef) => boolean;
  /** Accessible name of the button */
  label: string;
  className?: string;
  /** Show the instrument's description after its name on the button */
  withBlurb?: boolean;
  /** Offer the saved sounds too: what picking one does */
  onPickSound?: (sound: MySound) => void;
}

/** A button showing the chosen instrument that opens the searchable list. */
export const InstrumentPicker: React.FC<PickerProps> = ({ value, onChange, include, label, className = '', withBlurb, onPickSound }) => {
  const { open, toggle, close, buttonRef, render } = useFloatingMenu();
  const def = INSTRUMENTS[value];
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${def.name}`}
        title={`${def.name}${withBlurb ? ` (${def.blurb})` : ''}: choose an instrument (type to search)`}
        className={`flex items-center gap-2 text-left ${className}`}
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: def.color }} />
        <span className="truncate">
          {def.name}
          {withBlurb && <span className="font-normal text-forge-muted"> ({def.blurb})</span>}
        </span>
        <ChevronDown className="w-3.5 h-3.5 ml-auto shrink-0 text-forge-muted" />
      </button>
      {render(
        label,
        <InstrumentList
          include={include}
          current={value}
          onPick={(key) => {
            close(true);
            if (key !== value) onChange(key);
          }}
          onPickSound={
            onPickSound &&
            ((sound) => {
              close(true);
              onPickSound(sound);
            })
          }
        />
      )}
    </>
  );
};
