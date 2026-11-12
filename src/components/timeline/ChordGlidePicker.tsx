/**
 * The piano roll's GLIDE control: glide between chords for the clip (see chordGlide.ts). Each note
 * of a chord slides into its note in the next chord, the bass on its own: switched on and off with
 * the button, its time and the bass's set in its popover. On an instrument whose voices don't
 * glide on their own it says so (the chords play as written there). Pocket's clip sheet has the
 * same switch and times (PocketSheets.tsx).
 */
import React, { useRef, useState } from 'react';
import { Popover } from '../Popover';
import { FxSlider } from '../inspector/InsertFx';
import { useTimelineStore } from '../../store/timelineStore';
import { GLIDE_ABOUT, GLIDE_MS_DEFAULT, GLIDE_MS_MAX, GLIDE_MS_MIN, glideNotHere } from '../../store/chordGlide';
import type { Clip } from '../../store/timelineTypes';

const ACCENT = '#22d3ee';
const ms = (v: number) => `${Math.round(v)} ms`;

export const ChordGlidePicker: React.FC<{ clip: Clip; glides: boolean; instrumentName: string }> = ({ clip, glides, instrumentName }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const glide = clip.glide;
  const set = useTimelineStore.getState;
  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        data-search="glide between chords voices slide legato pad"
        aria-pressed={!!glide}
        onClick={() => set().setClipGlide(clip.id, glide ? null : { ms: GLIDE_MS_DEFAULT })}
        className={`h-6 px-1.5 rounded border text-[10px] font-mono ${glide ? (glides ? 'border-cyan-600 text-cyan-300' : 'border-forge-borderLight text-forge-text') : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
        title={`Glide between chords: ${GLIDE_ABOUT}${glides ? '' : ` ${glideNotHere(instrumentName)}`}`}
      >
        GLIDE {glide ? 'ON' : 'OFF'}
      </button>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`h-6 px-1.5 rounded border text-[10px] font-mono ${open ? 'border-cyan-500 text-white' : glide ? 'border-cyan-700 text-cyan-300' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
        title="How long each glide takes, the bass's on its own"
        aria-label="Glide time"
      >
        {glide ? ms(glide.ms) : 'TIME…'}
      </button>
      {open && (
        <Popover label="Glide between chords" onClose={() => setOpen(false)} anchorRef={anchor} className="left-0 w-[min(22rem,calc(100vw-2rem))]">
          <div className="flex flex-col gap-2 text-[10px] font-mono">
            <label className="flex items-center gap-2 text-forge-text font-bold">
              <input type="checkbox" checked={!!glide} onChange={() => set().setClipGlide(clip.id, glide ? null : { ms: GLIDE_MS_DEFAULT })} style={{ accentColor: ACCENT }} />
              Glide between chords
            </label>
            <p className="text-forge-muted">{GLIDE_ABOUT}</p>
            {!glides && <p className="text-amber-200">{glideNotHere(instrumentName)}</p>}
            <FxSlider
              label="Time"
              value={glide?.ms ?? GLIDE_MS_DEFAULT}
              min={GLIDE_MS_MIN}
              max={GLIDE_MS_MAX}
              step={5}
              format={ms}
              onChange={(v) => glide && set().setClipGlide(clip.id, { ...glide, ms: v }, false)}
              reset={GLIDE_MS_DEFAULT}
              accent={ACCENT}
              disabled={!glide}
              locked={!glide}
            />
            <FxSlider
              label="Bass"
              value={glide?.bassMs ?? glide?.ms ?? GLIDE_MS_DEFAULT}
              min={GLIDE_MS_MIN}
              max={GLIDE_MS_MAX}
              step={5}
              format={ms}
              onChange={(v) => glide && set().setClipGlide(clip.id, { ...glide, bassMs: v }, false)}
              reset={glide?.ms ?? GLIDE_MS_DEFAULT}
              accent={ACCENT}
              disabled={!glide}
              locked={!glide}
            />
            <p className="text-forge-muted">The lines in the roll show which note glides into which.</p>
          </div>
        </Popover>
      )}
    </div>
  );
};
