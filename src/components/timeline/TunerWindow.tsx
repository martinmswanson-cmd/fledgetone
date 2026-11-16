/**
 * The tuner: the note a sound is nearest to and how far off it is, for tuning a guitar, a bass or
 * a voice before recording. It listens to the microphone (the sound isn't recorded, kept or played
 * back), or to a track or the whole song as they play. The maths is tunerMath.ts.
 */
import React, { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { liveTrackWaveform } from '../../audio/liveTracks';
import { liveMix } from '../../audio/engine';
import { nativeContextOf } from '../../audio/nativeNodes';
import { readMasterWaveform, watchMasterSpectrum } from '../../audio/masterSpectrum';
import { steadyHz, tunerNote, tunerPitch } from '../../audio/tunerMath';
import { onFrame } from '../frameTicker';
import { FloatingWindow } from './FloatingWindow';

const MIC = 'mic';
const MASTER = 'master';
const SELECTED = 'selected';
/** Within this many cents the note is in tune */
const IN_TUNE = 5;
const A4_KEY = 'bosBeatbox.tunerA4';

function savedA4(): number {
  try {
    const v = Number(localStorage.getItem(A4_KEY));
    return v >= 415 && v <= 466 ? v : 440;
  } catch {
    return 440;
  }
}

export const TunerWindow: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedId = useTimelineStore((s) => s.selectedTrackId);
  const [source, setSource] = useState<string>(MIC);
  const [a4, setA4] = useState(savedA4);
  // What was last heard, and what went wrong, each with what was being listened to then (a
  // reading from the last source says nothing about this one)
  const [heard, setHeard] = useState<{ from: string; hz: number } | null>(null);
  const [failed, setFailed] = useState<{ from: string; text: string } | null>(null);
  const listenTo = source === SELECTED ? (selectedId ?? MASTER) : source;
  const hz = heard?.from === listenTo ? heard.hz : null;
  const problem = failed?.from === listenTo ? failed.text : null;

  useEffect(() => {
    try {
      localStorage.setItem(A4_KEY, String(a4));
    } catch {
      // Not kept, then
    }
  }, [a4]);

  useEffect(() => {
    const samples = new Float32Array(4096);
    let read: (() => number) | null = null;
    let undo: Array<() => void> = [];
    let gone = false;
    const rate = liveMix.bus.context.sampleRate;
    if (listenTo === MIC) {
      void (async () => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser has no microphone access here (it needs a secure https page)');
          // A music signal, not a call: nothing that would change its pitch or level
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
          const stopStream = () => stream.getTracks().forEach((t) => t.stop());
          if (gone) return stopStream();
          const ctx = nativeContextOf(liveMix.bus.context) as AudioContext;
          const input = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 4096;
          // (Played into a silent gain, so the browser keeps it running; nothing of it is heard)
          const silent = ctx.createGain();
          silent.gain.value = 0;
          input.connect(analyser);
          analyser.connect(silent);
          silent.connect(ctx.destination);
          read = () => {
            analyser.getFloatTimeDomainData(samples);
            return samples.length;
          };
          undo = [
            stopStream,
            () => {
              input.disconnect();
              analyser.disconnect();
              silent.disconnect();
            },
          ];
        } catch (err) {
          if (!gone) setFailed({ from: listenTo, text: `The microphone isn't available: ${err instanceof Error ? err.message : String(err)}. Allow it for this page, or listen to a track instead.` });
        }
      })();
    } else if (listenTo === MASTER) {
      undo = [watchMasterSpectrum()];
      read = () => readMasterWaveform(samples);
    } else {
      read = () => liveTrackWaveform(listenTo, samples);
    }
    const recent: number[] = [];
    let quiet = 0;
    const tick = () => {
      const n = read?.() ?? 0;
      const found = n >= 2048 ? tunerPitch(n === samples.length ? samples : samples.subarray(0, n), rate) : null;
      if (!found) {
        // A moment of nothing (between two plucks) keeps the last note on show
        if (++quiet > 8) {
          recent.length = 0;
          setHeard(null);
        }
        return;
      }
      quiet = 0;
      recent.push(found.hz);
      if (recent.length > 5) recent.shift();
      setHeard({ from: listenTo, hz: steadyHz(recent)! });
    };
    const stop = onFrame(tick, 12);
    return () => {
      gone = true;
      stop();
      undo.forEach((u) => {
        try {
          u();
        } catch {
          // Already let go
        }
      });
    };
  }, [listenTo]);

  const note = hz !== null ? tunerNote(hz, a4) : null;
  const cents = note ? note.cents : 0;
  const inTune = !!note && Math.abs(cents) <= IN_TUNE;
  const select = 'h-6 max-w-[11rem] rounded border border-forge-border bg-forge-bg px-1 text-[10px] text-forge-text';
  const say = note ? `${note.name}${note.octave}, ${inTune ? 'in tune' : `${Math.abs(cents).toFixed(0)} cents ${cents < 0 ? 'flat' : 'sharp'}`}` : 'No note heard';

  return (
    <FloatingWindow title="Tuner" icon={<Gauge className="w-3.5 h-3.5 text-cyan-300" />} at={{ x: window.innerWidth - 400, y: 120 }} onClose={onClose}>
      <div className="p-3 w-[340px] max-w-full flex flex-col gap-3 text-[10px] font-mono text-forge-muted">
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1" title="What the tuner listens to. The microphone's sound is not recorded, kept or played back.">
            <span className="uppercase">Listen to</span>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={select} aria-label="The tuner listens to">
              <option value={MIC}>The microphone</option>
              <option value={SELECTED}>The selected track</option>
              <option value={MASTER}>Everything (the master)</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ml-auto flex items-center gap-1" title="What A above middle C is tuned to: 440 Hz almost everywhere today; 442 in some orchestras, 415 for baroque instruments">
            <span>A4</span>
            <input type="number" min={415} max={466} step={1} value={a4} onChange={(e) => setA4(Math.max(415, Math.min(466, Math.round(Number(e.target.value) || 440))))} className="h-6 w-14 rounded border border-forge-border bg-forge-bg px-1 text-forge-text" aria-label="A4 in hertz" />
            <span>Hz</span>
          </label>
        </div>
        <div className="flex items-end justify-center gap-2 h-16" aria-hidden>
          <span className={`text-6xl leading-none font-sans font-semibold ${note ? (inTune ? 'text-emerald-300' : 'text-forge-text') : 'text-forge-border'}`}>{note ? note.name : '–'}</span>
          <span className="text-lg text-forge-muted pb-1">{note ? note.octave : ''}</span>
        </div>
        <div className="relative h-8 rounded bg-black/40" role="meter" aria-label="How far from the note" aria-valuemin={-50} aria-valuemax={50} aria-valuenow={note ? Math.round(cents) : 0} aria-valuetext={say}>
          {[-50, -25, 0, 25, 50].map((c) => (
            <span key={c} className={`absolute top-0 h-full w-px ${c === 0 ? 'bg-emerald-400/70' : 'bg-forge-border'}`} style={{ left: `${c + 50}%` }} />
          ))}
          <span className="absolute top-0 h-full bg-emerald-400/15" style={{ left: `${50 - IN_TUNE}%`, width: `${2 * IN_TUNE}%` }} />
          {note && <span className={`absolute top-1 bottom-1 w-1.5 -ml-[3px] rounded ${inTune ? 'bg-emerald-300' : 'bg-amber-300'}`} style={{ left: `${Math.max(0, Math.min(100, cents + 50))}%` }} />}
        </div>
        <div className="flex justify-between">
          <span>Flat</span>
          <span className={inTune ? 'text-emerald-300' : 'text-forge-text'}>{note ? (inTune ? `In tune (${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents)` : `${Math.abs(cents).toFixed(0)} cents ${cents < 0 ? 'flat: tune up' : 'sharp: tune down'}`) : ''}</span>
          <span>Sharp</span>
        </div>
        <p className="font-sans leading-snug min-h-[2.5em]" role="status">
          {problem ?? (note ? `${hz!.toFixed(1)} Hz. ${note.name}${note.octave} is ${note.hz.toFixed(1)} Hz.` : listenTo === MIC ? 'Play one note at a time, close to the microphone.' : 'Press Play, or play the track: one note at a time (a chord has no single pitch).')}
        </p>
      </div>
    </FloatingWindow>
  );
};
