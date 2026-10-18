/**
 * The Showcase picture for the MP4 export: the song's notes on a piano roll that scrolls past a
 * red playhead, as on fledgetone.com's home page. A note lights up and sends out a ring as the
 * playhead reaches it, glows while it's held and dims once it's played; the drums have a band of
 * their own under the pitched parts. Above the roll, the tracks playing, each name lighting up
 * while its track plays. Drawn in design units (1280×720 wide, 720×1280 tall) on a canvas scaled to
 * the video's size. Every frame is drawn from the time alone (no state), so frames can be drawn in
 * any order. The notes come from store/showcase.ts.
 */
import { firstFrom, type ShowcaseData } from '../store/showcase';

export interface ShowcaseBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How long a hit stays lit, and a ring takes to fade (seconds) */
const HIT = 0.45;
const RING = 0.65;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** How lit a note is at `t`: a flash when it starts, a softer glow while it's held, nothing before. */
export function noteGlow(start: number, end: number, t: number): number {
  if (t < start) return 0;
  const flash = Math.max(0, 1 - (t - start) / HIT);
  const held = t < end ? 0.35 : Math.max(0, 0.35 - (t - end) * 2);
  return Math.max(flash, held);
}

/**
 * The track names, as chips that light up while their track plays. Returns the height used.
 */
function drawTracks(g: CanvasRenderingContext2D, data: ShowcaseData, box: ShowcaseBox, playing: Float32Array): number {
  g.font = '600 15px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  const h = 28;
  let x = box.x;
  let y = box.y;
  for (let i = 0; i < data.tracks.length; i++) {
    const tr = data.tracks[i];
    const w = Math.min(box.w, g.measureText(tr.name).width + 34);
    if (x + w > box.x + box.w && x > box.x) {
      x = box.x;
      y += h + 8;
      // (At most three rows: a big song's last tracks aren't listed)
      if (y + h > box.y + 3 * (h + 8)) break;
    }
    const lit = playing[i];
    g.globalAlpha = 0.5 + 0.5 * lit;
    g.fillStyle = 'rgba(26,26,30,0.9)';
    roundRect(g, x, y, w, h, 7);
    g.fill();
    g.strokeStyle = tr.color;
    g.lineWidth = 1 + lit;
    g.globalAlpha = 0.35 + 0.65 * lit;
    g.stroke();
    if (lit > 0.05) {
      g.shadowColor = tr.color;
      g.shadowBlur = 14 * lit;
      g.stroke();
      g.shadowBlur = 0;
    }
    g.globalAlpha = 1;
    g.fillStyle = tr.color;
    g.beginPath();
    g.arc(x + 13, y + h / 2, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = lit > 0.05 ? '#f4f4f5' : '#a1a1aa';
    g.fillText(tr.name, x + 24, y + h / 2 + 1, w - 30);
    x += w + 8;
  }
  g.textBaseline = 'alphabetic';
  return y + h - box.y;
}

/**
 * Draw the roll at time `t` into `box`. `secondsShown` is how much of the song fits across it; the
 * playhead sits at `headAt` (0..1) of the width, so what's coming is visible ahead of it.
 */
export function drawShowcase(g: CanvasRenderingContext2D, data: ShowcaseData, box: ShowcaseBox, t: number, opts: { secondsShown: number; headAt: number }): void {
  // Which tracks are sounding now (for their chips)
  const playing = new Float32Array(data.tracks.length);
  const recent = firstFrom(data.notes, t - 8);
  for (let i = Math.max(0, recent - 400); i < data.notes.length; i++) {
    const n = data.notes[i];
    if (n.start > t) break;
    playing[n.track] = Math.max(playing[n.track], Math.min(1, noteGlow(n.start, n.end, t) / 0.35));
  }
  const chipsH = data.tracks.length ? drawTracks(g, data, box, playing) + 18 : 0;
  const roll = { x: box.x, y: box.y + chipsH, w: box.w, h: box.h - chipsH };

  // The roll's panel
  g.fillStyle = '#0f0f12';
  roundRect(g, roll.x, roll.y, roll.w, roll.h, 12);
  g.fill();
  g.strokeStyle = '#2a2a30';
  g.lineWidth = 1;
  g.stroke();
  g.save();
  roundRect(g, roll.x, roll.y, roll.w, roll.h, 12);
  g.clip();

  const pps = roll.w / opts.secondsShown;
  const headX = roll.x + roll.w * opts.headAt;
  const xOf = (s: number) => headX + (s - t) * pps;
  const drums = data.drumRows.length;
  const pad = 14;
  const drumH = drums ? Math.min(roll.h * 0.24, 14 * drums + 10) : 0;
  const pitchTop = roll.y + pad;
  const pitchBottom = roll.y + roll.h - pad - drumH - (drums ? 10 : 0);
  // At least two octaves, so a short melody isn't stretched into huge notes
  const low = Math.min(data.low, Math.round((data.low + data.high) / 2) - 12) - 1;
  const high = Math.max(data.high, low + 25) + 1;
  const lane = (pitchBottom - pitchTop) / (high - low + 1);
  const yOfPitch = (m: number) => pitchBottom - (m - low + 1) * lane;
  const drumLane = drums ? (drumH - 6) / drums : 0;
  const drumTop = roll.y + roll.h - pad - drumH;
  const drumRow = new Map(data.drumRows.map((m, i) => [m, i]));
  const yOf = (n: ShowcaseData['notes'][number]) => (n.drum ? drumTop + 3 + (drums - 1 - drumRow.get(n.midi)!) * drumLane : yOfPitch(n.midi));
  const hOf = (n: ShowcaseData['notes'][number]) => Math.max(3, (n.drum ? drumLane : lane) - 2);

  // Grid: bar lines, the octaves' C rows, the drum band
  g.lineWidth = 1;
  for (const b of data.bars) {
    const x = xOf(b);
    if (x < roll.x - 2 || x > roll.x + roll.w + 2) continue;
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, roll.y);
    g.lineTo(Math.round(x) + 0.5, roll.y + roll.h);
    g.stroke();
  }
  for (let m = Math.ceil(low / 12) * 12; m <= high; m += 12) {
    g.fillStyle = 'rgba(255,255,255,0.035)';
    g.fillRect(roll.x, yOfPitch(m), roll.w, Math.max(1, lane));
  }
  if (drums) {
    g.fillStyle = 'rgba(255,255,255,0.025)';
    g.fillRect(roll.x, drumTop, roll.w, drumH);
  }

  // The notes on screen (a long note that started before the window still shows)
  const from = firstFrom(data.notes, t - (headX - roll.x) / pps - 30);
  const rings: Array<{ y: number; color: string; age: number }> = [];
  for (let i = from; i < data.notes.length; i++) {
    const n = data.notes[i];
    const x = xOf(n.start);
    if (x > roll.x + roll.w) break;
    const x2 = xOf(n.end);
    if (x2 < roll.x) continue;
    const y = yOf(n);
    const h = hOf(n);
    const w = Math.max(3, x2 - x - 2);
    const glow = noteGlow(n.start, n.end, t);
    const past = n.end < t;
    const base = past ? 0.28 : 0.5;
    g.globalAlpha = Math.min(1, base * 0.6 + 0.65 * glow);
    g.fillStyle = n.color;
    roundRect(g, x, y, w, h, Math.min(3, h / 2));
    g.fill();
    g.globalAlpha = Math.min(1, base + 0.5 * glow);
    g.strokeStyle = n.color;
    g.lineWidth = 1;
    g.stroke();
    if (glow > 0.05) {
      g.globalAlpha = glow * 0.8;
      g.shadowColor = n.color;
      g.shadowBlur = 22 * glow;
      g.fill();
      g.shadowBlur = 0;
    }
    const age = t - n.start;
    if (age >= 0 && age < RING && rings.length < 48) rings.push({ y: y + h / 2, color: n.color, age });
  }
  g.globalAlpha = 1;

  // Rings where the playhead hit (at the playhead, as on the home page)
  g.lineWidth = 2;
  for (const r of rings) {
    const p = r.age / RING;
    g.globalAlpha = (1 - p) * 0.7;
    g.strokeStyle = r.color;
    g.beginPath();
    g.arc(headX, r.y, 4 + p * 34, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;

  // The playhead: a soft light behind it, the line, and its marker at the top
  const light = g.createLinearGradient(headX - 60, 0, headX + 60, 0);
  light.addColorStop(0, 'rgba(239,68,68,0)');
  light.addColorStop(0.5, 'rgba(239,68,68,0.10)');
  light.addColorStop(1, 'rgba(239,68,68,0)');
  g.fillStyle = light;
  g.fillRect(headX - 60, roll.y, 120, roll.h);
  g.fillStyle = '#ef4444';
  g.shadowColor = '#ef4444';
  g.shadowBlur = 14;
  g.fillRect(headX - 1.5, roll.y, 3, roll.h);
  g.shadowBlur = 0;
  g.beginPath();
  g.moveTo(headX - 9, roll.y);
  g.lineTo(headX + 9, roll.y);
  g.lineTo(headX, roll.y + 12);
  g.closePath();
  g.fill();
  g.restore();
}
