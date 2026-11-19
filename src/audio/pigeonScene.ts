/**
 * Pigeons video picture (a prototype): the song's notes played by low-poly pigeons walking and hopping
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
const FRONT_Z = WHITE_L / 2 + 2.2;
const BACK_Z = -WHITE_L / 2 - 2.4;

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
/** A bird lands this long before its note */
const LAND_EARLY = 0.05;

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
}

export function planPigeons(data: ShowcaseData): PigeonPlanResult {
  const notes = data.notes.filter((n) => !n.drum && !n.perc && n.end > n.start).sort((a, b) => a.start - b.start || a.midi - b.midi);
  const mids = notes.map((n) => n.midi);
  // Whole octaves around what's played, at least three
  let low = mids.length ? minOf(mids) : 48;
  let high = mids.length ? maxOf(mids) : 72;
  low = Math.floor(low / 12) * 12 - 12;
  high = Math.ceil((high + 1) / 12) * 12 + 12;
  while (high - low < 48) {
    low -= 6;
    high += 6;
  }
  low = Math.max(0, Math.floor(low / 12) * 12);
  high = Math.min(127, Math.ceil(high / 12) * 12);

  const count = Math.min(30, Math.max(6, polyphony(notes) * 2 + 4));
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
    const at = new T.Vector3(x0 + ((i + 0.5) / count) * (x1 - x0) + (r() - 0.5) * 2, 0, (front ? FRONT_Z : BACK_Z) + (front ? 1 : -1) * r() * 3);
    birds.push({ plan: { legs: [], seed: Math.floor(r() * 1e9), size: 1 + r() * 0.06 }, at, free: -10, onKeys: false });
  }

  const push = (b: Bird, leg: Leg) => b.plan.legs.push(leg);
  /** Somewhere to wait on the floor near x, on one side of the keys: of a few spots, the one with the most room round it */
  const floorSpot = (x: number, front: boolean) => {
    let best = new T.Vector3();
    let bestRoom = -1;
    for (let tries = 0; tries < 6; tries++) {
      const spot = new T.Vector3(x + (r() - 0.5) * 5, 0, front ? FRONT_Z + r() * 4 : BACK_Z - r() * 4);
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
  const EDGE = WHITE_L / 2 + 0.6;
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
      const walkTime = flatDist(ground, edge) / WALK_SPEED;
      const time = walkTime + HOP_TIME;
      const t0 = Math.max(b.free, arrive - time);
      const t1 = Math.max(arrive, t0 + time * 0.5);
      const split = t0 + ((up ? walkTime : HOP_TIME) / time) * (t1 - t0);
      push(b, { kind: up ? 'walk' : 'hop', t0, t1: split, from: b.at.clone(), to: edge.clone() });
      push(b, { kind: up ? 'hop' : 'walk', t0: split, t1, from: edge.clone(), to: to.clone() });
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
      const last = holder.plan.legs[holder.plan.legs.length - 1];
      if (leave > last.t1) {
        last.t1 = leave;
        holder.free = leave;
      }
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
  return { pigeons: birds.map((b) => b.plan), notes, low, high, byKey };
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
      const over = leg.from.y > 0 !== leg.to.y > 0 ? CLEAR_HOP : far < 0.05 ? Math.min(REHOP_HEIGHT, (leg.t1 - leg.t0) * (REHOP_HEIGHT / REHOP_TIME)) : 0.35 + Math.abs(leg.to.y - leg.from.y) * 0.5;
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
      // A little stamp as it lands
      const since = t - leg.note!.start;
      if (since > -0.06 && since < 0.12) lift = Math.max(0, -since) * 2;
      give = 0;
      break;
    }
    case 'stand': {
      pos.copy(leg.from);
      // Idle on the floor: a peck now and then
      if (leg.from.y === 0) {
        const cycle = (t * 0.6 + (seed % 97) / 13) % 3.5;
        peck = cycle < 0.5 ? Math.sin((cycle / 0.5) * Math.PI) : 0;
      } else give = 0.5;
      break;
    }
  }
  if (arriving) give = 1 - ease(k);
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
  let h = onKey ? FACE : way;
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
function spaceOut(birds: Posed[], least: number): boolean {
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
export function solveSpacing(birds: Posed[]) {
  // First the birds that give way move; if that can't settle it (one boxed in), the birds playing
  // budge a little too (a small shift on their key, unseen beside a bird popping up)
  if (spaceOut(birds, 0) || spaceOut(birds, 0.2)) return;
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

/** Every bird's pose at t, kept clear of one another (what a frame draws) */
export function posedAt(plan: PigeonPlanResult, t: number): Posed[] {
  const posed = plan.pigeons.map((p) => rawPose(p, t, plan.byKey));
  solveSpacing(posed);
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
  let down = 0;
  if (notes) {
    for (const n of notes) {
      if (n.start > t + 0.05) break;
      if (n.end > t - 0.1) down = Math.max(down, keyDown(n, t));
    }
  }
  return down;
}

/** How far a note's key is down at t: quickly down, held, back up */
function keyDown(n: ShowcaseNote, t: number): number {
  if (t < n.start - 0.02 || t > n.end + 0.08) return 0;
  const down = clamp01((t - n.start + 0.02) / 0.04);
  const up = clamp01((n.end + 0.08 - t) / 0.08);
  return PRESS * Math.min(down, up);
}

/** The height of whatever's under (x, z): the keys or the floor (roughly: white keys' top) */
function groundAt(_x: number, z: number): number {
  return Math.abs(z) <= WHITE_L / 2 ? WHITE_TOP : 0;
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
  private keys = new Map<number, { mesh: T.Mesh; mat: T.MeshLambertMaterial; base: T.Color; top: number }>();
  private glows: Array<{ mesh: T.Mesh; mat: T.MeshBasicMaterial }> = [];
  /** Notes by key, for lighting the keys */
  private byKey = new Map<number, ShowcaseNote[]>();
  private colors = new Map<string, T.Color>();
  private view: { w: number; h: number };
  private tilt: number;
  /** Roughly how many keys fit along the frame at the usual zoom */
  private alongKeys: number;
  private centerY: number;
  private disposables: Array<{ dispose(): void }> = [];

  constructor(data: ShowcaseData, opts: PigeonSceneOptions) {
    this.plan = planPigeons(data);
    this.canvas = document.createElement('canvas');
    this.canvas.width = opts.width;
    this.canvas.height = opts.height;
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(opts.width, opts.height, false);
    this.renderer.setClearColor(new T.Color(PIGEON_FLOOR));
    this.renderer.outputColorSpace = T.SRGBColorSpace;

    // Units across the frame's narrow side: about 14 white keys in a portrait frame, 22 in a wide one
    const aspect = opts.width / opts.height;
    const across = opts.across ?? (opts.tall ? 16 : 17);
    this.view = aspect < 1 ? { w: across, h: across / aspect } : { w: across * aspect, h: across };
    this.tilt = opts.tall ? -0.3 : 0.12;
    this.alongKeys = opts.tall ? 21 : 32;
    this.centerY = opts.centerY ?? 0.5;
    this.camera = new T.OrthographicCamera(-this.view.w / 2, this.view.w / 2, this.view.h / 2, -this.view.h / 2, -200, 400);

    this.scene.add(new T.HemisphereLight(0xffffff, 0xb8b2a8, 1.6));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-6, 14, 9);
    this.scene.add(sun);

    this.buildKeyboard();
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

  private buildKeyboard() {
    const { low, high } = this.plan;
    const whiteGeo = new T.BoxGeometry(WHITE_W * 0.94, WHITE_TOP, WHITE_L);
    const blackGeo = new T.BoxGeometry(BLACK_W, BLACK_TOP - WHITE_TOP + 0.5, BLACK_L);
    const glowGeo = new T.PlaneGeometry(1, 1);
    this.disposables.push(whiteGeo, blackGeo, glowGeo);
    // The keyboard's body under the keys and a soft shadow on the floor
    const x0 = keyX(low) - WHITE_W;
    const x1 = keyX(high) + WHITE_W;
    const baseGeo = new T.BoxGeometry(x1 - x0 + 0.4, 0.3, WHITE_L + 0.4);
    const baseMat = flat(0x2a2833);
    this.disposables.push(baseGeo, baseMat);
    const base = new T.Mesh(baseGeo, baseMat);
    base.position.set((x0 + x1) / 2, 0.15, 0);
    this.scene.add(base);
    const shadeGeo = new T.PlaneGeometry(x1 - x0 + 3, WHITE_L + 1.5);
    const shadeMat = new T.MeshBasicMaterial({ color: 0x1b1a24, transparent: true, opacity: 0.12, depthWrite: false });
    this.disposables.push(shadeGeo, shadeMat);
    const shade = new T.Mesh(shadeGeo, shadeMat);
    shade.rotation.x = -Math.PI / 2;
    shade.position.set((x0 + x1) / 2 + 0.8, 0.01, 0.9);
    this.scene.add(shade);

    for (let m = low; m <= high; m++) {
      const black = isBlack(m);
      const base = new T.Color(black ? 0x1d1c22 : 0xfbfaf7);
      const mat = flat(base.getHex());
      this.disposables.push(mat);
      const mesh = new T.Mesh(black ? blackGeo : whiteGeo, mat);
      const top = keyTop(m);
      if (black) mesh.position.set(keyX(m), top - (BLACK_TOP - WHITE_TOP + 0.5) / 2, -WHITE_L / 2 + BLACK_L / 2);
      else mesh.position.set(keyX(m), top / 2, 0);
      this.scene.add(mesh);
      this.keys.set(m, { mesh, mat, base, top });
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
    // The camera: high, looking down at an angle, turned so the keys run diagonally up the frame
    const { x: fx, spread } = this.focus(t);
    // Zoomed out far enough to show what's playing (both hands, as it were), never in past the usual
    this.camera.zoom = Math.min(1, Math.max(0.4, this.alongKeys / (2.2 * spread + 10)));
    this.camera.updateProjectionMatrix();
    const target = new T.Vector3(fx, 0, 0.5);
    const dist = 60;
    const yaw = -0.5;
    const pitch = 0.92;
    this.camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(target);
    // (turn the picture so the keyboard climbs from bottom left to top right)
    this.camera.rotateZ(this.tilt);
    // (and moved so the keys sit where the picture's room is)
    this.camera.translateY(((this.centerY - 0.5) * this.view.h) / this.camera.zoom);

    // Keys: down and coloured while played
    for (const [midi, k] of this.keys) {
      const notes = this.byKey.get(midi);
      let down = 0;
      let lit: ShowcaseNote | null = null;
      if (notes) {
        for (const n of notes) {
          if (n.start > t + 0.05) break;
          const d = keyDown(n, t);
          if (d > down) {
            down = d;
            lit = n;
          }
        }
      }
      const black = isBlack(midi);
      k.mesh.position.y = (black ? k.top - (BLACK_TOP - WHITE_TOP + 0.5) / 2 : k.top / 2) - down;
      if (lit) k.mat.color.copy(k.base).lerp(this.color(lit.color), (black ? 0.75 : 0.62) * (down / PRESS));
      else k.mat.color.copy(k.base);
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
    let n = 0;
    for (const p of this.plan.pigeons) if (findLeg(p.legs, t).kind === 'press') n++;
    return n;
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
