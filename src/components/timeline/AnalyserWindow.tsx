/**
 * The spectrum analyser: how loud a track (or everything) is at each frequency, drawn against a
 * frequency axis spaced as hearing spaces pitches, with the highest level reached held as a line,
 * and a second sound drawn over it to compare (the kick against the bass, a track against the
 * whole mix). Reads the analysers the mixer's meters and the Pro EQ already use (analyserMath.ts
 * lays the bins out); it listens only, and changes nothing in the sound.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { liveTrackSpectrum } from '../../audio/liveTracks';
import { liveMix } from '../../audio/engine';
import { readMasterBins, watchMasterSpectrum } from '../../audio/masterSpectrum';
import { ANALYSER_FLOOR_DB, ANALYSER_TOP_DB, analyserHz, analyserX, analyserY, hzText, loudestColumn, spectrumColumns } from '../../audio/analyserMath';
import { tunerNote } from '../../audio/tunerMath';
import { onFrame } from '../frameTicker';
import { FloatingWindow } from './FloatingWindow';

const W = 560;
const H = 240;
const MASTER = 'master';
const SELECTED = 'selected';
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const GRID_DB = [-12, -24, -36, -48, -60, -72, -84];

const noteText = (hz: number) => {
  const n = tunerNote(hz);
  return `${n.name}${n.octave}`;
};

export const AnalyserWindow: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedId = useTimelineStore((s) => s.selectedTrackId);
  const [source, setSource] = useState<string>(SELECTED);
  const [against, setAgainst] = useState<string>('');
  const [hold, setHold] = useState(true);
  const [readout, setReadout] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  /** The highest level each column has reached (cleared by Reset, and when what's shown changes) */
  const held = useRef(new Float32Array(W).fill(ANALYSER_FLOOR_DB));
  const cursor = useRef<number | null>(null);

  const idOf = (choice: string) => (choice === SELECTED ? (selectedId ?? MASTER) : choice);
  const shown = idOf(source);
  const other = against ? idOf(against) : '';
  const nameOf = (id: string) => (id === MASTER ? 'Everything' : (tracks.find((t) => t.id === id)?.name ?? 'A track that is gone'));
  const colorOf = (id: string) => (id === MASTER ? '#22d3ee' : (tracks.find((t) => t.id === id)?.color ?? '#22d3ee'));
  const [mainColor, otherColor] = [colorOf(shown), other ? colorOf(other) : ''];

  useEffect(() => {
    held.current.fill(ANALYSER_FLOOR_DB);
  }, [shown]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    c.width = W * ratio;
    c.height = H * ratio;
    const stopMaster = shown === MASTER || other === MASTER ? watchMasterSpectrum() : null;
    const bins = new Float32Array(4096);
    const [main, second] = [new Float32Array(W), new Float32Array(W)];
    const read = (id: string, out: Float32Array) => {
      const count = id === MASTER ? readMasterBins(bins) : liveTrackSpectrum(id, bins);
      if (!count) {
        out.fill(ANALYSER_FLOOR_DB);
        return false;
      }
      spectrumColumns(bins, count, liveMix.bus.context.sampleRate, out);
      return true;
    };
    const trace = (cols: Float32Array, fill: string | null, stroke: string, width = 1.25) => {
      g.beginPath();
      for (let x = 0; x < W; x++) g[x ? 'lineTo' : 'moveTo'](x + 0.5, analyserY(cols[x], H));
      if (fill) {
        g.lineTo(W, H);
        g.lineTo(0, H);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
      } else {
        g.strokeStyle = stroke;
        g.lineWidth = width;
        g.stroke();
      }
    };
    let last = '';
    const draw = () => {
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, W, H);
      g.font = '9px ui-monospace, monospace';
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(148,163,184,0.18)';
      g.fillStyle = 'rgba(148,163,184,0.7)';
      for (const hz of GRID_HZ) {
        const x = Math.round(analyserX(hz, W)) + 0.5;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
        g.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x + 3, H - 4);
      }
      for (const db of GRID_DB) {
        const y = Math.round(analyserY(db, H)) + 0.5;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
        g.fillText(String(db), 3, y - 2);
      }
      const live = read(shown, main);
      if (live) {
        trace(main, `${mainColor}55`, '');
        trace(main, null, mainColor);
        for (let x = 0; x < W; x++) if (main[x] > held.current[x]) held.current[x] = main[x];
      }
      if (hold) trace(held.current, null, 'rgba(226,232,240,0.75)', 1);
      if (other && read(other, second)) trace(second, null, otherColor === mainColor ? '#f0abfc' : otherColor, 1.5);
      // What's under the pointer, or the loudest frequency
      let text = '';
      if (cursor.current !== null) {
        const x = Math.max(0, Math.min(W - 1, Math.round(cursor.current)));
        const hz = analyserHz(x + 0.5, W);
        g.strokeStyle = 'rgba(226,232,240,0.5)';
        g.beginPath();
        g.moveTo(x + 0.5, 0);
        g.lineTo(x + 0.5, H);
        g.stroke();
        text = `${hzText(hz)} (${noteText(hz)}): ${live && main[x] > ANALYSER_FLOOR_DB ? `${main[x].toFixed(1)} dB` : 'silent'}${hold && held.current[x] > ANALYSER_FLOOR_DB ? `, held ${held.current[x].toFixed(1)} dB` : ''}`;
      } else {
        const top = live ? loudestColumn(main) : null;
        text = top ? `Loudest: ${hzText(top.hz)} (${noteText(top.hz)}) at ${top.db.toFixed(1)} dB` : 'Nothing sounding: press Play';
      }
      if (text !== last) setReadout((last = text));
    };
    const stop = onFrame(draw, 30);
    draw();
    return () => {
      stop();
      stopMaster?.();
    };
  }, [shown, other, hold, mainColor, otherColor]);

  const choices = (
    <>
      <option value={SELECTED}>The selected track</option>
      <option value={MASTER}>Everything (the master)</option>
      {tracks.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </>
  );
  const select = 'h-6 max-w-[11rem] rounded border border-forge-border bg-forge-bg px-1 text-[10px] text-forge-text';
  const move = (e: React.PointerEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    cursor.current = ((e.clientX - box.left) / box.width) * W;
  };

  return (
    <FloatingWindow title="Spectrum analyser" icon={<Activity className="w-3.5 h-3.5 text-cyan-300" />} at={{ x: window.innerWidth / 2 - 300, y: 120 }} onClose={onClose}>
      <div className="p-2 flex flex-col gap-2 text-[10px] font-mono text-forge-muted">
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1" title="Whose sound is drawn: after the track's effects and fader, as the mixer's meter hears it">
            <span className="uppercase">Show</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={select} aria-label="Show the spectrum of">
              {choices}
            </select>
          </label>
          <label className="flex items-center gap-1" title="A second sound drawn as a line over the first: where two parts are loud at the same frequencies, they fight for the same room">
            <span className="uppercase">Against</span>
            <select value={against} onChange={(e) => setAgainst(e.target.value)} className={select} aria-label="Compare against">
              <option value="">Nothing</option>
              {choices}
            </select>
          </label>
          <button type="button" onClick={() => setHold(!hold)} aria-pressed={hold} className={`h-6 px-2 rounded border ${hold ? 'border-cyan-400/70 text-forge-text' : 'border-forge-border hover:text-forge-text'}`} title="Keep a line at the highest level each frequency has reached">
            Hold peaks
          </button>
          <button type="button" onClick={() => held.current.fill(ANALYSER_FLOOR_DB)} className="h-6 px-2 rounded border border-forge-border hover:text-forge-text" title="Forget the held peaks and start again">
            Reset
          </button>
        </div>
        <canvas
          ref={canvas}
          style={{ width: W, height: H, maxWidth: '100%' }}
          className="rounded bg-black/50 cursor-crosshair"
          role="img"
          aria-label={`Spectrum of ${nameOf(shown)}${other ? ` against ${nameOf(other)}` : ''}, ${ANALYSER_FLOOR_DB} to ${ANALYSER_TOP_DB} dB, 20 Hz to 20 kHz. ${readout}`}
          onPointerMove={move}
          onPointerLeave={() => (cursor.current = null)}
        />
        <p className="font-sans leading-snug" aria-live="off">
          <span className="text-forge-text">{nameOf(shown)}</span>
          {other ? (
            <>
              {' '}
              against <span className="text-forge-text">{nameOf(other)}</span> (the line)
            </>
          ) : null}
          . {readout}
        </p>
      </div>
    </FloatingWindow>
  );
};
