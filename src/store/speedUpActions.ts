/**
 * The "Speed up into the drop" store action: the tempo rises over the last part of a block and
 * snaps back on the drop (or stays), with an optional drum roll that gets denser into it. One
 * undo step that writes ordinary tempo points (and notes), so live playback, every export, the
 * metronome, recording and the grid follow it. The maths is in speedUp.ts; this file applies it.
 */
import { songMeterOf, songTempo, splitClipAt, useTimelineStore } from './timelineStore';
import type { Clip, InstrumentKey, NoteEvent } from './timelineTypes';
import { uid } from './timelineTypes';
import { audioCuts, CUT_LEAD, barBeat, beatBars, describeBeats, rollNotes, speedUpPoints, type SpeedUpOptions } from './speedUp';
import { retimeAudioClips } from './audioClips';
import { retimeMarkers } from './markers';
import { isDrumKind } from '../audio/instrumentCatalog';
import { tempoAt } from '../audio/tempoMap';
import { DRUM_NOTES } from '../audio/instruments';

const tl = () => useTimelineStore.getState();
const EPS = 1e-6;
const ROLLED = new Set<string>([DRUM_NOTES.snare, DRUM_NOTES.clap]);

/** What the speed-up does besides the tempo. */
export interface SpeedUpExtras {
  /** The snare or clap in the sped-up part becomes a roll getting denser into the drop */
  roll: boolean;
}

/** Cut every audio clip that follows the tempo at `cuts` (bars), so each piece starts on its beat. */
function cutAudio(clips: readonly Clip[], cuts: readonly number[]): { clips: Clip[]; pieces: number } {
  const tempo = songTempo(tl());
  const out: Clip[] = [];
  let pieces = 0;
  for (const c of clips) {
    if (!c.audio?.stretchBpm) {
      out.push(c);
      continue;
    }
    let rest: Clip | null = c;
    for (const at of cuts) {
      if (!rest || at <= rest.startBar + EPS) continue;
      if (at >= rest.startBar + rest.lengthBars - EPS) break;
      const halves = splitClipAt(rest, at, tempo);
      if (!halves) continue;
      out.push(halves[0]);
      rest = halves[1];
      pieces++;
    }
    if (rest) out.push(rest);
  }
  return { clips: pieces ? out : [...clips], pieces };
}

/**
 * The drum roll: on the drum track that plays the most snare and clap in the block, those hits in
 * [start, drop) give way to a roll on the one it plays more, into the clips there (or a clip of
 * its own when a hit would fall outside them). Returns a word on what it did.
 */
function writeRoll(clips: Clip[], from: number, start: number, drop: number): { clips: Clip[]; said: string } {
  const s = tl();
  const abs = (c: Clip, n: NoteEvent) => c.startBar + n.startOffset;
  const inBlock = (c: Clip, n: NoteEvent, a: number) => abs(c, n) >= a - EPS && abs(c, n) < drop - EPS && n.startOffset < c.lengthBars - EPS && n.startOffset >= -EPS;
  let best: { trackId: string; note: string; velocity: number; count: number } | null = null;
  for (const t of s.tracks) {
    if (!isDrumKind(t.instrumentKey as InstrumentKey)) continue;
    const mine = clips.filter((c) => c.trackId === t.id && !c.audio);
    const hits = mine.flatMap((c) => c.notes.filter((n) => ROLLED.has(n.note) && inBlock(c, n, from)));
    const plays = mine.some((c) => c.startBar < drop - EPS && c.startBar + c.lengthBars > start + EPS);
    if (!hits.length && !plays) continue;
    const snares = hits.filter((n) => n.note === DRUM_NOTES.snare).length;
    const claps = hits.length - snares;
    const cand = { trackId: t.id, note: claps > snares ? DRUM_NOTES.clap : DRUM_NOTES.snare, velocity: hits.length ? Math.max(...hits.map((n) => n.velocity)) : 0.85, count: hits.length };
    if (!best || cand.count > best.count) best = cand;
  }
  if (!best) return { clips, said: ' No drum track plays there, so there is no roll.' };
  const { trackId, note } = best;
  const hits = rollNotes(start, drop, note, Math.max(0.6, best.velocity), () => uid('note'));
  // The snare and clap hits of the sped-up part go; the roll takes their place
  let out = clips.map((c) =>
    c.trackId !== trackId || c.audio ? c : { ...c, notes: c.notes.filter((n) => !(ROLLED.has(n.note) && inBlock(c, n, start))) }
  );
  const home = (bar: number) => out.find((c) => c.trackId === trackId && !c.audio && c.startBar <= bar + EPS && c.startBar + c.lengthBars > bar + EPS);
  if (hits.every((h) => home(h.startOffset))) {
    out = out.map((c) => {
      const mine = hits.filter((h) => home(h.startOffset) === c);
      return mine.length ? { ...c, notes: [...c.notes, ...mine.map((h) => ({ ...h, startOffset: Math.round((h.startOffset - c.startBar) * 1920) / 1920 }))] } : c;
    });
  } else {
    out.push({ id: uid('clip'), trackId, name: 'Drum roll', startBar: start, lengthBars: drop - start, notes: hits.map((h) => ({ ...h, startOffset: Math.round((h.startOffset - start) * 1920) / 1920 })), isSelected: false });
  }
  const name = s.tracks.find((t) => t.id === trackId)?.name ?? 'the drums';
  return { clips: out, said: ` The ${note === DRUM_NOTES.clap ? 'clap' : 'snare'} on ${name} rolls into the drop.` };
}

/**
 * Speed up the last part of the block [from, to) into the drop at `to`. One undo step: Undo puts
 * the tempo map (and the clips) back exactly. Returns a message for the person.
 */
export function speedUpIntoDrop(o: SpeedUpOptions, extras: SpeedUpExtras): string {
  const s = tl();
  const meter = songMeterOf(s);
  const plan = speedUpPoints(s.tempoPoints, songTempo(s), meter, o, () => uid('tempo'));
  if (typeof plan === 'string') return plan;
  const newTempo = songTempo({ bpm: s.bpm, tempoPoints: plan.points });
  let said = '';
  s.checkpoint();
  const past = tl().past;
  // Audio clips that follow the tempo: a piece per beat (or less) over the speed-up, and one from the drop
  // (a moment before each beat, so a hit on the beat keeps its attack; right on it where the tempo
  // jumps there, as at the snap back, or the piece would play on at the tempo before the jump)
  const cuts = audioCuts(plan.start, plan.drop, newTempo, beatBars(plan.start, meter)).map((bar) =>
    Math.abs(tempoAt(bar - CUT_LEAD, newTempo) / tempoAt(bar, newTempo) - 1) < 0.01 ? bar - CUT_LEAD : bar
  );
  const audio = cutAudio(s.clips, cuts);
  let clips = audio.clips;
  if (audio.pieces) said += ` Audio clips that follow the tempo are cut on the beats there (${audio.pieces} cut${audio.pieces === 1 ? '' : 's'}) so they keep time.`;
  if (extras.roll) {
    const r = writeRoll(clips, o.from, plan.start, plan.drop);
    clips = r.clips;
    said += r.said;
  }
  useTimelineStore.setState((st) => ({
    tempoPoints: plan.points,
    clips: retimeAudioClips(clips, songTempo(st), newTempo),
    markers: retimeMarkers(st.markers, newTempo),
  }));
  // One undo step, whatever the edits above recorded
  useTimelineStore.setState({ past, future: [] });
  const what = `${describeBeats(plan.beats, plan.start, meter)} from ${barBeat(plan.start, meter)}`;
  const top = `${Math.round(plan.fromBpm * 10) / 10} → ${Math.round(plan.toBpm * 10) / 10} BPM${plan.capped ? ' (held at 240, the fastest)' : ''}`;
  const after = o.snapBack ? `, back to ${Math.round(plan.afterBpm * 10) / 10} on the drop` : ', and it stays there';
  const replaced = plan.replaced ? ` It replaces ${plan.replaced} tempo change${plan.replaced === 1 ? '' : 's'} that were there.` : '';
  return `Speeds up over ${what}: ${top}${after}.${replaced}${said} Undo takes it out.`;
}

/** The selected clips' span, or null when none are selected. */
export function selectedSpan(): { from: number; to: number } | null {
  const sel = tl().clips.filter((c) => c.isSelected);
  if (!sel.length) return null;
  return { from: Math.min(...sel.map((c) => c.startBar)), to: Math.max(...sel.map((c) => c.startBar + c.lengthBars)) };
}

/**
 * The block a speed-up is offered for, near `bar` (the drop, when a menu was opened there): the
 * loop when `bar` is in it (or, with no bar, when it's on), else the selected clips' span when
 * `bar` is in it, else the 4 bars before `bar` (or the playhead).
 */
export function suggestBlock(bar?: number): { from: number; to: number; source: 'loop' | 'clips' | 'bars' } {
  const s = tl();
  const loop = s.loopRegion;
  const within = (a: number, b: number) => bar !== undefined && bar >= a - EPS && bar <= b + EPS;
  if (loop.outBar - loop.inBar > EPS && (within(loop.inBar, loop.outBar) || (bar === undefined && loop.enabled))) return { from: loop.inBar, to: loop.outBar, source: 'loop' };
  const sel = selectedSpan();
  if (sel && (bar === undefined || within(sel.from, sel.to))) return { ...sel, source: 'clips' };
  const drop = Math.max(2, Math.round(bar ?? s.playheadPosition));
  return { from: Math.max(1, drop - 4), to: drop, source: 'bars' };
}
