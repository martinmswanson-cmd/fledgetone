/**
 * Ring and breath for a recorded instrument (Track.ring, Track.breathe): how long its notes take
 * to die away once let go, for long, substantial notes in dramatic and ambient music without a
 * sustain pedal lane; for wind and brass, whether the player runs out of breath on a long note; and,
 * for bowed and blown instruments, Living notes (Track.living): held notes that move as a player's do.
 */
import React from 'react';
import { Waves } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { RING_MAX, type Track } from '../../store/timelineTypes';
import { breathOf, INSTRUMENTS, livesWhenHeld } from '../../audio/instrumentCatalog';
import { InsertPanel } from './InsertFx';
import { LogSlider } from './BassPanels';

const st = useTimelineStore.getState;
const secs = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(1)} s`);
/** The ring a track gets when it's switched on */
const RING_DEFAULT = 6;

export const RingPanel: React.FC<{ track: Track }> = ({ track }) => {
  const def = INSTRUMENTS[track.instrumentKey];
  if (def.kind !== 'sampled' || !def.samples) return null;
  const accent = '#2dd4bf';
  const on = track.ring !== undefined;
  const breathes = breathOf(track.instrumentKey) !== undefined;
  return (
    <InsertPanel title="Ring" icon={<Waves className="w-3.5 h-3.5" style={{ color: accent }} />} on={on} onToggle={() => st().setTrackFeel(track.id, { ring: on ? undefined : RING_DEFAULT })} accent={accent}>
      <p className={`text-[10px] text-forge-muted leading-snug ${on ? '' : 'opacity-70'}`}>
        {on ? 'Notes ring on after they end, dying away over this long (as far as the recording rings).' : "Off: notes stop as the instrument's own do when let go."}
      </p>
      <LogSlider label="Ring" value={track.ring ?? RING_DEFAULT} lo={0.3} hi={RING_MAX} format={secs} onChange={(ring) => st().setTrackFeel(track.id, { ring }, false)} reset={RING_DEFAULT} accent={accent} disabled={!on} locked={!on} />
      {breathes && (
        <label data-search="breathe" className="flex items-center gap-2 text-[11px] text-forge-text cursor-pointer" title="A player runs out of breath on a long note, so it fades a little after about 6 to 9 seconds. Off: held notes hold at full level, as a drone.">
          <input type="checkbox" className="accent-teal-400" checked={track.breathe !== false} onChange={(e) => st().setTrackFeel(track.id, { breathe: e.target.checked ? undefined : false })} />
          Breathe
          <span className="text-forge-muted text-[10px]">long notes fade as the player tires</span>
        </label>
      )}
      {livesWhenHeld(track.instrumentKey) && (
        <label
          data-search="living notes vibrato held alive human"
          className="flex items-center gap-2 text-[11px] text-forge-text cursor-pointer"
          title="A held note moves as a player's does: its vibrato is there from the start, it comes up to its loudest and eases off, and its pitch drifts a few cents, each note a little differently. Off: every held note is steady and exactly in tune, as tracks made before this sounded."
        >
          <input type="checkbox" className="accent-teal-400" checked={!!track.living} onChange={(e) => st().setTrackFeel(track.id, { living: e.target.checked ? true : undefined })} />
          Living notes
          <span className="text-forge-muted text-[10px]">held notes move as a player's do</span>
        </label>
      )}
    </InsertPanel>
  );
};
