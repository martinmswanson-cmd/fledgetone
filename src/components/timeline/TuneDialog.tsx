import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Loader2, Play, Square, Undo2, Wand2 } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore, songTempo } from '../../store/timelineStore';
import { tempoAt } from '../../audio/tempoMap';
import { detectKey, NOTE_NAMES, MAJOR_STEPS, MINOR_STEPS } from '../../store/songKey';
import { CHROMATIC, hzToMidi, tuneChannels, type PitchFrame } from '../../audio/vocalTune';
import { decodeSound, importSoundFile, useSoundLibrary } from '../../audio/soundLibrary';
import { encodeChannels } from '../../audio/exportWav';
import { audioSourceSeconds } from '../../store/audioClips';
import { initAudio } from '../../audio/engine';
import { showToast } from './toastStore';

/**
 * Tune a vocal (or any one-note-at-a-time recording): its pitch pulled onto the notes of a key.
 * The graph shows the pitch sung (grey) and where it goes (colour) against the key's notes. Apply
 * makes a tuned copy of the sound for the clip; the original is kept, and Untune goes back to it.
 */

type Scale = 'major' | 'minor' | 'chromatic';
const RATE = 44100;

export const TuneDialog: React.FC<{ clipId: string; onClose: () => void }> = ({ clipId, onClose }) => {
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === clip?.trackId));
  const bpm = useTimelineStore((s) => (clip ? tempoAt(clip.startBar, songTempo(s)) : s.bpm));
  const songKey = useMemo(() => {
    const s = useTimelineStore.getState();
    return detectKey(s.clips, s.tracks);
  }, []);
  const [root, setRoot] = useState(songKey?.root ?? 0);
  const [scale, setScale] = useState<Scale>(songKey?.mode ?? 'major');
  const [strength, setStrength] = useState(0.8);
  const [speed, setSpeed] = useState(40);
  const [source, setSource] = useState<AudioBuffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<AudioBufferSourceNode | null>(null);
  const audio = clip?.audio;
  const original = audio?.tunedFrom ?? audio?.soundId;
  const meta = useSoundLibrary((s) => (original ? s.metas[original] : undefined));

  useEffect(() => {
    if (!original) return;
    decodeSound(original, RATE).then(setSource, () => showToast("Couldn't read the recording."));
  }, [original]);
  useEffect(() => () => player.current?.stop(), []);

  const steps = scale === 'chromatic' ? CHROMATIC : scale === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  const settings = { root, steps, strength, speed };
  // The part of the sound the clip plays
  const from = audio?.offset ?? 0;
  const to = clip ? from + audioSourceSeconds(clip, bpm) : 0;
  // Worked out a moment after the settings stop moving (it takes a little while on a long take)
  const [result, setResult] = useState<ReturnType<typeof tuneChannels> | null>(null);
  useEffect(() => {
    if (!source) return;
    const timer = window.setTimeout(() => {
      const a = Math.floor(from * RATE);
      const b = Math.min(source.length, Math.ceil(to * RATE));
      const part = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c).slice(a, b));
      setResult(tuneChannels(part, RATE, { root, steps, strength, speed }));
    }, 200);
    return () => clearTimeout(timer);
  }, [source, from, to, root, steps, strength, speed]);

  if (!clip || !audio || !track) return null;

  const stop = () => {
    player.current?.stop();
    player.current = null;
    setPlaying(false);
  };
  const preview = async (tuned: boolean) => {
    if (!result || !source) return;
    stop();
    await initAudio();
    const ctx = Tone.getContext().rawContext as AudioContext;
    const chans = tuned ? result.channels : Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c).slice(Math.floor(from * RATE), Math.ceil(to * RATE)));
    const buf = ctx.createBuffer(chans.length, chans[0].length, RATE);
    chans.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => setPlaying(false);
    src.start();
    player.current = src;
    setPlaying(true);
  };

  const apply = async () => {
    if (!source) return;
    setBusy(true);
    try {
      // The whole recording, so the clip keeps its place in it
      const all = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c));
      const tuned = tuneChannels(all, RATE, settings).channels;
      const name = `${(meta?.name ?? clip.name).replace(/\.[a-z0-9]+$/i, '')} (tuned).wav`;
      const sound = await importSoundFile(new Blob([encodeChannels(tuned, RATE, 24)], { type: 'audio/wav' }), name);
      useTimelineStore.getState().setClipAudio(clip.id, { soundId: sound.id, tunedFrom: original }, true);
      showToast(`Tuned to ${NOTE_NAMES[root]} ${scale}. Untune (in the same dialog) goes back to the original.`);
      onClose();
    } catch (err) {
      showToast(`Couldn't tune it: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const untune = () => {
    if (!audio.tunedFrom) return;
    useTimelineStore.getState().setClipAudio(clip.id, { soundId: audio.tunedFrom, tunedFrom: undefined }, true);
    onClose();
  };

  return (
    <Modal title="Tune vocal" onClose={onClose} wide>
      <p>
        Pulls the pitch of <span className="text-forge-text">{clip.name}</span> onto the notes of a key, keeping its timing. Best on one voice or one instrument
        playing one note at a time.{songKey ? ` The song's notes are in ${songKey.name}.` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
        <label className="flex items-center gap-1.5">
          KEY
          <select value={root} onChange={(e) => setRoot(Number(e.target.value))} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text" aria-label="Key">
            {NOTE_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select value={scale} onChange={(e) => setScale(e.target.value as Scale)} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text" aria-label="Scale">
            <option value="major">major</option>
            <option value="minor">minor</option>
            <option value="chromatic">chromatic (any note)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5" title="How far onto the note: 100% lands right on it">
          STRENGTH
          <input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-28 accent-cyan-400" aria-label="Strength" />
          <span className="w-10 text-forge-text">{Math.round(strength * 100)}%</span>
        </label>
        <label className="flex items-center gap-1.5" title="How fast it gets there: 0 ms is the hard, robotic tuned sound; 50 ms and up keeps slides and vibrato">
          SPEED
          <input type="range" min={0} max={300} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-28 accent-cyan-400" aria-label="Speed" />
          <span className="w-14 text-forge-text">{speed === 0 ? 'instant' : `${speed} ms`}</span>
        </label>
      </div>

      <PitchGraph frames={result?.frames ?? []} shift={result?.shift ?? []} root={root} steps={steps} color={track.color} loading={!result} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!result} onClick={() => (playing ? stop() : void preview(true))} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border hover:text-forge-text disabled:opacity-50">
          {playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} Hear tuned
        </button>
        <button type="button" disabled={!result} onClick={() => void preview(false)} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border hover:text-forge-text disabled:opacity-50">
          <Play className="w-3.5 h-3.5" /> Hear original
        </button>
        {audio.tunedFrom && (
          <button type="button" onClick={untune} className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border hover:text-forge-text">
            <Undo2 className="w-3.5 h-3.5" /> Untune
          </button>
        )}
        <button type="button" disabled={!source || busy} onClick={() => void apply()} className="ml-auto h-8 px-3 flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Apply
        </button>
      </div>
    </Modal>
  );
};

/** The pitch sung (grey) and tuned (colour), over the key's notes. */
const PitchGraph: React.FC<{ frames: PitchFrame[]; shift: number[]; root: number; steps: readonly number[]; color: string; loading: boolean }> = ({ frames, shift, root, steps, color, loading }) => {
  const W = 680;
  const H = 160;
  const voiced = frames.map((f) => (f.hz > 0 ? hzToMidi(f.hz) : null));
  const sung = voiced.filter((m): m is number => m !== null);
  if (loading || !sung.length) {
    return (
      <div className="h-40 flex items-center justify-center rounded-md border border-forge-border bg-black/40 text-forge-muted">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'No pitched sound found in this clip.'}
      </div>
    );
  }
  const lo = Math.floor(Math.min(...sung)) - 1;
  const hi = Math.ceil(Math.max(...sung)) + 1;
  const x = (i: number) => (i / Math.max(1, frames.length - 1)) * W;
  const y = (m: number) => H - ((m - lo) / Math.max(1, hi - lo)) * H;
  const path = (values: Array<number | null>) => {
    let d = '';
    let pen = false;
    values.forEach((m, i) => {
      if (m === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(m).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const notes: number[] = [];
  for (let n = lo; n <= hi; n++) if (steps.includes((((n - root) % 12) + 12) % 12)) notes.push(n);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40 rounded-md border border-forge-border bg-black/40" preserveAspectRatio="none" aria-label="Pitch, sung and tuned">
      {notes.map((n) => (
        <g key={n}>
          <line x1={0} x2={W} y1={y(n)} y2={y(n)} stroke="white" strokeOpacity={n % 12 === root ? 0.25 : 0.08} vectorEffect="non-scaling-stroke" />
          <text x={2} y={y(n) - 2} fontSize={9} fill="white" fillOpacity={0.4}>
            {NOTE_NAMES[((n % 12) + 12) % 12]}
            {Math.floor(n / 12) - 1}
          </text>
        </g>
      ))}
      <path d={path(voiced)} fill="none" stroke="#9ca3af" strokeOpacity={0.7} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path d={path(voiced.map((m, i) => (m === null ? null : m + (shift[i] ?? 0))))} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};
