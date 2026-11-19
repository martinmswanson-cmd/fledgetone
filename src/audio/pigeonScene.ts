/**
 * Pigeons video picture (a prototype): the song's notes played by low-poly pigeons walking and hopping
 * across a big piano keyboard, seen from above at an angle. Drawn with three.js, one frame for any
 * time asked (the export asks in order, but nothing here depends on that): the keys press and light
 * up in their track's colour, and a pigeon is standing on each key as it plays.
 *
 * Who goes where is worked out once, up front (planPigeons): each note gets the free pigeon that can
 * walk there in time (else the nearest, which flies), and every pigeon's day becomes a list of legs
 * (stand, walk, hop, fly) that frame(t) just reads. Drum hits aren't played by birds.
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
/** Where a pigeon stands on a key (z): the front of a white key (clear of the black ones), the middle of a black one */
const WHITE_STAND_Z = WHITE_L / 2 - 1.2;
const BLACK_STAND_Z = -WHITE_L / 2 + BLACK_L * 0.62;
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
  /** press: the note it's playing (its key goes down under the bird) */
  note?: ShowcaseNote;
}
interface PigeonPlan {
  legs: Leg[];
  /** A little variety per bird: size, feather shade, step phase */
  seed: number;
}

/** Walking pace (units a second) and the hop and flight times */
const WALK_SPEED = 5.5;
const HOP_TIME = 0.2;
const HOP_REACH = 1.6;
/** A bird lands this long before its note */
const LAND_EARLY = 0.05;
/** Longer than this between notes, a bird steps off the keys and waits on the floor */
const WAIT_OFF = 2.6;

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
    birds.push({ plan: { legs: [], seed: Math.floor(r() * 1e9) }, at, free: -10, onKeys: false });
  }

  const push = (b: Bird, leg: Leg) => b.plan.legs.push(leg);
  const floorSpot = (x: number, front: boolean) => new T.Vector3(x + (r() - 0.5) * 3, 0, front ? FRONT_Z + r() * 2.5 : BACK_Z - r() * 2.5);
  /** Moves `b` from where it is to `to`, arriving at `arrive` (leaving no earlier than b.free), the way the room allows */
  const travel = (b: Bird, to: T.Vector3, arrive: number) => {
    const d = flatDist(b.at, to);
    const climbs = b.at.y !== to.y;
    if (d < 0.05 && !climbs) return;
    const window = arrive - b.free;
    if (d <= HOP_REACH && window >= HOP_TIME * 0.6) {
      const t0 = Math.max(b.free, arrive - HOP_TIME);
      push(b, { kind: 'hop', t0, t1: arrive, from: b.at.clone(), to: to.clone() });
    } else if (d / WALK_SPEED + (climbs ? HOP_TIME : 0) <= window) {
      // Walk most of the way, hop the step up or down at the keys' edge
      const walkTime = d / WALK_SPEED;
      const t0 = arrive - walkTime - (climbs ? HOP_TIME : 0);
      if (climbs) {
        // The edge: where the floor meets the keys, on the bird's way
        const edgeZ = to.y > b.at.y ? (b.at.z > 0 ? WHITE_L / 2 + 0.6 : -WHITE_L / 2 - 0.6) : to.z > 0 ? WHITE_L / 2 + 0.6 : -WHITE_L / 2 - 0.6;
        const ground = to.y > b.at.y ? b.at : to;
        const edge = new T.Vector3(ground === b.at ? to.x : b.at.x, 0, edgeZ);
        if (to.y > b.at.y) {
          push(b, { kind: 'walk', t0, t1: t0 + walkTime, from: b.at.clone(), to: edge });
          push(b, { kind: 'hop', t0: t0 + walkTime, t1: arrive, from: edge.clone(), to: to.clone() });
        } else {
          push(b, { kind: 'hop', t0, t1: t0 + HOP_TIME, from: b.at.clone(), to: edge });
          push(b, { kind: 'walk', t0: t0 + HOP_TIME, t1: arrive, from: edge.clone(), to: to.clone() });
        }
      } else push(b, { kind: 'walk', t0, t1: arrive, from: b.at.clone(), to: to.clone() });
    } else {
      // Too far to walk: it flies (quickly, if it must)
      const t0 = Math.max(b.free, arrive - Math.max(0.35, d / 16));
      push(b, { kind: 'fly', t0: Math.min(t0, arrive - 0.12), t1: arrive, from: b.at.clone(), to: to.clone() });
    }
    b.at = to.clone();
    b.free = arrive;
  };

  for (const n of notes) {
    const spot = new T.Vector3(keyX(n.midi), keyTop(n.midi), standZ(n.midi) + (r() - 0.5) * 0.4);
    const arrive = n.start - LAND_EARLY;
    // The free bird that can walk (or hop) there in time, nearest first; else the nearest free one
    let best: Bird | null = null;
    let bestCost = Infinity;
    for (const b of birds) {
      if (b.free > arrive - 0.02) continue;
      const d = flatDist(b.at, spot);
      const walks = d <= HOP_REACH || d / WALK_SPEED + HOP_TIME <= arrive - b.free;
      const cost = d + (walks ? 0 : 1000) + (b.onKeys ? 0 : 3);
      if (cost < bestCost) {
        bestCost = cost;
        best = b;
      }
    }
    if (!best) continue;
    const b = best;
    // A long wait: step off the keys onto the floor near the next key, and wait there
    if (b.onKeys && arrive - b.free > WAIT_OFF + 2) {
      const front = r() < 0.7;
      const wait = floorSpot((b.at.x + spot.x) / 2, front);
      travel(b, wait, b.free + flatDist(b.at, wait) / WALK_SPEED + HOP_TIME + 0.1);
      b.onKeys = false;
    }
    travel(b, spot, arrive);
    // Short notes: it's off again before the key comes up (so one bird can run a fast line)
    const len = n.end - n.start;
    const leave = len > 0.4 ? n.end : n.start + Math.max(0.06, len * 0.55);
    push(b, { kind: 'press', t0: arrive, t1: leave, from: spot.clone(), to: spot.clone(), note: n });
    b.free = leave;
    b.onKeys = true;
  }
  // Off the keys at the end
  for (const b of birds) {
    if (!b.onKeys) continue;
    const wait = floorSpot(b.at.x, r() < 0.6);
    travel(b, wait, b.free + flatDist(b.at, wait) / WALK_SPEED + HOP_TIME + 0.2);
  }
  // Fill the gaps between legs with standing still
  for (const b of birds) {
    const legs: Leg[] = [];
    let at = b.plan.legs.length ? b.plan.legs[0].from : b.at;
    let t = -1e6;
    for (const leg of b.plan.legs) {
      if (leg.t0 > t) legs.push({ kind: 'stand', t0: t, t1: leg.t0, from: at.clone(), to: at.clone() });
      legs.push(leg);
      at = leg.to;
      t = leg.t1;
    }
    legs.push({ kind: 'stand', t0: t, t1: 1e6, from: at.clone(), to: at.clone() });
    b.plan.legs = legs;
  }
  return { pigeons: birds.map((b) => b.plan), notes, low, high };
}

// ---------------------------------------------------------------------------------------------
// The pigeon: a few flat-shaded low-poly pieces

const flat = (color: number, extra: Partial<T.MeshLambertMaterialParameters> = {}) => new T.MeshLambertMaterial({ color, flatShading: true, ...extra });

interface PigeonModel {
  root: T.Group;
  body: T.Group;
  neck: T.Group;
  head: T.Group;
  wings: [T.Group, T.Group];
  legs: [T.Group, T.Group];
  shadow: T.Mesh;
}

function lowPoly(geo: T.BufferGeometry, wobble: number, seed: number): T.BufferGeometry {
  // A little irregularity, so it doesn't look turned on a lathe
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const r = rand(seed);
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = moved.get(key);
    if (!d) moved.set(key, (d = [(r() - 0.5) * wobble, (r() - 0.5) * wobble, (r() - 0.5) * wobble]));
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** A dark ink outline (a slightly bigger copy, its back faces only), so a bird reads against the pale floor and keys */
const INK = new T.MeshBasicMaterial({ color: 0x2b2836, side: T.BackSide });
function inked(mesh: T.Mesh, thickness = 0.07): T.Mesh {
  const shell = new T.Mesh(mesh.geometry, INK);
  shell.scale.setScalar(1 + thickness);
  mesh.add(shell);
  return mesh;
}

const SHADES = [0x8d93a3, 0x9aa0ae, 0x7e8494, 0xa7a9b2, 0x6f7280];

function makePigeon(seed: number, shadowGeo: T.BufferGeometry, shadowMat: T.Material): PigeonModel {
  const r = rand(seed);
  const shade = SHADES[Math.floor(r() * SHADES.length)];
  const grey = flat(shade);
  const dark = flat(0x4a4e5c);
  const pale = flat(0xc3c6cf);
  const sheen = flat(0x4f8a74, { emissive: 0x2a1f4a, emissiveIntensity: 0.35 });
  const orange = flat(0xe0743a);
  const beak = flat(0x3b3a40);
  const eye = flat(0xf08a24);

  const root = new T.Group();
  // The pigeon faces +x in its own space; root turns it
  const body = new T.Group();
  body.position.y = 0.55;
  root.add(body);

  const torso = inked(new T.Mesh(lowPoly(new T.IcosahedronGeometry(0.5, 1), 0.06, seed), grey), 0.06);
  torso.scale.set(1.25, 0.82, 0.78);
  body.add(torso);
  const belly = new T.Mesh(lowPoly(new T.IcosahedronGeometry(0.36, 0), 0.04, seed + 1), pale);
  belly.position.set(0.18, -0.12, 0);
  belly.scale.set(1.1, 0.8, 1.1);
  body.add(belly);
  // Tail: a flat fan, narrow at the body, with a dark band across its end
  const tail = inked(new T.Mesh(new T.ConeGeometry(0.3, 0.8, 4), grey), 0.1);
  tail.rotation.z = -Math.PI / 2 - 0.22;
  tail.scale.set(0.3, 1, 1);
  tail.position.set(-0.72, 0.1, 0);
  body.add(tail);
  const band = new T.Mesh(new T.BoxGeometry(0.1, 0.05, 0.6), dark);
  band.position.set(-1.06, 0.19, 0);
  band.rotation.z = 0.22;
  body.add(band);

  const wings: [T.Group, T.Group] = [new T.Group(), new T.Group()];
  wings.forEach((w, i) => {
    const side = i === 0 ? 1 : -1;
    w.position.set(0.05, 0.12, side * 0.27);
    const blade = inked(new T.Mesh(lowPoly(new T.IcosahedronGeometry(0.4, 0), 0.05, seed + 7 + i), grey), 0.08);
    blade.scale.set(1.4, 0.4, 0.5);
    blade.position.set(-0.15, 0, side * 0.08);
    w.add(blade);
    // Two dark wing bars
    for (const k of [0, 1]) {
      const bar = new T.Mesh(new T.BoxGeometry(0.07, 0.05, 0.16), dark);
      bar.position.set(-0.28 - k * 0.18, 0.11, side * 0.1);
      w.add(bar);
    }
    body.add(w);
  });

  const neck = new T.Group();
  neck.position.set(0.45, 0.22, 0);
  body.add(neck);
  const neckMesh = inked(new T.Mesh(lowPoly(new T.IcosahedronGeometry(0.27, 0), 0.03, seed + 3), sheen), 0.1);
  neckMesh.scale.set(1, 1.25, 1);
  neckMesh.position.y = 0.12;
  neck.add(neckMesh);
  const head = new T.Group();
  head.position.set(0.12, 0.42, 0);
  neck.add(head);
  const skull = inked(new T.Mesh(lowPoly(new T.IcosahedronGeometry(0.22, 0), 0.03, seed + 4), grey), 0.1);
  head.add(skull);
  const bill = new T.Mesh(new T.ConeGeometry(0.06, 0.26, 4), beak);
  bill.rotation.z = -Math.PI / 2;
  bill.position.set(0.27, -0.04, 0);
  head.add(bill);
  const cere = new T.Mesh(new T.IcosahedronGeometry(0.05, 0), pale);
  cere.position.set(0.18, 0.02, 0);
  head.add(cere);
  for (const side of [1, -1]) {
    const e = new T.Mesh(new T.IcosahedronGeometry(0.045, 0), eye);
    e.position.set(0.1, 0.06, side * 0.17);
    head.add(e);
  }

  const legs: [T.Group, T.Group] = [new T.Group(), new T.Group()];
  legs.forEach((hip, i) => {
    const side = i === 0 ? 1 : -1;
    hip.position.set(0.05, 0.3, side * 0.14);
    const shin = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.32, 4), orange);
    shin.position.y = -0.16;
    hip.add(shin);
    const foot = new T.Mesh(new T.ConeGeometry(0.1, 0.22, 3), orange);
    foot.rotation.z = -Math.PI / 2;
    foot.scale.set(1, 1, 0.4);
    foot.position.set(0.06, -0.31, 0);
    hip.add(foot);
    root.add(hip);
  });

  const shadow = new T.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  root.add(shadow);

  const size = 1.3 + r() * 0.2;
  root.scale.setScalar(size);
  return { root, body, neck, head, wings, legs, shadow };
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

function pose(p: PigeonModel, plan: PigeonPlan, t: number) {
  const leg = findLeg(plan.legs, t);
  const k = leg.t1 > leg.t0 ? clamp01((t - leg.t0) / (leg.t1 - leg.t0)) : 1;
  const pos = new T.Vector3();
  let lift = 0;
  let walkPhase = 0;
  let flap = 0;
  let bob = 0;
  let peck = 0;
  const seed = plan.seed;
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
      lift = Math.sin(k * Math.PI) * (0.35 + Math.abs(leg.to.y - leg.from.y) * 0.5);
      flap = Math.sin(k * Math.PI) * 0.6;
      break;
    }
    case 'fly': {
      pos.lerpVectors(leg.from, leg.to, ease(k));
      lift = Math.sin(k * Math.PI) * Math.min(4, 1 + flatDist(leg.from, leg.to) * 0.25);
      flap = 0.5 + 0.5 * Math.sin(t * 50);
      break;
    }
    case 'press': {
      pos.copy(leg.from);
      // Sinks with its key, and gives a little stamp as it lands
      const n = leg.note!;
      pos.y -= keyDown(n, t);
      const since = t - n.start;
      if (since > -0.06 && since < 0.12) lift = Math.max(0, -since) * 2;
      // A long note: wings up in triumph
      if (n.end - n.start > 0.8 && since > 0.1) flap = 0.35 + 0.15 * Math.sin(since * 9);
      break;
    }
    case 'stand': {
      pos.copy(leg.from);
      // Idle on the floor: a peck now and then
      if (leg.from.y === 0) {
        const cycle = (t * 0.6 + (seed % 97) / 13) % 3.5;
        peck = cycle < 0.5 ? Math.sin((cycle / 0.5) * Math.PI) : 0;
      }
      break;
    }
  }
  p.root.position.set(pos.x, pos.y + lift, pos.z);
  // On a key it faces the viewer (so neighbours on a chord stand side by side), turning on the hop up
  const FACE = -Math.PI / 2 + Math.sin(t * 1.3 + seed) * 0.12;
  const way = heading(plan.legs, leg, t, seed);
  p.root.rotation.y = leg.kind === 'press' ? FACE : leg.kind === 'hop' && leg.to.y > 0 ? turn(way, FACE, ease(k)) : way;
  // Legs: a step cycle while walking, tucked while flying
  const swing = leg.kind === 'walk' ? Math.sin(walkPhase) * 0.55 : 0;
  p.legs[0].rotation.z = swing;
  p.legs[1].rotation.z = -swing;
  const tucked = leg.kind === 'fly' ? Math.min(1, Math.sin(k * Math.PI) * 3) : 0;
  p.legs.forEach((l) => (l.scale.y = 1 - tucked * 0.6));
  p.body.position.y = 0.55 + (leg.kind === 'walk' ? Math.abs(Math.sin(walkPhase)) * 0.04 : 0);
  p.body.rotation.z = leg.kind === 'walk' ? 0.08 : leg.kind === 'fly' ? 0.2 : 0;
  // Head: thrust forward then held (walking), down for a peck
  const thrust = leg.kind === 'walk' ? (bob < 0.5 ? ease(bob * 2) : 1 - ease((bob - 0.5) * 2)) : 0;
  p.neck.position.x = 0.45 + thrust * 0.16;
  p.neck.rotation.z = -peck * 0.9;
  p.head.rotation.z = -peck * 0.4 + Math.sin(t * 2.3 + seed) * 0.05;
  // Wings
  p.wings[0].rotation.x = -flap * 1.4;
  p.wings[1].rotation.x = flap * 1.4;
  // The shadow stays on whatever's under the bird
  const ground = groundAt(pos.x, pos.z);
  p.shadow.position.set(0, (ground - p.root.position.y) / p.root.scale.y + 0.02, 0);
  const s = 1 / (1 + (p.root.position.y - ground) * 0.25);
  p.shadow.scale.setScalar(s);
  (p.shadow.material as T.MeshBasicMaterial).opacity = 0.22;
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
    const across = opts.across ?? (opts.tall ? 20 : 21);
    this.view = aspect < 1 ? { w: across, h: across / aspect } : { w: across * aspect, h: across };
    this.tilt = opts.tall ? -0.3 : 0.12;
    this.alongKeys = opts.tall ? 26 : 40;
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
      const m = makePigeon(p.seed, shadowGeo, shadowMat);
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

    this.plan.pigeons.forEach((p, i) => pose(this.birds[i], p, t));
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
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
        (Array.isArray(m) ? m : [m]).forEach((x) => x !== INK && x.dispose());
      }
    });
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
