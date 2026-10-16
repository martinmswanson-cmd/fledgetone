/**
 * Splitting a mixdown into parts that render at the same time, each on its own processor core (see
 * renderTracks in exportWav.ts): the tracks are split into parts whose sounds only meet at the
 * master bus, each part's sound before the master section is rendered on its own, the parts are
 * added up, and the master section runs once over the sum. No Web Audio here, so Node can
 * unit-test it.
 *
 * That gives the same sound as one render only where everything before the master is linear: the
 * sum of two parts through it is the sum of each through it. Track strips are each track's own, so
 * any insert is fine there. What tracks share is the catch:
 * - A group bus or a return with a non-linear insert (a Compressor, Distortion, Lo-fi, multiband
 *   compressor or a plugin effect) must hear all its tracks at once, so they all go in one part.
 *   A bus or return with only linear inserts (EQ, Filter, Chorus, Delay, Reverb, Gate, Pump, Mono bass) is
 *   built again in each part that plays into it, and the copies add up to the one.
 * - The shared reverb (a convolver with a fixed impulse response) and delay (delay lines with a
 *   feedback gain, no saturation) are linear, so every part carries its own copy of them.
 *   The lush reverb (an AudioWorklet whose slow drift runs only while it hears something) is the
 *   exception: the parts send what they'd feed it, and it plays once over their sum, in plain
 *   JavaScript before the master section (renderInParts in exportWav.ts, lushAfter.ts).
 * - The Pump and ducking under a proxy track follow notes and clips, not sound: every part
 *   schedules the triggering notes (playing no instrument) and works out the same duck curve from
 *   the whole song, so they are the same in every part and need no grouping.
 * The groups that are left are packed into parts of about the same rough cost (trackCost).
 */
import { durationToBars, type Clip, type Track } from '../store/timelineTypes';
import { audibleIds, busChain, isMixTrack, liveSends } from '../store/buses';
import { INSTRUMENTS, type InstrumentKind } from './instrumentCatalog';

/**
 * The inserts that act on their input linearly: a bus or return with only these on can be copied
 * into several parts. Anything else that's on (and any insert added later, until it's listed
 * here) keeps the tracks playing into it together.
 */
const LINEAR_INSERTS = new Set(['chorus', 'filter', 'pump', 'gate', 'echo', 'reverb', 'peq', 'human', 'monoLow']);

/** Whether a bus or return's strip changes its sound depending on how loud it is (so its tracks can't be split). */
export function isNonLinearMix(track: Pick<Track, 'fx' | 'pluginFx' | 'plugin'>): boolean {
  if (track.pluginFx?.length || track.plugin) return true;
  return Object.entries(track.fx).some(([name, insert]) => !LINEAR_INSERTS.has(name) && (insert as { on?: boolean }).on === true);
}

/** Whether a track plays through a plugin (an instrument or effect), which runs as an AudioWorklet. */
const usesWorklet = (track: Pick<Track, 'pluginFx' | 'plugin'>) => !!track.plugin || !!track.pluginFx?.length;
/** Where the tracks with plugins meet in the union-find (not a track id). */
const WORKLET = '\u0000worklet';

/*
 * Render cost, roughly, in milliseconds per bar at 120 BPM, measured on the starters (they vary by
 * half again from run to run, so these only need to rank the tracks). Sound costs for as long as
 * it sounds: a held pad of the Synth Designer's stacked oscillators costs far more than many short
 * notes of a recorded instrument.
 */
/** Every bar of every note sounding, by instrument. */
const VOICE_COST: Partial<Record<InstrumentKind, number>> = { synth: 20, fx: 20, custom: 20, plugin: 60, drums: 10, sampled: 10, multi: 10, rack: 10, slicer: 10, audio: 10 };
/** ...for the instruments that cost more than their kind. */
const VOICE_COST_BY_KEY: Record<string, number> = { synthDesigner: 60 };
/** Each note's start. */
const NOTE_COST = 2;
/** Every bar of the range, for the track's strip and instrument, which run throughout. */
const TRACK_COST = 60;
/** Every bar, for each insert that's on (the ones not listed: 4). */
const INSERT_COST: Record<string, number> = { distortion: 30, compressor: 10, mbc: 40, reverb: 60, echo: 10, chorus: 10, lofi: 20, saturate: 20, monoLow: 5 };
/** Every bar, for what each part renders whatever its tracks: the shared reverb and delay, the schedule. */
const PART_COST = 50;

/** A rough guess at what rendering `track` over [startBar, endBar) costs, from its instrument, notes and inserts. */
export function trackCost(track: Track, clips: readonly Clip[], startBar: number, endBar: number): number {
  const kind = INSTRUMENTS[track.instrumentKey]?.kind ?? 'synth';
  const perVoiceBar = track.plugin ? (VOICE_COST.plugin ?? 0) : (VOICE_COST_BY_KEY[track.instrumentKey] ?? VOICE_COST[kind] ?? 0);
  let notes = 0;
  let voiceBars = 0;
  for (const c of clips) {
    if (c.trackId !== track.id || c.startBar >= endBar || c.startBar + c.lengthBars <= startBar) continue;
    if (c.audio) {
      voiceBars += Math.min(endBar, c.startBar + c.lengthBars) - Math.max(startBar, c.startBar);
      continue;
    }
    for (const n of c.notes) {
      const at = c.startBar + n.startOffset;
      if (at < startBar || at >= endBar) continue;
      notes++;
      voiceBars += Math.min(durationToBars(n.duration), endBar - at);
    }
  }
  const bars = Math.max(0, endBar - startBar);
  const inserts = Object.entries(track.fx).reduce((sum, [name, x]) => sum + ((x as { on?: boolean }).on ? (INSERT_COST[name] ?? 4) : 0), 0) + 40 * (track.pluginFx?.length ?? 0);
  return bars * (TRACK_COST + inserts) + voiceBars * perVoiceBar + notes * NOTE_COST;
}

/** Splitting has to make the render at least this much faster, by the cost guess, to be worth it. */
const WORTHWHILE = 1.2;

/**
 * Split `sounding` (the tracks a render plays, already filtered to the audible ones) into at most
 * `maxParts` parts that can each be rendered on their own and added up before the master section,
 * balanced by rough cost. Only tracks that play are placed: the buses and returns they play
 * through come along into each part that needs them (renderTracks adds them). `tracks` is the
 * whole song, for the routing. A single part means there's nothing worth splitting.
 */
export function renderParts(
  tracks: readonly Track[],
  sounding: readonly Track[],
  clips: readonly Clip[],
  range: { startBar: number; endBar: number },
  maxParts: number
): Track[][] {
  const players = sounding.filter((t) => !isMixTrack(t));
  if (maxParts < 2 || players.length < 2) return [players];
  const heard = audibleIds(tracks);
  const byId = new Map(tracks.map((t) => [t.id, t]));

  // Union-find over track ids: tracks meeting at a non-linear bus or return end up together
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const t of players) {
    find(t.id);
    // Every bus and return the track's sound reaches: its buses, the returns it or any of its
    // buses sends to, and theirs
    const buses = busChain(t, tracks);
    const reaches = [...buses];
    for (const from of [t, ...buses]) {
      for (const send of liveSends(from, tracks)) {
        const ret = byId.get(send.to);
        if (!ret || !heard.has(ret.id)) continue;
        reaches.push(ret, ...busChain(ret, tracks));
      }
    }
    for (const mix of reaches) if (isNonLinearMix(mix)) union(t.id, mix.id);
    // Not for the sound but the speed: plugins run as AudioWorklets, and Chromium renders every
    // offline context with one on a single shared thread, so they'd take turns in any part
    if ([t, ...reaches].some(usesWorklet)) union(t.id, WORKLET);
  }

  const groups = new Map<string, { tracks: Track[]; cost: number }>();
  for (const t of players) {
    const root = find(t.id);
    const group = groups.get(root) ?? { tracks: [], cost: 0 };
    group.tracks.push(t);
    group.cost += trackCost(t, clips, range.startBar, range.endBar);
    groups.set(root, group);
  }
  if (groups.size < 2) return [players];

  // Each part also renders what every part does (PART_COST), so: the fewest parts that come
  // within 5% of the fastest, each filled longest group first into the lightest part so far
  const fixed = PART_COST * Math.max(0, range.endBar - range.startBar);
  const total = [...groups.values()].reduce((sum, g) => sum + g.cost, 0);
  const sorted = [...groups.values()].sort((a, b) => b.cost - a.cost);
  const pack = (n: number) => {
    const parts = Array.from({ length: n }, () => ({ tracks: [] as Track[], cost: 0 }));
    for (const group of sorted) {
      const lightest = parts.reduce((min, p) => (p.cost < min.cost ? p : min));
      lightest.tracks.push(...group.tracks);
      lightest.cost += group.cost;
    }
    return { parts, time: fixed + Math.max(...parts.map((p) => p.cost)) };
  };
  const packings = Array.from({ length: Math.min(maxParts, groups.size) - 1 }, (_, i) => pack(i + 2));
  const fastest = Math.min(...packings.map((p) => p.time));
  const { parts, time } = packings.find((p) => p.time <= fastest * 1.05)!;
  if ((fixed + total) / time < WORTHWHILE) return [players];
  // In song order within each part, so a part builds its tracks in the order one render would
  const order = new Map(sounding.map((t, i) => [t.id, i]));
  return parts.map((p) => p.tracks.sort((a, b) => order.get(a.id)! - order.get(b.id)!));
}
