/**
 * New tracks: makeTrack builds a track for an instrument with the usual starting settings (its
 * kind of part's sends, a recorded instrument's player feel, an orchestral seat, a return's fully
 * wet effects). Plain logic with no store or Web Audio in it, so the store's actions and the agent
 * tools (src/agent/) make tracks the same way, and Node can run it. timelineStore.ts re-exports it.
 */
import { INSTRUMENTS, playerFeel, seatOf } from '../audio/instrumentCatalog';
import { newKitDesign } from './drumDesign';
import { startSends } from './partKind';
import { defaultTrackFx, uid } from './timelineTypes';
import type { InstrumentKey, Track } from './timelineTypes';

/** A track for `instrumentKey` with the usual starting settings, named after it (numbered after those already there). */
export function makeTrack(instrumentKey: InstrumentKey, existing: Track[], name?: string): Track {
  const meta = INSTRUMENTS[instrumentKey];
  const count = existing.filter((t) => t.instrumentKey === instrumentKey).length;
  // The sends its kind of part starts with (partKind.ts): pads and leads in the room, a lead's echo
  const start = startSends(instrumentKey, instrumentKey === 'return' ? returnFx() : withHumanFeel(instrumentKey, defaultTrackFx()));
  return {
    id: uid('track'),
    name: name || (count > 0 ? `${meta.name} ${count + 1}` : meta.name),
    color: meta.color,
    instrumentKey,
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    // An orchestral instrument takes its usual seat on the stage (seatOf)
    pan: seatOf(instrumentKey)?.pan ?? 0,
    ...(seatOf(instrumentKey) ? { distance: seatOf(instrumentKey)!.distance } : {}),
    eq: { low: 0, mid: 0, high: 0 },
    fx: start.fx,
    // An orchestral instrument plays in the hall (a recording of one has as much of the room as of
    // the instrument); anything else as its kind of part starts
    reverbSend: seatOf(instrumentKey) ? SEATED_SEND : start.reverbSend,
    delaySend: 0,
    expressive: true,
    // A new Designed Kit starts on the modern kick and snare (NEW_KIT_PRESETS)
    ...(instrumentKey === 'designedKit' ? { drumDesign: newKitDesign() } : {}),
  };
}
/** A new orchestral track's reverb send (its distance adds to it: see distance.ts) */
export const SEATED_SEND = 0.35;

/** A recorded instrument starts with a player's feel (the Human insert, see playerFeel in the catalog). */
export function withHumanFeel(key: InstrumentKey, fx: Track['fx']): Track['fx'] {
  const feel = playerFeel(key);
  return feel ? { ...fx, human: { ...fx.human, on: true, ...feel, pitch: 0 } } : fx;
}

/** A return's effects start fully wet (the dry sound plays from the tracks that send to it), so its Delay and Reverb show the mix they'll use. */
export function returnFx(): Track['fx'] {
  const fx = defaultTrackFx();
  return { ...fx, echo: { ...fx.echo, mix: 1 }, reverb: { ...fx.reverb, mix: 1 } };
}

