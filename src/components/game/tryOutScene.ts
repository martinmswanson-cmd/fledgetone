/**
 * The game preview's little game, in three.js: the hero (a small robot) walks a grassy arena
 * collecting coins while the guard (a one-eyed cube) patrols. The guard notices the hero when it
 * comes close and chases it; touching the guard hurts, but landing on it from a jump beats it. The
 * scene only reports what happens (events); the preview turns them into music and sound effects.
 */
import * as T from 'three';

export interface TryOutEvents {
  /** The guard saw the hero and is chasing */
  notice: () => void;
  /** The guard gave up and went back to its rounds */
  lose: () => void;
  /** Every frame while chasing: how far the guard is */
  distance: (d: number, chasing: boolean) => void;
  coin: (left: number) => void;
  hurt: (hearts: number) => void;
  step: () => void;
  jump: () => void;
  /** The hero landed on the guard */
  bonk: () => void;
  gameOver: () => void;
}

const INK = 0x2b2140;
const ARENA = 11;
const SPEED = 4;
const CHASE_SPEED = 2.7;
const PATROL_SPEED = 1.5;
const NOTICE = 6.5;
const GIVE_UP = 10;
const GRAVITY = 22;
const JUMP = 8.5;

interface Guy {
  root: T.Group;
  body: T.Group;
  /** The body's rest height (the walk bobs on top of it) */
  baseY: number;
  legs: Array<{ hip: T.Group; knee: T.Group }>;
}

const toon = (col: number) => new T.MeshToonMaterial({ color: col });
/** A mesh with an ink outline (a slightly bigger back-faced copy). */
function outlined(mesh: T.Mesh, t: number): T.Mesh {
  const shell = new T.Mesh(mesh.geometry, new T.MeshBasicMaterial({ color: INK, side: T.BackSide }));
  shell.scale.setScalar(1 + t);
  mesh.add(shell);
  return mesh;
}

/** Two short block legs that can walk (hip and knee joints), in `color`, `spread` apart. */
function blockLegs(root: T.Group, color: number, spread: number, top: number): Guy['legs'] {
  const legs: Guy['legs'] = [];
  for (const sx of [-1, 1]) {
    const hip = new T.Group();
    hip.position.set(sx * spread, top, 0);
    const upper = outlined(new T.Mesh(new T.BoxGeometry(0.13, 0.2, 0.13), toon(color)), 0.12);
    upper.position.y = -0.1;
    hip.add(upper);
    const knee = new T.Group();
    knee.position.y = -0.2;
    hip.add(knee);
    const lower = outlined(new T.Mesh(new T.BoxGeometry(0.12, 0.18, 0.12), toon(color)), 0.12);
    lower.position.y = -0.09;
    knee.add(lower);
    const foot = new T.Mesh(new T.BoxGeometry(0.18, 0.07, 0.24), new T.MeshBasicMaterial({ color: INK }));
    foot.position.set(0, -0.19, 0.04);
    knee.add(foot);
    root.add(hip);
    legs.push({ hip, knee });
  }
  return legs;
}

/** The hero: a small orange robot with a screen for a face and an antenna. */
function buildHero(): Guy {
  const root = new T.Group();
  const body = new T.Group();
  root.add(body);
  const torso = outlined(new T.Mesh(new T.BoxGeometry(0.62, 0.5, 0.48), toon(0xf08a3c)), 0.06);
  body.add(torso);
  const head = outlined(new T.Mesh(new T.BoxGeometry(0.5, 0.36, 0.42), toon(0xf6f1e7)), 0.07);
  head.position.y = 0.45;
  body.add(head);
  const screen = new T.Mesh(new T.BoxGeometry(0.4, 0.22, 0.02), new T.MeshBasicMaterial({ color: 0x1d2433 }));
  screen.position.set(0, 0.45, 0.215);
  body.add(screen);
  for (const sx of [-1, 1]) {
    const eye = new T.Mesh(new T.BoxGeometry(0.07, 0.09, 0.02), new T.MeshBasicMaterial({ color: 0x5ee6ff }));
    eye.position.set(sx * 0.09, 0.46, 0.23);
    body.add(eye);
  }
  const stalk = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.22, 8), new T.MeshBasicMaterial({ color: INK }));
  stalk.position.y = 0.74;
  body.add(stalk);
  const tip = outlined(new T.Mesh(new T.SphereGeometry(0.06, 12, 8), toon(0xffd23f)), 0.2);
  tip.position.y = 0.87;
  body.add(tip);
  body.position.y = 0.62;
  const legs = blockLegs(root, 0x5b6474, 0.16, 0.4);
  return { root, body, baseY: body.position.y, legs };
}

/** The guard: a purple cube with one big eye and two horns. */
function buildGuard(): Guy {
  const root = new T.Group();
  const body = new T.Group();
  root.add(body);
  const cube = outlined(new T.Mesh(new T.BoxGeometry(0.8, 0.72, 0.72), toon(0x6b3fa0)), 0.05);
  body.add(cube);
  const white = outlined(new T.Mesh(new T.SphereGeometry(0.17, 20, 14), toon(0xffffff)), 0.12);
  white.position.set(0, 0.06, 0.34);
  white.scale.set(1, 1, 0.5);
  body.add(white);
  const pupil = new T.Mesh(new T.SphereGeometry(0.075, 12, 8), new T.MeshBasicMaterial({ color: 0xe0303a }));
  pupil.position.set(0, 0.05, 0.42);
  pupil.scale.set(1, 1, 0.5);
  body.add(pupil);
  for (const sx of [-1, 1]) {
    const horn = outlined(new T.Mesh(new T.ConeGeometry(0.09, 0.26, 10), toon(0xf2e6c9)), 0.15);
    horn.position.set(sx * 0.26, 0.48, 0);
    horn.rotation.z = -sx * 0.35;
    body.add(horn);
  }
  body.position.y = 0.72;
  const legs = blockLegs(root, 0x45286b, 0.22, 0.38);
  return { root, body, baseY: body.position.y, legs };
}

/** A seeded random number in [0, 1), so the arena is the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TryOutScene {
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(42, 1, 0.1, 100);
  private hero = buildHero();
  private guard = buildGuard();
  private heroShadow: T.Mesh;
  private guardShadow: T.Mesh;
  private coins: T.Mesh[] = [];
  private obstacles: Array<{ x: number; z: number; r: number }> = [];
  private keys = new Set<string>();
  private raf = 0;
  private last = 0;
  private resize: ResizeObserver;
  // Game state
  private heroVel = new T.Vector3();
  private heroY = 0;
  private heroVy = 0;
  private walk = 0;
  private stepClock = 0;
  private hearts = 3;
  private hurtUntil = 0;
  private chasing = false;
  private farFor = 0;
  private guardDown = false;
  /** The guard stops for a moment after it hits the hero */
  private guardRestUntil = 0;
  /** The guard naps (stays put, notices nothing) until the music is ready */
  private guardAwake = false;
  private guardSquash = 0;
  private patrol = 0;
  private over = false;
  private time = 0;

  private host: HTMLElement;
  private events: TryOutEvents;

  constructor(host: HTMLElement, events: TryOutEvents) {
    this.host = host;
    this.events = events;
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
    host.appendChild(this.renderer.domElement);
    this.scene.background = new T.Color(0x9fd3f0);
    this.scene.fog = new T.Fog(0x9fd3f0, 22, 42);
    this.scene.add(new T.HemisphereLight(0xfff4df, 0x7a9a5a, 1.7));
    const sun = new T.DirectionalLight(0xffffff, 2);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);

    // The arena: grass, a low fence, trees and rocks in fixed places
    const ground = new T.Mesh(new T.CircleGeometry(ARENA + 4, 48), new T.MeshToonMaterial({ color: 0x8fcf6a }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const path = new T.Mesh(new T.RingGeometry(4.2, 5.4, 48), new T.MeshToonMaterial({ color: 0xd9c38f }));
    path.rotation.x = -Math.PI / 2;
    path.position.y = 0.01;
    this.scene.add(path);
    const fenceMat = new T.MeshToonMaterial({ color: 0xa8774a });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const post = new T.Mesh(new T.BoxGeometry(0.25, 0.8, 0.25), fenceMat);
      post.position.set(Math.cos(a) * (ARENA + 0.6), 0.4, Math.sin(a) * (ARENA + 0.6));
      this.scene.add(post);
    }
    const r = rng(7);
    const trunk = new T.MeshToonMaterial({ color: 0x8a5a3a });
    const leaves = [0x3f9a4a, 0x56b25a, 0x2f8a52].map((c) => new T.MeshToonMaterial({ color: c }));
    const rock = new T.MeshToonMaterial({ color: 0xb9b3c9 });
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const d = 6.5 + r() * 3.8;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (r() < 0.65) {
        const tree = new T.Group();
        const t = new T.Mesh(new T.CylinderGeometry(0.15, 0.2, 0.9, 8), trunk);
        t.position.y = 0.45;
        const top = new T.Mesh(new T.ConeGeometry(0.8 + r() * 0.3, 1.8, 10), leaves[i % 3]);
        top.position.y = 1.6;
        tree.add(t, top);
        tree.position.set(x, 0, z);
        this.scene.add(tree);
        this.obstacles.push({ x, z, r: 0.55 });
      } else {
        const s = 0.4 + r() * 0.4;
        const stone = new T.Mesh(new T.DodecahedronGeometry(s, 0), rock);
        stone.position.set(x, s * 0.5, z);
        stone.rotation.set(r(), r(), r());
        this.scene.add(stone);
        this.obstacles.push({ x, z, r: s + 0.15 });
      }
    }

    // Coins on the path and between the trees
    const gold = new T.MeshToonMaterial({ color: 0xffc83d, emissive: 0x6a4a00 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const d = i % 2 ? 4.8 : 8.2;
      const coin = new T.Mesh(new T.TorusGeometry(0.22, 0.08, 8, 20), gold);
      coin.position.set(Math.cos(a) * d, 0.6, Math.sin(a) * d);
      this.coins.push(coin);
      this.scene.add(coin);
    }

    const shadowMat = new T.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.2 });
    const shadow = () => {
      const s = new T.Mesh(new T.CircleGeometry(0.42, 24), shadowMat);
      s.rotation.x = -Math.PI / 2;
      s.position.y = 0.02;
      this.scene.add(s);
      return s;
    };
    this.heroShadow = shadow();
    this.guardShadow = shadow();
    this.scene.add(this.hero.root, this.guard.root);
    this.reset();

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
  }

  private fit() {
    const w = this.host.clientWidth || 640;
    const h = this.host.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Back to the start: the hero in the middle, the guard on its rounds, every coin back. */
  reset() {
    this.hero.root.position.set(0, 0, 0);
    this.hero.root.rotation.y = Math.PI;
    this.heroY = 0;
    this.heroVy = 0;
    this.guard.root.position.set(0, 0, -8);
    this.guard.root.scale.setScalar(1);
    this.guard.root.visible = true;
    this.guardShadow.visible = true;
    this.guardDown = false;
    this.chasing = false;
    this.farFor = 0;
    this.hearts = 3;
    this.hurtUntil = 0;
    this.guardRestUntil = 0;
    this.time = 0;
    this.over = false;
    for (const c of this.coins) c.visible = true;
    this.camera.position.set(0, 9, 9);
    this.camera.lookAt(0, 0, 0);
  }

  /** The guard wakes up and starts its rounds (once the music is ready to follow it). */
  wake() {
    this.guardAwake = true;
    this.guard.root.scale.setScalar(1);
  }

  get state() {
    return { hearts: this.hearts, coins: this.coins.filter((c) => !c.visible).length, coinsTotal: this.coins.length, chasing: this.chasing, asleep: !this.guardAwake, beaten: this.guardDown, over: this.over };
  }

  key(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    if (down && (code === 'Space' || code === 'KeyJ') && this.heroY <= 0.001 && !this.over) {
      this.heroVy = JUMP;
      this.events.jump();
    }
  }

  start() {
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
    // (dispose() keeps the WebGL context: browsers allow only a few, so opening the game again and again ran out)
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** Keep a point inside the fence and out of the trees and rocks. */
  private collide(p: T.Vector3, radius: number) {
    const d = Math.hypot(p.x, p.z);
    if (d > ARENA - radius) {
      p.x *= (ARENA - radius) / d;
      p.z *= (ARENA - radius) / d;
    }
    for (const o of this.obstacles) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const dd = Math.hypot(dx, dz);
      const min = o.r + radius;
      if (dd < min && dd > 1e-6) {
        p.x = o.x + (dx / dd) * min;
        p.z = o.z + (dz / dd) * min;
      }
    }
  }

  private animateLegs(g: Guy, phase: number, amount: number) {
    g.legs.forEach((l, i) => {
      const s = Math.sin(phase + (i ? Math.PI : 0)) * amount;
      l.hip.rotation.x = s * 0.7;
      l.knee.rotation.x = Math.max(0, -s) * 1.1;
    });
    g.body.position.y = g.baseY + Math.abs(Math.sin(phase)) * 0.06 * amount;
  }

  private update(dt: number) {
    this.time += dt;
    const hero = this.hero.root;
    const gd = this.guard.root;

    // The hero: walk with the arrows or WASD (relative to the screen), jump with Space
    const k = this.keys;
    const ix = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const iz = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    const len = Math.hypot(ix, iz);
    const moving = len > 0 && !this.over;
    const target = moving ? new T.Vector3((ix / len) * SPEED, 0, (iz / len) * SPEED) : new T.Vector3();
    this.heroVel.lerp(target, Math.min(1, dt * 12));
    hero.position.addScaledVector(this.heroVel, dt);
    this.collide(hero.position, 0.45);
    if (this.heroVel.lengthSq() > 0.2) hero.rotation.y = Math.atan2(this.heroVel.x, this.heroVel.z);
    // The jump
    this.heroVy -= GRAVITY * dt;
    this.heroY = Math.max(0, this.heroY + this.heroVy * dt);
    if (this.heroY === 0) this.heroVy = 0;
    hero.position.y = this.heroY;
    const speed = this.heroVel.length();
    if (this.heroY > 0) {
      this.hero.legs.forEach((l) => {
        l.hip.rotation.x = -0.6;
        l.knee.rotation.x = 1.2;
      });
    } else {
      this.walk += dt * speed * 3.2;
      this.animateLegs(this.hero, this.walk, Math.min(1, speed / SPEED));
      if (speed > 1) {
        this.stepClock -= dt;
        if (this.stepClock <= 0) {
          this.stepClock = 0.32;
          this.events.step();
        }
      } else this.stepClock = 0;
    }
    // Blinking while hurt
    hero.visible = !(this.time < this.hurtUntil && Math.floor(this.time * 12) % 2 === 0);
    this.heroShadow.position.set(hero.position.x, 0.02, hero.position.z);
    this.heroShadow.scale.setScalar(1 - Math.min(0.6, this.heroY * 0.25));

    // Coins
    for (const c of this.coins) {
      if (!c.visible) continue;
      c.rotation.y += dt * 3;
      c.position.y = 0.6 + Math.sin(this.time * 3 + c.position.x) * 0.08;
      if (Math.hypot(c.position.x - hero.position.x, c.position.z - hero.position.z) < 0.75 && this.heroY < 1.2) {
        c.visible = false;
        this.events.coin(this.coins.filter((x) => x.visible).length);
      }
    }

    // The guard: on its rounds, or chasing, or beaten
    const dx = hero.position.x - gd.position.x;
    const dz = hero.position.z - gd.position.z;
    const dist = Math.hypot(dx, dz);
    if (this.guardDown) {
      this.guardSquash = Math.min(1, this.guardSquash + dt * 3);
      gd.scale.set(1 + this.guardSquash * 0.5, Math.max(0.05, 1 - this.guardSquash * 0.95), 1 + this.guardSquash * 0.5);
      if (this.guardSquash >= 1) {
        gd.visible = false;
        this.guardShadow.visible = false;
      }
    } else if (!this.guardAwake) {
      // Napping: a slow breath in place
      gd.scale.set(1, 0.92 + Math.sin(this.time * 2) * 0.04, 1);
    } else if (!this.over) {
      if (!this.chasing && dist < NOTICE) {
        this.chasing = true;
        this.farFor = 0;
        this.events.notice();
      }
      if (this.chasing) {
        this.farFor = dist > GIVE_UP ? this.farFor + dt : 0;
        if (this.farFor > 1.5) {
          this.chasing = false;
          this.events.lose();
        }
      }
      let vx: number;
      let vz: number;
      if (this.time < this.guardRestUntil) {
        vx = 0;
        vz = 0;
      } else if (this.chasing) {
        vx = (dx / Math.max(dist, 1e-6)) * CHASE_SPEED;
        vz = (dz / Math.max(dist, 1e-6)) * CHASE_SPEED;
      } else {
        // Rounds: a slow circle on the far side of the arena
        this.patrol += dt * 0.18;
        const tx = Math.cos(this.patrol) * 7.5;
        const tz = -Math.abs(Math.sin(this.patrol)) * 7.5 - 0.5;
        const ex = tx - gd.position.x;
        const ez = tz - gd.position.z;
        const ed = Math.hypot(ex, ez) || 1;
        vx = (ex / ed) * PATROL_SPEED;
        vz = (ez / ed) * PATROL_SPEED;
      }
      gd.position.x += vx * dt;
      gd.position.z += vz * dt;
      this.collide(gd.position, 0.45);
      gd.rotation.y = Math.atan2(vx, vz);
      this.animateLegs(this.guard, this.time * (this.chasing ? 11 : 6), this.chasing ? 1 : 0.6);
      if (this.chasing) this.events.distance(dist, true);

      // Landing on the guard beats it; walking into it hurts
      if (dist < 0.95 && this.heroVy < 0 && this.heroY > 0.25 && this.heroY < 1.3) {
        this.guardDown = true;
        this.guardSquash = 0;
        this.chasing = false;
        this.heroVy = JUMP * 0.7;
        this.events.bonk();
      } else if (dist < 0.85 && this.heroY < 0.25 && this.time > this.hurtUntil) {
        this.hearts -= 1;
        this.hurtUntil = this.time + 1.5;
        this.guardRestUntil = this.time + 1.2;
        hero.position.x += (dx / Math.max(dist, 1e-6)) * 1.5;
        hero.position.z += (dz / Math.max(dist, 1e-6)) * 1.5;
        this.collide(hero.position, 0.45);
        this.events.hurt(this.hearts);
        if (this.hearts <= 0) {
          this.over = true;
          this.events.gameOver();
        }
      }
    }
    this.guardShadow.position.set(gd.position.x, 0.02, gd.position.z);

    // The camera follows the hero from above and behind
    const want = new T.Vector3(hero.position.x * 0.85, 8.5, hero.position.z * 0.85 + 8.5);
    this.camera.position.lerp(want, Math.min(1, dt * 3));
    this.camera.lookAt(hero.position.x * 0.85, 0.5, hero.position.z * 0.85);
  }
}
