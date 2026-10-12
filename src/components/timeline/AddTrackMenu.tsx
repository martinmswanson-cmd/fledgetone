import React from 'react';
import { Plus } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { InstrumentList } from '../InstrumentMenu';
import { useFloatingMenu } from '../useFloatingMenu';

/**
 * "Add Track" button and its instrument picker: a search field over every instrument by category.
 * The picker floats (portalled to <body>) so nothing in the timeline can clip or cover it, and
 * closes on an outside click or Escape.
 */
export const AddTrackMenu: React.FC = () => {
  const { open, toggle, close, buttonRef, render } = useFloatingMenu();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="w-full h-7 rounded border border-dashed border-forge-border hover:border-cyan-400 text-forge-muted hover:text-cyan-200 bg-forge-bg/60 hover:bg-cyan-950/20 text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition shadow-sm"
        title="Add a new instrument track"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Track
      </button>

      {/* Rendered into <body>: inside the timeline's sticky header column it would share that
          column's stacking layer and get covered by later sticky rows (e.g. the piano roll ruler) */}
      {render(
        'Add instrument track',
        <InstrumentList
          heading="Add Instrument Track"
          onPick={(key) => {
            useTimelineStore.getState().addTrack(key);
            close();
          }}
        />
      )}
    </>
  );
};
