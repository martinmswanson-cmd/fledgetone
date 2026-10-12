import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFloatingMenu } from './useFloatingMenu';
import { ChevronDown, Search } from 'lucide-react';
import type { InstrumentDef, InstrumentKey } from '../audio/instrumentCatalog';
import { INSTRUMENTS, instrumentsByCategory } from '../audio/instrumentCatalog';
import { searchInstruments } from '../search/instrumentSearch';

/**
 * Choosing an instrument by typing: a search field over the instrument list. With nothing typed
 * the list is grouped as in the catalog; typing narrows it to the best matches first (by name,
 * then by style or mood words like "8-bit", "angelic" or "orchestral", then by description).
 * Up and Down move through it, Enter picks.
 */

interface ListProps {
  /** Which instruments to offer (all when left out) */
  include?: (def: InstrumentDef) => boolean;
  /** The one chosen now: marked, and where the list starts */
  current?: InstrumentKey;
  onPick: (key: InstrumentKey) => void;
  /** Heading over the search field */
  heading?: string;
}

/** The search field and the list it filters. */
export const InstrumentList: React.FC<ListProps> = ({ include, current, onPick, heading }) => {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const idBase = `inst${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // Rows in display order, with the group headings to show before some of them
  const rows = useMemo(() => {
    const allow = include ?? (() => true);
    if (query.trim()) return searchInstruments(query, allow).map((def) => ({ def, heading: null as string | null }));
    return instrumentsByCategory().flatMap(({ category, instruments }) =>
      instruments.filter(allow).map((def, i) => ({ def, heading: i === 0 ? category : null }))
    );
  }, [query, include]);

  const [active, setActive] = useState(() => Math.max(0, rows.findIndex((r) => r.def.key === current)));
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
      if (row) onPick(row.def.key);
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
        {rows.length === 0 && <div className="px-3 py-3 text-forge-muted font-sans">No instrument matches “{query}”.</div>}
        {rows.map(({ def, heading: group }, i) => (
          <React.Fragment key={def.key}>
            {group && <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-forge-muted/80 font-bold">{group}</div>}
            <div
              id={`${idBase}-${i}`}
              role="option"
              aria-selected={def.key === current}
              onPointerMove={() => i !== active && setActive(i)}
              onClick={() => onPick(def.key)}
              className={`w-full px-3 py-1.5 flex items-center gap-2 text-left cursor-pointer ${i === active ? 'bg-cyan-500/15' : ''}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: def.color }} />
              <span className={`font-medium whitespace-nowrap ${def.key === current ? 'text-cyan-200' : 'text-forge-text'}`}>{def.name}</span>
              <span className="ml-auto text-[10px] text-forge-muted truncate pl-2">{query.trim() ? `${def.category} · ${def.blurb}` : def.blurb}</span>
            </div>
          </React.Fragment>
        ))}
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
}

/** A button showing the chosen instrument that opens the searchable list. */
export const InstrumentPicker: React.FC<PickerProps> = ({ value, onChange, include, label, className = '', withBlurb }) => {
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
        title="Choose an instrument (type to search)"
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
        />
      )}
    </>
  );
};
