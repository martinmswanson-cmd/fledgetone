import React from 'react';
import { FolderOpen, Plug, Plus, Radio, Waypoints } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useTimelineStore } from '../../store/timelineStore';
import { InstrumentList } from '../InstrumentMenu';
import { useFloatingMenu } from '../useFloatingMenu';
import { pickAudioFolder } from './audioFiles';
import { importSamplePack } from './samplePackImport';

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
        <>
          <button
            type="button"
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-mono text-slate-200 hover:bg-slate-500/15 border-b border-forge-border"
            onClick={() => {
              useTimelineStore.getState().addTrack('bus');
              close();
            }}
            title="A group channel: route tracks into it (right-click a track) to share one fader, inserts and sends"
          >
            <Waypoints className="w-3.5 h-3.5 text-slate-300" />
            <span className="flex-1">Bus (group channel)</span>
            <span className="text-[10px] text-forge-muted">route tracks into it</span>
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-mono text-sky-200 hover:bg-sky-500/15 border-b border-forge-border"
            onClick={() => {
              useTimelineStore.getState().addReturn();
              close();
            }}
            title="An effect return: put a reverb or delay on it, then send any amount of any track to it"
          >
            <Radio className="w-3.5 h-3.5 text-sky-300" />
            <span className="flex-1">Return (effect return)</span>
            <span className="text-[10px] text-forge-muted">tracks send to it</span>
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-mono text-fuchsia-200 hover:bg-fuchsia-500/15 border-b border-forge-border"
            onClick={() => {
              useUiStore.getState().setPluginBrowser({ trackId: null, category: 'Instruments' });
              close();
            }}
            title="The built-in plugin instruments: synths, physical models, bells, drums"
          >
            <Plug className="w-3.5 h-3.5 text-fuchsia-300" />
            <span className="flex-1">Plugin instrument…</span>
            <span className="text-[10px] text-forge-muted">built in</span>
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-mono text-fuchsia-200 hover:bg-fuchsia-500/15 border-b border-forge-border"
            onClick={() => {
              useUiStore.getState().setPluginDialog({ trackId: null });
              close();
            }}
            title="A Web Audio Module instrument from the web, loaded by its address"
          >
            <Plug className="w-3.5 h-3.5 text-fuchsia-300" />
            <span className="flex-1">Plugin instrument (WAM)…</span>
            <span className="text-[10px] text-forge-muted">by URL</span>
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs font-mono text-rose-200 hover:bg-rose-500/15 border-b border-forge-border"
            onClick={() => {
              close();
              void pickAudioFolder().then((files) => importSamplePack(files));
            }}
            title="Pick a sample pack's folder: its drums become Drum Rack kits (kick, snare, hats… on their pads), an instrument's notes a Multi Sampler, its loops an Audio track. You can also drop the folder under the tracks."
          >
            <FolderOpen className="w-3.5 h-3.5 text-rose-300" />
            <span className="flex-1">Sample pack (folder)…</span>
            <span className="text-[10px] text-forge-muted">kits from your sounds</span>
          </button>
          <InstrumentList
            heading="Add Instrument Track"
            onPick={(key) => {
              useTimelineStore.getState().addTrack(key);
              close();
            }}
            onPickSound={(sound) => {
              useTimelineStore.getState().addSoundTrack(sound);
              close();
            }}
          />
        </>
      )}
    </>
  );
};
