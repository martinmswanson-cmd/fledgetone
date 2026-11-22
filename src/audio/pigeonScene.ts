/**
 * Pigeons video picture: the song's notes played by low-poly pigeons walking, hopping and flying
 * across a big piano keyboard, seen from above at an angle. Drawn with three.js, one frame for any
 * time asked (the export asks in order, but nothing here depends on that): the keys press and light
 * up in their track's colour, and a pigeon is standing on each key as it plays.
 *
 * Who goes where is worked out once, up front (planPigeons): each note gets the free pigeon that can
 * get there in time (else the nearest, which flies), and every pigeon's day becomes a list of legs
 * (stand, walk, hop, fly) that a frame just reads. A bird playing the same key again hops on the
 * spot; a jump of FLAP_DISTANCE or more is flown with the wings out. No two birds ever touch
 * (solveSpacing, spreadWings; scripts/pigeonScene.test.mjs). Drum hits aren't played by birds.
 */
import * as T from 'three';
import type { ShowcaseData, ShowcaseNote } from '../store/showcase';
import { maxOf, minOf } from '../support/minMax';
import { bankSize, DRUM_R, DRUM_TOP, KICK_SIZE, PAD_D, PAD_GAP, PAD_TOP, PAD_W, padSpot, stageBox, stageFor, type DrumPad, type PadBank, type Stage } from './pigeonStage';
import { backgroundAt, backgroundOf, cameraAt, cameraOf, cleanLook, energyAt, flaresAt, pulseAt, senseMusic, travelAt, turnAt, uprightRoll, type BackgroundId, type MusicSense, type PigeonBackground, type PigeonCamera, type PigeonLook } from './pigeonLooks';

// ---------------------------------------------------------------------------------------------
// The keyboard, in scene units: a white key is 1 wide; the keys run along x, their fronts toward +z

const WHITE_W = 1;
const WHITE_L = 6;
const WHITE_TOP = 0.9;
const BLACK_W = 0.58;
const BLACK_L = 3.7;
const BLACK_TOP = 1.45;
/** How far a key goes down when played */
const PRESS = 0.22;
/**
 * Where a pigeon stands on a key (z), facing the viewer: the front of a white key, the back half of
 * a black one, so birds on a white key and the black key beside it are clear of each other
 * (BIRD_SHAPE), as birds on two neighbouring white keys, or black keys, are side by side
 */
const WHITE_STAND_Z = WHITE_L / 2 - 1;
const BLACK_STAND_Z = -0.85;
/** The floor's lines where pigeons wait: in front of the keys and behind them */
/**
 * On a stage (pads in front of the keys, drums behind) the keyboard's spare birds wait at its two
 * ends instead: this far from the end at the nearest, over this much floor, and no further forward
 * or back than this (inside the lanes beside the keys, so their way to a key never crosses a pad)
 */
const WINGS_NEAR = 1.6;
const WINGS_DEEP = 3.4;
const WINGS_REACH = 4.6;
/** How far beyond the keyboard's last key a bird rounds its corner, walking between the end and the lane beside the keys */
const WINGS_CORNER = 1.9;
/** How steeply a stage runs up a tall frame at the least, and across a wide one at the most (radians up from level) */
const STAGE_SLOPE = { tall: 1.42, wide: 0.1 };
/** How far behind its drum a drum's bird stands: its beak, pecking, comes down on the drum's top */
const DRUM_STAND = 1.5;
const FRONT_Z = WHITE_L / 2 + 2.2;
const BACK_Z = -WHITE_L / 2 - 2.4;

/**
 * The key bed: the keyboard's dark body. The keys stand in it: their undersides are down inside it
 * and stay inside it however far they're pressed, so no key ever shows under the keyboard.
 */
const BED_TOP = 0.46;
const BED_MARGIN = 0.2;
/** Where the keys' undersides are (above the floor even when pressed: KEY_FLOOR - PRESS > 0) */
const KEY_FLOOR = 0.3;
/** The room left between a key and the next */
const KEY_GAP = 0.03;

const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
/** Index of the white key at or below `midi` (C-1 = 0) */
const whiteIndex = (midi: number) => {
  const octave = Math.floor(midi / 12);
  const pc = ((midi % 12) + 12) % 12;
  return octave * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pc];
};
/** A key's centre along x */
function keyX(midi: number): number {
  const w = whiteIndex(midi) * WHITE_W;
  return isBlack(midi) ? w + WHITE_W : w + WHITE_W / 2;
}
const keyTop = (midi: number) => (isBlack(midi) ? BLACK_TOP : WHITE_TOP);
const standZ = (midi: number) => (isBlack(midi) ? BLACK_STAND_Z : WHITE_STAND_Z);

/** A box: its least and greatest x, y and z */
export interface KeyBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/**
 * The shape of each key from `low` to `high`, as boxes, at rest. A white key is its head (the
 * front, its full width) and its tail (the back, cut away where a black key sits beside it, as on
 * a real keyboard); a black key is one box standing in those cuts. No two keys share any space,
 * pressed or not, and none reaches down out of the bed (scripts/pigeonScene.test.mjs).
 */
export function keyBoxes(low: number, high: number): Array<{ midi: number; black: boolean; boxes: KeyBox[] }> {
  const back = -WHITE_L / 2;
  const front = WHITE_L / 2;
  const blackFront = back + BLACK_L;
  const out: Array<{ midi: number; black: boolean; boxes: KeyBox[] }> = [];
  for (let m = low; m <= high; m++) {
    const x = keyX(m);
    if (isBlack(m)) {
      out.push({ midi: m, black: true, boxes: [{ x0: x - BLACK_W / 2, x1: x + BLACK_W / 2, y0: KEY_FLOOR, y1: BLACK_TOP, z0: back, z1: blackFront }] });
      continue;
    }
    const half = WHITE_W / 2 - KEY_GAP / 2;
    // (cut back to clear a black key on that side, if there's one there in this keyboard)
    const cut = (to: number) => (to >= low && to <= high && isBlack(to) ? WHITE_W / 2 - BLACK_W / 2 - KEY_GAP : half);
    out.push({
      midi: m,
      black: false,
      boxes: [
        { x0: x - half, x1: x + half, y0: KEY_FLOOR, y1: WHITE_TOP, z0: blackFront + KEY_GAP, z1: front },
        { x0: x - cut(m - 1), x1: x + cut(m + 1), y0: KEY_FLOOR, y1: WHITE_TOP, z0: back, z1: blackFront + KEY_GAP },
      ],
    });
  }
  return out;
}

/** The key bed's box, for keys from `low` to `high` */
export function bedBox(low: number, high: number): KeyBox {
  return { x0: keyX(low) - WHITE_W / 2 - BED_MARGIN, x1: keyX(high) + WHITE_W / 2 + BED_MARGIN, y0: 0, y1: BED_TOP, z0: -WHITE_L / 2 - BED_MARGIN, z1: WHITE_L / 2 + BED_MARGIN };
}

/** How far a key goes down when played (for the tests) */
export const KEY_PRESS = PRESS;

// ---------------------------------------------------------------------------------------------
// The plan: every pigeon's legs, worked out once

type LegKind = 'stand' | 'walk' | 'hop' | 'fly' | 'press';
interface Leg {
  kind: LegKind;
  t0: number;
  t1: number;
  from: T.Vector3;
  to: T.Vector3;
  /** press: the note it's playing */
  note?: ShowcaseNote;
  /** The key it's standing on, or hopping on the spot over (it goes down with the key as it plays) */
  key?: number;
}
interface PigeonPlan {
  legs: Leg[];
  /** A little variety per bird: feather shade, step phase */
  seed: number;
  /** The bird's size (its model's scale): a little under 1 to a little over */
  size: number;
  /** What it plays: the keyboard (not said), a bank of pads it never leaves, the kick's pad, or a drum it stands at and pecks */
  role?: 'pad' | 'kick' | 'drum';
  /** A drum's bird: when it pecks (seconds, in order) */
  pecks?: number[];
}

/** Walking pace (units a second) and the hop and flight times */
const WALK_SPEED = 5.5;
const HOP_TIME = 0.26;
/** A hop on the spot, to play the same key again: how long it takes at most, and how high it goes for that */
const REHOP_TIME = 0.16;
const REHOP_HEIGHT = 0.5;
/** A jump this far or further (scene units; a white key is 1 wide) is flown: the wings spread and flap */
const FLAP_DISTANCE = 1.4;
/**
 * How high a hop onto or off the keys, or a flight, goes: in the middle third of it a bird is clear
 * over the head of one standing on a black key (the higher keys), so it can turn round there
 */
const CLEAR_HOP = 2.9;
const HOP_REACH = 1.6;
/**
 * A bird lands this long before its note: not at all. It touches the key as the note starts and the
 * key goes down under it (KEY_TRAVEL), so the press is seen as the note is heard
 */
const LAND_EARLY = 0;

const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 0x1000000;
  };
};

const flatDist = (a: T.Vector3, b: T.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** The most notes sounding at once */
function polyphony(notes: ShowcaseNote[]): number {
  const edges: Array<[number, number]> = [];
  for (const n of notes) edges.push([n.start, 1], [n.end, -1]);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let most = 0;
  for (const [, d] of edges) most = Math.max(most, (now += d));
  return most;
}

export interface PigeonPlanResult {
  pigeons: PigeonPlan[];
  /** The notes the birds play (no drums), sorted by start */
  notes: ShowcaseNote[];
  /** The lowest and highest keys drawn */
  low: number;
  high: number;
  /** The notes on each key, in order */
  byKey: Map<number, ShowcaseNote[]>;
  /** The banks of pads and the drum pads beside the keyboard (none: everything's on the keyboard) */
  stage: Stage;
  /** The notes on each pad, in order: by padKey(its bank's place in stage.banks, its pitch) */
  byPad: Map<number, ShowcaseNote[]>;
}

/** A pad's key in PigeonPlanResult.byPad */
export const padKey = (bank: number, midi: number): number => bank * 1000 + midi;

/**
 * The keys a keyboard needs for these pitches: whole octaves around what's played, at least four of
 * them. `snug` (on a stage, where the camera holds the whole keyboard): just the octaves played, at
 * least three, so nothing is spent on keys nobody touches
 */
function keyboardRange(mids: number[], snug = false): { low: number; high: number } {
  let low = mids.length ? minOf(mids) : 48;
  let high = mids.length ? maxOf(mids) : 72;
  if (snug) {
    low = Math.floor(low / 12) * 12;
    high = Math.max(low + 36, Math.ceil(high / 12) * 12);
    return { low: Math.max(0, low), high: Math.min(127, high) };
  }
  low = Math.floor(low / 12) * 12 - 12;
  high = Math.ceil((high + 1) / 12) * 12 + 12;
  while (high - low < 48) {
    low -= 6;
    high += 6;
  }
  return { low: Math.max(0, Math.floor(low / 12) * 12), high: Math.min(127, Math.ceil(high / 12) * 12) };
}

export interface PlanOptions {
  /** Fast parts on banks of pads and the drums on drum pads, each with birds of their own (pigeonStage.ts); off, everything pitched is on the keyboard and the drums aren't played */
  pads?: boolean;
}

export function planPigeons(data: ShowcaseData, opts: PlanOptions = {}): PigeonPlanResult {
  const stage = stageFor(data, !!opts.pads, (keys) => {
    const range = keyboardRange(keys.map((n) => n.midi), true);
    return (keyX(range.low) + keyX(range.high)) / 2;
  });
  const staged = stage.banks.length > 0 || stage.drums.length > 0;
  const notes = [...stage.keys].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const { low, high } = keyboardRange(notes.map((n) => n.midi), staged);

  // (on a stage the keyboard has the slower parts alone: it needs fewer birds to spare)
  const count = staged ? Math.min(24, Math.max(4, polyphony(notes) + 5)) : Math.min(30, Math.max(6, polyphony(notes) * 2 + 4));
  const r = rand(1234);
  const x0 = keyX(low);
  const x1 = keyX(high);
  interface Bird {
    plan: PigeonPlan;
    at: T.Vector3;
    free: number;
    onKeys: boolean;
  }
  const birds: Bird[] = [];
  for (let i = 0; i < count; i++) {
    const front = i % 2 === 0;
    // Waiting in front of the keys and behind them; on a stage (pads in front, drums behind) at the keyboard's two ends
    const at = staged
      ? new T.Vector3(i % 2 ? x1 + WINGS_NEAR + r() * WINGS_DEEP : x0 - WINGS_NEAR - r() * WINGS_DEEP, 0, (r() * 2 - 1) * WINGS_REACH)
      : new T.Vector3(x0 + ((i + 0.5) / count) * (x1 - x0) + (r() - 0.5) * 2, 0, (front ? FRONT_Z : BACK_Z) + (front ? 1 : -1) * r() * 3);
    birds.push({ plan: { legs: [], seed: Math.floor(r() * 1e9), size: 1 + r() * 0.06 }, at, free: -10, onKeys: false });
  }

  const push = (b: Bird, leg: Leg) => b.plan.legs.push(leg);
  /** Somewhere to wait on the floor near x, on one side of the keys: of a few spots, the one with the most room round it */
  const floorSpot = (x: number, front: boolean) => {
    let best = new T.Vector3();
    let bestRoom = -1;
    for (let tries = 0; tries < 6; tries++) {
      // (on a stage: at the nearer end of the keyboard, on that side of it, within the lanes beside the keys)
      const spot = staged
        ? new T.Vector3(x < (x0 + x1) / 2 ? x0 - WINGS_NEAR - r() * WINGS_DEEP : x1 + WINGS_NEAR + r() * WINGS_DEEP, 0, (front ? 1 : -1) * r() * WINGS_REACH)
        : new T.Vector3(x + (r() - 0.5) * 5, 0, front ? FRONT_Z + r() * 4 : BACK_Z - r() * 4);
      let room = Infinity;
      for (const b of birds) room = Math.min(room, flatDist(b.at, spot));
      if (room > bestRoom) {
        bestRoom = room;
        best = spot;
      }
    }
    return best;
  };
  /**
   * Which side of the keyboard a bird gets on and off a key from: the front for a white key, the
   * back for a black one (it stands on the back half), so it never steps across the row of birds
   * on the other keys. On the floor: the side it's on.
   */
  const sideOf = (at: T.Vector3) => (at.y > 0 ? (at.y > WHITE_TOP + 0.01 ? -1 : 1) : at.z > 0 ? 1 : -1);
  // (where a bird stands on the floor to hop up: clear of the key bed)
  const EDGE = WHITE_L / 2 + BED_MARGIN + 0.55;
  /** Moves `b` from where it is to `to`, arriving at `arrive` (leaving no earlier than b.free), the way the room allows */
  const travel = (b: Bird, to: T.Vector3, arrive: number) => {
    const d = flatDist(b.at, to);
    // (onto the keys from the floor, or down: a key to a key, white or black, is no climb)
    const climbs = b.at.y > 0 !== to.y > 0;
    if (d < 0.05 && !climbs) return;
    const window = arrive - b.free;
    const keyToKey = b.at.y > 0 && to.y > 0;
    // (between the floor on one side and a key got on from the other, it flies over the keys)
    const wrongSide = climbs && sideOf(b.at) !== sideOf(to);
    if ((keyToKey && d > HOP_REACH) || wrongSide) {
      // Across the keys it flies, low, over the birds playing (walking it would be boxed in among them)
      const time = Math.min(0.8, Math.max(0.3, d / 10));
      push(b, { kind: 'fly', t0: Math.max(b.free, arrive - time), t1: arrive, from: b.at.clone(), to: to.clone() });
    } else if (keyToKey && window >= HOP_TIME * 0.6) {
      const t0 = Math.max(b.free, arrive - HOP_TIME);
      push(b, { kind: 'hop', t0, t1: arrive, from: b.at.clone(), to: to.clone() });
    } else if (!climbs && d / WALK_SPEED <= window) {
      push(b, { kind: 'walk', t0: arrive - d / WALK_SPEED, t1: arrive, from: b.at.clone(), to: to.clone() });
    } else if (climbs) {
      // Walk along the floor to the keys' edge on its side, and hop up (or hop down, and walk off)
      const up = to.y > 0;
      const key = up ? to : b.at;
      const ground = up ? b.at : to;
      const edge = new T.Vector3(key.x, 0, sideOf(key) * EDGE);
      // (on a stage it waits beyond the keyboard's end: it walks round the corner and along the lane beside the keys, never through them)
      const corner = staged ? new T.Vector3(ground.x < (x0 + x1) / 2 ? x0 - WINGS_CORNER : x1 + WINGS_CORNER, 0, edge.z) : null;
      const cornerTime = corner ? flatDist(ground, corner) / WALK_SPEED : 0;
      const walkTime = cornerTime + flatDist(corner ?? ground, edge) / WALK_SPEED;
      const time = walkTime + HOP_TIME;
      const t0 = Math.max(b.free, arrive - time);
      const t1 = Math.max(arrive, t0 + time * 0.5);
      const pace = (t1 - t0) / time;
      const split = t0 + (up ? walkTime : HOP_TIME) * pace;
      if (up) {
        if (corner) push(b, { kind: 'walk', t0, t1: t0 + cornerTime * pace, from: b.at.clone(), to: corner.clone() });
        push(b, { kind: 'walk', t0: t0 + cornerTime * pace, t1: split, from: (corner ?? b.at).clone(), to: edge.clone() });
        push(b, { kind: 'hop', t0: split, t1, from: edge.clone(), to: to.clone() });
      } else {
        push(b, { kind: 'hop', t0, t1: split, from: b.at.clone(), to: edge.clone() });
        push(b, { kind: 'walk', t0: split, t1: t1 - cornerTime * pace, from: edge.clone(), to: (corner ?? to).clone() });
        if (corner) push(b, { kind: 'walk', t0: t1 - cornerTime * pace, t1, from: corner.clone(), to: to.clone() });
      }
      arrive = t1;
    } else {
      // Too far to walk: it flies (quickly, if it must)
      const t0 = Math.max(b.free, arrive - Math.max(0.35, d / 16));
      push(b, { kind: 'fly', t0: Math.min(t0, arrive - 0.12), t1: arrive, from: b.at.clone(), to: to.clone() });
    }
    b.at = to.clone();
    b.free = arrive;
  };
  /** `c` gets down off the keys at `depart` and waits on the floor, on the side it got on from */
  const stepOff = (c: Bird, depart: number) => {
    const wait = floorSpot(c.at.x, sideOf(c.at) > 0);
    c.free = Math.max(c.free, depart);
    travel(c, wait, c.free + flatDist(c.at, wait) / WALK_SPEED + HOP_TIME);
    c.onKeys = false;
  };

  for (const n of notes) {
    const spot = new T.Vector3(keyX(n.midi), keyTop(n.midi), standZ(n.midi));
    const arrive = n.start - LAND_EARLY;
    const len = n.end - n.start;
    // Short notes: it's off again before the key comes up (so one bird can run a fast line)
    const leave = len > 0.4 ? n.end : n.start + Math.max(0.06, len * 0.55);
    const onSpot = (b: Bird) => b.onKeys && flatDist(b.at, spot) < 0.05;
    // Birds that have stood about on the keys for a while get down onto the floor, out of the way
    for (const c of birds) if (c.onKeys && c.free < n.start - 1.5 && !onSpot(c)) stepOff(c, c.free + 0.3);
    // The key's still held by a bird when this note starts (another track playing the same note):
    // that bird plays this one too
    const holder = birds.find((b) => onSpot(b) && b.free > n.start + 1e-3);
    if (holder) {
      // It hops on the spot and strikes the key afresh as this note starts (so every note is seen
      // played), unless the two notes start together or there's no time to; then it stays on for both
      const last = holder.plan.legs[holder.plan.legs.length - 1];
      const until = Math.max(last.t1, leave);
      const off = Math.max(last.t0 + 0.05, n.start - REHOP_TIME);
      if (last.kind === 'press' && n.start - off > 0.04) {
        last.t1 = off;
        push(holder, { kind: 'hop', t0: off, t1: n.start, from: spot.clone(), to: spot.clone(), key: n.midi });
        push(holder, { kind: 'press', t0: n.start, t1: until, from: spot.clone(), to: spot.clone(), note: n, key: n.midi });
      } else last.t1 = until;
      holder.free = until;
      continue;
    }
    // A bird still standing on this key (it played it last) plays it again; else the free bird that
    // can walk (or hop) there in time, nearest first; else the nearest free one
    const parked = birds.find((b) => onSpot(b) && b.free <= n.start + 1e-3);
    let best: Bird | null = parked ?? null;
    let bestCost = parked ? -1 : Infinity;
    for (const b of birds) {
      if (parked) break;
      if (b.free > arrive - 0.02) continue;
      const d = flatDist(b.at, spot);
      // (from a key it side-steps or flies along; from the floor it walks to the keys and hops up)
      const walks = b.onKeys ? d <= HOP_REACH || Math.min(0.8, Math.max(0.3, d / 10)) <= arrive - b.free : d / WALK_SPEED + HOP_TIME <= arrive - b.free;
      const cost = d + (walks ? 0 : 1000) + (b.onKeys ? 0 : 3);
      if (cost < bestCost) {
        bestCost = cost;
        best = b;
      }
    }
    if (!best) continue;
    const b = best;
    // Any other bird waiting on this key steps off onto the floor before this one lands
    for (const c of birds) if (c !== b && onSpot(c)) stepOff(c, Math.max(c.free, arrive - 0.9));
    if (b !== parked) travel(b, spot, arrive);
    else {
      // The same key again: it hops on the spot to strike it afresh, leaving the note before a
      // little early if it must to have time for it
      const last = b.plan.legs[b.plan.legs.length - 1];
      if (last.kind === 'press' && last.t1 > arrive - REHOP_TIME) last.t1 = Math.max(last.t0 + 0.04, Math.min(last.t1, arrive - REHOP_TIME));
      const t0 = Math.max(last.t1, arrive - REHOP_TIME);
      if (arrive - t0 > 0.03) push(b, { kind: 'hop', t0, t1: arrive, from: spot.clone(), to: spot.clone(), key: n.midi });
      b.free = Math.max(arrive, t0);
    }
    push(b, { kind: 'press', t0: Math.max(arrive, b.free), t1: Math.max(leave, b.free + 0.05), from: spot.clone(), to: spot.clone(), note: n, key: n.midi });
    b.free = Math.max(leave, b.free + 0.05);
    b.onKeys = true;
  }
  // Off the keys at the end
  for (const b of birds) if (b.onKeys) stepOff(b, b.free + 0.2);

  // The stage's own birds: each bank of pads has a few that never leave it, the kick's pad one that stomps it, each drum one that pecks it
  const byPad = new Map<number, ShowcaseNote[]>();
  const resident = (role: PigeonPlan['role'], at: T.Vector3): Bird => {
    const b: Bird = { plan: { legs: [], seed: Math.floor(r() * 1e9), size: 1 + r() * 0.06, role }, at, free: -10, onKeys: true };
    birds.push(b);
    return b;
  };
  /** A hop between pads: as late as it can be, so it lands as the note starts; a hop on the spot for the same pad again */
  const padHop = (b: Bird, to: T.Vector3, arrive: number) => {
    const d = flatDist(b.at, to);
    const time = d < 0.05 ? REHOP_TIME : Math.min(0.24, 0.1 + d * 0.03);
    const t0 = Math.max(b.free, arrive - time);
    if (arrive - t0 > 0.03) push(b, { kind: 'hop', t0, t1: arrive, from: b.at.clone(), to: to.clone() });
    b.at = to.clone();
    b.free = Math.max(b.free, arrive);
  };
  /** Plays `list` (in order) on spots: each note to the bird on its spot already, else the free bird nearest, else the one free soonest */
  const playPads = (flock: Bird[], list: ShowcaseNote[], spotOf: (n: ShowcaseNote) => T.Vector3 | null) => {
    for (const n of list) {
      const spot = spotOf(n);
      if (!spot) continue;
      const len = n.end - n.start;
      const leave = len > 0.4 ? n.end : n.start + Math.max(0.05, len * 0.5);
      const here = flock.find((b) => flatDist(b.at, spot) < 0.05);
      let b = here;
      if (!b) {
        const free = flock.filter((x) => x.free <= n.start - 0.06);
        b = (free.length ? free : flock).reduce((best, x) => (free.length ? flatDist(x.at, spot) < flatDist(best.at, spot) : x.free < best.free) ? x : best);
      }
      const last = b.plan.legs[b.plan.legs.length - 1];
      if (here && last?.kind === 'press' && last.t1 > n.start - 0.05) {
        // It's on this pad, playing still (or only just done): it lifts off in time to strike it again, if there's time to
        const off = Math.max(last.t0 + 0.05, n.start - REHOP_TIME);
        if (n.start - off <= 0.04) {
          last.t1 = Math.max(last.t1, leave);
          b.free = last.t1;
          continue;
        }
        last.t1 = off;
        b.free = off;
      }
      padHop(b, spot, n.start);
      const t0 = Math.max(n.start, b.free);
      push(b, { kind: 'press', t0, t1: Math.max(leave, t0 + 0.04), from: spot.clone(), to: spot.clone(), note: n });
      b.free = Math.max(leave, t0 + 0.04);
    }
  };
  stage.banks.forEach((bank, bi) => {
    const spotOf = (midi: number) => {
      const at = padSpot(bank, midi);
      return at ? new T.Vector3(at.x, PAD_TOP, at.z) : null;
    };
    // Its birds start spread along its pads
    const flock = Array.from({ length: bank.birds }, (_, i) => resident('pad', spotOf(bank.pitches[Math.min(bank.pitches.length - 1, Math.round(((i + 0.5) / bank.birds) * bank.pitches.length - 0.5))])!));
    // (no two on one pad to begin with: a bank with fewer pads than birds has fewer birds)
    const seen = new Set<string>();
    const placed = flock.filter((b) => {
      const k = `${b.at.x.toFixed(2)},${b.at.z.toFixed(2)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (const b of flock) if (!placed.includes(b)) birds.splice(birds.indexOf(b), 1);
    const list = [...bank.notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
    playPads(placed, list, (n) => spotOf(n.midi));
    for (const n of list) {
      const k = padKey(bi, n.midi);
      const at = byPad.get(k);
      if (at) at.push(n);
      else byPad.set(k, [n]);
    }
  });
  for (const drum of stage.drums) {
    if (drum.kind === 'kick') {
      // The kick's bird stands on its pad and stomps it: a hop on the spot, down on each hit
      const spot = new T.Vector3(drum.x, PAD_TOP, drum.z);
      const bird = resident('kick', spot.clone());
      playPads([bird], drum.hits.map((t): ShowcaseNote => ({ start: t, end: t + 0.12, midi: 0, color: drum.color, track: -1, drum: true })), () => spot);
    } else {
      // A drum's bird stands behind it and pecks it
      resident('drum', new T.Vector3(drum.x, 0, drum.z - DRUM_STAND)).plan.pecks = drum.hits;
    }
  }
  // Fill the gaps between legs with standing still
  for (const b of birds) {
    const legs: Leg[] = [];
    let at = b.plan.legs.length ? b.plan.legs[0].from : b.at;
    let t = -1e6;
    // (the key it was left standing on, if any)
    let key: number | undefined;
    for (const leg of b.plan.legs) {
      if (leg.t0 > t) legs.push({ kind: 'stand', t0: t, t1: leg.t0, from: at.clone(), to: at.clone(), key });
      legs.push(leg);
      at = leg.to;
      t = leg.t1;
      key = leg.key;
    }
    legs.push({ kind: 'stand', t0: t, t1: 1e6, from: at.clone(), to: at.clone(), key });
    b.plan.legs = legs;
  }
  const byKey = new Map<number, ShowcaseNote[]>();
  for (const n of notes) {
    const list = byKey.get(n.midi);
    if (list) list.push(n);
    else byKey.set(n.midi, [n]);
  }
  return { pigeons: birds.map((b) => b.plan), notes, low, high, byKey, stage, byPad };
}

// ---------------------------------------------------------------------------------------------
// The pigeon: a low-poly rock dove, flat-shaded. Its body, neck and head are lofted (rings of
// points along a spine), its wings and tail are thin slabs, and every face carries its own colour
// (one material for all the birds). It faces +x in its own space, its feet on y = 0.

/** Every bird's faces: flat-shaded, each face in the colour its corners carry */
const FEATHERS = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
/** A dark ink outline (a slightly fatter copy, its back faces only), so a bird reads against the pale floor and keys */
const INK = new T.MeshBasicMaterial({ color: 0x2b2836, side: T.BackSide });
const SHARED: T.Material[] = [FEATHERS, INK];

type P3 = [number, number, number];

/** Collects coloured triangles into a geometry, each facing away from the middle of its part */
class Mesher {
  private pos: number[] = [];
  private col: number[] = [];
  /** How many corners it has so far */
  get count(): number {
    return this.pos.length / 3;
  }
  /** A triangle in `color`, wound so it faces away from `inside` */
  tri(a: P3, b: P3, c: P3, color: T.Color, inside: P3) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const out = nx * ((a[0] + b[0] + c[0]) / 3 - inside[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - inside[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - inside[2]);
    for (const p of out >= 0 ? [a, b, c] : [a, c, b]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r, color.g, color.b);
    }
  }
  quad(a: P3, b: P3, c: P3, d: P3, color: T.Color, inside: P3) {
    this.tri(a, b, c, color, inside);
    this.tri(a, c, d, color, inside);
  }
  /**
   * A lofted shape: at each station along a spine in the x-y plane (x, y, half its width across z,
   * half its height, its colour), a ring of `sides` points, square to the spine; `under` colours the
   * faces on its underside. The ends are closed.
   */
  loft(stations: Array<{ x: number; y: number; w: number; h: number; color: T.Color; under?: T.Color }>, sides: number) {
    const rings: P3[][] = stations.map((s, i) => {
      const a = stations[Math.max(0, i - 1)];
      const b = stations[Math.min(stations.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const tx = (b.x - a.x) / len;
      const ty = (b.y - a.y) / len;
      const ring: P3[] = [];
      for (let k = 0; k < sides; k++) {
        const ang = ((k + 0.5) / sides) * Math.PI * 2;
        // (up, across the spine, is (-ty, tx); sideways is z)
        ring.push([s.x - ty * s.h * Math.sin(ang), s.y + tx * s.h * Math.sin(ang), s.w * Math.cos(ang)]);
      }
      return ring;
    });
    for (let i = 0; i + 1 < stations.length; i++) {
      const s = stations[i];
      const n = stations[i + 1];
      const inside: P3 = [(s.x + n.x) / 2, (s.y + n.y) / 2, 0];
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        const low = (rings[i][k][1] + rings[i][k2][1]) / 2 < s.y - s.h * 0.45;
        this.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2], low && s.under ? s.under : s.color, inside);
      }
    }
    for (const end of [0, stations.length - 1]) {
      const s = stations[end];
      const near = stations[end === 0 ? 1 : end - 1];
      for (let k = 0; k < sides; k++) this.tri(rings[end][k], rings[end][(k + 1) % sides], [s.x, s.y, 0], s.color, [near.x, near.y, 0]);
    }
  }
  /** A thin slab between two edges (lists of points, the same number in each), `thick` along y; a colour for each stretch */
  slab(a: P3[], b: P3[], thick: number, colors: T.Color[]) {
    const up = (p: P3, s: number): P3 => [p[0], p[1] + (s * thick) / 2, p[2]];
    for (let i = 0; i + 1 < a.length; i++) {
      const c = colors[Math.min(i, colors.length - 1)];
      const mid: P3 = [(a[i][0] + a[i + 1][0] + b[i][0] + b[i + 1][0]) / 4, (a[i][1] + a[i + 1][1] + b[i][1] + b[i + 1][1]) / 4, (a[i][2] + a[i + 1][2] + b[i][2] + b[i + 1][2]) / 4];
      for (const s of [1, -1]) this.quad(up(a[i], s), up(a[i + 1], s), up(b[i + 1], s), up(b[i], s), c, mid);
      this.quad(up(a[i], 1), up(a[i + 1], 1), up(a[i + 1], -1), up(a[i], -1), c, mid);
      this.quad(up(b[i], 1), up(b[i + 1], 1), up(b[i + 1], -1), up(b[i], -1), c, mid);
      if (i === 0) this.quad(up(a[0], 1), up(b[0], 1), up(b[0], -1), up(a[0], -1), c, mid);
      if (i === a.length - 2) this.quad(up(a[i + 1], 1), up(b[i + 1], 1), up(b[i + 1], -1), up(a[i + 1], -1), c, mid);
    }
  }
  /** A box, turned by `yaw` about y */
  box(at: P3, size: P3, color: T.Color, yaw = 0) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const corner = (x: number, y: number, z: number): P3 => {
      const lx = (x * size[0]) / 2;
      const lz = (z * size[2]) / 2;
      return [at[0] + lx * c + lz * s, at[1] + (y * size[1]) / 2, at[2] - lx * s + lz * c];
    };
    const faces: Array<[P3, P3, P3, P3]> = [];
    for (const d of [1, -1]) {
      faces.push([corner(d, 1, 1), corner(d, 1, -1), corner(d, -1, -1), corner(d, -1, 1)]);
      faces.push([corner(1, d, 1), corner(1, d, -1), corner(-1, d, -1), corner(-1, d, 1)]);
      faces.push([corner(1, 1, d), corner(1, -1, d), corner(-1, -1, d), corner(-1, 1, d)]);
    }
    for (const f of faces) this.quad(f[0], f[1], f[2], f[3], color, at);
  }
  /** A gem (eight faces) with the given half-sizes: an eye, a cere */
  gem(at: P3, r: P3, color: T.Color) {
    const x: P3[] = [[at[0] + r[0], at[1], at[2]], [at[0] - r[0], at[1], at[2]]];
    const y: P3[] = [[at[0], at[1] + r[1], at[2]], [at[0], at[1] - r[1], at[2]]];
    const z: P3[] = [[at[0], at[1], at[2] + r[2]], [at[0], at[1], at[2] - r[2]]];
    for (const a of x) for (const b of y) for (const c of z) this.tri(a, b, c, color, at);
  }
  /** A pointed cone from a ring round `base` to `tip` */
  cone(base: P3, tip: P3, r: number, color: T.Color, sides = 4) {
    const ring: P3[] = [];
    for (let k = 0; k < sides; k++) {
      const ang = ((k + 0.5) / sides) * Math.PI * 2;
      ring.push([base[0], base[1] + r * Math.sin(ang), base[2] + r * Math.cos(ang)]);
    }
    const mid: P3 = [(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2];
    for (let k = 0; k < sides; k++) {
      this.tri(ring[k], ring[(k + 1) % sides], tip, color, mid);
      this.tri(ring[k], ring[(k + 1) % sides], base, color, mid);
    }
  }
  build(): T.BufferGeometry {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** The geometry grown by `d` all round (each corner moved along the average of its faces' normals): the outline's shell */
function fattened(geo: T.BufferGeometry, d: number): T.BufferGeometry {
  const pos = geo.getAttribute('position');
  const sums = new Map<string, [number, number, number]>();
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const a = new T.Vector3();
  const b = new T.Vector3();
  const c = new T.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = b.sub(a).cross(c.sub(a)).normalize();
    for (let k = 0; k < 3; k++) {
      const s = sums.get(key(i + k));
      if (s) {
        s[0] += n.x;
        s[1] += n.y;
        s[2] += n.z;
      } else sums.set(key(i + k), [n.x, n.y, n.z]);
    }
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(key(i))!;
    const len = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = pos.getX(i) + (s[0] / len) * d;
    out[i * 3 + 1] = pos.getY(i) + (s[1] / len) * d;
    out[i * 3 + 2] = pos.getZ(i) + (s[2] / len) * d;
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(out, 3));
  return g;
}

/** A part of the bird: its coloured faces, and its ink outline `ink` thick (0: none) */
function part(m: Mesher, ink = 0.022): T.Mesh {
  const geo = m.build();
  const mesh = new T.Mesh(geo, FEATHERS);
  if (ink > 0) mesh.add(new T.Mesh(fattened(geo, ink), INK));
  return mesh;
}

/** A wing's joints: `flap` lifts it about the shoulder, `open` swings it out from the side, `fold` lays it flat against the flank */
interface Wing {
  flap: T.Group;
  open: T.Group;
  fold: T.Group;
}

export interface PigeonModel {
  root: T.Group;
  body: T.Group;
  neck: T.Group;
  head: T.Group;
  wings: [Wing, Wing];
  tail: T.Group;
  legs: [T.Group, T.Group];
  shadow: T.Mesh;
}

/** The plumages: the usual blue-grey (most birds), a dark one, a red-brown one, a pale pied one */
const PLUMAGES = [
  { body: 0x8f98ab, under: 0xa9b0c0, wing: 0xb4bac8, head: 0x6d768b, rump: 0xd0d3dc, tail: 0x767d90, bar: 0x2f3038 },
  { body: 0x8f98ab, under: 0xa9b0c0, wing: 0xb4bac8, head: 0x6d768b, rump: 0xd0d3dc, tail: 0x767d90, bar: 0x2f3038 },
  { body: 0x858ea3, under: 0x9da5b7, wing: 0xa8afbf, head: 0x626b80, rump: 0xc6cad5, tail: 0x6c7387, bar: 0x2f3038 },
  { body: 0x5d6274, under: 0x6d7285, wing: 0x666b7d, head: 0x4c5162, rump: 0x7c8194, tail: 0x4a4e5d, bar: 0x26262d },
  { body: 0xa87763, under: 0xc59a86, wing: 0xd9c3b6, head: 0x935f4d, rump: 0xe3d5cc, tail: 0xcbb3a6, bar: 0x8a5544 },
  { body: 0xd9dbe2, under: 0xecedf1, wing: 0xb4bac8, head: 0xe4e5ea, rump: 0xf0f1f4, tail: 0x8b92a4, bar: 0x2f3038 },
];
/** How long a wing is, shoulder to tip, and where its shoulder is */
const WING_LENGTH = 0.92;
const SHOULDER: P3 = [0.24, 0.8, 0.22];
/** How far a folded wing is turned down from flat, to lie along the flank (radians) */
const WING_FOLD = 1.95;

export function makePigeon(seed: number, size: number, shadowGeo: T.BufferGeometry, shadowMat: T.Material): PigeonModel {
  const r = rand(seed);
  // (most are blue-grey: three in five, the lighter or the darker of the two; the rest dark, red-brown or pied)
  const pick = r();
  const plumage = PLUMAGES[pick < 0.62 ? Math.floor((pick / 0.62) * 3) : pick < 0.76 ? 3 : pick < 0.88 ? 4 : 5];
  // (a touch lighter or darker, bird to bird)
  const tint = 0.94 + r() * 0.12;
  const col = (hex: number, vary = true) => new T.Color(hex).multiplyScalar(vary ? tint : 1);
  const grey = col(plumage.body);
  const under = col(plumage.under);
  const wingGrey = col(plumage.wing);
  const headGrey = col(plumage.head);
  const rump = col(plumage.rump);
  const tailGrey = col(plumage.tail);
  const bar = col(plumage.bar, false);
  const green = col(0x2f9d7c, false);
  const purple = col(0x8d5fb8, false);
  const red = col(0xd4524d, false);
  const billDark = col(0x35343c, false);
  const cere = col(0xf2f0ea, false);
  const eye = col(0xf59a1c, false);
  const pupil = col(0x16151a, false);

  const root = new T.Group();
  const body = new T.Group();
  root.add(body);

  // The body: a plump breast, the back sloping down to a narrow rump
  const torso = new Mesher();
  torso.loft(
    [
      { x: -0.68, y: 0.63, w: 0.07, h: 0.05, color: rump },
      { x: -0.5, y: 0.63, w: 0.2, h: 0.15, color: rump, under },
      { x: -0.26, y: 0.6, w: 0.3, h: 0.26, color: grey, under },
      { x: 0, y: 0.58, w: 0.33, h: 0.31, color: grey, under },
      { x: 0.22, y: 0.6, w: 0.31, h: 0.31, color: grey, under },
      { x: 0.4, y: 0.67, w: 0.24, h: 0.26, color: grey },
      { x: 0.5, y: 0.73, w: 0.11, h: 0.13, color: grey },
    ],
    8
  );
  body.add(part(torso));

  // The tail: a flat fan with the dark band near its end (it spreads in flight)
  const tail = new T.Group();
  tail.position.set(-0.5, 0.65, 0);
  const fan = new Mesher();
  const along = [0, -0.3, -0.42, -0.53, -0.59];
  const half = [0.1, 0.19, 0.22, 0.235, 0.2];
  const drop = [0, -0.03, -0.045, -0.06, -0.065];
  fan.slab(
    along.map((x, i): P3 => [x, drop[i], half[i]]),
    along.map((x, i): P3 => [x, drop[i], -half[i]]),
    0.05,
    [tailGrey, tailGrey, bar, tailGrey]
  );
  tail.add(part(fan));
  body.add(tail);

  // The wings: folded along the flanks, their tips over the tail; two dark bars across each
  const wings = [1, -1].map((side): Wing => {
    const flap = new T.Group();
    flap.position.set(SHOULDER[0], SHOULDER[1], side * SHOULDER[2]);
    const open = new T.Group();
    const fold = new T.Group();
    flap.add(open);
    open.add(fold);
    const m = new Mesher();
    // (along the wing from the shoulder, and how deep it is there, front edge to back)
    const u = [0, 0.2, 0.38, 0.46, 0.58, 0.66, 0.8, WING_LENGTH];
    const deep = [0.2, 0.31, 0.3, 0.29, 0.26, 0.23, 0.14, 0.03];
    m.slab(
      u.map((x, i): P3 => [-x, i === 0 ? -0.01 : 0, 0]),
      u.map((x, i): P3 => [-x - 0.03, 0, -side * deep[i]]),
      0.045,
      [wingGrey, wingGrey, bar, wingGrey, bar, wingGrey, tailGrey]
    );
    fold.add(part(m));
    body.add(flap);
    return { flap, open, fold };
  }) as [Wing, Wing];

  // The neck: upright, glossy green shading to purple
  const neck = new T.Group();
  neck.position.set(0.38, 0.7, 0);
  body.add(neck);
  const throat = new Mesher();
  throat.loft(
    [
      { x: -0.02, y: -0.06, w: 0.2, h: 0.2, color: green },
      { x: 0.03, y: 0.08, w: 0.21, h: 0.2, color: green },
      { x: 0.08, y: 0.22, w: 0.17, h: 0.16, color: purple },
      { x: 0.12, y: 0.34, w: 0.14, h: 0.13, color: purple },
      { x: 0.14, y: 0.42, w: 0.11, h: 0.1, color: headGrey },
    ],
    6
  );
  neck.add(part(throat));

  // The head: rounded, a short dark bill with the white cere over it, orange eyes
  const head = new T.Group();
  head.position.set(0.17, 0.46, 0);
  neck.add(head);
  const skull = new Mesher();
  skull.loft(
    [
      { x: -0.17, y: -0.01, w: 0.06, h: 0.06, color: headGrey },
      { x: -0.1, y: 0, w: 0.14, h: 0.14, color: headGrey },
      { x: 0.01, y: 0.01, w: 0.17, h: 0.16, color: headGrey },
      { x: 0.11, y: 0, w: 0.13, h: 0.12, color: headGrey },
      { x: 0.18, y: -0.02, w: 0.06, h: 0.06, color: headGrey },
    ],
    6
  );
  head.add(part(skull));
  const face = new Mesher();
  face.cone([0.15, -0.035, 0], [0.37, -0.07, 0], 0.05, billDark);
  face.gem([0.2, 0.012, 0], [0.05, 0.03, 0.045], cere);
  for (const side of [1, -1]) {
    face.gem([0.06, 0.03, side * 0.135], [0.05, 0.05, 0.03], eye);
    face.gem([0.065, 0.03, side * 0.16], [0.022, 0.022, 0.012], pupil);
  }
  head.add(part(face, 0));

  // The legs: short and red, three toes forward and one back; a tuft of feathers at the top
  const legs = [1, -1].map((side) => {
    const hip = new T.Group();
    hip.position.set(0.02, 0.33, side * 0.13);
    const m = new Mesher();
    m.box([0, -0.03, 0], [0.11, 0.12, 0.11], under);
    m.box([0, -0.19, 0], [0.045, 0.24, 0.045], red);
    for (const a of [0, 0.55, -0.55]) m.box([0.075 * Math.cos(a), -0.315, -0.075 * Math.sin(a)], [0.17, 0.03, 0.035], red, a);
    m.box([-0.05, -0.315, 0], [0.09, 0.03, 0.035], red);
    hip.add(part(m, 0));
    root.add(hip);
    return hip;
  }) as [T.Group, T.Group];

  const shadow = new T.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  root.add(shadow);

  root.scale.setScalar(size);
  return { root, body, neck, head, wings, tail, legs, shadow };
}

// ---------------------------------------------------------------------------------------------
// Posing a bird at time t

const ease = (x: number) => x * x * (3 - 2 * x);
/** From angle a toward b by k, the short way round */
const turn = (a: number, b: number, k: number) => a + ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * k;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function findLeg(legs: Leg[], t: number): Leg {
  let lo = 0;
  let hi = legs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (legs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return legs[lo];
}

/** Which way a bird faces at t: toward where it's going, else toward where it went, else a lazy look around */
function heading(legs: Leg[], leg: Leg, t: number, seed: number): number {
  const dir = (l: Leg) => (flatDist(l.from, l.to) > 0.05 ? Math.atan2(-(l.to.z - l.from.z), l.to.x - l.from.x) : null);
  const now = dir(leg);
  if (now !== null) return now;
  const i = legs.indexOf(leg);
  for (let k = i - 1; k >= 0; k--) {
    const d = dir(legs[k]);
    if (d !== null) return d + Math.sin(t * 0.7 + seed) * 0.4;
  }
  return ((seed % 628) / 100) + Math.sin(t * 0.5 + seed) * 0.6;
}

/** A bird's pose at t, before the birds are kept apart (solveSpacing) */
export interface Posed {
  leg: Leg;
  /** How far through its leg (0 to 1) */
  k: number;
  /** Where its feet are, before any lift */
  pos: T.Vector3;
  lift: number;
  heading: number;
  walkPhase: number;
  /** How far it would spread its wings (0 folded, 1 right out): in a flight or a long jump */
  wants: number;
  /**
   * How far its footprint reaches to each side (its own units): BIRD_SHAPE.RADIUS with the wings
   * folded, up to BIRD_SHAPE.SPAN with them out (as far as the birds near it leave room: spreadWings)
   */
  reach: number;
  bob: number;
  peck: number;
  /** Its size (the model's scale) */
  size: number;
  /** How readily it's pushed aside: 0 never (it's on its key, playing), 1 freely */
  give: number;
  /** Lifted over another bird it had no room to step round (solveSpacing's last resort) */
  flutter: boolean;
}

function rawPose(plan: PigeonPlan, t: number, byKey: Map<number, ShowcaseNote[]>): Posed {
  const size = plan.size;
  const leg = findLeg(plan.legs, t);
  const k = leg.t1 > leg.t0 ? clamp01((t - leg.t0) / (leg.t1 - leg.t0)) : 1;
  const pos = new T.Vector3();
  let lift = 0;
  let walkPhase = 0;
  let wants = 0;
  let bob = 0;
  let peck = 0;
  let give = 1;
  const seed = plan.seed;
  /** Its leg ends on a key (it's arriving to play): the nearer it is, the less it gives way */
  const arriving = leg.to.y > 0 && leg.kind !== 'press' && leg.kind !== 'stand';
  switch (leg.kind) {
    case 'walk': {
      pos.lerpVectors(leg.from, leg.to, k);
      const dist = flatDist(leg.from, leg.to) * k;
      walkPhase = dist * 3.2 + seed;
      // The pigeon's head bob: forward and held, forward and held
      bob = (walkPhase / Math.PI) % 1;
      break;
    }
    case 'hop': {
      pos.lerpVectors(leg.from, leg.to, ease(k));
      const far = flatDist(leg.from, leg.to);
      // A hop up onto the keys or down off them is a flap up over the heads of the birds there (so
      // it can turn round up in the air); a hop on the spot strikes the same key again; a
      // side-step to the next key is a little hop
      // (between pads: a little hop to the next pad, a higher one over the pads between to a further one)
      const over =
        leg.from.y > 0 !== leg.to.y > 0
          ? CLEAR_HOP
          : far < 0.05
            ? Math.min(REHOP_HEIGHT, (leg.t1 - leg.t0) * (REHOP_HEIGHT / REHOP_TIME))
            : plan.role === 'pad'
              ? far < PAD_W + PAD_GAP + 0.3 ? 0.4 : Math.min(2.3, 0.7 + far * 0.4)
              : 0.35 + Math.abs(leg.to.y - leg.from.y) * 0.5;
      lift = Math.sin(k * Math.PI) * over;
      // (a long enough jump is flown, wings out)
      if (far >= FLAP_DISTANCE) wants = clamp01(lift / 0.5);
      break;
    }
    case 'fly': {
      pos.lerpVectors(leg.from, leg.to, ease(k));
      lift = Math.sin(k * Math.PI) * Math.min(4, CLEAR_HOP + flatDist(leg.from, leg.to) * 0.1);
      wants = clamp01(lift / 0.5);
      break;
    }
    case 'press': {
      pos.copy(leg.from);
      give = 0;
      break;
    }
    case 'stand': {
      pos.copy(leg.from);
      // Idle on the floor: a peck now and then
      if (plan.pecks) {
        // A drum's bird: its beak comes down onto the drum as each hit lands, and lifts after
        peck = peckAt(plan.pecks, t);
        give = 0;
      } else if (leg.from.y === 0) {
        const cycle = (t * 0.6 + (seed % 97) / 13) % 3.5;
        peck = cycle < 0.5 ? Math.sin((cycle / 0.5) * Math.PI) : 0;
      } else give = 0.5;
      break;
    }
  }
  if (arriving) give = 1 - ease(k);
  // (a bird on its bank of pads, or the kick's, is never pushed off it)
  if (plan.role === 'pad' || plan.role === 'kick') give = Math.min(give, leg.kind === 'press' ? 0 : 0.15);
  // On a key, it goes down with it as it's played
  if (leg.key !== undefined) pos.y -= keyDownAt(byKey.get(leg.key), t);
  // On a key it faces the viewer, square to the key (so birds on neighbouring keys stand side by
  // side, never wider than a key), turning to it on the way up
  const way = heading(plan.legs, leg, t, seed);
  // (a hop to a neighbouring key is a side-step: it keeps facing the viewer)
  const onKey = leg.kind === 'press' || (leg.kind === 'stand' && leg.from.y > 0) || (leg.kind === 'hop' && leg.from.y > 0 && leg.to.y > 0);
  // (it stays square to its key until it's up off it, and is square again before it lands: turning
  // down among its neighbours would swing its tail into them)
  const leaving = leg.from.y > 0 && (leg.kind === 'hop' || leg.kind === 'fly' || leg.kind === 'walk');
  // (a drum's bird faces its drum, which is in front of it)
  let h = onKey || plan.pecks ? FACE : way;
  // (turning only while it's up above the others' heads: the middle third of its hop or flight)
  if (leaving && !onKey) h = turn(FACE, way, ease(clamp01((k - 1 / 3) / (1 / 6))));
  if (arriving && !onKey) h = turn(h, FACE, ease(clamp01((k - 1 / 2) / (1 / 6))));
  return { leg, k, pos, lift, heading: h, walkPhase, wants, reach: BIRD_SHAPE.RADIUS, bob, peck, size, give, flutter: false };
}

/** Facing the viewer (+z) */
const FACE = -Math.PI / 2;

/**
 * A bird's footprint, in its own units (facing +x): a capsule, the segment from TAIL to HEAD along
 * its length grown by RADIUS all round, and HEIGHT tall. It holds the whole model (the beak at the
 * head's furthest bob, the tail band, the wings), so footprints that don't meet are birds that
 * don't touch. RADIUS is under half a key at the biggest size, so birds on neighbouring keys fit.
 * With its wings out the footprint is wider, up to SPAN to each side (Posed.reach).
 */
export const BIRD_SHAPE = { TAIL: -0.9, HEAD: 0.75, RADIUS: 0.45, HEIGHT: 1.55, SPAN: 1.22 };
/** The smallest gap kept between two birds (scene units) */
const GAP = 0.02;

/** The ends of a bird's footprint segment, in scene units (x, z) */
function footprint(b: Posed): [number, number, number, number] {
  const c = Math.cos(b.heading);
  const sn = -Math.sin(b.heading);
  const x = b.pos.x;
  const z = b.pos.z;
  return [x + c * BIRD_SHAPE.TAIL * b.size, z + sn * BIRD_SHAPE.TAIL * b.size, x + c * BIRD_SHAPE.HEAD * b.size, z + sn * BIRD_SHAPE.HEAD * b.size];
}

/** The closest points between segments PQ and RS (2D): [px, pz, rx, rz] */
function closest(p: number[], q: number[]): [number, number, number, number] {
  const [ax, az, bx, bz] = p;
  const [cx, cz, dx, dz] = q;
  const ux = bx - ax;
  const uz = bz - az;
  const vx = dx - cx;
  const vz = dz - cz;
  const wx = ax - cx;
  const wz = az - cz;
  const a = ux * ux + uz * uz;
  const b = ux * vx + uz * vz;
  const c = vx * vx + vz * vz;
  const d = ux * wx + uz * wz;
  const e = vx * wx + vz * wz;
  const den = a * c - b * b;
  let sN = den > 1e-9 ? clamp01((b * e - c * d) / den) : 0;
  let tN = c > 1e-9 ? (b * sN + e) / c : 0;
  if (tN < 0) {
    tN = 0;
    sN = a > 1e-9 ? clamp01(-d / a) : 0;
  } else if (tN > 1) {
    tN = 1;
    sN = a > 1e-9 ? clamp01((b - d) / a) : 0;
  }
  return [ax + ux * sN, az + uz * sN, cx + vx * tN, cz + vz * tN];
}

/** How far two birds' footprints overlap (positive: they touch), and the way from b to a */
export function overlapOf(a: Posed, b: Posed): { depth: number; nx: number; nz: number } {
  // Only birds at the same height can touch (one flying over another can't)
  const a0 = a.pos.y + a.lift;
  const b0 = b.pos.y + b.lift;
  if (a0 > b0 + BIRD_SHAPE.HEIGHT * b.size || b0 > a0 + BIRD_SHAPE.HEIGHT * a.size) return { depth: -1, nx: 0, nz: 0 };
  const [px, pz, rx, rz] = closest(footprint(a), footprint(b));
  let nx = px - rx;
  let nz = pz - rz;
  const d = Math.hypot(nx, nz);
  if (d > 1e-6) {
    nx /= d;
    nz /= d;
  } else {
    // (exactly on top of each other: apart along x, the same way every time)
    nx = a.pos.x >= b.pos.x ? 1 : -1;
    nz = 0;
  }
  return { depth: a.reach * a.size + b.reach * b.size + GAP - d, nx, nz };
}

/** Pushes touching birds apart, each by its give (at least `least`); true if they all came clear */
/** Moves a bird on the floor that's been pushed in under the keyboard back out, by the nearest way; how far it had to go */
function keepOff(b: Posed, box: KeyBox): number {
  if (b.give <= 0 || b.pos.y + b.lift > 0.2) return 0;
  const m = BIRD_SHAPE.RADIUS * b.size + GAP;
  const left = b.pos.x - (box.x0 - m);
  const right = box.x1 + m - b.pos.x;
  const back = b.pos.z - (box.z0 - m);
  const front = box.z1 + m - b.pos.z;
  const depth = Math.min(left, right, back, front);
  if (depth <= 0) return 0;
  if (depth === front) b.pos.z += depth;
  else if (depth === back) b.pos.z -= depth;
  else if (depth === left) b.pos.x -= depth;
  else b.pos.x += depth;
  return depth;
}

function spaceOut(birds: Posed[], least: number, keepOut?: KeyBox): boolean {
  for (let round = 0; round < 80; round++) {
    let worst = 0;
    for (let i = 0; i < birds.length; i++) {
      for (let j = i + 1; j < birds.length; j++) {
        const a = birds[i];
        const b = birds[j];
        const { depth, nx, nz } = overlapOf(a, b);
        if (depth <= 0) continue;
        let ga = Math.max(least, a.give);
        let gb = Math.max(least, b.give);
        // (two birds that won't give way: both must, a little)
        if (ga + gb < 1e-3) ga = gb = 0.5;
        const share = depth / (ga + gb);
        a.pos.x += nx * share * ga;
        a.pos.z += nz * share * ga;
        b.pos.x -= nx * share * gb;
        b.pos.z -= nz * share * gb;
        worst = Math.max(worst, depth);
      }
    }
    // (and none is pushed in under the keyboard: the floor there isn't floor)
    if (keepOut) for (const bird of birds) worst = Math.max(worst, keepOff(bird, keepOut));
    if (worst <= 1e-4) return true;
  }
  return false;
}

/**
 * Keeps every bird clear of every other: birds that would touch are pushed apart, the one more
 * ready to give way (a bird walking or waiting) moving more than one playing its key (which never
 * moves). It works from the poses at t alone, so a frame is the same however it's reached, and a
 * push grows and shrinks smoothly as birds come close and part (they step round each other).
 */
export function solveSpacing(birds: Posed[], keepOut?: KeyBox) {
  // First the birds that give way move; if that can't settle it (one boxed in), the birds playing
  // budge a little too (a small shift on their key, unseen beside a bird popping up)
  if (spaceOut(birds, 0, keepOut) || spaceOut(birds, 0.2, keepOut)) return;
  // Last resort: a bird boxed in (between birds playing their keys) flutters up over the one it
  // still touches, rather than through it
  for (let round = 0; round < 4; round++) {
    let lifted = false;
    for (let i = 0; i < birds.length; i++) {
      for (let j = i + 1; j < birds.length; j++) {
        const { depth } = overlapOf(birds[i], birds[j]);
        if (depth <= 1e-4) continue;
        const [up, under] = birds[i].give >= birds[j].give ? [birds[i], birds[j]] : [birds[j], birds[i]];
        up.lift = under.pos.y + under.lift + BIRD_SHAPE.HEIGHT * under.size + GAP - up.pos.y;
        up.flutter = true;
        lifted = true;
      }
    }
    if (!lifted) return;
  }
}

/**
 * Whether a bird is on the keys in this leg: standing on a key (playing it or not), hopping on the
 * spot to play it again, or side-stepping to the next key. Not while it's flying, even from key to
 * key, nor on its way up from the floor or down to it.
 */
const onTheKeys = (leg: Leg) => leg.from.y > 0 && leg.to.y > 0 && leg.kind !== 'fly';

/** How long a drum bird's beak takes to come down onto the drum, and to lift again (seconds) */
const PECK_DOWN = 0.07;
const PECK_UP = 0.13;

/** How far down a drum bird's head is at t (0 up, 1 on the drum): down as each hit lands, up after; between quick hits it only comes part of the way up */
export function peckAt(hits: readonly number[], t: number): number {
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  // (the hit just gone, lifting; the hit coming, on its way down)
  const up = lo > 0 ? 1 - clamp01((t - hits[lo - 1]) / PECK_UP) : 0;
  const down = lo < hits.length ? clamp01(1 - (hits[lo] - t) / PECK_DOWN) : 0;
  return Math.max(ease(up), ease(down));
}

/** How many birds are on the keys at t: what the picture's count says, and what you'd count yourself */
export function birdsOnKeys(plan: PigeonPlanResult, t: number): number {
  let n = 0;
  for (const p of plan.pigeons) if (!p.role && onTheKeys(findLeg(p.legs, t))) n++;
  return n;
}

/** Every bird's pose at t, kept clear of one another (what a frame draws) */
export function posedAt(plan: PigeonPlanResult, t: number): Posed[] {
  const posed = plan.pigeons.map((p) => rawPose(p, t, plan.byKey));
  // (on a stage birds walk the floor beside the keyboard: they're kept from being pushed in under it)
  solveSpacing(posed, plan.stage.banks.length || plan.stage.drums.length ? bedBox(plan.low, plan.high) : undefined);
  spreadWings(posed);
  return posed;
}

/**
 * Lets each bird that would spread its wings spread them as far as there's room: its footprint
 * widens up to the nearest bird at its height (two birds both spreading share the room between
 * them), so wings never touch another bird either. A bird clear above another, or below, isn't in
 * its way; the room opens up gradually as it rises clear, so the wings open smoothly.
 */
function spreadWings(birds: Posed[]) {
  const extra = birds.map((b) => (b.flutter ? 1 : b.wants) * (BIRD_SHAPE.SPAN - BIRD_SHAPE.RADIUS) * b.size);
  const room = extra.slice();
  for (let i = 0; i < birds.length; i++) {
    for (let j = i + 1; j < birds.length; j++) {
      if (extra[i] <= 0 && extra[j] <= 0) continue;
      const a = birds[i];
      const b = birds[j];
      // How far one's feet are above the other's head (negative: they're at the same height)
      const a0 = a.pos.y + a.lift;
      const b0 = b.pos.y + b.lift;
      const clear = Math.max(a0 - (b0 + BIRD_SHAPE.HEIGHT * b.size), b0 - (a0 + BIRD_SHAPE.HEIGHT * a.size));
      const [px, pz, rx, rz] = closest(footprint(a), footprint(b));
      const between = Math.max(0, Math.hypot(px - rx, pz - rz) - BIRD_SHAPE.RADIUS * (a.size + b.size) - GAP);
      // (each may take all the room if the other isn't spreading, else half; and more as they come clear)
      const free = ease(clamp01(clear / 0.5)) * BIRD_SHAPE.SPAN * 2;
      const share = extra[i] > 0 && extra[j] > 0 ? 0.5 : 1;
      room[i] = Math.min(room[i], between * share + free);
      room[j] = Math.min(room[j], between * share + free);
    }
  }
  birds.forEach((b, i) => (b.reach = BIRD_SHAPE.RADIUS + Math.max(0, room[i]) / b.size));
}

/** Puts a model in the pose worked out for it */
export function applyPose(p: PigeonModel, b: Posed, t: number, seed: number) {
  const { leg, k, pos, lift, walkPhase, bob, peck } = b;
  p.root.position.set(pos.x, pos.y + lift, pos.z);
  p.root.rotation.y = b.heading;
  // Legs: a step cycle while walking, tucked while flying
  const swing = leg.kind === 'walk' ? Math.sin(walkPhase) * 0.5 : 0;
  p.legs[0].rotation.z = swing;
  p.legs[1].rotation.z = -swing;
  const tucked = leg.kind === 'fly' ? Math.min(1, Math.sin(k * Math.PI) * 3) : 0;
  p.legs.forEach((l) => (l.scale.y = 1 - tucked * 0.5));
  p.body.position.y = leg.kind === 'walk' ? Math.abs(Math.sin(walkPhase)) * 0.035 : 0;
  // Head: thrust forward then held (walking), down for a peck; a little look around otherwise
  const thrust = leg.kind === 'walk' ? (bob < 0.5 ? ease(bob * 2) : 1 - ease((bob - 0.5) * 2)) : 0;
  p.neck.position.x = 0.38 + thrust * 0.14;
  p.neck.rotation.z = -peck * 0.85;
  p.head.rotation.z = -peck * 0.4 + Math.sin(t * 2.3 + seed) * 0.05;
  p.head.rotation.y = Math.sin(t * 1.3 + seed) * 0.35;
  // Wings: out as far as its footprint reaches (spreadWings found it the room), beating while
  // they're out; folded flat along the flanks otherwise
  const out = clamp01((b.reach - BIRD_SHAPE.RADIUS - 0.03) / (BIRD_SHAPE.SPAN - BIRD_SHAPE.RADIUS - 0.06));
  const swingOut = Math.asin(out);
  const beat = out * (0.12 + 0.55 * Math.sin(t * 42 + seed));
  p.wings.forEach((w, i) => {
    const side = i === 0 ? 1 : -1;
    w.flap.rotation.x = -side * beat;
    // (folded, the tips lie in toward the tail, following the body)
    w.open.rotation.y = side * (swingOut - (1 - out) * 0.13);
    w.fold.rotation.x = -side * (1 - out) * WING_FOLD;
  });
  // (and the tail fans out with them)
  p.tail.scale.z = 1 + out * 0.6;
  // The shadow stays on whatever's under the bird
  const ground = groundAt(pos.x, pos.z);
  p.shadow.position.set(0, (ground - p.root.position.y) / p.root.scale.y + 0.02, 0);
  p.shadow.scale.setScalar(1 / (1 + (p.root.position.y - ground) * 0.25));
}

/** How far a key is down at t, given its notes in order */
function keyDownAt(notes: ShowcaseNote[] | undefined, t: number): number {
  return keyAt(notes, t).down;
}

/** How far a held key comes back up before it's struck again (a share of its travel) */
const RESTRIKE = 0.55;

/**
 * A key at t, given its notes in order: how far down it is, and the note it shows (the one struck
 * last that's still sounding). A note that starts while the key is already down (the same pitch in
 * another part, or the same note again with no gap) is a new strike all the same: the key comes
 * part of the way up over the moment before it (the bird on it hops) and goes down again as the
 * note starts, so every note is seen played.
 */
export function keyAt(notes: ShowcaseNote[] | undefined, t: number): { down: number; lit: ShowcaseNote | null } {
  let down = 0;
  let lit: ShowcaseNote | null = null;
  if (!notes) return { down, lit };
  let next: ShowcaseNote | null = null;
  /** Whether another note had the key down when `lit` was struck */
  let restruck = false;
  for (const n of notes) {
    if (n.start > t) {
      next = n;
      break;
    }
    if (n.end + 0.1 < t) continue;
    const d = keyDown(n, t);
    if (d <= 0) continue;
    // (the last one struck is shown; one struck at the same moment as it isn't a strike of its own)
    if (lit && n.start - lit.start > 0.04) restruck = true;
    down = Math.max(down, d);
    lit = n;
  }
  if (lit && restruck) {
    // Struck again: down from part of the way up, over the key's travel
    const since = t - lit.start;
    if (since < KEY_TRAVEL) down = Math.min(down, PRESS * (1 - RESTRIKE + (RESTRIKE * since) / KEY_TRAVEL));
  }
  if (down > 0 && next && next.start - t < REHOP_TIME && next.start - (lit?.start ?? -1) > 0.04) {
    // About to be struck again: it comes up as the bird leaves it
    const rise = ease(1 - (next.start - t) / REHOP_TIME);
    down *= 1 - RESTRIKE * rise;
  }
  return { down, lit };
}

/** How long a key takes to go down (seconds): two frames of a 60 a second video */
export const KEY_TRAVEL = 0.03;

/**
 * How far a note's key is down at t: it starts down as the note starts (never before: seen before
 * it's heard, a key press looks early, and the sound late), is down in KEY_TRAVEL, held, back up
 */
export function keyDown(n: ShowcaseNote, t: number): number {
  if (t < n.start || t > n.end + 0.08) return 0;
  const down = clamp01((t - n.start) / KEY_TRAVEL);
  const up = clamp01((n.end + 0.08 - t) / 0.08);
  return PRESS * Math.min(down, up);
}

/** The height of whatever's under (x, z): the keys or the floor (roughly: white keys' top) */
function groundAt(_x: number, z: number): number {
  return Math.abs(z) <= WHITE_L / 2 ? WHITE_TOP : 0;
}

// ---------------------------------------------------------------------------------------------
// The backgrounds' floor details: flat shapes lying on the floor (paving, daisies, puddles, bird
// tracks, shells), so the birds walk over them and nothing stands in their way. Each detail can
// move with the music in its own way (FloorMove); the moving is done on the graphics card, from a
// few numbers the scene gives it each frame (the beat's jump, how busy the music is, the notes
// just struck), so a frame is still drawn from the time alone.

/** How one detail moves with the music (all 0: it doesn't) */
interface FloorMove {
  /** How much bigger it gets on a beat (0.2: a fifth bigger) */
  grow?: number;
  /** How much brighter it gets on a beat */
  glow?: number;
  /** How much it twinkles by itself: bigger and brighter, smaller and dimmer, in its own time */
  twinkle?: number;
  /** How far it rocks from side to side (radians), gently by itself and a little further on a beat */
  sway?: number;
  /** How fast it drifts across the floor, along the keys and toward the front, as a share of the background's drift speed (it comes round again at the far side) */
  drift?: [number, number];
  /** How much it flares (brighter, a little bigger) when a note is struck: the details take turns, in eight groups */
  flare?: number;
  /** It's there only in busier passages (1): the busier, the more of these show */
  busy?: number;
}

/** Flat shapes on the floor, collected into one geometry (each a little above the last, so they lie over each other in the order drawn) */
class FloorArt {
  private m = new Mesher();
  private y = 0.004;
  private anchors: number[] = [];
  private moveA: number[] = [];
  private moveB: number[] = [];
  private moveC: number[] = [];
  private r: () => number;
  private now: { x: number; z: number; move: FloorMove; phase: number } = { x: 0, z: 0, move: {}, phase: 0 };
  constructor(r: () => number) {
    this.r = r;
  }
  /** The detail's own phase (which group of eight it flares with, when it twinkles): set it to make details move together */
  get phaseNow(): number {
    return this.now.phase;
  }
  set phaseNow(phase: number) {
    this.now.phase = phase;
  }
  /** What follows (until the next detail) is one detail, centred on (x, z), moving like this */
  detail(x: number, z: number, move: FloorMove = {}) {
    this.now = { x, z, move, phase: this.r() };
  }
  private layer(): number {
    return (this.y += 0.00002);
  }
  /** Gives the corners just added their detail's centre and moves */
  private tag() {
    const { x, z, move, phase } = this.now;
    while (this.anchors.length / 2 < this.m.count) {
      this.anchors.push(x, z);
      this.moveA.push(move.grow ?? 0, move.glow ?? 0, move.twinkle ?? 0, move.sway ?? 0);
      this.moveB.push(move.drift?.[0] ?? 0, move.drift?.[1] ?? 0, phase, move.busy ?? 0);
      this.moveC.push(move.flare ?? 0);
    }
  }
  /** A shape with `sides` corners round (x, z), `r` across; `star` pulls every other corner in (a star), `squash` flattens it along z */
  shape(x: number, z: number, r: number, sides: number, color: T.Color, turn = 0, star = 1, squash = 1) {
    const y = this.layer();
    const at = (k: number): P3 => {
      const a = turn + (k / sides) * Math.PI * 2;
      const rr = k % 2 ? r * star : r;
      return [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr * squash];
    };
    for (let k = 0; k < sides; k++) this.m.tri([x, y, z], at(k), at(k + 1), color, [x, y - 1, z]);
    this.tag();
  }
  /** A straight stroke from one point to another, `wide` across */
  stroke(x0: number, z0: number, x1: number, z1: number, wide: number, color: T.Color) {
    const y = this.layer();
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const nx = (-(z1 - z0) / len) * (wide / 2);
    const nz = ((x1 - x0) / len) * (wide / 2);
    this.m.quad([x0 + nx, y, z0 + nz], [x1 + nx, y, z1 + nz], [x1 - nx, y, z1 - nz], [x0 - nx, y, z0 - nz], color, [x0, y - 1, z0]);
    this.tag();
  }
  build(): T.BufferGeometry {
    const g = this.m.build();
    g.setAttribute('anchor', new T.Float32BufferAttribute(this.anchors, 2));
    g.setAttribute('moveA', new T.Float32BufferAttribute(this.moveA, 4));
    g.setAttribute('moveB', new T.Float32BufferAttribute(this.moveB, 4));
    g.setAttribute('moveC', new T.Float32BufferAttribute(this.moveC, 1));
    return g;
  }
}

/** A ring from a struck key: how long it lasts (seconds) and how fast it spreads (units a second) */
const RING_LIFE = 1.5;
const RING_SPEED = 2.6;

/** How far the floor's details reach past the keyboard's ends and to its front and back (the camera, pulled right back, sees about this far) */
const FLOOR_REACH = 80;

/** What the scene tells a background's details each frame */
interface FloorUniforms {
  [name: string]: T.IUniform;
  uOpacity: { value: number };
  /** How much the details move at all: the look's motion times the background's liveliness (drifting goes by uDrift) */
  uAmount: { value: number };
  uTime: { value: number };
  uPulse: { value: number };
  uEnergy: { value: number };
  /** How far a detail drifting at the background's full speed has gone (scene units) */
  uDrift: { value: number };
  /** The last four notes struck: their groups, and how bright each still is */
  uGroups: { value: T.Vector4 };
  uGlows: { value: T.Vector4 };
  /** The floor's left edge and width, and its reach to front and back: drifting details come round again */
  uSpan: { value: T.Vector3 };
  uTint: { value: T.Color };
}

/** The material that draws a background's details and moves them (FloorMove) */
function floorMaterial(left: number, right: number): T.ShaderMaterial & { uniforms: FloorUniforms } {
  const uniforms: FloorUniforms = {
    uOpacity: { value: 1 },
    uAmount: { value: 1 },
    uTime: { value: 0 },
    uPulse: { value: 0 },
    uEnergy: { value: 0 },
    uDrift: { value: 0 },
    uGroups: { value: new T.Vector4(-1, -1, -1, -1) },
    uGlows: { value: new T.Vector4() },
    uSpan: { value: new T.Vector3(left, right - left, FLOOR_REACH) },
    uTint: { value: new T.Color(1, 1, 1) },
  };
  return new T.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute vec2 anchor;
      attribute vec4 moveA; // grow, glow, twinkle, sway
      attribute vec4 moveB; // drift along the keys, drift to the front, its own phase, only when busy
      attribute float moveC; // flare
      uniform float uAmount, uTime, uPulse, uEnergy, uDrift;
      uniform vec4 uGroups, uGlows;
      uniform vec3 uSpan;
      varying vec3 vColor;
      void main() {
        float phase = moveB.z;
        // The notes just struck: this detail's group lights when its turn comes
        float group = floor(phase * 8.0);
        float lit = 0.0;
        for (int i = 0; i < 4; i++) if (abs(uGroups[i] - group) < 0.5) lit = max(lit, uGlows[i]);
        // Its own slow twinkle (each detail in its own time)
        float twinkle = sin(uTime * (0.9 + phase * 1.3) + phase * 40.0);
        float size = 1.0 + uAmount * (moveA.x * uPulse + moveA.z * twinkle * 0.45 + moveC * lit * 0.5);
        // Only in busier passages: the busier, the more of them (each has its own threshold)
        float need = fract(phase * 7.31);
        size *= mix(1.0, smoothstep(need - 0.12, need + 0.02, 0.15 + uEnergy * 0.9), moveB.w);
        float rock = uAmount * moveA.w * (sin(uTime * 1.1 + phase * 6.2832) * 0.7 + uPulse * 0.5);
        vec2 rel = position.xz - anchor;
        rel = vec2(rel.x * cos(rock) - rel.y * sin(rock), rel.x * sin(rock) + rel.y * cos(rock)) * size;
        // Drifting, and round again at the far side
        vec2 at = anchor + moveB.xy * uDrift;
        at.x = uSpan.x + mod(at.x - uSpan.x, uSpan.y);
        at.y = mod(at.y + uSpan.z, 2.0 * uSpan.z) - uSpan.z;
        vColor = color * (1.0 + uAmount * (moveA.y * uPulse + moveA.z * twinkle * 0.3 + moveC * lit * 1.3));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(at.x + rel.x, position.y, at.y + rel.y, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uTint;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor * uTint, uOpacity);
        #include <colorspace_fragment>
      }`,
  }) as T.ShaderMaterial & { uniforms: FloorUniforms };
}

/** The floor details of a background, for a keyboard from x0 to x1: the same every time */
function floorDetails(id: BackgroundId, x0: number, x1: number): T.BufferGeometry {
  const r = rand(id.length * 7919 + id.charCodeAt(0) * 31 + id.charCodeAt(1));
  const art = new FloorArt(r);
  const left = x0 - FLOOR_REACH;
  const right = x1 + FLOOR_REACH;
  const c = (hex: number) => new T.Color(hex);
  /** `per100` for every 100 square units of floor: calls `put` at spots clear of the keyboard (everywhere, for things that drift: they pass under it) */
  const scatter = (per100: number, put: (x: number, z: number) => void, everywhere = false) => {
    const n = Math.round((((right - left) * FLOOR_REACH * 2) / 100) * per100);
    for (let i = 0; i < n; i++) {
      const x = left + r() * (right - left);
      const z = (r() * 2 - 1) * FLOOR_REACH;
      if (everywhere || Math.abs(z) > WHITE_L / 2 + 0.9) put(x, z);
    }
  };
  /** Joints between square paving stones `size` across (one detail: they glow together on the beat) */
  const paving = (size: number, wide: number, color: T.Color, glow = 0) => {
    art.detail(0, 0, { glow });
    for (let z = -FLOOR_REACH; z <= FLOOR_REACH; z += size) art.stroke(left, z + size / 2, right, z + size / 2, wide, color);
    for (let x = Math.floor(left / size) * size; x <= right; x += size) art.stroke(x, -FLOOR_REACH, x, FLOOR_REACH, wide, color);
  };
  switch (id) {
    case 'plaza': {
      paving(4, 0.07, c(0xd6d2ca));
      // Crumbs, a few together (they hop a little on the beat)
      scatter(0.5, (x, z) => {
        for (let k = 0; k < 5; k++) {
          const cx = x + (r() - 0.5) * 1.6;
          const cz = z + (r() - 0.5) * 1.6;
          art.detail(cx, cz, { grow: 0.5 });
          art.shape(cx, cz, 0.05 + r() * 0.05, 5, c(0xc9a878), r() * 6);
        }
      });
      break;
    }
    case 'park': {
      // Tufts of darker and lighter grass swaying, daisies that nod on the beat, a few leaves blowing across
      scatter(22, (x, z) => {
        const col = c(r() < 0.5 ? 0x8fbd6d : 0xb6dc93);
        art.detail(x, z + 0.2, { sway: 0.3 });
        for (let k = 0; k < 3; k++) art.shape(x + (k - 1) * 0.16, z, 0.2 + r() * 0.12, 3, col, -Math.PI / 2 + (k - 1) * 0.4, 1, 1.5);
      });
      scatter(3, (x, z) => {
        const turn = r() * 6;
        art.detail(x, z, { grow: 0.35, sway: 0.25, flare: 0.5 });
        art.shape(x, z, 0.2, 12, c(0xffffff), turn, 0.55);
        art.shape(x, z, 0.075, 6, c(0xf6c945), turn);
      });
      scatter(
        1.2,
        (x, z) => {
          art.detail(x, z, { drift: [0.6 + r() * 0.4, 0.15], sway: 0.9 });
          art.shape(x, z, 0.26, 4, c([0xe0a03c, 0xd9763a, 0xc9c24a][Math.floor(r() * 3)]), r() * 6, 1, 0.5);
        },
        true
      );
      break;
    }
    case 'sunset': {
      // Terracotta tiles, some a shade lighter or darker, catching the light in turn
      const size = 3;
      for (let x = Math.floor(left / size) * size; x <= right; x += size) {
        for (let z = -FLOOR_REACH; z <= FLOOR_REACH; z += size) {
          if (r() >= 0.3) continue;
          art.detail(x + size / 2, z + size / 2, { glow: 0.12, flare: 0.25 });
          art.shape(x + size / 2, z + size / 2, (size / 2) * Math.SQRT2 * 0.97, 4, c(r() < 0.5 ? 0xe39f78 : 0xeeb590), Math.PI / 4);
        }
      }
      paving(size, 0.09, c(0xcf8762));
      break;
    }
    case 'night': {
      paving(4, 0.07, c(0x2e3454), 0.5);
      // Pools of lamplight that swell on the beat, and puddles that shiver and catch the notes
      scatter(0.16, (x, z) => {
        art.detail(x, z, { grow: 0.08, glow: 0.35 });
        art.shape(x, z, 7, 18, c(0x2c3152), 0);
        art.shape(x, z, 4.4, 18, c(0x363b60), 0);
      });
      scatter(0.9, (x, z) => {
        const turn = r() * 6;
        const size = 0.7 + r() * 1.3;
        art.detail(x, z, { grow: 0.12, flare: 0.5, twinkle: 0.08 });
        art.shape(x, z, size, 9, c(0x38436e), turn, 0.82, 0.6);
        art.shape(x + size * 0.15, z - size * 0.08, size * 0.42, 7, c(0x53629a), turn, 0.8, 0.6);
      });
      break;
    }
    case 'snow': {
      // Soft blue hollows, trails of bird tracks wandering across, and snow falling: more of it in busy passages
      scatter(0.7, (x, z) => {
        art.detail(x, z);
        art.shape(x, z, 1.5 + r() * 2.5, 9, c(0xe4ecf7), r() * 6, 0.85, 0.6);
      });
      scatter(0.45, (x, z) => {
        let way = r() * Math.PI * 2;
        let px = x;
        let pz = z;
        const ink = c(0xbfcce0);
        art.detail(x, z);
        for (let step = 0; step < 9 + r() * 8; step++) {
          way += (r() - 0.5) * 0.5;
          // (left foot, right foot)
          const side = step % 2 ? 0.13 : -0.13;
          const fx = px - Math.sin(way) * side;
          const fz = pz + Math.cos(way) * side;
          if (Math.abs(fz) < WHITE_L / 2 + 0.9) break;
          for (const toe of [0, 0.55, -0.55]) art.stroke(fx, fz, fx + Math.cos(way + toe) * 0.2, fz + Math.sin(way + toe) * 0.2, 0.045, ink);
          art.stroke(fx, fz, fx - Math.cos(way) * 0.09, fz - Math.sin(way) * 0.09, 0.045, ink);
          px += Math.cos(way) * 0.42;
          pz += Math.sin(way) * 0.42;
        }
      });
      scatter(
        9,
        (x, z) => {
          // (the first third always fall; the rest come in as the music gets busier)
          art.detail(x, z, { drift: [0.25 + r() * 0.2, 0.7 + r() * 0.3], twinkle: 0.3, busy: r() < 0.35 ? 0 : 1 });
          art.shape(x, z, 0.06 + r() * 0.07, 6, c(r() < 0.5 ? 0xffffff : 0xdbe6f5), r() * 6);
        },
        true
      );
      break;
    }
    case 'space': {
      // Nebulas, a few planets (some ringed), and stars: all drifting by, the near ones faster; the stars twinkle and flare with the notes
      scatter(
        0.12,
        (x, z) => {
          const tint = [0x1c1640, 0x161f45, 0x2a1640][Math.floor(r() * 3)];
          art.detail(x, z, { drift: [0.25, 0], glow: 0.25 });
          for (let k = 0; k < 5; k++) art.shape(x + (r() - 0.5) * 10, z + (r() - 0.5) * 6, 3 + r() * 4, 16, c(tint), r() * 6, 0.92, 0.7);
        },
        true
      );
      scatter(
        0.1,
        (x, z) => {
          const size = 1.1 + r() * 1.6;
          const [body, band] = [[0xe07a5f, 0xf2a488], [0x5fa8d3, 0x9fd0ec], [0xd9b44a, 0xf0d98a], [0x8e6fd1, 0xb9a3ea]][Math.floor(r() * 4)];
          art.detail(x, z, { drift: [0.45, 0], grow: 0.04 });
          if (r() < 0.5) art.shape(x, z, size * 1.9, 20, c(0xcfc6e8), 0.3, 1, 0.28);
          art.shape(x, z, size, 16, c(body), 0);
          art.shape(x - size * 0.2, z - size * 0.25, size * 0.5, 9, c(band), 0, 1, 0.5);
        },
        true
      );
      scatter(
        26,
        (x, z) => {
          art.detail(x, z, { drift: [0.6 + r() * 0.4, 0], twinkle: 0.7, flare: 1 });
          art.shape(x, z, 0.035 + r() * 0.05, 4, c(r() < 0.8 ? 0xdfe3ff : 0xffe9b8), 0);
        },
        true
      );
      scatter(
        1.4,
        (x, z) => {
          art.detail(x, z, { drift: [1, 0], twinkle: 0.5, grow: 0.5, flare: 0.8 });
          art.shape(x, z, 0.22 + r() * 0.2, 8, c(0xffffff), 0, 0.22);
        },
        true
      );
      break;
    }
    case 'neon': {
      // A grid of neon lines that brightens on the beat, and circuit traces with a pad at each end: light runs to them as notes are struck
      const size = 4;
      art.detail(0, 0, { glow: 1.1 });
      for (let z = -FLOOR_REACH; z <= FLOOR_REACH; z += size) art.stroke(left, z + size / 2, right, z + size / 2, 0.06, c(0x3a1f7a));
      for (let x = Math.floor(left / size) * size; x <= right; x += size) art.stroke(x, -FLOOR_REACH, x, FLOOR_REACH, 0.06, c(0x1f3f7a));
      scatter(1.3, (x, z) => {
        const col = c(r() < 0.5 ? 0xff3fd0 : 0x2ff3ff).multiplyScalar(0.62);
        // (along the grid: a run, a turn, another run)
        const gx = Math.round(x / size) * size;
        const gz = Math.round(z / size) * size + size / 2;
        const run = (1 + Math.floor(r() * 3)) * size * (r() < 0.5 ? 1 : -1);
        const rise = (1 + Math.floor(r() * 2)) * size * (r() < 0.5 ? 1 : -1);
        if (Math.abs(gz) < WHITE_L / 2 + 1.2 || Math.abs(gz + rise) < WHITE_L / 2 + 1.2) return;
        // (the lines light, without growing; the pads at their ends grow too)
        art.detail(gx, gz, { glow: 0.2 });
        const phase = art.phaseNow;
        art.stroke(gx, gz, gx + run, gz, 0.1, col);
        art.stroke(gx + run, gz, gx + run, gz + rise, 0.1, col);
        art.detail(gx, gz, { flare: 1, grow: 0.3 });
        art.phaseNow = phase;
        art.shape(gx, gz, 0.22, 6, col, 0);
        art.detail(gx + run, gz + rise, { flare: 1, grow: 0.3 });
        art.phaseNow = phase;
        art.shape(gx + run, gz + rise, 0.3, 4, col, Math.PI / 4);
      });
      scatter(0.5, (x, z) => {
        const hx = Math.round(x / size) * size;
        const hz = Math.round(z / size) * size + size / 2;
        art.detail(hx, hz, { glow: 0.8, grow: 0.15 });
        art.shape(hx, hz, 0.9, 6, c(r() < 0.5 ? 0x2a1560 : 0x15305e), Math.PI / 6);
      });
      break;
    }
    case 'clouds': {
      // Clouds far below, drifting slowly by (the nearer ones a little faster): a few puffs together, with a paler edge
      scatter(
        0.5,
        (x, z) => {
          const puffs = 3 + Math.floor(r() * 3);
          const size = 1.4 + r() * 1.8;
          art.detail(x, z, { drift: [0.55 + r() * 0.45, 0], grow: 0.06 });
          for (let k = 0; k < puffs; k++) art.shape(x + (k - puffs / 2) * size * 0.8, z + (r() - 0.5) * size * 0.4 + 0.25, size * (0.7 + r() * 0.5), 12, c(0xcfe6fa), 0, 1, 0.62);
          for (let k = 0; k < puffs; k++) art.shape(x + (k - puffs / 2) * size * 0.8, z + (r() - 0.5) * size * 0.3, size * (0.6 + r() * 0.45), 12, c(0xffffff), 0, 1, 0.6);
        },
        true
      );
      break;
    }
    case 'beach': {
      // Ripples in the sand that shift a little like water running back, shells, the odd starfish and pebble
      scatter(3.2, (x, z) => {
        const col = c(r() < 0.5 ? 0xe4cc94 : 0xf5e4b8);
        const len = 1.5 + r() * 3;
        art.detail(x + len / 2, z, { sway: 0.07, twinkle: 0.12 });
        for (let k = 0; k < 4; k++) art.stroke(x + (k / 4) * len, z + Math.sin(k * 1.6) * 0.13, x + ((k + 1) / 4) * len, z + Math.sin((k + 1) * 1.6) * 0.13, 0.07, col);
      });
      scatter(1.1, (x, z) => {
        const turn = r() * 6;
        art.detail(x, z, { flare: 0.4 });
        art.shape(x, z, 0.2, 7, c(r() < 0.5 ? 0xfaf3ea : 0xf2c4b8), turn, 1, 0.8);
        art.shape(x, z, 0.1, 5, c(0xe9a99a), turn, 1, 0.8);
      });
      scatter(0.3, (x, z) => {
        art.detail(x, z, { grow: 0.25, sway: 0.12 });
        art.shape(x, z, 0.42, 10, c(0xf08a4b), r() * 6, 0.42);
      });
      scatter(0.8, (x, z) => {
        art.detail(x, z);
        art.shape(x, z, 0.1 + r() * 0.1, 6, c(0xb9ad97), r() * 6, 1, 0.75);
      });
      break;
    }
  }
  return art.build();
}

// ---------------------------------------------------------------------------------------------
// The scene

export interface PigeonSceneOptions {
  /** Pixels */
  width: number;
  height: number;
  /** A portrait frame: the keys run more steeply across it */
  tall: boolean;
  /** Scene units across the frame's narrow side (how far out the camera is) */
  across?: number;
  /** Where the keys' middle goes, from the top of the frame (0 to 1; the middle if not given) */
  centerY?: number;
  /**
   * The part of the frame a stage (the keyboard with its pads and drums) is kept inside: its top
   * and bottom, from the top of the frame (0 to 1). For a frame with things drawn over its edges
   * (a title, a waveform). The whole frame, if not given.
   */
  safe?: { top: number; bottom: number };
  /** The canvas to draw on (one of its own, if not given). It mustn't have a context yet */
  canvas?: HTMLCanvasElement;
  /** A floor colour of your own, in place of the backgrounds' (their floor details are still drawn) */
  floor?: string;
  /** Which backgrounds and camera angles it uses, and when it changes between them (the plaza, the diagonal camera, if not given) */
  look?: Partial<PigeonLook>;
}

const flat = (color: number) => new T.MeshLambertMaterial({ color, flatShading: true });

/** The floor colour (the export draws its text over it, in dark ink) */
export const PIGEON_FLOOR = '#e9e6e1';

export class PigeonScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera: T.OrthographicCamera;
  private plan: PigeonPlanResult;
  private birds: PigeonModel[] = [];
  private keys = new Map<number, { mesh: T.Group; mat: T.MeshLambertMaterial; base: T.Color }>();
  private glows: Array<{ mesh: T.Mesh; mat: T.MeshBasicMaterial }> = [];
  /** Notes by key, for lighting the keys */
  private byKey = new Map<number, ShowcaseNote[]>();
  private colors = new Map<string, T.Color>();
  private view = { w: 1, h: 1 };
  private tall = false;
  private aspect = 1;
  private centerY: number;
  private safe: { top: number; bottom: number };
  private across?: number;
  private look: PigeonLook;
  /** A floor colour given in place of the backgrounds' */
  private ownFloor: T.Color | null;
  private sky: T.HemisphereLight;
  private sun: T.DirectionalLight;
  /** Each background's floor details (made when it's first shown) */
  private details = new Map<BackgroundId, { mesh: T.Mesh; mat: ReturnType<typeof floorMaterial> }>();
  /** What the backgrounds hear of the music: the beat, how busy it is, the notes just struck */
  private sense: MusicSense;
  /** When the song ends (the sunset is down by then) */
  private songEnd: number;
  /** The floor the stage takes up, if there's one (pads, drums): the camera holds all of it */
  private box: { x0: number; x1: number; z0: number; z1: number } | null = null;
  /** Each pad: its mesh, its colours, and its key in plan.byPad */
  private pads: Array<{ mesh: T.Mesh; mat: T.MeshLambertMaterial; base: T.Color; lit: T.Color; key: number }> = [];
  /** Each drum (and the kick's pad): its skin, and when it's hit */
  private drums: Array<{ skin: T.Mesh; mat: T.MeshLambertMaterial; base: T.Color; lit: T.Color; hits: number[]; rest: number }> = [];
  /** Rings that spread across the floor from each key as it's struck (a pool, reused) */
  private rings: Array<{ mesh: T.Mesh; mat: T.MeshBasicMaterial }> = [];
  private disposables: Array<{ dispose(): void }> = [];

  constructor(data: ShowcaseData, opts: PigeonSceneOptions) {
    this.look = cleanLook(opts.look);
    this.plan = planPigeons(data, { pads: this.look.pads });
    this.canvas = opts.canvas ?? document.createElement('canvas');
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, -400, 600);
    this.across = opts.across;
    this.centerY = opts.centerY ?? 0.5;
    const top = Math.min(0.8, Math.max(0, opts.safe?.top ?? 0));
    this.safe = { top, bottom: Math.min(1, Math.max(top + 0.2, opts.safe?.bottom ?? 1)) };
    this.sense = senseMusic(data.notes, data.bars);
    this.songEnd = maxOf(data.notes.map((n) => n.end), 1);
    this.ownFloor = opts.floor ? new T.Color(opts.floor) : null;
    this.frame(opts.width, opts.height, opts.tall);

    this.sky = new T.HemisphereLight(0xffffff, 0xb8b2a8, 1.6);
    this.sun = new T.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-6, 14, 9);
    this.scene.add(this.sky, this.sun);

    this.buildKeyboard();
    this.buildStage();
    const shadowGeo = new T.CircleGeometry(0.55, 16);
    const shadowMat = new T.MeshBasicMaterial({ color: 0x1b1a24, transparent: true, opacity: 0.22, depthWrite: false });
    this.disposables.push(shadowGeo, shadowMat);
    for (const p of this.plan.pigeons) {
      const m = makePigeon(p.seed, p.size, shadowGeo, shadowMat);
      this.scene.add(m.root);
      this.birds.push(m);
    }
    for (const n of this.plan.notes) {
      const list = this.byKey.get(n.midi) ?? [];
      list.push(n);
      this.byKey.set(n.midi, list);
    }
  }

  /**
   * Sets the picture's size in pixels and its shape (tall: the keys run corner to corner; wide:
   * across the middle). The export sets it once; a page calls it when its canvas changes size.
   */
  frame(width: number, height: number, tall: boolean) {
    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
    this.tall = tall;
  }

  /** A floor colour of your own (any CSS colour) in place of the backgrounds'; null: theirs again */
  setFloor(color: string | null) {
    this.ownFloor = color ? new T.Color(color) : null;
  }

  /** Changes which backgrounds and camera angles it uses, and when it changes between them */
  setLook(look: Partial<PigeonLook>) {
    this.look = cleanLook({ ...this.look, ...look });
  }

  /** Whether the floor is dark at t (the export then draws its text in light ink) */
  darkAt(t: number): boolean {
    if (this.ownFloor) return this.ownFloor.getHSL({ h: 0, s: 0, l: 0 }).l < 0.45;
    const { now, from, mix } = backgroundAt(this.look, t);
    return backgroundOf(mix < 0.5 ? from : now).dark;
  }

  /**
   * The background at t: the floor's colour, the light, and each background's floor details faded
   * in or out and moving with the music (as much as the look's motion and the background's own
   * liveliness allow); and the rings spreading from the keys just struck.
   */
  private dress(t: number) {
    const { now, from, mix } = backgroundAt(this.look, t);
    const motion = this.look.motion;
    // How far through the song it is (a background whose light changes through it: the sunset going down)
    const through = Math.min(1, Math.max(0, t / this.songEnd)) * motion;
    const lit = (b: PigeonBackground) => {
      const late = b.late;
      const at = (early: string, end?: string) => (end ? this.color(early).clone().lerp(this.color(end), through) : this.color(early));
      return { floor: at(b.floor, late?.floor), sky: at(b.sky, late?.sky), sun: at(b.sun, late?.sun) };
    };
    const a = backgroundOf(from);
    const b = backgroundOf(now);
    const la = lit(a);
    const lb = lit(b);
    this.renderer.setClearColor(this.ownFloor ?? la.floor.clone().lerp(lb.floor, mix));
    this.sky.color.copy(la.sky).lerp(lb.sky, mix);
    this.sky.groundColor.copy(this.color(a.bounce)).lerp(this.color(b.bounce), mix);
    this.sky.intensity = a.skyLight + (b.skyLight - a.skyLight) * mix;
    this.sun.color.copy(la.sun).lerp(lb.sun, mix);
    this.sun.intensity = a.sunLight + (b.sunLight - a.sunLight) * mix;
    for (const id of new Set([from, now])) {
      if (this.details.has(id)) continue;
      const x0 = keyX(this.plan.low);
      const x1 = keyX(this.plan.high);
      const mat = floorMaterial(x0 - FLOOR_REACH, x1 + FLOOR_REACH);
      const mesh = new T.Mesh(floorDetails(id, x0, x1), mat);
      mesh.renderOrder = -1;
      // (its details move on the graphics card, so where it is can't be told from its corners: always draw it)
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.details.set(id, { mesh, mat });
    }
    const pulse = pulseAt(this.sense, t);
    const energy = energyAt(this.sense, t);
    const travel = travelAt(this.sense, t);
    const flares = flaresAt(this.sense, t);
    for (const [id, d] of this.details) {
      const shown = id === now ? (id === from ? 1 : mix) : id === from ? 1 - mix : 0;
      d.mesh.visible = shown > 0.001;
      if (!d.mesh.visible) continue;
      const bg = backgroundOf(id);
      const u = d.mat.uniforms;
      u.uOpacity.value = shown;
      u.uAmount.value = motion * (0.4 + 0.6 * bg.lively);
      u.uTime.value = t;
      u.uPulse.value = pulse;
      u.uEnergy.value = energy;
      // A calm background drifts at nearly one pace; a lively one quickens with the music. Never faster than its drift speed
      u.uDrift.value = motion * bg.drift * ((1 - bg.lively) * 0.7 * t + bg.lively * travel);
      u.uGroups.value.set(flares[0].group, flares[1].group, flares[2].group, flares[3].group);
      u.uGlows.value.set(flares[0].glow, flares[1].glow, flares[2].glow, flares[3].glow);
      // (the sunset's tiles darken with its floor)
      if (bg.late && !this.ownFloor) {
        const floor = lit(bg).floor;
        const first = this.color(bg.floor);
        u.uTint.value.setRGB(floor.r / first.r, floor.g / first.g, floor.b / first.b);
      }
    }
    this.ripple(t, motion * (0.45 + 0.55 * (backgroundOf(from).lively + (backgroundOf(now).lively - backgroundOf(from).lively) * mix)));
  }

  /** Rings spreading across the floor from under each key struck in the last moments, in its track's colour, fading as they go */
  private ripple(t: number, strength: number) {
    const notes = this.plan.notes;
    let used = 0;
    if (strength > 0.001) {
      // The notes begun within a ring's life, newest first (as many as there are rings)
      let hi = notes.length;
      let lo = 0;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (notes[mid].start <= t) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo - 1; i >= 0 && used < this.rings.length; i--) {
        const age = t - notes[i].start;
        if (age > RING_LIFE) break;
        const k = age / RING_LIFE;
        const { mesh, mat } = this.rings[used++];
        mesh.visible = true;
        mesh.scale.setScalar(WHITE_L / 2 + 0.4 + age * RING_SPEED);
        mesh.position.set(keyX(notes[i].midi), 0.012 + used * 0.00002, 0);
        mat.color.copy(this.color(notes[i].color));
        mat.opacity = 0.55 * strength * (1 - k) * (1 - k);
      }
    }
    for (; used < this.rings.length; used++) this.rings[used].mesh.visible = false;
  }

  /**
   * Points the camera for the angle in use at t: at the middle of what's playing, turned so the
   * keyboard runs at the angle's slope across the frame, pulled back far enough to show what's
   * playing (both hands, as it were), and moved so the keys sit where the picture's room is.
   */
  private aim(t: number) {
    const cam: PigeonCamera = cameraOf(cameraAt(this.look, t));
    const across = this.across ?? (this.tall ? cam.across.tall : cam.across.wide);
    this.view = this.aspect < 1 ? { w: across, h: across / this.aspect } : { w: across * this.aspect, h: across };
    this.camera.left = -this.view.w / 2;
    this.camera.right = this.view.w / 2;
    this.camera.top = this.view.h / 2;
    this.camera.bottom = -this.view.h / 2;
    const { x: fx, spread } = this.focus(t);
    const target = new T.Vector3(fx, 0, 0.5);
    const dist = 120;
    this.camera.position.set(target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist, target.y + Math.sin(cam.pitch) * dist, target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    // Which way the keyboard runs across the picture as the camera stands, and how much shorter it
    // looks than it is; then the camera is rolled to give it the angle's slope
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorld.elements;
    const rx = e[0];
    const ux = e[4];
    const seen = Math.hypot(rx, ux);
    // (a stage in a tall frame runs steeply up it, and nearly level across a wide one: it's long, and so fills the frame)
    const slope = !this.box ? (this.tall ? cam.slope.tall : cam.slope.wide) : this.tall ? Math.sign(cam.slope.tall || 1) * Math.max(Math.abs(cam.slope.tall), STAGE_SLOPE.tall) : Math.sign(cam.slope.wide) * Math.min(Math.abs(cam.slope.wide), STAGE_SLOPE.wide);
    // (the lesser turn that gives that slope: the camera stays the right way up)
    this.camera.rotateZ(uprightRoll(rx, ux, slope));
    if (this.box) {
      // A stage (pads, drums): the camera holds all of it, the same all through, however the music
      // moves about it, inside the frame's safe part. Every angle does, the close-up too (it's
      // the nearest and lowest of them): a part out of the frame would be a part not seen
      this.camera.updateMatrixWorld();
      const m = this.camera.matrixWorld.elements;
      const { x0, x1, z0, z1 } = this.box;
      const mid = new T.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
      let a0 = Infinity;
      let a1 = -Infinity;
      let u0 = Infinity;
      let u1 = -Infinity;
      for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [0, 2.4]) {
        const dx = x - mid.x;
        const dz = z - mid.z;
        const ac = dx * m[0] + y * m[1] + dz * m[2];
        const upw = dx * m[4] + y * m[5] + dz * m[6];
        a0 = Math.min(a0, ac);
        a1 = Math.max(a1, ac);
        u0 = Math.min(u0, upw);
        u1 = Math.max(u1, upw);
      }
      const room = this.safe.bottom - this.safe.top;
      this.camera.zoom = Math.min(1.8, 0.94 * Math.min(this.view.w / (a1 - a0), (this.view.h * room) / (u1 - u0)));
      // (moved so the stage is in the middle of the safe part, keeping the way it looks)
      this.camera.position.add(new T.Vector3(mid.x - target.x, 0, mid.z - target.z));
      this.camera.updateProjectionMatrix();
      this.camera.translateX((a0 + a1) / 2);
      this.camera.translateY((u0 + u1) / 2 + (((this.safe.top + this.safe.bottom) / 2 - 0.5) * this.view.h) / this.camera.zoom);
      return;
    } else {
      // How many keys fit along the frame at this slope, and so how far to pull back
      const fits = 0.92 * Math.min(this.view.w / Math.max(1e-6, seen * Math.abs(Math.cos(slope))), this.view.h / Math.max(1e-6, seen * Math.abs(Math.sin(slope))));
      this.camera.zoom = Math.min(1, Math.max(cam.furthest, fits / (2.2 * spread + 10)));
    }
    this.camera.updateProjectionMatrix();
    this.camera.translateY(((this.centerY - 0.5) * this.view.h) / this.camera.zoom);
  }

  /** The banks of pads and the drums, if the song has them (pigeonStage.ts): dark slabs with a pad for each note, drums with a skin that flashes */
  private buildStage() {
    const { stage, low, high } = this.plan;
    if (!stage.banks.length && !stage.drums.length) return;
    // (with room at the keyboard's ends for the birds waiting there)
    this.box = stageBox(stage, keyX(low) - WHITE_W - WINGS_NEAR - WINGS_DEEP * 0.6, keyX(high) + WHITE_W + WINGS_NEAR + WINGS_DEEP * 0.6);
    const slabMat = flat(0x2a2833);
    this.disposables.push(slabMat);
    const add = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number) => {
      this.disposables.push(geo);
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      return mesh;
    };
    stage.banks.forEach((bank: PadBank, bi) => {
      const { w, d } = bankSize(bank);
      add(new T.BoxGeometry(w + 0.5, 0.07, d + 0.5), slabMat, bank.x, 0.035, bank.z);
      const padGeo = new T.BoxGeometry(PAD_W, PAD_TOP - 0.05, PAD_D);
      this.disposables.push(padGeo);
      for (const midi of bank.pitches) {
        const at = padSpot(bank, midi)!;
        // Unlit, a pad is a dim shade of its part's colour; lit, the colour itself
        const lit = new T.Color(bank.color);
        const base = lit.clone().multiplyScalar(0.3).lerp(new T.Color(0x3a3846), 0.45);
        const mat = flat(base.getHex());
        this.disposables.push(mat);
        const mesh = new T.Mesh(padGeo, mat);
        mesh.position.set(at.x, 0.05 + (PAD_TOP - 0.05) / 2, at.z);
        this.scene.add(mesh);
        this.pads.push({ mesh, mat, base, lit, key: padKey(bi, midi) });
      }
    });
    for (const drum of stage.drums as DrumPad[]) {
      const lit = new T.Color(drum.color);
      const base = lit.clone().multiplyScalar(0.55);
      const mat = flat(base.getHex());
      this.disposables.push(mat);
      if (drum.kind === 'kick') {
        add(new T.BoxGeometry(KICK_SIZE + 0.4, 0.07, KICK_SIZE + 0.4), slabMat, drum.x, 0.035, drum.z);
        const skin = add(new T.BoxGeometry(KICK_SIZE, PAD_TOP - 0.05, KICK_SIZE), mat, drum.x, 0.05 + (PAD_TOP - 0.05) / 2, drum.z);
        this.drums.push({ skin, mat, base, lit, hits: drum.hits, rest: skin.position.y });
      } else {
        // A drum: a dark shell, its skin on top
        add(new T.CylinderGeometry(DRUM_R, DRUM_R * 0.9, DRUM_TOP - 0.06, 20), slabMat, drum.x, (DRUM_TOP - 0.06) / 2, drum.z);
        const skin = add(new T.CylinderGeometry(DRUM_R * 0.94, DRUM_R * 0.94, 0.06, 20), mat, drum.x, DRUM_TOP - 0.03, drum.z);
        this.drums.push({ skin, mat, base, lit, hits: drum.hits, rest: skin.position.y });
      }
    }
  }

  /** The pads and drums at t: a pad lit (and a little down) while its note sounds, struck afresh as a key is; a drum's skin flashing as it's hit */
  private light(t: number) {
    for (const pad of this.pads) {
      const { down, lit } = keyAt(this.plan.byPad.get(pad.key), t);
      const on = Math.min(1, down / (PRESS * (1 - RESTRIKE)));
      pad.mesh.position.y = 0.05 + (PAD_TOP - 0.05) / 2 - (down / PRESS) * 0.035;
      pad.mat.color.copy(pad.base).lerp(pad.lit, lit ? on : 0);
      pad.mat.emissive.copy(pad.lit).multiplyScalar(lit ? 0.55 * on : 0);
    }
    for (const drum of this.drums) {
      const { turns, since } = turnAt(drum.hits, t);
      const flash = turns ? Math.exp(-since / 0.09) : 0;
      drum.skin.position.y = drum.rest - flash * 0.03;
      drum.mat.color.copy(drum.base).lerp(drum.lit, flash);
      drum.mat.emissive.copy(drum.lit).multiplyScalar(0.6 * flash);
    }
  }

  private buildKeyboard() {
    const { low, high } = this.plan;
    const glowGeo = new T.PlaneGeometry(1, 1);
    this.disposables.push(glowGeo);
    const boxMesh = (b: KeyBox, mat: T.Material) => {
      const geo = new T.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
      this.disposables.push(geo);
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      return mesh;
    };
    // The key bed, and a soft shadow on the floor beside it
    const bed = bedBox(low, high);
    const bedMat = flat(0x2a2833);
    this.disposables.push(bedMat);
    this.scene.add(boxMesh(bed, bedMat));
    const shadeGeo = new T.PlaneGeometry(bed.x1 - bed.x0 + 2.6, WHITE_L + 1.5);
    const shadeMat = new T.MeshBasicMaterial({ color: 0x1b1a24, transparent: true, opacity: 0.12, depthWrite: false });
    this.disposables.push(shadeGeo, shadeMat);
    const shade = new T.Mesh(shadeGeo, shadeMat);
    shade.rotation.x = -Math.PI / 2;
    shade.position.set((bed.x0 + bed.x1) / 2 + 0.8, 0.01, 0.9);
    this.scene.add(shade);

    // The keys, each a group that goes down as one when it's played
    for (const key of keyBoxes(low, high)) {
      const base = new T.Color(key.black ? 0x1d1c22 : 0xfbfaf7);
      const mat = flat(base.getHex());
      this.disposables.push(mat);
      const mesh = new T.Group();
      for (const b of key.boxes) mesh.add(boxMesh(b, mat));
      this.scene.add(mesh);
      this.keys.set(key.midi, { mesh, mat, base });
    }
    // Rings that spread from a struck key (a pool, reused)
    const ringGeo = new T.RingGeometry(0.965, 1, 56);
    this.disposables.push(ringGeo);
    for (let i = 0; i < 40; i++) {
      const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide });
      this.disposables.push(mat);
      const mesh = new T.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat });
    }
    // Glows: a soft coloured patch on the floor in front of a played key (a pool, reused)
    for (let i = 0; i < 24; i++) {
      const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      this.disposables.push(mat);
      const mesh = new T.Mesh(glowGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.glows.push({ mesh, mat });
    }
  }

  private color(css: string): T.Color {
    let c = this.colors.get(css);
    if (!c) this.colors.set(css, (c = new T.Color(css)));
    return c;
  }

  /**
   * Where the camera looks at t, and how much of the keyboard it must show: the middle of what's
   * playing around then (the nearer in time counting more), and how far it spreads either side
   */
  private focus(t: number): { x: number; spread: number } {
    const notes = this.plan.notes;
    const xs: number[] = [];
    const ws: number[] = [];
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].start < t - 8) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < notes.length && notes[i].start < t + 2.5; i++) {
      const n = notes[i];
      const d = n.end < t ? t - n.end : n.start > t ? n.start - t : 0;
      if (d > 2.5) continue;
      xs.push(keyX(n.midi));
      ws.push(Math.exp(-(d * d) / 1.5));
    }
    const middle = (keyX(this.plan.low) + keyX(this.plan.high)) / 2;
    // (a little pull toward the middle, so silence doesn't leave the camera anywhere odd)
    let sum = middle * 0.05;
    let weight = 0.05;
    xs.forEach((x, i) => ((sum += x * ws[i]), (weight += ws[i])));
    const x = sum / weight;
    let dev = 0;
    xs.forEach((v, i) => (dev += Math.abs(v - x) * ws[i]));
    return { x, spread: dev / weight };
  }

  /** Draws the frame for time t (seconds) into `canvas` */
  render(t: number): HTMLCanvasElement {
    this.dress(t);
    this.aim(t);
    this.light(t);

    // Keys: down and coloured while played
    for (const [midi, k] of this.keys) {
      const { down, lit } = keyAt(this.byKey.get(midi), t);
      const black = isBlack(midi);
      k.mesh.position.y = -down;
      if (lit) {
        k.mat.color.copy(k.base).lerp(this.color(lit.color), (black ? 0.75 : 0.62) * Math.min(1, down / (PRESS * (1 - RESTRIKE))));
        // (and it glows a little, which shows on the night street)
        k.mat.emissive.copy(this.color(lit.color)).multiplyScalar(0.3 * Math.min(1, down / (PRESS * (1 - RESTRIKE))));
      } else {
        k.mat.color.copy(k.base);
        k.mat.emissive.setRGB(0, 0, 0);
      }
    }
    // Floor glows in front of the keys being played, fading out after
    let g = 0;
    for (const [midi, notes] of this.byKey) {
      for (const n of notes) {
        if (n.start > t) break;
        const after = t - n.end;
        if (after > 0.5 || g >= this.glows.length) continue;
        const fade = after < 0 ? 1 : 1 - after / 0.5;
        const pulse = clamp01((t - n.start) / 0.25);
        const { mesh, mat } = this.glows[g++];
        mesh.visible = true;
        mat.color.copy(this.color(n.color));
        mat.opacity = 0.35 * fade;
        const w = isBlack(midi) ? 0.9 : 1.1;
        mesh.scale.set(w * (0.6 + 0.4 * pulse), 1.4 + pulse * 0.8, 1);
        mesh.position.set(keyX(midi), 0.012, WHITE_L / 2 + 0.6 + pulse * 0.4);
      }
    }
    for (; g < this.glows.length; g++) this.glows[g].mesh.visible = false;

    const posed = this.posed(t);
    posed.forEach((b, i) => applyPose(this.birds[i], b, t, this.plan.pigeons[i].seed));
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  /** Every bird's pose at t, kept clear of one another */
  posed(t: number): Posed[] {
    return posedAt(this.plan, t);
  }

  /** How many birds are on the keys at t (for the "on the keys" count) */
  onKeys(t: number): number {
    return birdsOnKeys(this.plan, t);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => !SHARED.includes(x) && x.dispose());
      }
    });
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
