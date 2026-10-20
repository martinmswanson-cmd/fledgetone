/**
 * The game preview's 2D platformer, drawn on a canvas: the robot hero runs and jumps through a
 * side-scrolling level of grass, gaps, spikes and floating platforms, collecting coins, to the flag
 * at the end. One-eyed blobs patrol the ground: one notices the hero when it comes close and
 * chases it; touching one hurts, landing on it squashes it. Falling into a gap or onto spikes
 * hurts too. Like the 3D scene (tryOutScene.ts) it only reports what happens (events); the preview
 * turns them into music and sound effects.
 */
import type { TryOutEvents } from './tryOutScene';

export interface PlatformerEvents extends Omit<TryOutEvents, 'bonk'> {
  /** The hero squashed a blob */
  stomp: () => void;
  /** The hero reached the flag */
  win: () => void;
}

/** A tile's size, and the level's height in tiles (the view shows all of it) */
const TILE = 32;
const ROWS = 14;
const COLS = 112;
const GRAVITY = 1900;
const JUMP = 660;
const RUN = 230;
const ACCEL = 2000;
const FRICTION = 1800;
const COYOTE = 0.1;
const BUFFER = 0.12;
/** Blobs: their speeds (pixels a second) and how near they notice the hero, and give up (tiles) */
const PATROL = 45;
const CHASE = 95;
const NOTICE = 7;
const GIVE_UP = 11;

type Cell = 0 | 1 | 2;
/** 0 air, 1 ground, 2 spikes */
function buildLevel(): { grid: Cell[][]; coins: Array<{ x: number; y: number }>; blobs: Array<{ x: number; y: number; from: number; to: number }>; flag: number } {
  const grid: Cell[][] = Array.from({ length: ROWS }, () => new Array<Cell>(COLS).fill(0));
  const fill = (x0: number, x1: number, y0: number, y1: number, v: Cell = 1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && x < COLS && y >= 0 && y < ROWS) grid[y][x] = v;
  };
  // The ground (two rows), with gaps to jump
  fill(0, COLS - 1, 12, 13);
  for (const [a, b] of [[18, 20], [41, 43], [69, 71], [90, 91]]) fill(a, b, 12, 13, 0);
  // Hills and steps on the ground
  fill(33, 35, 10, 11);
  fill(34, 35, 9, 9);
  fill(96, 97, 11, 11);
  fill(98, 99, 10, 11);
  fill(100, 101, 9, 11);
  // Floating platforms
  for (const [a, b, y] of [[9, 12, 9], [21, 25, 8], [27, 30, 6], [45, 49, 9], [53, 56, 7], [59, 61, 5], [65, 68, 8], [74, 78, 9], [82, 85, 7], [87, 89, 5]]) fill(a, b, y, y);
  // Spikes
  fill(38, 39, 11, 11, 2);
  fill(62, 63, 11, 11, 2);
  fill(80, 80, 11, 11, 2);
  const coins = [
    [10.5, 7.5], [19, 8.5], [23, 6.5], [28.5, 4.5], [42, 9], [47, 7.5], [54.5, 5.5], [60, 3.5], [70, 9], [76, 7.5], [83.5, 5.5], [88, 3.5],
  ].map(([x, y]) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }));
  // Each on the ground (row 12) or a platform (the row it stands on), walking its stretch
  const blobs = [
    { x: 15, row: 12, from: 13, to: 17 },
    { x: 27, row: 12, from: 22, to: 32 },
    { x: 50, row: 12, from: 44, to: 61 },
    { x: 55, row: 7, from: 53, to: 56 },
    { x: 76, row: 12, from: 72, to: 79 },
    { x: 86, row: 12, from: 82, to: 89 },
  ].map((b) => ({ x: b.x * TILE, y: b.row * TILE - 24, from: b.from * TILE, to: (b.to + 1) * TILE }));
  return { grid, coins, blobs, flag: 106 * TILE };
}

interface Blob {
  x: number;
  y: number;
  vx: number;
  from: number;
  to: number;
  chasing: boolean;
  /** Squashed: when (it fades away), else -1 */
  squashedAt: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export class PlatformerScene {
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private host: HTMLElement;
  private events: PlatformerEvents;
  private level = buildLevel();
  private keys = new Set<string>();
  private raf = 0;
  private last = 0;
  private resize: ResizeObserver;
  private time = 0;
  // The hero (its box's top-left, in pixels)
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private w = 22;
  private h = 28;
  private facing = 1;
  private grounded = false;
  private sinceGround = 0;
  private jumpAsked = -1;
  private walk = 0;
  private stepClock = 0;
  private checkpoint = { x: 2 * TILE, y: 10 * TILE };
  private hearts = 3;
  private hurtUntil = 0;
  private coinTaken: boolean[] = [];
  private blobs: Blob[] = [];
  private chasing = false;
  private farFor = 0;
  private awake = false;
  private won = false;
  private over = false;
  private puffs: Puff[] = [];
  private camX = 0;

  constructor(host: HTMLElement, events: PlatformerEvents) {
    this.host = host;
    this.events = events;
    this.g = this.canvas.getContext('2d')!;
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    host.appendChild(this.canvas);
    this.reset();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
  }

  private fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round((this.host.clientWidth || 640) * dpr));
    this.canvas.height = Math.max(1, Math.round((this.host.clientHeight || 400) * dpr));
  }

  /** Back to the start: every coin and blob back, three hearts. */
  reset() {
    this.x = this.checkpoint.x = 2 * TILE;
    this.y = this.checkpoint.y = 12 * TILE - this.h;
    this.vx = this.vy = 0;
    this.facing = 1;
    this.hearts = 3;
    this.hurtUntil = 0;
    this.coinTaken = this.level.coins.map(() => false);
    this.blobs = this.level.blobs.map((b) => ({ x: b.x, y: b.y, vx: -PATROL, from: b.from, to: b.to, chasing: false, squashedAt: -1 }));
    this.chasing = false;
    this.farFor = 0;
    this.won = false;
    this.over = false;
    this.puffs = [];
    this.time = 0;
    this.camX = 0;
  }

  /** The blobs wake up and start their rounds (once the music is ready to follow them). */
  wake() {
    this.awake = true;
  }

  get state() {
    return { hearts: this.hearts, coins: this.coinTaken.filter(Boolean).length, coinsTotal: this.coinTaken.length, chasing: this.chasing, asleep: !this.awake, beaten: this.won, over: this.over };
  }

  key(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    const jumpKey = code === 'Space' || code === 'KeyJ' || code === 'ArrowUp' || code === 'KeyW';
    if (jumpKey && down) this.jumpAsked = this.time;
    // Letting go early makes a short hop
    if (jumpKey && !down && this.vy < -200) this.vy *= 0.45;
  }

  start() {
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.04, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.canvas.remove();
  }

  // ---------- the world ----------

  private cell(px: number, py: number): Cell {
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    if (cx < 0 || cx >= COLS) return 1;
    if (cy < 0 || cy >= ROWS) return 0;
    return this.level.grid[cy][cx];
  }

  private solid(px: number, py: number) {
    return this.cell(px, py) === 1;
  }

  /** The top of the ground below x (pixels), or below the level */
  private groundUnder(px: number): number {
    for (let r = 0; r < ROWS; r++) if (this.level.grid[r][Math.floor(px / TILE)] === 1) return r * TILE;
    return ROWS * TILE + 200;
  }

  /** Move a box by (dx, dy) against the solid tiles; returns which sides it hit */
  private move(box: { x: number; y: number; w: number; h: number }, dx: number, dy: number) {
    const hit = { left: false, right: false, top: false, bottom: false };
    box.x += dx;
    if (dx > 0 && (this.solid(box.x + box.w, box.y + 1) || this.solid(box.x + box.w, box.y + box.h - 1))) {
      box.x = Math.floor((box.x + box.w) / TILE) * TILE - box.w - 0.01;
      hit.right = true;
    } else if (dx < 0 && (this.solid(box.x, box.y + 1) || this.solid(box.x, box.y + box.h - 1))) {
      box.x = Math.floor(box.x / TILE + 1) * TILE + 0.01;
      hit.left = true;
    }
    box.y += dy;
    if (dy > 0 && (this.solid(box.x + 1, box.y + box.h) || this.solid(box.x + box.w - 1, box.y + box.h))) {
      box.y = Math.floor((box.y + box.h) / TILE) * TILE - box.h;
      hit.bottom = true;
    } else if (dy < 0 && (this.solid(box.x + 1, box.y) || this.solid(box.x + box.w - 1, box.y))) {
      box.y = Math.floor(box.y / TILE + 1) * TILE;
      hit.top = true;
    }
    return hit;
  }

  private puff(x: number, y: number, color: string, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.puffs.push({ x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, life: 0.5, color });
    }
  }

  private hurt(fromX: number) {
    if (this.time < this.hurtUntil || this.over || this.won) return;
    this.hearts--;
    this.hurtUntil = this.time + 1.3;
    this.vx = (this.x + this.w / 2 < fromX ? -1 : 1) * 260;
    this.vy = -380;
    this.events.hurt(this.hearts);
    if (this.hearts <= 0) {
      this.over = true;
      this.events.gameOver();
    }
  }

  // ---------- each frame ----------

  private update(dt: number) {
    this.time += dt;
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const alive = !this.over && !this.won;

    // Running, with a little slide when the keys are let go
    const want = alive ? (right ? 1 : 0) - (left ? 1 : 0) : 0;
    if (want) {
      this.vx += want * ACCEL * dt;
      this.facing = want;
    } else {
      const slow = Math.min(Math.abs(this.vx), FRICTION * dt);
      this.vx -= Math.sign(this.vx) * slow;
    }
    this.vx = Math.max(-RUN, Math.min(RUN, this.vx));

    // Jumping: a moment after leaving a ledge still counts, and a press just before landing too
    this.sinceGround = this.grounded ? 0 : this.sinceGround + dt;
    if (alive && this.time - this.jumpAsked < BUFFER && this.sinceGround < COYOTE) {
      this.vy = -JUMP;
      this.jumpAsked = -1;
      this.sinceGround = COYOTE;
      this.events.jump();
    }
    this.vy = Math.min(900, this.vy + GRAVITY * dt);
    const box = { x: this.x, y: this.y, w: this.w, h: this.h };
    const hit = this.move(box, this.vx * dt, this.vy * dt);
    this.x = box.x;
    this.y = box.y;
    if (hit.left || hit.right) this.vx = 0;
    if (hit.top) this.vy = 0;
    const landed = hit.bottom && !this.grounded;
    this.grounded = hit.bottom;
    if (hit.bottom) {
      this.vy = 0;
      // Somewhere safe to come back to (not by a gap's edge)
      if (this.solid(this.x - 4, this.y + this.h + 2) && this.solid(this.x + this.w + 4, this.y + this.h + 2) && this.y + this.h >= 11 * TILE) this.checkpoint = { x: this.x, y: this.y };
      if (landed) this.puff(this.x + this.w / 2, this.y + this.h, '#e8e2d0', 4);
    }

    // Steps
    if (this.grounded && Math.abs(this.vx) > 40) {
      this.walk += dt * Math.abs(this.vx) * 0.06;
      this.stepClock += dt * (Math.abs(this.vx) / RUN);
      if (this.stepClock > 0.3) {
        this.stepClock = 0;
        this.events.step();
      }
    }

    // Spikes and gaps
    if (this.cell(this.x + 3, this.y + this.h - 2) === 2 || this.cell(this.x + this.w - 3, this.y + this.h - 2) === 2) this.hurt(this.x + this.w / 2 - this.facing);
    if (this.y > ROWS * TILE + 40 && !this.over) {
      this.hurtUntil = 0;
      this.hurt(this.x);
      if (!this.over) {
        this.x = this.checkpoint.x;
        this.y = this.checkpoint.y - 4;
        this.vx = this.vy = 0;
      }
    }

    // Coins
    for (let i = 0; i < this.level.coins.length; i++) {
      if (this.coinTaken[i]) continue;
      const c = this.level.coins[i];
      if (Math.abs(c.x - (this.x + this.w / 2)) < 20 && Math.abs(c.y - (this.y + this.h / 2)) < 22) {
        this.coinTaken[i] = true;
        this.puff(c.x, c.y, '#ffd34d', 10);
        this.events.coin(this.coinTaken.filter((t) => !t).length);
      }
    }

    // Blobs: patrol their stretch; one notices the hero close by and chases it (not over an edge)
    const heroX = this.x + this.w / 2;
    const heroY = this.y + this.h / 2;
    let nearest = Infinity;
    let anyChasing = false;
    for (const b of this.blobs) {
      if (b.squashedAt >= 0) continue;
      const bx = b.x + 13;
      const d = Math.hypot(heroX - bx, heroY - (b.y + 12)) / TILE;
      if (this.awake && alive) {
        if (!b.chasing && d < NOTICE && Math.abs(heroY - (b.y + 12)) < 3 * TILE) b.chasing = true;
        if (b.chasing && d > GIVE_UP) b.chasing = false;
        if (b.chasing) {
          const dir = Math.sign(heroX - bx) || 1;
          const ahead = bx + dir * 16;
          // A blob stops at an edge, a spike or a wall
          const blocked = !this.solid(ahead, b.y + 24 + 4) || this.cell(ahead, b.y + 12) !== 0 || this.cell(ahead, b.y + 24 + 4) === 2;
          b.vx = blocked ? 0 : dir * CHASE;
        } else {
          if (b.vx === 0) b.vx = -PATROL;
          b.vx = Math.sign(b.vx) * PATROL;
          if (b.x < b.from) b.vx = PATROL;
          if (b.x + 26 > b.to) b.vx = -PATROL;
          const ahead = bx + Math.sign(b.vx) * 16;
          if (!this.solid(ahead, b.y + 24 + 4) || this.cell(ahead, b.y + 12) !== 0) b.vx = -b.vx;
        }
        b.x += b.vx * dt;
      }
      if (b.chasing) {
        anyChasing = true;
        nearest = Math.min(nearest, d);
      }
      // Touching: from above squashes it, else it hurts
      const overlapX = this.x + this.w > b.x + 2 && this.x < b.x + 24;
      const overlapY = this.y + this.h > b.y + 2 && this.y < b.y + 24;
      if (alive && overlapX && overlapY) {
        if (this.vy > 60 && this.y + this.h - b.y < 16) {
          b.squashedAt = this.time;
          b.chasing = false;
          this.vy = -440;
          this.puff(bx, b.y + 20, '#b79be8', 10);
          this.events.stomp();
        } else this.hurt(bx);
      }
    }
    if (anyChasing && !this.chasing) {
      this.chasing = true;
      this.farFor = 0;
      this.events.notice();
    }
    if (this.chasing) {
      this.events.distance(nearest, true);
      if (!anyChasing) {
        this.farFor += dt;
        if (this.farFor > 1) {
          this.chasing = false;
          this.events.lose();
        }
      } else this.farFor = 0;
    }

    // The flag
    if (alive && this.x + this.w >= this.level.flag) {
      this.won = true;
      this.vx = 0;
      this.puff(this.level.flag + 4, this.y, '#7ee787', 16);
      this.events.win();
    }

    for (const p of this.puffs) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 400 * dt;
      p.life -= dt;
    }
    this.puffs = this.puffs.filter((p) => p.life > 0);
  }

  // ---------- drawing ----------

  private draw() {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scale = H / (ROWS * TILE);
    const viewW = W / scale;
    // The camera follows the hero, a little ahead of where it's facing
    const target = Math.max(0, Math.min(COLS * TILE - viewW, this.x - viewW * 0.38 + this.facing * 30));
    this.camX += (target - this.camX) * 0.12;
    const cam = this.camX;
    g.setTransform(1, 0, 0, 1, 0, 0);

    // Sky, the sun, hills far and near (parallax), clouds
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#7ec8f2');
    sky.addColorStop(1, '#d8f0ff');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = '#fff5c4';
    g.beginPath();
    g.arc(viewW - 90, 70, 34, 0, Math.PI * 2);
    g.fill();
    const hills = (speed: number, color: string, base: number, size: number, gap: number) => {
      g.fillStyle = color;
      const off = -(cam * speed) % gap;
      for (let x = off - gap; x < viewW + gap; x += gap) {
        g.beginPath();
        g.ellipse(x, base, size, size * 0.55, 0, Math.PI, 0);
        g.fill();
      }
    };
    hills(0.15, '#a8d8b0', 12 * TILE, 220, 380);
    hills(0.35, '#86c48f', 12 * TILE + 10, 150, 260);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 6; i++) {
      const x = ((i * 310 - cam * 0.25 + this.time * 8) % (viewW + 300)) - 100;
      const y = 60 + (i % 3) * 45;
      for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 26], [50, 0, 20]]) {
        g.beginPath();
        g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        g.fill();
      }
    }

    g.translate(-cam, 0);
    const c0 = Math.max(0, Math.floor(cam / TILE) - 1);
    const c1 = Math.min(COLS - 1, Math.ceil((cam + viewW) / TILE) + 1);
    const grid = this.level.grid;
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const v = grid[r][c];
        const x = c * TILE;
        const y = r * TILE;
        if (v === 1) {
          const top = r === 0 || grid[r - 1][c] !== 1;
          g.fillStyle = '#9a6a43';
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle = '#8a5d3a';
          g.fillRect(x + 6, y + (top ? 16 : 6), 4, 4);
          g.fillRect(x + 20, y + (top ? 24 : 18), 4, 4);
          if (top) {
            g.fillStyle = '#5cbf4f';
            g.fillRect(x, y, TILE, 10);
            g.fillStyle = '#4aa340';
            g.fillRect(x, y + 8, TILE, 3);
          }
        } else if (v === 2) {
          g.fillStyle = '#c9ccd8';
          for (let s = 0; s < 3; s++) {
            g.beginPath();
            g.moveTo(x + s * 11, y + TILE);
            g.lineTo(x + s * 11 + 5.5, y + 12);
            g.lineTo(x + s * 11 + 11, y + TILE);
            g.fill();
          }
        }
      }
    }

    // The flag
    const fx = this.level.flag;
    const fy = this.groundUnder(fx + 4);
    g.fillStyle = '#e7e7ef';
    g.fillRect(fx, fy - 6 * TILE, 5, 6 * TILE);
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.arc(fx + 2.5, fy - 6 * TILE, 6, 0, Math.PI * 2);
    g.fill();
    const wave = Math.sin(this.time * 6) * 5;
    const flagUp = this.won ? 0 : 3 * TILE;
    g.fillStyle = '#7ee787';
    g.beginPath();
    g.moveTo(fx + 5, fy - 6 * TILE + 6 + flagUp);
    g.quadraticCurveTo(fx + 30, fy - 6 * TILE + 14 + flagUp + wave, fx + 52, fy - 6 * TILE + 20 + flagUp);
    g.lineTo(fx + 5, fy - 6 * TILE + 36 + flagUp);
    g.fill();

    // Coins (spinning)
    for (let i = 0; i < this.level.coins.length; i++) {
      if (this.coinTaken[i]) continue;
      const c = this.level.coins[i];
      const spin = Math.abs(Math.cos(this.time * 3 + i));
      const bob = Math.sin(this.time * 2.5 + i) * 3;
      g.fillStyle = '#e0a800';
      g.beginPath();
      g.ellipse(c.x, c.y + bob, 9 * spin + 2, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffd34d';
      g.beginPath();
      g.ellipse(c.x, c.y + bob, 6 * spin + 1, 7, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Blobs: one eye that looks at the hero, closed while they nap
    for (const b of this.blobs) {
      const age = b.squashedAt >= 0 ? this.time - b.squashedAt : -1;
      if (age > 0.6) continue;
      const squash = age >= 0 ? 0.3 : 1 + Math.sin(this.time * 8 + b.from) * 0.05;
      const bw = 26 * (age >= 0 ? 1.3 : 1);
      const bh = 24 * squash;
      const bx = b.x + 13 - bw / 2;
      const by = b.y + 24 - bh;
      g.globalAlpha = age >= 0 ? 1 - age / 0.6 : 1;
      g.fillStyle = b.chasing ? '#8a4fd6' : '#6d4aa6';
      g.beginPath();
      g.roundRect(bx, by, bw, bh, 8);
      g.fill();
      if (age < 0) {
        const eyeX = b.x + 13;
        const eyeY = by + 9;
        if (!this.awake) {
          g.strokeStyle = '#2b2140';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(eyeX - 5, eyeY);
          g.lineTo(eyeX + 5, eyeY);
          g.stroke();
          g.fillStyle = '#2b2140';
          g.font = 'bold 10px system-ui, sans-serif';
          g.fillText('z', bx + bw, by - 2 - Math.sin(this.time * 2 + b.from) * 3);
        } else {
          g.fillStyle = '#fff';
          g.beginPath();
          g.arc(eyeX, eyeY, 6, 0, Math.PI * 2);
          g.fill();
          const look = Math.atan2(this.y + this.h / 2 - eyeY, this.x + this.w / 2 - eyeX);
          g.fillStyle = '#2b2140';
          g.beginPath();
          g.arc(eyeX + Math.cos(look) * 2.5, eyeY + Math.sin(look) * 2.5, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }

    // The hero: a small robot (blinking while it can't be hurt)
    const blink = this.time < this.hurtUntil && Math.floor(this.time * 12) % 2 === 0;
    if (!blink) {
      const hx = this.x + this.w / 2;
      const hy = this.y;
      const run = this.grounded ? Math.sin(this.walk * 2) : 0.6;
      g.fillStyle = '#4b5563';
      g.fillRect(hx - 7 + run * 3, hy + 22, 5, 6);
      g.fillRect(hx + 2 - run * 3, hy + 22, 5, 6);
      g.fillStyle = this.over ? '#9ca3af' : '#f1f3f8';
      g.beginPath();
      g.roundRect(hx - 11, hy + 4, 22, 20, 6);
      g.fill();
      g.fillStyle = '#2b2140';
      g.beginPath();
      g.roundRect(hx - 8 + this.facing * 1.5, hy + 8, 16, 8, 3);
      g.fill();
      g.fillStyle = this.won ? '#7ee787' : '#22d3ee';
      g.beginPath();
      g.arc(hx + this.facing * 4, hy + 12, 2.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4b5563';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(hx, hy + 4);
      g.lineTo(hx - this.facing * 2, hy - 3);
      g.stroke();
      g.fillStyle = '#f59e0b';
      g.beginPath();
      g.arc(hx - this.facing * 2, hy - 4, 2.5, 0, Math.PI * 2);
      g.fill();
    }

    for (const p of this.puffs) {
      g.globalAlpha = Math.max(0, p.life / 0.5);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
