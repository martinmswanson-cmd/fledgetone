import React, { useEffect, useMemo, useRef, useState } from 'react';
import { afterMaster, liveContext } from '../../audio/liveContext';
import { Loader2, Play, Square, Undo2, AudioLines } from 'lucide-react';
import { Modal } from './Modal';
import { useTimelineStore, songTempo } from '../../store/timelineStore';
import { tempoAt } from '../../audio/tempoMap';
import { detectKey, NOTE_NAMES } from '../../store/songKey';
import { hzToMidi, type PitchFrame } from '../../audio/vocalTune';
import { runDsp, runDspFull } from '../../audio/dspRun';
import { holdClip } from '../../store/clipJobs';
import { hardTuneChannels, msToSpeed, speedToMs, TUNE_SCALE_NAMES, TUNE_SCALES, type TuneScale } from '../../audio/hardTune';
import { useUiStore } from '../../store/uiStore';
import { decodeSound, importSoundFile, useSoundLibrary } from '../../audio/soundLibrary';
import { encodeChannels } from '../../audio/exportWav';
import { audioSourceSeconds } from '../../store/audioClips';
import { initAudio } from '../../audio/engine';
import { useExclusivePreview } from '../../audio/exclusivePreview';
import { showToast } from './toastStore';

/**
 * Tune a vocal (or any one-note-at-a-time recording): its pitch pulled onto the notes of a key.
 * The graph shows the pitch sung (grey) and where it goes (colour) against the key's notes. Apply
 * makes a tuned copy of the sound for the clip; the original is kept, and Untune goes back to it.
 * Opened as Hard tune (or with that button) it starts at full strength and instant speed: the
 * robotic sound (hardTune.ts). It's a processing step on the clip, so exports play the result.
 */

/** Natural tuning's starting settings: most of the way, gently (slides and vibrato kept). */
const NATURAL = { strength: 0.8, speed: msToSpeed(40) };
const HARD = { strength: 1, speed: 100 };
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
  const [scale, setScale] = useState<TuneScale>(songKey?.mode ?? 'major');
  const hard = useUiStore((s) => s.tuneHard);
  const [strength, setStrength] = useState(hard ? HARD.strength : NATURAL.strength);
  /** 0 (natural) to 100 (instant) */
  const [speed, setSpeed] = useState(hard ? HARD.speed : NATURAL.speed);
  const [source, setSource] = useState<AudioBuffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<AudioBufferSourceNode | null>(null);
  // The clip heard (tuned or not) is the one preview playing (and another starting stops it)
  const claim = useExclusivePreview('tune', () => {
    try {
      player.current?.stop();
    } catch {
      // Already ended
    }
    player.current = null;
    setPlaying(false);
  });
  const audio = clip?.audio;
  const original = audio?.tunedFrom ?? audio?.soundId;
  const meta = useSoundLibrary((s) => (original ? s.metas[original] : undefined));

  useEffect(() => {
    if (!original) return;
    decodeSound(original, RATE).then(setSource, () => showToast("Couldn't read the recording."));
  }, [original]);
  useEffect(() => () => player.current?.stop(), []);

  const steps = TUNE_SCALES[scale];
  const settings = { root, steps, strength, speed };
  // The part of the sound the clip plays
  const from = audio?.offset ?? 0;
  const to = clip ? from + audioSourceSeconds(clip, bpm) : 0;
  // Worked out a moment after the settings stop moving, in a Worker (it takes a little while on a
  // long take); a result for settings moved on from since is dropped
  const [result, setResult] = useState<ReturnType<typeof hardTuneChannels> | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!source) return;
    const mine = ++generation.current;
    const timer = window.setTimeout(() => {
      const a = Math.floor(from * RATE);
      const b = Math.min(source.length, Math.ceil(to * RATE));
      const part = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c).subarray(a, b));
      runDspFull({ kind: 'tune', settings: { root, steps, strength, speed } }, part, RATE, { wanted: () => generation.current === mine }).then(
        (r) => {
          if (generation.current === mine && r.frames && r.shift) setResult({ channels: r.channels, frames: r.frames, shift: r.shift });
        },
        () => {}
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [source, from, to, root, steps, strength, speed]);
  // While it's open nothing else swaps the clip's sound (its Untune goes back to the one it opened on)
  useEffect(() => holdClip(clipId), [clipId]);
  // (Closing the dialog drops what's still being worked out)
  useEffect(() => () => void generation.current++, []);

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
    const ctx = liveContext.rawContext as AudioContext;
    const chans = tuned ? result.channels : Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c).slice(Math.floor(from * RATE), Math.ceil(to * RATE)));
    const buf = ctx.createBuffer(chans.length, chans[0].length, RATE);
    chans.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(afterMaster());
    src.onended = () => setPlaying(false);
    claim();
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
      const tuned = await runDsp({ kind: 'tune', settings }, all, RATE);
      const name = `${(meta?.name ?? clip.name).replace(/\.[a-z0-9]+$/i, '')} (tuned).wav`;
      const sound = await importSoundFile(new Blob([encodeChannels(tuned, RATE, 24)], { type: 'audio/wav' }), name);
      useTimelineStore.getState().setClipAudio(clip.id, { soundId: sound.id, tunedFrom: original }, true);
      showToast(`Tuned to ${NOTE_NAMES[root]} ${TUNE_SCALE_NAMES[scale]}. Untune (in the same dialog) goes back to the original.`);
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
    <Modal title={hard ? 'Hard tune' : 'Tune vocal'} onClose={onClose} wide>
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
          <select value={scale} onChange={(e) => setScale(e.target.value as TuneScale)} className="h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text" aria-label="Scale">
            {(Object.keys(TUNE_SCALES) as TuneScale[]).map((k) => (
              <option key={k} value={k}>
                {TUNE_SCALE_NAMES[k]}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-1">
          {(
            [
              ['Natural', NATURAL, 'Most of the way onto the notes, gently: slides and vibrato kept'],
              ['Hard tune', HARD, 'All the way, instantly: the robotic stepped sound'],
            ] as const
          ).map(([label, preset, title]) => (
            <button
              key={label}
              type="button"
              title={title}
              onClick={() => {
                setStrength(preset.strength);
                setSpeed(preset.speed);
              }}
              className={`h-7 px-2 rounded border ${strength === preset.strength && speed === preset.speed ? 'border-cyan-400/70 text-cyan-100 bg-cyan-500/15' : 'border-forge-border hover:text-forge-text'}`}
            >
              {label}
            </button>
          ))}
        </span>
        <label className="flex items-center gap-1.5" title="How far onto the note: 100% lands right on it">
          STRENGTH
          <input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-28 accent-cyan-400" aria-label="Strength" />
          <span className="w-10 text-forge-text">{Math.round(strength * 100)}%</span>
        </label>
        <label className="flex items-center gap-1.5" title="How fast it gets onto the note: natural keeps slides and vibrato; instant is the hard, robotic tuned sound">
          SPEED
          <span className="text-forge-muted">natural</span>
          <input type="range" min={0} max={100} step={1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-28 accent-cyan-400" aria-label="Speed" />
          <span className="text-forge-muted">instant</span>
          <span className="w-14 text-forge-text">{speedToMs(speed)} ms</span>
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
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AudioLines className="w-3.5 h-3.5" />} Apply
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
