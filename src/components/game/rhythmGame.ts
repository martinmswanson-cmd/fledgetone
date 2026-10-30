/**
 * The game preview's rhythm game, drawn on a canvas: the song plays and its own notes (the chart
 * from store/rhythmChart.ts) fall down four lanes; press a lane's key (D F J K, or the arrows) as a
 * note reaches the line. Hits are judged Perfect, Great or Good by how close they are; a note let
 * past is a miss, and a miss muffles the song for a moment, as rhythm games do. Long notes are held
 * to their end for a bonus. The picture is timed by the audio clock (minus the output's delay, plus
 * the player's own offset), so what's seen is what's heard.
 */
import { LANES, type ChartNote } from '../../store/rhythmChart';

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

export interface RhythmResult {
  score: number;
  /** Of what a perfect run would score, 0 to 1 */
  accuracy: number;
  grade: string;
  maxCombo: number;
  counts: Record<Judgement, number>;
  fullCombo: boolean;
}

export interface RhythmEvents {
  judge: (j: Judgement, combo: number) => void;
  finish: (r: RhythmResult) => void;
}

/** How far off a hit can be (seconds), for each judgement */
const WINDOW: Record<Exclude<Judgement, 'miss'>, number> = { perfect: 0.045, great: 0.09, good: 0.135 };
const POINTS: Record<Judgement, number> = { perfect: 300, great: 200, good: 100, miss: 0 };
/** Seconds of countdown before the song starts */
const LEAD_IN = 2;
const LANE_KEYS: Record<string, number> = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
const LANE_COLORS = ['#22d3ee', '#a78bfa', '#fbbf24', '#fb7185'];
const LANE_LABELS = ['D', 'F', 'J', 'K'];

export const RHYTHM_KEYS = new Set(Object.keys(LANE_KEYS));

export function gradeOf(accuracy: number): string {
  return accuracy >= 0.95 ? 'S' : accuracy >= 0.9 ? 'A' : accuracy >= 0.8 ? 'B' : accuracy >= 0.7 ? 'C' : 'D';
}

interface Live extends ChartNote {
  judged: Judgement | null;
  /** A hold being held down; its end reached (bonus) or let go early */
  holding: boolean;
  holdDone: boolean;
  holdBroken: boolean;
}

export interface RhythmOptions {
  ctx: AudioContext;
  buffer: AudioBuffer;
  chart: ChartNote[];
  /** Where the song goes */
  out: AudioNode;
  /** The player's timing offset (ms): positive when they hit late on every note */
  offsetMs: number;
  /** How long a note takes to fall from the top to the line (seconds) */
  fallSeconds: number;
  events: RhythmEvents;
}

export class RhythmGame {
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private host: HTMLElement;
  private o: RhythmOptions;
  private resize: ResizeObserver;
  private raf = 0;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private t0 = 0;
  private notes: Live[] = [];
  /** The first note not yet judged or done (everything before it is behind the line) */
  private cursor = 0;
  private pressed = new Array<boolean>(LANES).fill(false);
  private flash = new Array<number>(LANES).fill(-Infinity);
  private combo = 0;
  private maxCombo = 0;
  private score = 0;
  private counts: Record<Judgement, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  private last: { j: Judgement; at: number; lane: number; early: boolean } | null = null;
  private result: RhythmResult | null = null;
  private end = 0;

  constructor(host: HTMLElement, o: RhythmOptions) {
    this.host = host;
    this.o = o;
    this.g = this.canvas.getContext('2d')!;
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    host.appendChild(this.canvas);
    this.filter = o.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.5;
    this.gain = o.ctx.createGain();
    this.filter.connect(this.gain).connect(o.out);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
  }

  private fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round((this.host.clientWidth || 640) * dpr));
    this.canvas.height = Math.max(1, Math.round((this.host.clientHeight || 400) * dpr));
  }

  /** The song's time now, as the player hears it */
  private now(): number {
    const ctx = this.o.ctx;
    const heard = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime - this.t0 - heard - this.o.offsetMs / 1000;
  }

  /** (Re)start from the top: a count-in, then the song. */
  start() {
    this.stopSong();
    this.notes = this.o.chart.map((n) => ({ ...n, judged: null, holding: false, holdDone: false, holdBroken: false }));
    this.cursor = 0;
    this.combo = this.maxCombo = this.score = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.last = null;
    this.result = null;
    const ctx = this.o.ctx;
    this.t0 = ctx.currentTime + LEAD_IN;
    const src = ctx.createBufferSource();
    src.buffer = this.o.buffer;
    src.connect(this.filter);
    src.start(this.t0);
    this.source = src;
    this.end = Math.max(this.o.buffer.duration, ...this.notes.map((n) => n.end ?? n.time)) + 0.5;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.update();
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Stop the song (another preview started): the game stays where it is until start() again. */
  silence() {
    this.stopSong();
  }

  private stopSong() {
    try {
      this.source?.stop();
    } catch {
      // (not started yet)
    }
    this.source?.disconnect();
    this.source = null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.stopSong();
    this.filter.disconnect();
    this.gain.disconnect();
    this.resize.disconnect();
    this.canvas.remove();
  }

  key(code: string, down: boolean) {
    const lane = LANE_KEYS[code];
    if (lane === undefined || this.result) return;
    this.pressed[lane] = down;
    const t = this.now();
    if (!down) {
      // Letting go of a hold before its end
      for (const n of this.notes) if (n.lane === lane && n.holding && !n.holdDone) {
        n.holding = false;
        if (n.end! - t > 0.12) n.holdBroken = true;
        else this.finishHold(n);
      }
      return;
    }
    this.flash[lane] = t;
    // The nearest note in the lane still to be hit, if it's close enough
    let best: Live | null = null;
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time - t > WINDOW.good) break;
      if (n.lane !== lane || n.judged) continue;
      if (!best || Math.abs(n.time - t) < Math.abs(best.time - t)) best = n;
    }
    if (!best) return;
    const off = t - best.time;
    const a = Math.abs(off);
    const j: Judgement = a <= WINDOW.perfect ? 'perfect' : a <= WINDOW.great ? 'great' : 'good';
    this.judge(best, j, lane, off < 0);
    if (best.end !== undefined) best.holding = true;
  }

  private judge(n: Live, j: Judgement, lane: number, early: boolean) {
    n.judged = j;
    this.counts[j]++;
    if (j === 'miss') {
      this.combo = 0;
      // The song goes dull for a moment
      const f = this.filter.frequency;
      const at = this.o.ctx.currentTime;
      f.cancelScheduledValues(at);
      f.setValueAtTime(650, at);
      f.exponentialRampToValueAtTime(20000, at + 0.45);
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += Math.round(POINTS[j] * (1 + Math.min(this.combo, 100) / 100));
    }
    this.last = { j, at: this.now(), lane, early };
    this.o.events.judge(j, this.combo);
  }

  private finishHold(n: Live) {
    n.holding = false;
    n.holdDone = true;
    this.score += 100;
  }

  private update() {
    const t = this.now();
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time - t > 0) break;
      if (!n.judged && t - n.time > WINDOW.good) this.judge(n, 'miss', n.lane, false);
      if (n.holding && n.end !== undefined && t >= n.end) this.finishHold(n);
    }
    while (this.cursor < this.notes.length) {
      const n = this.notes[this.cursor];
      if (!n.judged || n.holding) break;
      this.cursor++;
    }
    if (!this.result && t > this.end) {
      const total = this.notes.length;
      const accuracy = total ? (this.counts.perfect * 300 + this.counts.great * 200 + this.counts.good * 100) / (total * 300) : 0;
      this.result = { score: this.score, accuracy, grade: gradeOf(accuracy), maxCombo: this.maxCombo, counts: { ...this.counts }, fullCombo: total > 0 && this.counts.miss === 0 };
      this.o.events.finish(this.result);
    }
  }

  // ---------- drawing ----------

  private draw() {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = W / (this.host.clientWidth || W);
    const t = this.now();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d0b1a');
    bg.addColorStop(1, '#1a1030');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // The track: four lanes in the middle
    const laneW = Math.min(110 * dpr, (W * 0.5) / LANES);
    const left = (W - laneW * LANES) / 2;
    const lineY = H * 0.84;
    const pxPerSec = lineY / this.o.fallSeconds;
    for (let l = 0; l < LANES; l++) {
      const x = left + l * laneW;
      g.fillStyle = l % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.06)';
      g.fillRect(x, 0, laneW, H);
      // A press lights the lane
      const since = t - this.flash[l];
      if (this.pressed[l] || since < 0.15) {
        const glow = g.createLinearGradient(0, lineY, 0, lineY - H * 0.5);
        glow.addColorStop(0, `${LANE_COLORS[l]}55`);
        glow.addColorStop(1, `${LANE_COLORS[l]}00`);
        g.fillStyle = glow;
        g.fillRect(x, lineY - H * 0.5, laneW, H * 0.5);
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let l = 0; l <= LANES; l++) g.fillRect(left + l * laneW - 0.5 * dpr, 0, dpr, H);

    // The line and the keys
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(left, lineY - 1.5 * dpr, laneW * LANES, 3 * dpr);
    g.font = `600 ${14 * dpr}px ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let l = 0; l < LANES; l++) {
      const cx = left + (l + 0.5) * laneW;
      g.fillStyle = this.pressed[l] ? LANE_COLORS[l] : 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.roundRect(cx - laneW * 0.32, lineY + 12 * dpr, laneW * 0.64, 30 * dpr, 6 * dpr);
      g.fill();
      g.fillStyle = this.pressed[l] ? '#0d0b1a' : 'rgba(255,255,255,0.7)';
      g.fillText(LANE_LABELS[l], cx, lineY + 27 * dpr);
    }

    // The notes (those on screen), holds as a tail up to their end
    const noteH = 16 * dpr;
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      const y = lineY - (n.time - t) * pxPerSec;
      if (y < -H) break;
      const x = left + n.lane * laneW + 6 * dpr;
      const w = laneW - 12 * dpr;
      const color = LANE_COLORS[n.lane];
      if (n.end !== undefined) {
        const yEnd = lineY - (n.end - t) * pxPerSec;
        const yStart = n.holding ? lineY : y;
        if (yEnd < yStart) {
          g.fillStyle = n.holdBroken || n.judged === 'miss' ? 'rgba(255,255,255,0.12)' : `${color}${n.holding ? 'cc' : '66'}`;
          g.fillRect(x + w * 0.3, yEnd, w * 0.4, yStart - yEnd);
        }
      }
      if (n.judged && n.judged !== 'miss') continue;
      if (n.judged === 'miss') g.globalAlpha = 0.3;
      g.shadowColor = color;
      g.shadowBlur = 12 * dpr;
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, y - noteH / 2, w, noteH, 5 * dpr);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x + 4 * dpr, y - noteH / 2 + 3 * dpr, w - 8 * dpr, 3 * dpr);
      g.globalAlpha = 1;
    }

    // The last judgement and the combo
    const cx = W / 2;
    if (this.last && t - this.last.at < 0.5) {
      const k = (t - this.last.at) / 0.5;
      const label = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' }[this.last.j];
      const color = { perfect: '#fde047', great: '#7ee787', good: '#93c5fd', miss: '#f87171' }[this.last.j];
      g.globalAlpha = 1 - k;
      g.fillStyle = color;
      g.font = `800 ${(30 - k * 6) * dpr}px system-ui, sans-serif`;
      g.fillText(label, cx, lineY - H * 0.28 - k * 10 * dpr);
      if (this.last.j !== 'miss' && this.last.j !== 'perfect') {
        g.font = `500 ${12 * dpr}px system-ui, sans-serif`;
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillText(this.last.early ? 'early' : 'late', cx, lineY - H * 0.28 + 24 * dpr);
      }
      g.globalAlpha = 1;
    }
    if (this.combo >= 5) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `800 ${44 * dpr}px system-ui, sans-serif`;
      g.fillText(String(this.combo), cx, H * 0.3);
      g.font = `600 ${12 * dpr}px system-ui, sans-serif`;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText('COMBO', cx, H * 0.3 + 30 * dpr);
    }

    // Score, accuracy so far and the song's progress, on the right
    const judged = this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss;
    const acc = judged ? (this.counts.perfect * 300 + this.counts.great * 200 + this.counts.good * 100) / (judged * 300) : 1;
    g.textAlign = 'right';
    g.fillStyle = '#fff';
    g.font = `800 ${26 * dpr}px ui-monospace, monospace`;
    g.fillText(String(this.score).padStart(7, '0'), W - 20 * dpr, 30 * dpr);
    g.font = `500 ${14 * dpr}px ui-monospace, monospace`;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(`${(acc * 100).toFixed(2)}%`, W - 20 * dpr, 56 * dpr);
    const duration = this.o.buffer.duration;
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, 0, W, 4 * dpr);
    g.fillStyle = '#a78bfa';
    g.fillRect(0, 0, W * Math.max(0, Math.min(1, t / duration)), 4 * dpr);

    // The count-in
    g.textAlign = 'center';
    if (t < 0) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `800 ${64 * dpr}px system-ui, sans-serif`;
      g.fillText(String(Math.ceil(-t)), cx, H * 0.45);
    }

    // The results
    if (this.result) {
      const r = this.result;
      g.fillStyle = 'rgba(8,6,18,0.82)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = { S: '#fde047', A: '#7ee787', B: '#93c5fd', C: '#c4b5fd', D: '#f87171' }[r.grade] ?? '#fff';
      g.font = `900 ${96 * dpr}px system-ui, sans-serif`;
      g.fillText(r.grade, cx, H * 0.3);
      g.fillStyle = '#fff';
      g.font = `700 ${20 * dpr}px system-ui, sans-serif`;
      g.fillText(r.fullCombo ? 'FULL COMBO!' : `${(r.accuracy * 100).toFixed(2)}%`, cx, H * 0.3 + 70 * dpr);
      g.font = `500 ${15 * dpr}px ui-monospace, monospace`;
      g.fillStyle = 'rgba(255,255,255,0.8)';
      const lines = [`Score ${r.score}`, `Max combo ${r.maxCombo}`, `Perfect ${r.counts.perfect} · Great ${r.counts.great} · Good ${r.counts.good} · Miss ${r.counts.miss}`, 'Press R to play again'];
      lines.forEach((line, i) => g.fillText(line, cx, H * 0.3 + (110 + i * 26) * dpr));
    }
  }
}
