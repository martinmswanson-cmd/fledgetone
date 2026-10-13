/**
 * The game preview's little game, in three.js: Bo (the Gomo-Fu crew's white one) walks a grassy
 * arena collecting coins while Slate (the dark one) patrols. Slate notices Bo when he comes close
 * and chases him; touching Bo hurts, but landing on Slate from a jump beats it. The scene only
 * reports what happens (events); the preview turns them into music and sound effects. Bo and
 * Slate are built from simple shapes the way gomofu-guys.js on twobirdsworkshop.com builds them.
 */
import * as T from 'three';

export interface TryOutEvents {
  /** Slate saw Bo and is chasing */
  notice: () => void;
  /** Slate gave up and went back to its rounds */
  lose: () => void;
  /** Every frame while chasing: how far Slate is */
  distance: (d: number, chasing: boolean) => void;
  coin: (left: number) => void;
  hurt: (hearts: number) => void;
  step: () => void;
  jump: () => void;
  /** Bo landed on Slate */
  bonk: () => void;
  gameOver: () => void;
}

const INK = 0x2b2140;
const CREW = {
  slate: { body: 0x2f2546, band: 0xffbe3b, legs: 0x3b3155 },
  bo: { body: 0xfffaf0, band: 0x3d9ee0, legs: 0xe9dcc0 },
};
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
  legs: Array<{ hip: T.Group; knee: T.Group }>;
}

/** One of the crew: a round body with a band, two eyes and two little legs, outlined in ink. */
function buildGuy(c: { body: number; band: number; legs: number }): Guy {
  const toon = (col: number) => new T.MeshToonMaterial({ color: col });
  const inkMat = new T.MeshBasicMaterial({ color: INK, side: T.BackSide });
  const withLine = (mesh: T.Mesh, t: number) => {
    const shell = new T.Mesh(mesh.geometry, inkMat);
    shell.scale.setScalar(1 + t);
    mesh.add(shell);
    return mesh;
  };
  const root = new T.Group();
  const body = new T.Group();
  root.add(body);
  const ball = withLine(new T.Mesh(new T.SphereGeometry(0.5, 32, 18), toon(c.body)), 0.08);
  ball.scale.set(1, 0.65, 1);
  body.add(ball);
  const band = withLine(new T.Mesh(new T.TorusGeometry(0.47, 0.065, 12, 48), toon(c.band)), 0.12);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.8);
  band.position.y = -0.09;
  body.add(band);
  for (const sx of [-1, 1]) {
    const eye = withLine(new T.Mesh(new T.SphereGeometry(0.105, 16, 12), toon(0xffffff)), 0.18);
    eye.position.set(sx * 0.14, 0.04, 0.47);
    eye.scale.set(1, 1, 0.55);
    body.add(eye);
    const pupil = new T.Mesh(new T.SphereGeometry(0.052, 12, 8), new T.MeshBasicMaterial({ color: INK }));
    pupil.position.set(sx * 0.14 + 0.012, 0.03, 0.545);
    pupil.scale.set(1, 1, 0.5);
    body.add(pupil);
  }
  const legs: Guy['legs'] = [];
  for (const sx of [-1, 1]) {
    const hip = new T.Group();
    hip.position.set(sx * 0.17, -0.2 + 0.88, 0);
    const thigh = withLine(new T.Mesh(new T.CapsuleGeometry(0.055, 0.2, 4, 10), toon(c.legs)), 0.35);
    thigh.position.y = -0.135;
    hip.add(thigh);
    const knee = new T.Group();
    knee.position.y = -0.27;
    hip.add(knee);
    const shin = withLine(new T.Mesh(new T.CapsuleGeometry(0.05, 0.2, 4, 10), toon(c.legs)), 0.35);
    shin.position.y = -0.135;
    knee.add(shin);
    const foot = new T.Mesh(new T.SphereGeometry(0.1, 12, 8), new T.MeshBasicMaterial({ color: INK }));
    foot.scale.set(1, 0.5, 1.3);
    foot.position.set(0, -0.27, 0.04);
    knee.add(foot);
    root.add(hip);
    legs.push({ hip, knee });
  }
  body.position.y = 0.88;
  return { root, body, legs };
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
  private bo = buildGuy(CREW.bo);
  private slate = buildGuy(CREW.slate);
  private boShadow: T.Mesh;
  private slateShadow: T.Mesh;
  private coins: T.Mesh[] = [];
  private obstacles: Array<{ x: number; z: number; r: number }> = [];
  private keys = new Set<string>();
  private raf = 0;
  private last = 0;
  private resize: ResizeObserver;
  // Game state
  private boVel = new T.Vector3();
  private boY = 0;
  private boVy = 0;
  private walk = 0;
  private stepClock = 0;
  private hearts = 3;
  private hurtUntil = 0;
  private chasing = false;
  private farFor = 0;
  private slateDown = false;
  /** Slate stops for a moment after it hits Bo */
  private slateRestUntil = 0;
  /** Slate naps (stays put, notices nothing) until the music is ready */
  private slateAwake = false;
  private slateSquash = 0;
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
    this.boShadow = shadow();
    this.slateShadow = shadow();
    this.scene.add(this.bo.root, this.slate.root);
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

  /** Back to the start: Bo in the middle, Slate on its rounds, every coin back. */
  reset() {
    this.bo.root.position.set(0, 0, 0);
    this.bo.root.rotation.y = Math.PI;
    this.boY = 0;
    this.boVy = 0;
    this.slate.root.position.set(0, 0, -8);
    this.slate.root.scale.setScalar(1);
    this.slate.root.visible = true;
    this.slateShadow.visible = true;
    this.slateDown = false;
    this.chasing = false;
    this.farFor = 0;
    this.hearts = 3;
    this.hurtUntil = 0;
    this.slateRestUntil = 0;
    this.time = 0;
    this.over = false;
    for (const c of this.coins) c.visible = true;
    this.camera.position.set(0, 9, 9);
    this.camera.lookAt(0, 0, 0);
  }

  /** Slate wakes up and starts its rounds (once the music is ready to follow it). */
  wake() {
    this.slateAwake = true;
    this.slate.root.scale.setScalar(1);
  }

  get state() {
    return { hearts: this.hearts, coins: this.coins.filter((c) => !c.visible).length, coinsTotal: this.coins.length, chasing: this.chasing, asleep: !this.slateAwake, beaten: this.slateDown, over: this.over };
  }

  key(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    if (down && (code === 'Space' || code === 'KeyJ') && this.boY <= 0.001 && !this.over) {
      this.boVy = JUMP;
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
    g.body.position.y = 0.88 + Math.abs(Math.sin(phase)) * 0.06 * amount;
  }

  private update(dt: number) {
    this.time += dt;
    const bo = this.bo.root;
    const sl = this.slate.root;

    // Bo: walk with the arrows or WASD (relative to the screen), jump with Space
    const k = this.keys;
    const ix = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const iz = (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) - (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0);
    const len = Math.hypot(ix, iz);
    const moving = len > 0 && !this.over;
    const target = moving ? new T.Vector3((ix / len) * SPEED, 0, (iz / len) * SPEED) : new T.Vector3();
    this.boVel.lerp(target, Math.min(1, dt * 12));
    bo.position.addScaledVector(this.boVel, dt);
    this.collide(bo.position, 0.45);
    if (this.boVel.lengthSq() > 0.2) bo.rotation.y = Math.atan2(this.boVel.x, this.boVel.z);
    // The jump
    this.boVy -= GRAVITY * dt;
    this.boY = Math.max(0, this.boY + this.boVy * dt);
    if (this.boY === 0) this.boVy = 0;
    bo.position.y = this.boY;
    const speed = this.boVel.length();
    if (this.boY > 0) {
      this.bo.legs.forEach((l) => {
        l.hip.rotation.x = -0.6;
        l.knee.rotation.x = 1.2;
      });
    } else {
      this.walk += dt * speed * 3.2;
      this.animateLegs(this.bo, this.walk, Math.min(1, speed / SPEED));
      if (speed > 1) {
        this.stepClock -= dt;
        if (this.stepClock <= 0) {
          this.stepClock = 0.32;
          this.events.step();
        }
      } else this.stepClock = 0;
    }
    // Blinking while hurt
    bo.visible = !(this.time < this.hurtUntil && Math.floor(this.time * 12) % 2 === 0);
    this.boShadow.position.set(bo.position.x, 0.02, bo.position.z);
    this.boShadow.scale.setScalar(1 - Math.min(0.6, this.boY * 0.25));

    // Coins
    for (const c of this.coins) {
      if (!c.visible) continue;
      c.rotation.y += dt * 3;
      c.position.y = 0.6 + Math.sin(this.time * 3 + c.position.x) * 0.08;
      if (Math.hypot(c.position.x - bo.position.x, c.position.z - bo.position.z) < 0.75 && this.boY < 1.2) {
        c.visible = false;
        this.events.coin(this.coins.filter((x) => x.visible).length);
      }
    }

    // Slate: on its rounds, or chasing, or beaten
    const dx = bo.position.x - sl.position.x;
    const dz = bo.position.z - sl.position.z;
    const dist = Math.hypot(dx, dz);
    if (this.slateDown) {
      this.slateSquash = Math.min(1, this.slateSquash + dt * 3);
      sl.scale.set(1 + this.slateSquash * 0.5, Math.max(0.05, 1 - this.slateSquash * 0.95), 1 + this.slateSquash * 0.5);
      if (this.slateSquash >= 1) {
        sl.visible = false;
        this.slateShadow.visible = false;
      }
    } else if (!this.slateAwake) {
      // Napping: a slow breath in place
      sl.scale.set(1, 0.92 + Math.sin(this.time * 2) * 0.04, 1);
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
      if (this.time < this.slateRestUntil) {
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
        const ex = tx - sl.position.x;
        const ez = tz - sl.position.z;
        const ed = Math.hypot(ex, ez) || 1;
        vx = (ex / ed) * PATROL_SPEED;
        vz = (ez / ed) * PATROL_SPEED;
      }
      sl.position.x += vx * dt;
      sl.position.z += vz * dt;
      this.collide(sl.position, 0.45);
      sl.rotation.y = Math.atan2(vx, vz);
      this.animateLegs(this.slate, this.time * (this.chasing ? 11 : 6), this.chasing ? 1 : 0.6);
      if (this.chasing) this.events.distance(dist, true);

      // Landing on Slate beats it; walking into it hurts
      if (dist < 0.95 && this.boVy < 0 && this.boY > 0.25 && this.boY < 1.3) {
        this.slateDown = true;
        this.slateSquash = 0;
        this.chasing = false;
        this.boVy = JUMP * 0.7;
        this.events.bonk();
      } else if (dist < 0.85 && this.boY < 0.25 && this.time > this.hurtUntil) {
        this.hearts -= 1;
        this.hurtUntil = this.time + 1.5;
        this.slateRestUntil = this.time + 1.2;
        bo.position.x += (dx / Math.max(dist, 1e-6)) * 1.5;
        bo.position.z += (dz / Math.max(dist, 1e-6)) * 1.5;
        this.collide(bo.position, 0.45);
        this.events.hurt(this.hearts);
        if (this.hearts <= 0) {
          this.over = true;
          this.events.gameOver();
        }
      }
    }
    this.slateShadow.position.set(sl.position.x, 0.02, sl.position.z);

    // The camera follows Bo from above and behind
    const want = new T.Vector3(bo.position.x * 0.85, 8.5, bo.position.z * 0.85 + 8.5);
    this.camera.position.lerp(want, Math.min(1, dt * 3));
    this.camera.lookAt(bo.position.x * 0.85, 0.5, bo.position.z * 0.85);
  }
}
